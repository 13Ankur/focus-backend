import express from 'express';
import User from '../models/User.js';
import WebhookLog from '../models/WebhookLog.js';
import Transaction from '../models/Transaction.js';
import protect from '../middleware/auth.middleware.js';
import {
  getEffectiveTier,
  startTrial,
  isFeatureAvailable,
  FEATURE_TIERS,
  TIER_LEVELS,
} from '../services/subscriptionService.js';

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
    const trialActive = !!(user.trialUsed && user.trialEndDate && user.trialEndDate > now);

    res.json({
      tier: effectiveTier,
      expiry: user.subscriptionExpiry,
      platform: user.subscriptionPlatform,
      cancelled: user.subscriptionCancelled || false,
      gracePeriod: user.subscriptionGracePeriod || false,
      trial: {
        used: user.trialUsed,
        start: user.trialStartDate,
        end: user.trialEndDate,
        active: trialActive,
      },
      isPremium: user.isPremium,
    });
  } catch (err) {
    console.error('GET /subscription/status error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Start 7-day Pro trial
router.post('/start-trial', protect, async (req, res) => {
  try {
    const user = await startTrial(req.user._id);
    const now = new Date();

    res.json({
      message: 'Trial started',
      tier: 'pro',
      trial: {
        used: true,
        start: user.trialStartDate,
        end: user.trialEndDate,
        active: user.trialEndDate > now,
      },
    });
  } catch (err) {
    if (err.message === 'Trial already used') {
      return res.status(409).json({
        error: 'trial_already_used',
        message: 'You have already used your free trial.',
      });
    }
    console.error('POST /subscription/start-trial error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
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

export default router;
