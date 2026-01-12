import express from 'express';
import Focus from '../models/Focus.js';
import User from '../models/User.js';
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
        completedAt: session.completedAt
      })),
      statistics: {
        completedSessions: user.completedSessions,
        totalMinutes: user.totalFocusMinutes,
        totalKibble: user.totalKibble,
        longestStreak: user.longestStreak,
        currentStreak: user.currentStreak
      },
      breedCollection: {
        unlockedBreeds: user.unlockedBreeds,
        activeBreed: user.activeBreed,
        totalKibble: user.totalKibble
      }
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

    // Delete all user data in order
    await Focus.deleteMany({ userId });
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

export default router;
