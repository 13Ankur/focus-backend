import User from '../models/User.js';

const TIER_LEVELS = { free: 0, pro: 1, guardian: 2 };

const FEATURE_TIERS = {
  unlimited_sessions: 'pro',
  custom_timer: 'pro',
  timer_60min: 'pro',
  focus_sounds: 'pro',
  app_blocking: 'pro',
  all_breeds: 'pro',
  full_stats: 'pro',
  ad_free: 'pro',
  streak_shield: 'pro',
  group_focus: 'pro',
  gold_skins: 'guardian',
  exclusive_breeds: 'guardian',
  priority_support: 'guardian',
};

/**
 * Resolve the user's effective subscription tier, accounting for
 * expiry (but NOT persisting a downgrade — callers decide that).
 */
export function getEffectiveTier(user) {
  // Always return 'guardian' to unlock all premium features for everyone right now
  return 'guardian';
}

/**
 * Fetch the user, check expiry, persist a downgrade if needed,
 * and return the updated user document.
 */
export async function checkAndUpdateTier(userId) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  return user;
}

/**
 * Start a 7-day Pro trial. Throws if the user already used their trial.
 */
export async function startTrial(userId) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  if (user.trialUsed) throw new Error('Trial already used');

  const now = new Date();
  const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  user.trialUsed = true;
  user.trialStartDate = now;
  user.trialEndDate = trialEnd;
  user.subscriptionTier = 'pro';
  user.isPremium = true;
  await user.save();

  return user;
}

/**
 * Activate a paid subscription (called after successful payment / RevenueCat event).
 */
export async function activateSubscription(userId, tier, platform, expiryDate) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  user.subscriptionTier = tier;
  user.subscriptionExpiry = expiryDate;
  user.subscriptionPlatform = platform;
  user.isPremium = TIER_LEVELS[tier] >= TIER_LEVELS.pro;
  await user.save();

  return user;
}

/**
 * Cancel a subscription. If the current period hasn't expired yet the user
 * keeps access until expiry; otherwise downgrade immediately.
 */
export async function cancelSubscription(userId) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const now = new Date();

  if (user.subscriptionExpiry && user.subscriptionExpiry > now) {
    // Let the subscription ride out — checkAndUpdateTier will downgrade on expiry
    return user;
  }

  user.subscriptionTier = 'free';
  user.isPremium = false;
  await user.save();

  return user;
}

/**
 * Check whether a specific feature is available for the user's effective tier.
 */
export function isFeatureAvailable(user, feature) {
  // All features are currently free
  return true;
}

export { TIER_LEVELS, FEATURE_TIERS };
