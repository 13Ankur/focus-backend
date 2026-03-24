import express from 'express';
import crypto from 'crypto';
import Focus from '../models/Focus.js';
import User from '../models/User.js';
import DailyStats from '../models/DailyStats.js';
import protect from '../middleware/auth.middleware.js';
import { checkSessionLimit } from '../middleware/sessionLimit.js';
import { getEffectiveTier, TIER_LEVELS } from '../services/subscriptionService.js';
import { checkAchievements } from '../services/achievementService.js';
import { updateLeaderboard, touchRoomActivity } from './social.js';
import { checkAndUnlockBreeds } from './breed.routes.js';

const router = express.Router();

const VALID_TAGS = ['study', 'work', 'reading', 'exercise', 'meditation', 'creative', 'other'];
const KIBBLE_PER_MEAL = 25;
const MIN_DURATION = 5;
const MAX_DURATION = 120;
const MAX_SESSION_AGE_MS = 3 * 60 * 60 * 1000; // 3 hours
const ELAPSED_TOLERANCE = 0.9; // 10% clock drift tolerance
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
const MIN_COMPLETION_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes between completions

const DAILY_KIBBLE_LIMITS = { free: 300, pro: 600, guardian: Infinity };

const FREE_DURATIONS = [15, 25];

const FAILURE_TIPS = [
  'Try enabling Do Not Disturb',
  'Shorter sessions build consistency',
  'Enable app blocking in Pro',
  'Find a quiet spot before starting',
];

// In-memory session token cache: token -> { userId, startTime, duration, createdAt }
const sessionTokens = new Map();

// Purge expired tokens every 30 minutes
setInterval(() => {
  const cutoff = Date.now() - MAX_SESSION_AGE_MS;
  for (const [token, data] of sessionTokens) {
    if (data.createdAt < cutoff) sessionTokens.delete(token);
  }
}, 30 * 60 * 1000);

function resolveTimezone(header) {
  if (!header) return 'UTC';
  try {
    Intl.DateTimeFormat(undefined, { timeZone: header });
    return header;
  } catch {
    return 'UTC';
  }
}

function getTodayInTimezone(tz) {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}

function getYesterdayInTimezone(tz) {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA', { timeZone: tz });
}

async function getDailyKibbleUsed(userId, dateStr) {
  const stats = await DailyStats.findOne({ userId, date: dateStr });
  return stats?.kibbleEarned || 0;
}

