import crypto from 'crypto';
import Razorpay from 'razorpay';

/** Only Free + Pro are offered right now */
const VALID_TIERS = ['pro'];

function getPlanIdForTier(tier) {
  if (tier === 'pro') {
    return process.env.RAZORPAY_PLAN_PRO || 'plan_TV7AXOU5yKFJtF';
  }
  return null;
}

function getRazorpayClient() {
  const key_id = process.env.RAZORPAY_KEY_ID || 'rzp_live_T0E1gmDDGHQVdV';
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret) {
    throw new Error('Razorpay credentials are not configured');
  }

  return new Razorpay({ key_id, key_secret });
}

const TRIAL_DAYS = 7;

/**
 * Create a Razorpay subscription for Pro.
 * First-time subscribers authorize a payment method now and are charged
 * after a 7-day trial. Anyone who already used a trial is charged immediately.
 * Returns { keyId, subscriptionId, tier, trial, trialEndsAt }.
 */
export async function createSubscription(tier, user) {
  const normalizedTier = tier === 'guardian' ? 'pro' : tier;

  if (!VALID_TIERS.includes(normalizedTier)) {
    throw new Error('Invalid subscription tier');
  }

  const planId = getPlanIdForTier(normalizedTier);
  if (!planId) {
    throw new Error(`Razorpay plan ID not configured for tier "${normalizedTier}"`);
  }

  const razorpay = getRazorpayClient();
  const includeTrial = !user.trialUsed;
  const trialEndsAt = includeTrial
    ? new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000)
    : null;

  const payload = {
    plan_id: planId,
    total_count: 12, // 12 monthly billing cycles after the trial
    customer_notify: 1,
    notes: {
      userId: String(user._id),
      tier: normalizedTier,
      email: user.email || '',
      trial: includeTrial ? 'true' : 'false',
    },
  };

  // Future start_at collects payment details now and charges on that date.
  if (trialEndsAt) {
    payload.start_at = Math.floor(trialEndsAt.getTime() / 1000);
  }

  const subscription = await razorpay.subscriptions.create(payload);

  return {
    keyId: process.env.RAZORPAY_KEY_ID || 'rzp_live_T0E1gmDDGHQVdV',
    subscriptionId: subscription.id,
    tier: normalizedTier,
    trial: includeTrial,
    trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
  };
}

export async function fetchSubscription(subscriptionId) {
  const razorpay = getRazorpayClient();
  return razorpay.subscriptions.fetch(subscriptionId);
}

/**
 * Decide whether a verified Razorpay subscription is still in the free trial
 * and when Pro access should end.
 * Paid statuses (active) always use the paid period, even if the trial note remains.
 */
export function resolveRazorpayEntitlement(remote, trialUsed, now = new Date()) {
  const startAt = remote?.start_at ? new Date(remote.start_at * 1000) : null;
  const trialEnd = startAt && startAt > now
    ? startAt
    : new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const paidEnd = remote?.current_end
    ? new Date(remote.current_end * 1000)
    : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const paid = remote?.status === 'active';
  const isTrial = paid
    ? false
    : remote
      ? remote.status === 'authenticated'
        || !!(startAt && startAt > now)
        || remote.notes?.trial === 'true'
      : !trialUsed;

  return {
    isTrial,
    expiry: isTrial ? trialEnd : paidEnd,
  };
}

/**
 * Verify Razorpay subscription payment signature.
 * Razorpay signs payment_id|subscription_id with the key secret.
 */
export function verifySubscriptionPaymentSignature({
  paymentId,
  subscriptionId,
  signature,
}) {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    throw new Error('Razorpay key secret is not configured');
  }

  if (!paymentId || !subscriptionId || !signature) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${paymentId}|${subscriptionId}`)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(signature, 'utf8'),
    );
  } catch {
    return false;
  }
}

/** Razorpay webhook signature is HMAC-SHA256 of the raw request body. */
export function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !rawBody || !signature) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(signature, 'utf8'),
    );
  } catch {
    return false;
  }
}

export { VALID_TIERS, getPlanIdForTier, TRIAL_DAYS };
