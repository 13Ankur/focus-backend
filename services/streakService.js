import DailyStats from '../models/DailyStats.js';
import { currentStreakFromDates, longestStreakFromDates } from '../utils/localDate.js';

/** Rebuild the streak from completed-session days so the stored number matches real focus days. */
export async function syncUserStreak(user, today) {
  const days = await DailyStats.find({
    userId: user._id,
    sessionsCompleted: { $gt: 0 },
  }).select('date').lean();

  const dates = days.map(day => day.date).filter(Boolean);
  const current = currentStreakFromDates(dates, today);
  const longest = Math.max(user.longestStreak || 0, longestStreakFromDates(dates));
  const lastActive = dates.filter(date => date <= today).sort().pop() || user.lastSessionDate || null;

  user.currentStreak = current;
  user.longestStreak = longest;
  if (lastActive) user.lastSessionDate = lastActive;
  await user.save();
  return current;
}
