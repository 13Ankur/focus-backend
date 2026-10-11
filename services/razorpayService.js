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

/**
 * Create a Razorpay subscription for Pro.
 * Returns { keyId, subscriptionId, tier }.
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

  const subscription = await razorpay.subscriptions.create({
    plan_id: planId,
    total_count: 12, // 12 monthly billing cycles
    customer_notify: 1,
    notes: {
      userId: String(user._id),
      tier: normalizedTier,
      email: user.email || '',
    },
  });

  return {
    keyId: process.env.RAZORPAY_KEY_ID || 'rzp_live_T0E1gmDDGHQVdV',
    subscriptionId: subscription.id,
    tier: normalizedTier,
  };
}

/**
 * Verify Razorpay subscription payment signature.
 * Signature payload: subscription_id|payment_id
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
    .update(`${subscriptionId}|${paymentId}`)
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

export { VALID_TIERS, getPlanIdForTier };
