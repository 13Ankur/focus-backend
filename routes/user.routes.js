import express from 'express';
import { randomUUID } from 'crypto';
import Focus from '../models/Focus.js';
import User from '../models/User.js';
import Stats from '../models/Stats.js';
import BreedCollection from '../models/BreedCollection.js';
import Transaction from '../models/Transaction.js';
import DailyStats from '../models/DailyStats.js';
import Achievement from '../models/Achievement.js';
import Accessory from '../models/Accessory.js';
import LeaderboardEntry from '../models/LeaderboardEntry.js';
import VerificationToken from '../models/VerificationToken.js';
import FocusRoom from '../models/FocusRoom.js';
import protect from '../middleware/auth.middleware.js';

const router = express.Router();

// @route   GET /user/profile
// @desc    Get user profile with focus stats and kibble balance
// @access  Private
router.get('/profile', protect, async (req, res) => {
  try {
    // Get focus session statistics
    const focusSessions = await Focus.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(10);

    const totalSessions = await Focus.countDocuments({ userId: req.user._id });
    const completedSessions = await Focus.countDocuments({
      userId: req.user._id,
      status: 'completed',
    });
    const failedSessions = await Focus.countDocuments({
      userId: req.user._id,
      status: 'failed',
    });

    res.json({
      user: {
        _id: req.user._id,
        username: req.user.username,
        email: req.user.email,
        totalKibble: req.user.totalKibble,
        totalFocusMinutes: req.user.totalFocusMinutes,
        buddyHappiness: req.user.buddyHappiness,
        buddyFullness: req.user.buddyFullness,
        lastBuddyInteraction: req.user.lastBuddyInteraction,
      },
      stats: {
        totalSessions,
        completedSessions,
        failedSessions,
        completionRate:
          totalSessions > 0
            ? Math.round((completedSessions / totalSessions) * 100)
            : 0,
      },
      recentSessions: focusSessions,
    });
  } catch (error) {
    console.error('Profile error:', error.message);
    res.status(500).json({ message: 'Server error fetching profile' });
  }
});

// @route   GET /user/export
// @desc    Export all user data (GDPR compliance)
// @access  Private
router.get('/export', protect, async (req, res) => {
  try {
    const userId = req.user._id;

    // Get all user data
    const user = await User.findById(userId).select('-password -emailVerificationToken -emailVerificationExpires -resetPasswordToken -resetPasswordExpires');
    const focusSessions = await Focus.find({ userId });
    const stats = await Stats.findOne({ userId });
    const breedCollection = await BreedCollection.findOne({ userId });

    const exportData = {
      exportDate: new Date().toISOString(),
      dataPortabilityRequest: true,
      account: {
        id: user._id,
        email: user.email,
        username: user.username,
        createdAt: user.createdAt,
        totalKibble: user.totalKibble,
        totalFocusMinutes: user.totalFocusMinutes,
        emailVerified: user.emailVerified,
        provider: user.provider
      },
      focusSessions: focusSessions.map(session => ({
        id: session._id,
        duration: session.duration,
        status: session.status,
        kibbleEarned: session.kibbleEarned,
        createdAt: session.createdAt,
        completedAt: session.createdAt
      })),
      statistics: stats ? {
        completedSessions: stats.completedSessions,
        totalMinutes: stats.totalMinutes,
        totalKibble: stats.totalKibble,
        longestStreak: stats.longestStreak,
        currentStreak: stats.currentStreak
      } : null,
      breedCollection: breedCollection ? {
        unlockedBreeds: breedCollection.unlockedBreeds,
        activeBreed: breedCollection.activeBreed,
        totalKibble: breedCollection.totalKibble
      } : null
    };

    res.json(exportData);
  } catch (error) {
    console.error('Export data error:', error.message);
    res.status(500).json({ message: 'Server error exporting data' });
  }
});

// @route   DELETE /user/account
// @desc    Delete user account and all associated data (Apple requirement)
// @access  Private
router.delete('/account', protect, async (req, res) => {
  try {
    const userId = req.user._id;

    await Focus.deleteMany({ userId });
    await DailyStats.deleteMany({ userId });
    await Stats.deleteOne({ userId });
    await BreedCollection.deleteOne({ userId });
    await Achievement.deleteMany({ userId });
    await Accessory.deleteMany({ userId });
    await LeaderboardEntry.deleteMany({ userId });
    await VerificationToken.deleteMany({ userId });
    await Transaction.deleteMany({ userId });
    await FocusRoom.updateMany(
      { 'members.userId': userId },
      { $pull: { members: { userId } } }
    );
    await User.findByIdAndDelete(userId);

    res.json({
      message: 'Account deleted successfully',
      deletedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Delete account error:', error.message);
    res.status(500).json({ message: 'Server error deleting account' });
  }
});

// Valid kibble pack definitions (must match frontend)
const KIBBLE_PACKS = {
  kibble_snack: { base: 100, bonus: 0, label: 'Snack Pack' },
  kibble_meal: { base: 500, bonus: 50, label: 'Meal Pack' },
  kibble_feast: { base: 1500, bonus: 300, label: 'Feast Pack' },
  kibble_king: { base: 5000, bonus: 1500, label: 'Kibble King' },
};

// @route   POST /user/add-kibble
// @desc    Credit kibble from IAP purchase (idempotent via transactionId)
// @access  Private
router.post('/add-kibble', protect, async (req, res) => {
  try {
    const { amount, source, packId, transactionId } = req.body;

    // --- Validation ---
    if (source !== 'purchase') {
      return res.status(400).json({ message: 'Only source "purchase" is accepted via this endpoint.' });
    }
    if (!packId || !KIBBLE_PACKS[packId]) {
      return res.status(400).json({ message: 'Invalid packId.' });
    }
    const pack = KIBBLE_PACKS[packId];
    const expectedAmount = pack.base + pack.bonus;
    if (typeof amount !== 'number' || amount !== expectedAmount) {
      return res.status(400).json({ message: `Amount must be ${expectedAmount} for ${pack.label}.` });
    }
    if (!transactionId || typeof transactionId !== 'string') {
      return res.status(400).json({ message: 'transactionId is required for purchase idempotency.' });
    }

    // --- Idempotency: reject duplicate transactionId ---
    const existing = await Transaction.findOne({ transactionId });
    if (existing) {
      // Already processed — return success without double-granting
      const user = await User.findById(req.user._id);
      return res.json({
        duplicate: true,
        totalKibble: user.totalKibble,
        totalMealsProvided: user.totalMealsProvided,
        newBreedUnlocks: [],
      });
    }

    // --- Atomically credit kibble ---
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $inc: { totalKibble: amount } },
      { new: true }
    );

    // Recalculate meals
    user.totalMealsProvided = Math.floor(user.totalKibble / 25);

    // Check breed unlocks
    const newBreedUnlocks = user.checkBreedUnlocks();
    await user.save();

    // Record transaction
    await Transaction.create({
      userId: req.user._id,
      transactionId,
      source: 'purchase',
      packId,
      amount,
    });

    res.json({
      duplicate: false,
      totalKibble: user.totalKibble,
      totalMealsProvided: user.totalMealsProvided,
      newBreedUnlocks,
    });
  } catch (error) {
    console.error('POST /user/add-kibble error:', error.message);
    res.status(500).json({ message: 'Server error adding kibble' });
  }
});

