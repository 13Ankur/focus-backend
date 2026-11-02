import express from 'express';
import User from '../models/User.js';
import WebhookLog from '../models/WebhookLog.js';
import Transaction from '../models/Transaction.js';
import protect from '../middleware/auth.middleware.js';
import {
  getEffectiveTier,
  startTrial,
  isFeatureAvailable,
  activateSubscription,
  FEATURE_TIERS,
  TIER_LEVELS,
} from '../services/subscriptionService.js';
import {
  createSubscription,
  fetchSubscription,
  verifySubscriptionPaymentSignature,
  verifyWebhookSignature,
  resolveRazorpayEntitlement,
  VALID_TIERS,
} from '../services/razorpayService.js';
import { log } from '../utils/logger.js';

const router = express.Router();

// ── Product ID → tier mapping ──

const PRODUCT_TIER_MAP = {
  staypaws_pro_monthly: 'pro',
  staypaws_pro_annual: 'pro',
  staypaws_guardian_monthly: 'guardian',
  staypaws_guardian_annual: 'guardian',
};

// ── Consumable product ID → kibble amount ──

const KIBBLE_PACK_MAP = {
  staypaws_kibble_100: 100,
  staypaws_kibble_500: 500,
  staypaws_kibble_1200: 1200,
  staypaws_kibble_3000: 3000,
};

// ── Platform detection from store ──

function detectPlatform(event) {
  const store = event.store || '';
  if (store === 'APP_STORE' || store === 'MAC_APP_STORE') return 'ios';
  if (store === 'PLAY_STORE') return 'android';
  if (store === 'STRIPE') return 'web';
  return null;
}

// ── Find user from RevenueCat event ──

async function resolveUser(event) {
  const appUserId = event.app_user_id;
  if (!appUserId) return null;

  // Try by MongoDB _id first (our app sets this as the RC user ID)
  let user = null;
  if (appUserId.match(/^[0-9a-fA-F]{24}$/)) {
    user = await User.findById(appUserId);
  }

  // Fallback: try by revenuecatId
  if (!user) {
    user = await User.findOne({ revenuecatId: appUserId });
  }

  // Last resort: try by email if present in aliases
  if (!user && event.aliases?.length) {
    for (const alias of event.aliases) {
      if (alias.includes('@')) {
        user = await User.findOne({ email: alias.toLowerCase() });
        if (user) break;
      }
    }
  }

  return user;
}

// ════════════════════════════════════════════════════════════════════
//  POST /subscription/webhook — RevenueCat webhook handler
// ════════════════════════════════════════════════════════════════════

