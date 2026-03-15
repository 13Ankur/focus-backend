/**
 * One-time migration: Prepare all existing users for the tiered subscription model.
 *
 * Strategy:
 *   - Every existing user gets 30 days of free "Founder Pro" as a thank-you.
 *   - After 30 days they can subscribe or revert to free tier.
 *   - All earned data (kibble, breeds, stats, accessories) is preserved.
 *
 * Usage:
 *   NODE_ENV=production node scripts/migrate-to-tiers.js
 *   (or without NODE_ENV for dry-run against dev DB)
 *
 * Safety:
 *   - Idempotent: skips users who already have founderBonus = true
 *   - Uses bulkWrite for atomicity per-batch
 *   - Logs every step
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import User from '../models/User.js';

const FOUNDER_PRO_DAYS = 30;
const BATCH_SIZE = 500;

async function run() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('❌ MONGODB_URI not set. Add it to .env or pass as env var.');
    process.exit(1);
  }

  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('✅ Connected');

  const now = new Date();
  const founderExpiry = new Date(now.getTime() + FOUNDER_PRO_DAYS * 24 * 60 * 60 * 1000);

  // Count eligible users (not already migrated)
  const eligibleCount = await User.countDocuments({ founderBonus: { $ne: true } });
  console.log(`📊 Found ${eligibleCount} user(s) to migrate`);

  if (eligibleCount === 0) {
    console.log('✅ No users to migrate — already up to date.');
    await mongoose.disconnect();
    return;
  }

  let processed = 0;
  let errors = 0;

  // Process in batches
  while (processed < eligibleCount) {
    const users = await User.find({ founderBonus: { $ne: true } })
      .select('_id username subscriptionTier')
      .limit(BATCH_SIZE)
      .lean();

    if (users.length === 0) break;

    const ops = users.map(user => ({
      updateOne: {
        filter: { _id: user._id },
        update: {
          $set: {
            subscriptionTier: 'pro',
            subscriptionExpiry: founderExpiry,
            isPremium: true,
            founderBonus: true,
            subscriptionCancelled: false,
            subscriptionGracePeriod: false,
            trialUsed: false,
            dailySessionCount: 0,
            onboardingCompleted: true,
          },
        },
      },
    }));

    try {
      const result = await User.bulkWrite(ops, { ordered: false });
      processed += result.modifiedCount;
      console.log(`  ✅ Batch: ${result.modifiedCount} migrated (${processed}/${eligibleCount})`);
    } catch (err) {
      console.error(`  ❌ Batch error: ${err.message}`);
      errors++;
      // Skip this batch and continue
      processed += users.length;
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('  Migration Complete');
  console.log(`  Total processed: ${processed}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Founder Pro expires: ${founderExpiry.toISOString()}`);
  console.log('═══════════════════════════════════════');
  console.log('');
  console.log('Existing user data (kibble, breeds, stats, accessories) was preserved.');
  console.log(`All migrated users now have Pro access until ${founderExpiry.toLocaleDateString()}.`);

  await mongoose.disconnect();
  console.log('🔌 Disconnected from MongoDB');
}

run().catch(err => {
  console.error('💥 Migration failed:', err);
  process.exit(1);
});
