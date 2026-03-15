import User from '../models/User.js';
import { getEffectiveTier, TIER_LEVELS } from '../services/subscriptionService.js';

const FREE_SESSION_LIMIT = 3;

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
  return new Date().toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
}

function getNextMidnightISO(tz) {
  const todayStr = getTodayInTimezone(tz);
  const parts = todayStr.split('-').map(Number);
  // Build tomorrow at midnight in the user's TZ by formatting the next day
  const tomorrow = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + 1));
  // Convert the TZ-local midnight to an actual instant
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  // Approximate: use the date string to build an ISO timestamp
  // For the 429 response we just need a reasonable "next reset" hint
  return `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2] + 1).padStart(2, '0')}T00:00:00`;
}

/**
 * Middleware that enforces a daily session limit for free-tier users.
 * Pro and Guardian users skip the check entirely.
 *
 * Uses atomic MongoDB operations to avoid race conditions.
 */
export async function checkSessionLimit(req, res, next) {
  try {
    const user = req.user;
    const effectiveTier = getEffectiveTier(user);

    if (TIER_LEVELS[effectiveTier] >= TIER_LEVELS.pro) {
      return next();
    }

    const tz = resolveTimezone(req.headers['x-timezone']);
    const today = getTodayInTimezone(tz);

    // Reset counter if the day has rolled over (atomic)
    if (user.lastSessionCountReset !== today) {
      await User.findOneAndUpdate(
        { _id: user._id },
        { $set: { dailySessionCount: 0, lastSessionCountReset: today } }
      );
    }

    // Atomically increment and read back
    const updated = await User.findOneAndUpdate(
      { _id: user._id },
      { $inc: { dailySessionCount: 1 } },
      { new: true }
    );

    if (updated.dailySessionCount > FREE_SESSION_LIMIT) {
      // Roll back the increment
      await User.findOneAndUpdate(
        { _id: user._id },
        { $inc: { dailySessionCount: -1 } }
      );

      return res.status(429).json({
        error: 'session_limit_reached',
        limit: FREE_SESSION_LIMIT,
        used: FREE_SESSION_LIMIT,
        message: 'Daily limit reached. Upgrade to Pro for unlimited sessions.',
        nextReset: getNextMidnightISO(tz),
      });
    }

    // Sync the count back onto req.user for downstream handlers
    req.user.dailySessionCount = updated.dailySessionCount;
    return next();
  } catch (err) {
    console.error('sessionLimit error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
}

export default checkSessionLimit;