router.post('/webhook', async (req, res) => {
  // ── Verify authorization ──
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (secret) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${secret}`) {
      console.warn('Webhook auth failed — invalid secret');
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  // Always return 200 immediately so RevenueCat doesn't retry
  res.status(200).json({ received: true });

  // ── Process asynchronously ──
  try {
    const body = req.body;
    const event = body.event || body;

    const eventId = event.id || `${event.type}_${Date.now()}`;
    const eventType = event.type;

    if (!eventType) {
      console.warn('Webhook received with no event type');
      return;
    }

    // ── Duplicate check ──
    const existing = await WebhookLog.findOne({ eventId });
    if (existing) {
      console.log(`Webhook duplicate skipped: ${eventId}`);
      return;
    }

    // ── Log the event ──
    const log = await WebhookLog.create({
      eventId,
      eventType,
      appUserId: event.app_user_id || null,
      productId: event.product_id || null,
      rawPayload: event,
    });

    // ── Resolve user ──
    const user = await resolveUser(event);
    if (!user) {
      console.warn(`Webhook: user not found for app_user_id="${event.app_user_id}", event=${eventType}`);
      log.error = 'user_not_found';
      await log.save();
      return;
    }

    // ── Handle by event type ──
    switch (eventType) {
      case 'INITIAL_PURCHASE':
        await handleInitialPurchase(user, event);
        break;

      case 'RENEWAL':
        await handleRenewal(user, event);
        break;

      case 'CANCELLATION':
        await handleCancellation(user, event);
        break;

      case 'EXPIRATION':
        await handleExpiration(user, event);
        break;

      case 'BILLING_ISSUE':
        await handleBillingIssue(user, event);
        break;

      case 'PRODUCT_CHANGE':
        await handleProductChange(user, event);
        break;

      case 'NON_RENEWING_PURCHASE':
        await handleConsumablePurchase(user, event);
        break;

      case 'SUBSCRIBER_ALIAS':
        await handleSubscriberAlias(user, event);
        break;

      default:
        console.log(`Webhook: unhandled event type "${eventType}"`);
    }

    log.processed = true;
    await log.save();
  } catch (err) {
    console.error('Webhook processing error:', err.message);
  }
});

// ════════════════════════════════════════════════════════════════════
//  Event Handlers
// ════════════════════════════════════════════════════════════════════

async function handleInitialPurchase(user, event) {
  const productId = event.product_id;
  const tier = PRODUCT_TIER_MAP[productId];

  if (!tier) {
    // Might be a consumable initial purchase
    if (KIBBLE_PACK_MAP[productId] !== undefined) {
      return handleConsumablePurchase(user, event);
    }
    console.warn(`Webhook INITIAL_PURCHASE: unknown product_id="${productId}"`);
    return;
  }

  const expiry = event.expiration_at_ms
    ? new Date(event.expiration_at_ms)
    : null;
  const platform = detectPlatform(event);

  user.subscriptionTier = tier;
  user.subscriptionExpiry = expiry;
  user.subscriptionPlatform = platform;
  user.isPremium = TIER_LEVELS[tier] >= TIER_LEVELS.pro;
  user.subscriptionCancelled = false;
  user.subscriptionGracePeriod = false;

  if (event.app_user_id && !user.revenuecatId) {
    user.revenuecatId = event.app_user_id;
  }

  await user.save();
  console.log(`Subscription activated: user=${user._id}, tier=${tier}, expiry=${expiry}`);
}

async function handleRenewal(user, event) {
  const expiry = event.expiration_at_ms
    ? new Date(event.expiration_at_ms)
    : user.subscriptionExpiry;

  const productId = event.product_id;
  const tier = PRODUCT_TIER_MAP[productId] || user.subscriptionTier;

  user.subscriptionExpiry = expiry;
  user.subscriptionTier = tier;
  user.isPremium = TIER_LEVELS[tier] >= TIER_LEVELS.pro;
  user.subscriptionCancelled = false;
  user.subscriptionGracePeriod = false;
  await user.save();

  console.log(`Subscription renewed: user=${user._id}, newExpiry=${expiry}`);
}

async function handleCancellation(user, event) {
  // User cancelled but may still have access until expiry
  user.subscriptionCancelled = true;
  await user.save();

  console.log(`Subscription cancelled: user=${user._id}, expiresAt=${user.subscriptionExpiry}`);
}

async function handleExpiration(user, event) {
  user.subscriptionTier = 'free';
  user.subscriptionExpiry = null;
  user.isPremium = false;
  user.subscriptionCancelled = false;
  user.subscriptionGracePeriod = false;
  // Keep all earned data (kibble, breeds, stats, accessories)
  await user.save();

  console.log(`Subscription expired — downgraded: user=${user._id}`);
}

async function handleBillingIssue(user, event) {
  user.subscriptionGracePeriod = true;
  await user.save();

  console.log(`Billing issue (grace period): user=${user._id}`);
}

async function handleProductChange(user, event) {
  const newProductId = event.new_product_id || event.product_id;
  const newTier = PRODUCT_TIER_MAP[newProductId];

  if (!newTier) {
    console.warn(`Webhook PRODUCT_CHANGE: unknown new product_id="${newProductId}"`);
    return;
  }

  const expiry = event.expiration_at_ms
    ? new Date(event.expiration_at_ms)
    : user.subscriptionExpiry;

  user.subscriptionTier = newTier;
  user.subscriptionExpiry = expiry;
  user.isPremium = TIER_LEVELS[newTier] >= TIER_LEVELS.pro;
  user.subscriptionCancelled = false;
  user.subscriptionGracePeriod = false;
  await user.save();

  console.log(`Subscription changed: user=${user._id}, newTier=${newTier}`);
}

async function handleConsumablePurchase(user, event) {
  const productId = event.product_id;
  const kibbleAmount = KIBBLE_PACK_MAP[productId];

  if (kibbleAmount === undefined) {
    console.warn(`Webhook NON_RENEWING_PURCHASE: unknown product_id="${productId}"`);
    return;
  }

  // Idempotency: check if this transaction was already processed
  const txnId = event.id || event.transaction_id || `rc_${event.app_user_id}_${Date.now()}`;
  const existingTxn = await Transaction.findOne({ transactionId: txnId });
  if (existingTxn) {
    console.log(`Consumable purchase duplicate skipped: txn=${txnId}`);
    return;
  }

  // Record transaction
  await Transaction.create({
    userId: user._id,
    transactionId: txnId,
    source: 'webhook',
    type: 'kibble_pack',
    productId,
    amount: kibbleAmount,
    status: 'completed',
  });

  // Credit kibble
  await User.findOneAndUpdate(
    { _id: user._id },
    { $inc: { totalKibble: kibbleAmount } },
  );

  console.log(`Kibble pack purchased: user=${user._id}, product=${productId}, kibble=+${kibbleAmount}`);
}

async function handleSubscriberAlias(user, event) {
  const newId = event.new_app_user_id || event.app_user_id;
  if (newId && newId !== user.revenuecatId) {
    user.revenuecatId = newId;
    await user.save();
    console.log(`Subscriber alias updated: user=${user._id}, newRcId=${newId}`);
  }
}

// ════════════════════════════════════════════════════════════════════
//  Existing authenticated endpoints
// ════════════════════════════════════════════════════════════════════

// Current user's subscription status
router.get('/status', protect, (req, res) => {
  try {
    const user = req.user;
    const now = new Date();
    const effectiveTier = getEffectiveTier(user);
    const isPremium = (TIER_LEVELS[effectiveTier] ?? 0) >= TIER_LEVELS.pro;
    const trialActive = !!(user.trialEndDate && user.trialEndDate > now);
    // Free accounts must not receive leftover Pro dates — clients used those to unlock UI.

    res.json({
      tier: effectiveTier,
      expiry: isPremium ? (user.subscriptionExpiry || null) : null,
      platform: user.subscriptionPlatform,
      cancelled: user.subscriptionCancelled || false,
      gracePeriod: user.subscriptionGracePeriod || false,
      trial: {
        used: !!user.trialUsed,
        start: trialActive ? user.trialStartDate : null,
        end: trialActive ? user.trialEndDate : null,
        active: trialActive,
      },
      isPremium,
    });
  } catch (err) {
    console.error('GET /subscription/status error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Start 7-day Pro trial (Discontinued)
router.post('/start-trial', protect, async (req, res) => {
  return res.status(403).json({
    error: 'trials_disabled',
    message: 'Free trials are no longer available. Please subscribe to StayPaws Pro.',
  });
});

// Feature availability map for current user
router.get('/features', protect, (req, res) => {
  try {
    const features = {};
    for (const feature of Object.keys(FEATURE_TIERS)) {
      features[feature] = isFeatureAvailable(req.user, feature);
    }
    res.json({ features });
  } catch (err) {
    console.error('GET /subscription/features error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create Razorpay subscription (Android & Web checkout)
router.post('/razorpay/create', protect, async (req, res) => {
  try {
    const tier = req.body?.tier || 'pro';

    if (!VALID_TIERS.includes(tier)) {
      return res.status(400).json({
        error: 'invalid_tier',
        message: 'Tier must be "pro".',
      });
    }

    const result = await createSubscription(tier, req.user);
    log('info', 'razorpay_create', {
      userId: String(req.user._id),
      tier: result.tier,
      trial: result.trial,
      subscriptionId: result.subscriptionId,
    });
    res.json(result);
  } catch (err) {
    log('error', 'razorpay_create_failed', {
      userId: String(req.user?._id || ''),
      message: err.message,
    });
    if (err.message.includes('not configured') || err.message.includes('plan ID') || err.message.includes('Invalid subscription tier')) {
      return res.status(503).json({
        error: 'razorpay_not_configured',
        message: 'Payment configuration error: ' + err.message,
      });
    }
    res.status(500).json({ message: 'Could not create subscription: ' + err.message });
  }
});

// Verify Razorpay Subscription / Payment
router.post('/verify-razorpay', protect, async (req, res) => {
  try {
    let { paymentId, subscriptionId, signature, tier = 'pro' } = req.body;

    if (tier === 'guardian') tier = 'pro';

    if (!paymentId || !subscriptionId || !signature) {
      return res.status(400).json({
        error: 'missing_fields',
        message: 'paymentId, subscriptionId, and signature are required.',
      });
    }

    if (!VALID_TIERS.includes(tier)) {
      return res.status(400).json({
        error: 'invalid_tier',
        message: 'Tier must be "pro".',
      });
    }

    const valid = verifySubscriptionPaymentSignature({
      paymentId,
      subscriptionId,
      signature,
    });

    if (!valid) {
      log('warn', 'razorpay_bad_signature', {
        userId: String(req.user._id),
        paymentId,
        subscriptionId,
      });
      return res.status(400).json({
        error: 'invalid_signature',
        message: 'Payment signature verification failed.',
      });
    }

    let remote = null;
    try {
      remote = await fetchSubscription(subscriptionId);
    } catch (fetchErr) {
      log('warn', 'razorpay_fetch_failed', {
        userId: String(req.user._id),
        subscriptionId,
        message: fetchErr.message,
      });
    }

    const notesUserId = remote?.notes?.userId;
    if (notesUserId && notesUserId !== String(req.user._id)) {
      log('warn', 'razorpay_user_mismatch', {
        userId: String(req.user._id),
        notesUserId,
        subscriptionId,
      });
      return res.status(403).json({
        error: 'user_mismatch',
        message: 'This payment belongs to a different account.',
      });
    }

    const { isTrial, expiry } = resolveRazorpayEntitlement(remote, req.user.trialUsed);
    const platform = req.body?.platform === 'web' ? 'web' : 'android';
    const user = await grantRazorpayAccess(req.user._id, {
      tier,
      platform,
      expiry,
      isTrial,
      subscriptionId,
      paymentId,
    });

    log('info', 'razorpay_verified', {
      userId: String(user._id),
      paymentId,
      subscriptionId,
      trial: isTrial,
      expiry: expiry.toISOString(),
      platform,
    });

    res.json({
      success: true,
      message: isTrial
        ? '7-day free trial started. Payment details saved.'
        : 'Subscription verified successfully',
      tier: user.subscriptionTier,
      expiry: user.subscriptionExpiry,
      trial: isTrial,
    });
  } catch (err) {
    log('error', 'razorpay_verify_failed', {
      userId: String(req.user?._id || ''),
      message: err.message,
    });
    if (err.message.includes('not configured')) {
      return res.status(503).json({
        error: 'razorpay_not_configured',
        message: 'Payment is temporarily unavailable. Please try again later.',
      });
    }
    res.status(500).json({ message: 'Could not verify payment' });
  }
});

// Finish a payment that Razorpay already accepted if the app closed before verify.
router.post('/razorpay/recover', protect, async (req, res) => {
  try {
    const subscriptionId = req.body?.subscriptionId;
    if (!subscriptionId) {
      return res.status(400).json({
        error: 'missing_fields',
        message: 'subscriptionId is required.',
      });
    }

    const remote = await fetchSubscription(subscriptionId);
    const notesUserId = remote?.notes?.userId;
    const ownsSubscription = notesUserId
      ? notesUserId === String(req.user._id)
      : req.user.razorpaySubscriptionId === subscriptionId;

    if (!ownsSubscription) {
      log('warn', 'razorpay_recover_denied', {
        userId: String(req.user._id),
        subscriptionId,
      });
      return res.status(403).json({
        error: 'user_mismatch',
        message: 'This subscription belongs to a different account.',
      });
    }

    const status = remote?.status;
    if (status !== 'authenticated' && status !== 'active') {
      return res.status(409).json({
        error: 'not_confirmed',
        message: 'Razorpay has not confirmed this payment yet.',
      });
    }

    const { isTrial, expiry } = resolveRazorpayEntitlement(remote, req.user.trialUsed);
    const platform = req.body?.platform === 'web' ? 'web' : 'android';
    const user = await grantRazorpayAccess(req.user._id, {
      tier: 'pro',
      platform,
      expiry,
      isTrial,
      subscriptionId,
    });

    log('info', 'razorpay_recovered', {
      userId: String(user._id),
      subscriptionId,
      status,
      trial: isTrial,
      expiry: expiry.toISOString(),
    });

    res.json({
      success: true,
      message: 'Subscription restored',
      tier: user.subscriptionTier,
      expiry: user.subscriptionExpiry,
      trial: isTrial,
    });
  } catch (err) {
    log('error', 'razorpay_recover_failed', {
      userId: String(req.user?._id || ''),
      message: err.message,
    });
    res.status(500).json({ message: 'Could not restore the subscription' });
  }
});

// Razorpay charges the saved payment method when the trial ends.
// Dashboard webhook URL: POST /subscription/razorpay/webhook
router.post('/razorpay/webhook', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (webhookSecret) {
    const valid = verifyWebhookSignature(req.rawBody, signature);
    if (!valid) {
      console.warn('Razorpay webhook signature failed');
      return res.status(400).json({ error: 'invalid_signature' });
    }
  } else {
    console.warn('RAZORPAY_WEBHOOK_SECRET is not set — accepting Razorpay webhook without signature check');
  }

  const event = req.body?.event;
  const subscription = req.body?.payload?.subscription?.entity;
  const payment = req.body?.payload?.payment?.entity;

  if (!event || !subscription?.id) {
    return res.status(200).json({ received: true });
  }

  const eventId = req.body?.id || `${event}_${subscription.id}_${payment?.id || ''}`;

  try {
    const existing = await WebhookLog.findOne({ eventId });
    if (existing) {
      return res.status(200).json({ received: true, duplicate: true });
    }

    await WebhookLog.create({
      eventId,
      eventType: event,
      appUserId: subscription.notes?.userId || null,
      productId: subscription.id,
      processed: false,
      rawPayload: req.body,
    });

    const user = await findRazorpayUser(subscription);
    if (!user) {
      console.warn(`Razorpay webhook ${event}: user not found for ${subscription.id}`);
      return res.status(200).json({ received: true });
    }

    const periodEnd = subscription.current_end
      ? new Date(subscription.current_end * 1000)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    if (event === 'subscription.charged' || event === 'subscription.activated') {
      user.subscriptionTier = 'pro';
      user.subscriptionExpiry = periodEnd;
      user.subscriptionPlatform = user.subscriptionPlatform || 'android';
      user.isPremium = true;
      user.subscriptionCancelled = false;
      user.subscriptionGracePeriod = false;
      user.razorpaySubscriptionId = subscription.id;
      await user.save();

      if (payment?.id) {
        await Transaction.updateOne(
          { transactionId: payment.id },
          {
            $setOnInsert: {
              userId: user._id,
              transactionId: payment.id,
              source: 'razorpay',
              type: 'subscription',
              productId: subscription.id,
              amount: typeof payment.amount === 'number' ? payment.amount / 100 : 0,
              status: 'completed',
            },
          },
          { upsert: true },
        );
      }

      console.log(`Razorpay ${event}: user=${user._id} pro until ${periodEnd.toISOString()}`);
    } else if (event === 'subscription.halted' || event === 'subscription.pending') {
      user.subscriptionGracePeriod = true;
      user.razorpaySubscriptionId = subscription.id;
      await user.save();
      console.log(`Razorpay ${event}: user=${user._id} payment failed after trial`);
    } else if (event === 'subscription.cancelled') {
      user.subscriptionCancelled = true;
      user.razorpaySubscriptionId = subscription.id;
      if (subscription.current_end) {
        user.subscriptionExpiry = periodEnd;
      }
      await user.save();
      console.log(`Razorpay subscription cancelled: user=${user._id}`);
    }

    await WebhookLog.updateOne({ eventId }, { $set: { processed: true } });
  } catch (err) {
    log('error', 'razorpay_webhook_failed', { event, message: err.message });
    await WebhookLog.updateOne({ eventId }, { $set: { error: err.message } }).catch(() => {});
  }

  return res.status(200).json({ received: true });
});

async function grantRazorpayAccess(userId, {
  tier,
  platform,
  expiry,
  isTrial,
  subscriptionId,
  paymentId,
  amount = 0,
}) {
  const user = await activateSubscription(userId, tier, platform, expiry);
  user.subscriptionCancelled = false;
  user.subscriptionGracePeriod = false;
  user.razorpaySubscriptionId = subscriptionId;
  if (isTrial) {
    user.trialUsed = true;
    if (!user.trialStartDate) user.trialStartDate = new Date();
    user.trialEndDate = expiry;
  }
  await user.save();

  if (paymentId) {
    await Transaction.updateOne(
      { transactionId: paymentId },
      {
        $setOnInsert: {
          userId: user._id,
          transactionId: paymentId,
          source: 'razorpay',
          type: 'subscription',
          productId: subscriptionId,
          amount,
          status: 'completed',
        },
      },
      { upsert: true },
    );
  }

  return user;
}

async function findRazorpayUser(subscription) {
  const notesUserId = subscription?.notes?.userId;
  if (notesUserId && /^[0-9a-fA-F]{24}$/.test(notesUserId)) {
    const byId = await User.findById(notesUserId);
    if (byId) return byId;
  }
  if (subscription?.id) {
    return User.findOne({ razorpaySubscriptionId: subscription.id });
  }
  return null;
}

export default router;
