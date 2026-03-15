import express from 'express';
import User from '../models/User.js';
import DailyStats from '../models/DailyStats.js';
import Focus from '../models/Focus.js';
import protect from '../middleware/auth.middleware.js';
import { getEffectiveTier } from '../services/subscriptionService.js';

const router = express.Router();

const KIBBLE_PER_MEAL = 25;

function dateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

// @route   GET /stats
// @desc    Get user's full stats with tag breakdown & insights (tier-gated)
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const user = req.user;
    const today = new Date().toISOString().split('T')[0];

    const todayStats = await DailyStats.findOne({ userId: user._id, date: today });
    const weeklyStats = await DailyStats.getWeeklyStats(user._id);
    const chartData = await DailyStats.getChartData(user._id, 7);

    if (user.lastSessionDate) {
      const diffDays = Math.floor(
        (new Date(today).getTime() - new Date(user.lastSessionDate).getTime()) / 86400000
      );
      if (diffDays > 1) {
        user.currentStreak = 0;
        await user.save();
      }
    }

    const response = {
      today: {
        focusMinutes: todayStats?.focusMinutes || 0,
        sessionsCompleted: todayStats?.sessionsCompleted || 0,
        kibbleEarned: todayStats?.kibbleEarned || 0,
        mealsProvided: Math.floor((todayStats?.kibbleEarned || 0) / KIBBLE_PER_MEAL),
      },
      week: {
        focusMinutes: weeklyStats.totalMinutes,
        sessionsCompleted: weeklyStats.totalSessions,
        kibbleEarned: weeklyStats.totalKibble,
        mealsProvided: Math.floor(weeklyStats.totalKibble / KIBBLE_PER_MEAL),
        averageMinutesPerDay: weeklyStats.averageMinutesPerDay,
        activeDays: weeklyStats.activeDays,
      },
      allTime: {
        totalKibble: user.totalKibble,
        totalFocusMinutes: user.totalFocusMinutes,
        completedSessions: user.completedSessions,
        totalMealsProvided: user.totalMealsProvided,
        currentStreak: user.currentStreak,
        longestStreak: user.longestStreak,
        lastSessionDate: user.lastSessionDate,
      },
      chartData,
      tier: getEffectiveTier(user),
      streakCalendar: [],
      lastShieldUsedDate: user.lastShieldUsedDate || null,
    };

    // Streak calendar — last 30 days (available to all)
    const calendarStart = dateDaysAgo(29);
    const calendarDays = await DailyStats.find({
      userId: user._id,
      date: { $gte: calendarStart },
    }).lean();
    const calendarMap = new Map(calendarDays.map(d => [d.date, d]));
    const dailyGoal = parseInt(req.query.dailyGoal) || 60;

    for (let i = 29; i >= 0; i--) {
      const dateStr = dateDaysAgo(i);
      const d = calendarMap.get(dateStr);
      response.streakCalendar.push({
        date: dateStr,
        minutes: d?.focusMinutes || 0,
        sessions: d?.sessionsCompleted || 0,
        goalMet: (d?.focusMinutes || 0) >= dailyGoal,
      });
    }

    // Monthly stats
    const monthlyStats = await DailyStats.getMonthlyStats(user._id);
    response.month = monthlyStats;

    // Tag breakdown (last 30 days)
    const tagAgg = await Focus.aggregate([
      {
        $match: {
          userId: user._id,
          status: 'completed',
          startTime: { $gte: new Date(Date.now() - 30 * 86400000) },
        },
      },
      {
        $group: {
          _id: { $ifNull: ['$tag', 'untagged'] },
          totalMinutes: { $sum: '$duration' },
          count: { $sum: 1 },
        },
      },
      { $sort: { totalMinutes: -1 } },
    ]);
    response.tagBreakdown = tagAgg.map(t => ({
      tag: t._id,
      minutes: t.totalMinutes,
      sessions: t.count,
    }));

    // ── Insights (available to all users) ──
    const insights = [];
    const dayNames = ['', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // 1. Best day of week
    const dayAgg = await Focus.aggregate([
      { $match: { userId: user._id, status: 'completed' } },
      { $group: { _id: { $dayOfWeek: '$startTime' }, totalMin: { $sum: '$duration' }, count: { $sum: 1 } } },
      { $sort: { totalMin: -1 } },
      { $limit: 1 },
    ]);
    if (dayAgg.length > 0) {
      const avg = Math.round(dayAgg[0].totalMin / Math.max(dayAgg[0].count, 1));
      insights.push({
        type: 'best_day',
        text: `Your most productive day: ${dayNames[dayAgg[0]._id]} (avg ${avg} min)`,
      });
    }

    // 2. Best time slot
    const hourAgg = await Focus.aggregate([
      { $match: { userId: user._id, status: 'completed' } },
      { $group: { _id: { $hour: '$startTime' }, totalMin: { $sum: '$duration' }, count: { $sum: 1 } } },
      { $sort: { totalMin: -1 } },
      { $limit: 1 },
    ]);
    if (hourAgg.length > 0) {
      const h = hourAgg[0]._id;
      const endH = (h + 2) % 24;
      const fmt = (hr) => `${hr % 12 || 12} ${hr < 12 ? 'AM' : 'PM'}`;
      insights.push({ type: 'best_time', text: `Best focus time: ${fmt(h)} – ${fmt(endH)}` });
    }

    // 3. Average session length
    const avgDur = await Focus.aggregate([
      { $match: { userId: user._id, status: 'completed' } },
      { $group: { _id: null, avg: { $avg: '$duration' } } },
    ]);
    if (avgDur.length > 0) {
      insights.push({
        type: 'avg_session',
        text: `Your average session is ${Math.round(avgDur[0].avg)} minutes`,
      });
    }

    // 4. Week-over-week trend
    const thisWeekStart = dateDaysAgo(6);
    const lastWeekStart = dateDaysAgo(13);
    const lastWeekEnd = dateDaysAgo(7);
    const thisWeekDays = await DailyStats.find({
      userId: user._id, date: { $gte: thisWeekStart },
    }).lean();
    const lastWeekDays = await DailyStats.find({
      userId: user._id, date: { $gte: lastWeekStart, $lt: lastWeekEnd },
    }).lean();
    const thisWeekMin = thisWeekDays.reduce((s, d) => s + (d.focusMinutes || 0), 0);
    const lastWeekMin = lastWeekDays.reduce((s, d) => s + (d.focusMinutes || 0), 0);
    if (lastWeekMin > 0) {
      const change = Math.round(((thisWeekMin - lastWeekMin) / lastWeekMin) * 100);
      const direction = change >= 0 ? 'more' : 'less';
      insights.push({
        type: 'weekly_trend',
        text: `You focused ${Math.abs(change)}% ${direction} this week than last week`,
        change,
      });
    } else if (thisWeekMin > 0) {
      insights.push({
        type: 'weekly_trend',
        text: `Great start! You've focused ${thisWeekMin} min this week`,
        change: 100,
      });
    }

    // 5. Consistency score (last 30 days)
    const activeDays30 = response.streakCalendar.filter(d => d.minutes > 0).length;
    const consistencyScore = Math.round((activeDays30 / 30) * 100);
    if (user.completedSessions > 0) {
      insights.push({
        type: 'consistency',
        text: `30-day consistency: ${consistencyScore}% (${activeDays30} of 30 days)`,
        score: consistencyScore,
      });
    }

    // 6. Completion rate
    const statusAgg = await Focus.aggregate([
      { $match: { userId: user._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const completedCount = statusAgg.find(s => s._id === 'completed')?.count || 0;
    const failedCount = statusAgg.find(s => s._id === 'failed')?.count || 0;
    const totalSessions = completedCount + failedCount;
    if (totalSessions > 0) {
      const rate = Math.round((completedCount / totalSessions) * 100);
      insights.push({
        type: 'completion_rate',
        text: `Session completion rate: ${rate}%`,
        rate,
      });
    }

    // 7. Longest session
    const longestAgg = await Focus.aggregate([
      { $match: { userId: user._id, status: 'completed' } },
      { $group: { _id: null, maxDur: { $max: '$duration' } } },
    ]);
    if (longestAgg.length > 0 && longestAgg[0].maxDur > 0) {
      const mins = longestAgg[0].maxDur;
      const fmtDur = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} minutes`;
      insights.push({
        type: 'longest_session',
        text: `Your longest session: ${fmtDur}`,
        minutes: mins,
      });
    }

    // 8. Favorite tag
    const taggedEntries = tagAgg.filter(t => t._id !== 'untagged');
    if (taggedEntries.length > 0) {
      const top = taggedEntries[0];
      const tagLabel = top._id.charAt(0).toUpperCase() + top._id.slice(1);
      const hrs = Math.floor(top.totalMinutes / 60);
      const rm = top.totalMinutes % 60;
      const fmtTime = hrs > 0 ? `${hrs}h ${rm}m` : `${rm}m`;
      insights.push({
        type: 'favorite_tag',
        text: `Top focus category: ${tagLabel} (${fmtTime})`,
        tag: top._id,
      });
    }

    response.insights = insights;

    res.json(response);
  } catch (error) {
    console.error('Stats fetch error:', error);
    res.status(500).json({ message: 'Server error fetching stats' });
  }
});

// @route   GET /stats/global
// @desc    Get global community stats (public)
// @access  Public
router.get('/global', async (_req, res) => {
  try {
    const result = await User.aggregate([
      { $group: { _id: null, totalMeals: { $sum: '$totalMealsProvided' }, totalUsers: { $sum: 1 } } },
    ]);
    const data = result[0] || { totalMeals: 0, totalUsers: 0 };
    res.json({ totalMeals: data.totalMeals, totalUsers: data.totalUsers });
  } catch (error) {
    console.error('Global stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /stats/session
// @desc    DEPRECATED — Use POST /focus/complete instead. This redirects internally.
// @access  Private
router.post('/session', protect, async (req, res) => {
  console.warn('⚠️  DEPRECATED: POST /stats/session called — migrate client to POST /focus/complete');

  try {
    const { focusMinutes, kibbleEarned, status = 'completed' } = req.body;

    if (!focusMinutes || focusMinutes < 1) {
      return res.status(400).json({ message: 'Focus minutes must be at least 1' });
    }

    const user = req.user;
    const today = new Date().toISOString().split('T')[0];

    const focusSession = new Focus({
      userId: user._id,
      startTime: new Date(Date.now() - focusMinutes * 60 * 1000),
      duration: focusMinutes,
      status,
      kibbleEarned: status === 'completed' ? (kibbleEarned || focusMinutes) : 0,
    });
    await focusSession.save();

    if (status === 'completed') {
      user.totalFocusMinutes += focusMinutes;
      user.totalKibble += kibbleEarned || focusMinutes;
      user.completedSessions += 1;
      user.totalMealsProvided = Math.floor(user.totalKibble / 25);

      user.updateStreak(today);
      const newlyUnlocked = user.checkBreedUnlocks();
      await user.save();

      let dailyStats = await DailyStats.getOrCreate(user._id, today);
      dailyStats.focusMinutes += focusMinutes;
      dailyStats.sessionsCompleted += 1;
      dailyStats.kibbleEarned += kibbleEarned || focusMinutes;
      await dailyStats.save();

      res.json({
        success: true,
        deprecated: true,
        message: 'This endpoint is deprecated. Use POST /focus/complete instead.',
        session: focusSession,
        updatedStats: {
          totalKibble: user.totalKibble,
          totalFocusMinutes: user.totalFocusMinutes,
          completedSessions: user.completedSessions,
          totalMealsProvided: user.totalMealsProvided,
          currentStreak: user.currentStreak,
          longestStreak: user.longestStreak,
        },
        newlyUnlockedBreeds: newlyUnlocked,
      });
    } else {
      res.json({
        success: true,
        deprecated: true,
        message: 'This endpoint is deprecated. Use POST /focus/fail instead.',
        session: focusSession,
      });
    }
  } catch (error) {
    console.error('Session record error (deprecated endpoint):', error);
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
