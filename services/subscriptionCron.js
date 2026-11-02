import User from '../models/User.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Find all users whose paid subscription has expired but hasn't been
 * downgraded yet (webhook may have been missed), and downgrade them.
 */
async function downgradeExpiredSubscriptions() {
  const now = new Date();

  try {
    const result = await User.updateMany(
      {
        subscriptionTier: { $ne: 'free' },
        subscriptionExpiry: { $ne: null, $lte: now },
      },
      {
        $set: {
          subscriptionTier: 'free',
          isPremium: false,
          subscriptionCancelled: false,
          subscriptionGracePeriod: false,
        },
      },
    );

    if (result.modifiedCount > 0) {
      console.log(`🔄 Downgraded ${result.modifiedCount} expired subscription(s)`);
    }
  } catch (err) {
    console.error('Subscription expiry check error:', err.message);
  }

  // isPremium / tier with no payment dates is not a subscription.
  // Real purchases always store a platform and an expiry.
  try {
    const stale = await User.updateMany(
      {
        subscriptionTier: { $ne: 'free' },
        subscriptionPlatform: null,
        $and: [
          { $or: [{ subscriptionExpiry: null }, { subscriptionExpiry: { $exists: false } }] },
          {
            $or: [
              { trialEndDate: null },
              { trialEndDate: { $exists: false } },
              { trialEndDate: { $lte: now } },
            ],
          },
        ],
      },
      { $set: { subscriptionTier: 'free', isPremium: false } },
    );
    if (stale.modifiedCount > 0) {
      console.log(`🔄 Cleared ${stale.modifiedCount} subscription flag(s) with no expiry`);
    }
  } catch (err) {
    console.error('Stale premium flag check error:', err.message);
  }

  // Also expire finished trials
  try {
    const trialResult = await User.updateMany(
      {
        trialUsed: true,
        trialEndDate: { $ne: null, $lte: now },
        subscriptionTier: { $nin: ['pro', 'guardian'] },
        isPremium: true,
      },
      {
        $set: { isPremium: false },
      },
    );

    if (trialResult.modifiedCount > 0) {
      console.log(`🔄 Expired ${trialResult.modifiedCount} trial(s)`);
    }
  } catch (err) {
    console.error('Trial expiry check error:', err.message);
  }
}

/**
 * Start the hourly subscription expiry check.
 * Also runs once immediately on startup.
 */
export function startSubscriptionCron() {
  console.log('⏰ Subscription expiry cron started (runs every hour)');

  // Run on startup after a short delay (let DB connect first)
  setTimeout(() => {
    downgradeExpiredSubscriptions();
  }, 5000);

  // Then every hour
  setInterval(downgradeExpiredSubscriptions, ONE_HOUR_MS);
}

export { downgradeExpiredSubscriptions };
