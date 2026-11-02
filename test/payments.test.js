import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

process.env.RAZORPAY_KEY_SECRET = 'test_secret';

const { verifySubscriptionPaymentSignature, resolveRazorpayEntitlement } = await import('../services/razorpayService.js');

function sign(payload) {
  return crypto.createHmac('sha256', 'test_secret').update(payload).digest('hex');
}

test('accepts Razorpay subscription signature payment_id|subscription_id', () => {
  const paymentId = 'pay_123';
  const subscriptionId = 'sub_456';
  const signature = sign(`${paymentId}|${subscriptionId}`);
  assert.equal(verifySubscriptionPaymentSignature({ paymentId, subscriptionId, signature }), true);
});

test('rejects a signature built in the opposite order', () => {
  const paymentId = 'pay_123';
  const subscriptionId = 'sub_456';
  const signature = sign(`${subscriptionId}|${paymentId}`);
  assert.equal(verifySubscriptionPaymentSignature({ paymentId, subscriptionId, signature }), false);
});

test('rejects a missing or tampered signature', () => {
  assert.equal(verifySubscriptionPaymentSignature({
    paymentId: 'pay_123',
    subscriptionId: 'sub_456',
    signature: 'deadbeef',
  }), false);
  assert.equal(verifySubscriptionPaymentSignature({
    paymentId: '',
    subscriptionId: 'sub_456',
    signature: 'abc',
  }), false);
});

test('an authorized trial lasts until Razorpay start_at', () => {
  const now = new Date('2026-11-02T00:00:00Z');
  const startAt = Math.floor(new Date('2026-11-09T00:00:00Z').getTime() / 1000);
  const result = resolveRazorpayEntitlement({
    status: 'authenticated',
    start_at: startAt,
    notes: { trial: 'true' },
  }, false, now);
  assert.equal(result.isTrial, true);
  assert.equal(result.expiry.toISOString(), '2026-11-09T00:00:00.000Z');
});

test('an active subscription uses the paid period, not another trial', () => {
  const now = new Date('2026-11-02T00:00:00Z');
  const currentEnd = Math.floor(new Date('2026-12-02T00:00:00Z').getTime() / 1000);
  const result = resolveRazorpayEntitlement({
    status: 'active',
    current_end: currentEnd,
    notes: { trial: 'true' },
  }, true, now);
  assert.equal(result.isTrial, false);
  assert.equal(result.expiry.toISOString(), '2026-12-02T00:00:00.000Z');
});

test('a repeat customer with no Razorpay record is billed for 30 days', () => {
  const now = new Date('2026-11-02T00:00:00Z');
  const result = resolveRazorpayEntitlement(null, true, now);
  assert.equal(result.isTrial, false);
  assert.equal(result.expiry.toISOString(), '2026-12-02T00:00:00.000Z');
});