// ─── POST /focus/start ───────────────────────────────────────────────
// Validates a session can begin; returns a sessionToken for /complete
router.post('/start', protect, checkSessionLimit, async (req, res) => {
  try {
    const { duration } = req.body;

    if (!duration || typeof duration !== 'number') {
      return res.status(400).json({ allowed: false, reason: 'invalid_duration' });
    }

    if (duration < MIN_DURATION || duration > MAX_DURATION) {
      return res.status(400).json({
        allowed: false,
        reason: 'invalid_duration',
        message: `Duration must be between ${MIN_DURATION} and ${MAX_DURATION} minutes`,
      });
    }

    const effectiveTier = getEffectiveTier(req.user);

    // Free users restricted to 15 or 25 minute sessions
    if (TIER_LEVELS[effectiveTier] < TIER_LEVELS.pro && !FREE_DURATIONS.includes(duration)) {
      return res.status(403).json({
        allowed: false,
        reason: 'duration_locked',
        message: 'Free users can use 15 or 25 minute sessions. Upgrade to Pro for custom durations.',
        allowedDurations: FREE_DURATIONS,
      });
    }

    const sessionToken = crypto.randomUUID();
    sessionTokens.set(sessionToken, {
      userId: req.user._id.toString(),
      startTime: new Date(),
      duration,
      createdAt: Date.now(),
    });

    res.json({ allowed: true, sessionToken });
  } catch (err) {
    console.error('POST /focus/start error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── POST /focus/complete ────────────────────────────────────────────
// Consolidated session completion: validates, awards kibble, updates all stats
router.post('/complete', protect, async (req, res) => {
  try {
    const { duration, startTime, tag = null, sessionToken } = req.body;

    // ── Basic validation ──
    if (!duration || !startTime) {
      return res.status(400).json({ error: 'invalid_request', message: 'duration and startTime are required' });
    }

    if (typeof duration !== 'number' || duration < MIN_DURATION || duration > MAX_DURATION) {
      return res.status(400).json({
        error: 'invalid_duration',
        message: `Duration must be between ${MIN_DURATION} and ${MAX_DURATION} minutes`,
      });
    }

    if (tag !== null && tag !== undefined && !VALID_TAGS.includes(tag)) {
      return res.status(400).json({ error: 'invalid_tag', message: `Tag must be one of: ${VALID_TAGS.join(', ')}` });
    }

    // ── Session token validation (if provided) ──
    if (sessionToken) {
      const tokenData = sessionTokens.get(sessionToken);
      if (!tokenData || tokenData.userId !== req.user._id.toString()) {
        return res.status(400).json({ error: 'invalid_session_token', message: 'Invalid or expired session token' });
      }
      sessionTokens.delete(sessionToken);
    }

    // ── Time validation ──
    const sessionStart = new Date(startTime);
    const now = new Date();

    if (isNaN(sessionStart.getTime())) {
      return res.status(400).json({ error: 'invalid_start_time', message: 'startTime must be a valid ISO date string' });
    }

    if (sessionStart > now) {
      return res.status(400).json({ error: 'invalid_start_time', message: 'startTime cannot be in the future' });
    }

    const ageMs = now.getTime() - sessionStart.getTime();
    if (ageMs > MAX_SESSION_AGE_MS) {
      return res.status(400).json({
        error: 'session_too_old',
        message: 'Session must have started within the last 3 hours',
      });
    }

    // Elapsed time must be at least 90% of the claimed duration
    const elapsedSeconds = ageMs / 1000;
    const requiredSeconds = duration * 60 * ELAPSED_TOLERANCE;
    if (elapsedSeconds < requiredSeconds) {
      return res.status(400).json({
        error: 'invalid_session',
        message: 'Session duration does not match elapsed time',
      });
    }

    // ── Duplicate / rapid submission guard ──
    const recentSession = await Focus.findOne({
      userId: req.user._id,
      status: 'completed',
      createdAt: { $gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) },
    });
    if (recentSession) {
      const msSinceLast = now.getTime() - new Date(recentSession.createdAt).getTime();
      if (msSinceLast < MIN_COMPLETION_INTERVAL_MS) {
        return res.status(429).json({
          error: 'too_many_completions',
          message: 'Please wait before submitting another session',
          retryAfterMs: MIN_COMPLETION_INTERVAL_MS - msSinceLast,
        });
      }
    }

    // ── Kibble calculation with daily cap ──
    const tz = resolveTimezone(req.headers['x-timezone']);
    const today = getTodayInTimezone(tz);
    const yesterday = getYesterdayInTimezone(tz);
    const effectiveTier = getEffectiveTier(req.user);
    const dailyLimit = DAILY_KIBBLE_LIMITS[effectiveTier] ?? DAILY_KIBBLE_LIMITS.free;

    const dailyKibbleUsed = await getDailyKibbleUsed(req.user._id, today);

    // Dynamic kibble with focus bonuses:
    // 15: 15+0=15, 25: 25+5=30, 45: 45+10=55, 60: 60+15=75, 90: 90+30=120, 120: 120+60=180
    const REWARD_MAP = { 15: 15, 25: 30, 45: 55, 60: 75, 90: 120, 120: 180 };
    let kibbleEarned = REWARD_MAP[duration] || duration;

    const remaining = dailyLimit - dailyKibbleUsed;
    if (remaining <= 0 && dailyLimit !== Infinity) {
      kibbleEarned = 0;
    } else if (dailyLimit !== Infinity) {
      kibbleEarned = Math.min(kibbleEarned, remaining);
    }

    // ── Persist focus session ──
    const focusSession = await Focus.create({
      userId: req.user._id,
      startTime: sessionStart,
      duration,
      status: 'completed',
      tag: tag || null,
      kibbleEarned,
    });

    // ── Atomic user stats update ──
    const updatedUser = await User.findOneAndUpdate(
      { _id: req.user._id },
      {
        $inc: {
          totalKibble: kibbleEarned,
          totalFocusMinutes: duration,
          completedSessions: 1,
        },
      },
      { new: true }
    );

    // ── Streak calculation (credit to session START date) ──
    const sessionDateStr = sessionStart.toLocaleDateString('en-CA', { timeZone: tz });

    if (updatedUser.lastSessionDate !== sessionDateStr) {
      if (updatedUser.lastSessionDate === yesterday || updatedUser.lastSessionDate === null) {
        updatedUser.currentStreak = updatedUser.lastSessionDate === null ? 1 : updatedUser.currentStreak + 1;
      } else {
        updatedUser.currentStreak = 1;
      }

      if (updatedUser.currentStreak > updatedUser.longestStreak) {
        updatedUser.longestStreak = updatedUser.currentStreak;
      }
      updatedUser.lastSessionDate = sessionDateStr;
    }

    // ── Meals ──
    updatedUser.totalMealsProvided = Math.floor(updatedUser.totalKibble / KIBBLE_PER_MEAL);

    // ── Breed unlocks (kibble-based) ──
    const newlyUnlocked = await checkAndUnlockBreeds(updatedUser);

    await updatedUser.save();

    // ── DailyStats upsert — handle midnight crossing ──
    const sessionEndDate = now.toLocaleDateString('en-CA', { timeZone: tz });

    if (sessionDateStr === sessionEndDate) {
      await DailyStats.findOneAndUpdate(
        { userId: req.user._id, date: sessionDateStr },
        { $inc: { focusMinutes: duration, sessionsCompleted: 1, kibbleEarned } },
        { upsert: true }
      );
    } else {
      // Session spans midnight: split minutes across both days
      const midnightParts = sessionEndDate.split('-').map(Number);
      const midnightUTC = new Date(Date.UTC(midnightParts[0], midnightParts[1] - 1, midnightParts[2]));
      const minutesBeforeMidnight = Math.max(1, Math.floor((midnightUTC.getTime() - sessionStart.getTime()) / 60000));
      const minutesAfterMidnight = Math.max(0, duration - minutesBeforeMidnight);

      await DailyStats.findOneAndUpdate(
        { userId: req.user._id, date: sessionDateStr },
        { $inc: { focusMinutes: minutesBeforeMidnight, sessionsCompleted: 1, kibbleEarned } },
        { upsert: true }
      );
      if (minutesAfterMidnight > 0) {
        await DailyStats.findOneAndUpdate(
          { userId: req.user._id, date: sessionEndDate },
          { $inc: { focusMinutes: minutesAfterMidnight } },
          { upsert: true }
        );
      }
    }

    // ── Achievement check ──
    let todayDailyStats = null;
    try {
      todayDailyStats = await DailyStats.findOne({ userId: req.user._id, date: sessionDateStr });
    } catch { /* non-critical */ }

    const newAchievements = await checkAchievements(
      req.user._id,
      { duration, startTime: sessionStart },
      todayDailyStats
    );

    // ── Leaderboard + room activity (non-blocking) ──
    updateLeaderboard(req.user._id, duration).catch(() => { });
    touchRoomActivity(req.user._id).catch(() => { });

    res.status(201).json({
      success: true,
      kibbleEarned,
      totalKibble: updatedUser.totalKibble,
      completedSessions: updatedUser.completedSessions,
      totalMealsProvided: updatedUser.totalMealsProvided,
      newBreedUnlocked: newlyUnlocked.length > 0 ? newlyUnlocked[0] : null,
      newlyUnlockedBreeds: newlyUnlocked.map(b => ({ id: b.id, name: b.name, description: b.description })),
      streak: {
        current: updatedUser.currentStreak,
        longest: updatedUser.longestStreak,
      },
      dailyKibbleUsed: dailyKibbleUsed + kibbleEarned,
      dailyKibbleLimit: dailyLimit === Infinity ? null : dailyLimit,
      newAchievements,
    });
  } catch (err) {
    console.error('POST /focus/complete error:', err.message);
    res.status(500).json({ message: 'Server error recording focus session' });
  }
});

// ─── POST /focus/fail ────────────────────────────────────────────────
// Record a failed/interrupted session with partial kibble
router.post('/fail', protect, async (req, res) => {
  try {
    const { duration, startTime, minutesCompleted = 0 } = req.body;

    if (!duration || !startTime) {
      return res.status(400).json({ error: 'invalid_request', message: 'duration and startTime are required' });
    }

    const sessionStart = new Date(startTime);
    if (isNaN(sessionStart.getTime())) {
      return res.status(400).json({ error: 'invalid_start_time', message: 'startTime must be a valid ISO date string' });
    }

    const validMinutes = Math.max(0, Math.min(minutesCompleted, duration));
    const partialKibble = Math.floor(validMinutes / 5); // 1 kibble per 5 full minutes

    const focusSession = await Focus.create({
      userId: req.user._id,
      startTime: sessionStart,
      duration,
      status: 'failed',
      kibbleEarned: partialKibble,
    });

    if (partialKibble > 0) {
      await User.findOneAndUpdate(
        { _id: req.user._id },
        { $inc: { totalKibble: partialKibble, totalFocusMinutes: validMinutes } }
      );

      const tz = resolveTimezone(req.headers['x-timezone']);
      const today = getTodayInTimezone(tz);
      await DailyStats.findOneAndUpdate(
        { userId: req.user._id, date: today },
        { $inc: { focusMinutes: validMinutes, kibbleEarned: partialKibble } },
        { upsert: true }
      );
    }

    const tip = FAILURE_TIPS[Math.floor(Math.random() * FAILURE_TIPS.length)];

    res.json({
      partialKibble,
      tip,
      sessionId: focusSession._id,
    });
  } catch (err) {
    console.error('POST /focus/fail error:', err.message);
    res.status(500).json({ message: 'Server error recording failed session' });
  }
});

export default router;