// @route   POST /user/use-streak-shield
// @desc    Use a streak shield to prevent streak from breaking (1/week, Pro+)
// @access  Private
router.post('/use-streak-shield', protect, async (req, res) => {
  try {
    const user = req.user;
    const tier = user.subscriptionTier || 'free';
    if (tier === 'free') {
      return res.status(403).json({
        error: 'subscription_required',
        message: 'Streak shields require Pro or Guardian.',
      });
    }

    const today = new Date().toISOString().split('T')[0];

    if (user.lastShieldUsedDate) {
      const lastUsed = new Date(user.lastShieldUsedDate);
      const daysSince = Math.floor(
        (new Date(today).getTime() - lastUsed.getTime()) / 86400000
      );
      if (daysSince < 7) {
        return res.status(429).json({
          error: 'shield_cooldown',
          message: `Streak shield recharges in ${7 - daysSince} day(s).`,
          nextAvailable: new Date(lastUsed.getTime() + 7 * 86400000).toISOString().split('T')[0],
        });
      }
    }

    if (user.currentStreak <= 0) {
      return res.status(400).json({
        error: 'no_streak',
        message: 'No active streak to protect.',
      });
    }

    user.lastShieldUsedDate = today;
    user.lastSessionDate = today;
    await user.save();

    res.json({
      success: true,
      streakPreserved: user.currentStreak,
      nextShieldAvailable: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
    });
  } catch (error) {
    console.error('POST /user/use-streak-shield error:', error.message);
    res.status(500).json({ message: 'Server error using streak shield' });
  }
});

// @route   PATCH /user/settings
// @desc    Update user preferences
// @access  Private
router.patch('/settings', protect, async (req, res) => {
  try {
    const { settings, notificationPrefs } = req.body;
    const user = await User.findById(req.user._id);

    if (settings) {
      if (settings.soundEnabled !== undefined) user.settings.soundEnabled = settings.soundEnabled;
      if (settings.notificationsEnabled !== undefined) user.settings.notificationsEnabled = settings.notificationsEnabled;
      if (settings.vibrationEnabled !== undefined) user.settings.vibrationEnabled = settings.vibrationEnabled;
      if (settings.theme !== undefined) user.settings.theme = settings.theme;
      if (settings.defaultTimerDuration !== undefined) user.settings.defaultTimerDuration = settings.defaultTimerDuration;
    }

    if (notificationPrefs) {
      if (notificationPrefs.streakReminders !== undefined) user.notificationPrefs.streakReminders = notificationPrefs.streakReminders;
      if (notificationPrefs.dailyReminder !== undefined) user.notificationPrefs.dailyReminder = notificationPrefs.dailyReminder;
      if (notificationPrefs.reminderTime !== undefined) user.notificationPrefs.reminderTime = notificationPrefs.reminderTime;
      if (notificationPrefs.buddyHungerAlerts !== undefined) user.notificationPrefs.buddyHungerAlerts = notificationPrefs.buddyHungerAlerts;
      if (notificationPrefs.weeklySummary !== undefined) user.notificationPrefs.weeklySummary = notificationPrefs.weeklySummary;
    }

    await user.save();

    res.json({
      success: true,
      settings: user.settings,
      notificationPrefs: user.notificationPrefs
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ message: 'Server error updating settings' });
  }
});

// @route   PATCH /user/onboarding
// @desc    Update onboarding status
// @access  Private
router.patch('/onboarding', protect, async (req, res) => {
  try {
    const { completed } = req.body;
    const user = await User.findById(req.user._id);

    user.onboardingCompleted = !!completed;
    await user.save();

    res.json({
      success: true,
      onboardingCompleted: user.onboardingCompleted
    });
  } catch (error) {
    console.error('Update onboarding error:', error);
    res.status(500).json({ message: 'Server error updating onboarding status' });
  }
});

export default router;
