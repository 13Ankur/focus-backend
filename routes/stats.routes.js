import express from 'express';
import User from '../models/User.js';
import DailyStats from '../models/DailyStats.js';
import Focus from '../models/Focus.js';
import protect from '../middleware/auth.middleware.js';

const router = express.Router();

const KIBBLE_PER_MEAL = 25;

// @route   GET /stats
// @desc    Get user's full stats (today, week, month, all-time)
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const user = req.user;
    const today = new Date().toISOString().split('T')[0];
    
    // Get today's stats
    const todayStats = await DailyStats.findOne({ 
      userId: user._id, 
      date: today 
    });
    
    // Get weekly stats
    const weeklyStats = await DailyStats.getWeeklyStats(user._id);
    
    // Get monthly stats
    const monthlyStats = await DailyStats.getMonthlyStats(user._id);
    
    // Get chart data for last 7 days
    const chartData = await DailyStats.getChartData(user._id, 7);
    
    // Check if streak is still valid
    if (user.lastSessionDate) {
      const lastDate = new Date(user.lastSessionDate);
      const todayDate = new Date(today);
      const diffDays = Math.floor((todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDays > 1) {
        // Streak is broken
        user.currentStreak = 0;
        await user.save();
      }
    }
    
    res.json({
      today: {
        focusMinutes: todayStats?.focusMinutes || 0,
        sessionsCompleted: todayStats?.sessionsCompleted || 0,
        kibbleEarned: todayStats?.kibbleEarned || 0,
        mealsProvided: Math.floor((todayStats?.kibbleEarned || 0) / KIBBLE_PER_MEAL)
      },
      week: {
        focusMinutes: weeklyStats.totalMinutes,
        sessionsCompleted: weeklyStats.totalSessions,
        kibbleEarned: weeklyStats.totalKibble,
        mealsProvided: Math.floor(weeklyStats.totalKibble / KIBBLE_PER_MEAL),
        averageMinutesPerDay: weeklyStats.averageMinutesPerDay,
        activeDays: weeklyStats.activeDays
      },
      month: monthlyStats,
      allTime: {
        totalKibble: user.totalKibble,
        totalFocusMinutes: user.totalFocusMinutes,
        completedSessions: user.completedSessions,
        totalMealsProvided: user.totalMealsProvided,
        currentStreak: user.currentStreak,
        longestStreak: user.longestStreak,
        lastSessionDate: user.lastSessionDate
      },
      chartData
    });
  } catch (error) {
    console.error('Stats fetch error:', error);
    res.status(500).json({ message: 'Server error fetching stats' });
  }
});

// @route   POST /stats/session
// @desc    Record a completed focus session
// @access  Private
router.post('/session', protect, async (req, res) => {
  try {
    const { focusMinutes, kibbleEarned, status = 'completed' } = req.body;
    
    if (!focusMinutes || focusMinutes < 1) {
      return res.status(400).json({ message: 'Focus minutes must be at least 1' });
    }
    
    const user = req.user;
    const today = new Date().toISOString().split('T')[0];
    
    // Create focus session record
    const focusSession = new Focus({
      userId: user._id,
      startTime: new Date(Date.now() - focusMinutes * 60 * 1000),
      duration: focusMinutes,
      status
    });
    await focusSession.save();
    
    // Only update stats for completed sessions
    if (status === 'completed') {
      // Update user stats
      user.totalFocusMinutes += focusMinutes;
      user.totalKibble += kibbleEarned || 0;
      user.completedSessions += 1;
      user.totalMealsProvided = Math.floor(user.totalKibble / KIBBLE_PER_MEAL);
      
      // Update streak
      user.updateStreak(today);
      
      // Check for new breed unlocks
      const newlyUnlocked = user.checkBreedUnlocks();
      
      await user.save();
      
      // Update daily stats
      let dailyStats = await DailyStats.getOrCreate(user._id, today);
      dailyStats.focusMinutes += focusMinutes;
      dailyStats.sessionsCompleted += 1;
      dailyStats.kibbleEarned += kibbleEarned || 0;
      await dailyStats.save();
      
      res.json({
        success: true,
        session: focusSession,
        updatedStats: {
          totalKibble: user.totalKibble,
          totalFocusMinutes: user.totalFocusMinutes,
          completedSessions: user.completedSessions,
          totalMealsProvided: user.totalMealsProvided,
          currentStreak: user.currentStreak,
          longestStreak: user.longestStreak
        },
        newlyUnlockedBreeds: newlyUnlocked,
        dailyStats: {
          focusMinutes: dailyStats.focusMinutes,
          sessionsCompleted: dailyStats.sessionsCompleted,
          kibbleEarned: dailyStats.kibbleEarned
        }
      });
    } else {
      // Failed session - just record it
      res.json({
        success: true,
        session: focusSession,
        message: 'Session recorded as failed'
      });
    }
  } catch (error) {
    console.error('Session record error:', error);
    res.status(500).json({ message: 'Server error recording session' });
  }
});

// @route   GET /stats/daily
// @desc    Get daily history for charts (last 30 days)
// @access  Private
router.get('/daily', protect, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const chartData = await DailyStats.getChartData(req.user._id, days);
    
    res.json({
      days,
      data: chartData
    });
  } catch (error) {
    console.error('Daily stats error:', error);
    res.status(500).json({ message: 'Server error fetching daily stats' });
  }
});

// @route   GET /stats/history
// @desc    Get recent focus sessions
// @access  Private
router.get('/history', protect, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    
    const sessions = await Focus.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(limit);
    
    res.json({
      sessions,
      total: await Focus.countDocuments({ userId: req.user._id })
    });
  } catch (error) {
    console.error('History fetch error:', error);
    res.status(500).json({ message: 'Server error fetching history' });
  }
});

export default router;
