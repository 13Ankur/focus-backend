import Achievement from '../models/Achievement.js';
import User from '../models/User.js';

const ACHIEVEMENTS = [
  // ── Session milestones ──
  { id: 'first_bite',      name: 'First Bite',       desc: 'Complete your first session',         icon: '🍖', kibble: 10,   category: 'sessions', check: (u) => u.completedSessions >= 1 },
  { id: 'getting_started', name: 'Getting Started',   desc: 'Complete 5 sessions',                 icon: '🐾', kibble: 25,   category: 'sessions', check: (u) => u.completedSessions >= 5 },
  { id: 'dedicated',       name: 'Dedicated',         desc: 'Complete 25 sessions',                icon: '💪', kibble: 100,  category: 'sessions', check: (u) => u.completedSessions >= 25 },
  { id: 'century',         name: 'Century',           desc: 'Complete 100 sessions',               icon: '💯', kibble: 250,  category: 'sessions', check: (u) => u.completedSessions >= 100 },
  { id: 'marathon',        name: 'Marathon Runner',   desc: 'Complete a 60+ minute session',       icon: '🏃', kibble: 50,   category: 'sessions', check: (u, s) => s && s.duration >= 60 },
  { id: 'early_bird',      name: 'Early Bird',        desc: 'Complete a session before 8 AM',      icon: '🌅', kibble: 25,   category: 'sessions', check: (u, s) => s && new Date(s.startTime).getHours() < 8 },
  { id: 'night_owl',       name: 'Night Owl',         desc: 'Complete a session after 10 PM',      icon: '🦉', kibble: 25,   category: 'sessions', check: (u, s) => s && new Date(s.startTime).getHours() >= 22 },

  // ── Streak milestones ──
  { id: 'streak_3',  name: 'Streak Starter',    desc: '3-day streak',  icon: '🔥', kibble: 50,   category: 'streaks', check: (u) => u.currentStreak >= 3 },
  { id: 'streak_7',  name: 'Week Warrior',      desc: '7-day streak',  icon: '⚡', kibble: 100,  category: 'streaks', check: (u) => u.currentStreak >= 7 },
  { id: 'streak_14', name: 'Fortnight Focus',   desc: '14-day streak', icon: '🌟', kibble: 200,  category: 'streaks', check: (u) => u.currentStreak >= 14 },
  { id: 'streak_30', name: 'Month Master',      desc: '30-day streak', icon: '👑', kibble: 500,  category: 'streaks', check: (u) => u.currentStreak >= 30 },

  // ── Breed milestones ──
  { id: 'breed_3',     name: 'Dog Lover',     desc: 'Unlock 3 breeds',     icon: '🐕', kibble: 100,  category: 'breeds', check: (u) => u.unlockedBreeds && u.unlockedBreeds.length >= 3 },
  { id: 'breed_5',     name: 'Dog Whisperer', desc: 'Unlock 5 breeds',     icon: '🐾', kibble: 200,  category: 'breeds', check: (u) => u.unlockedBreeds && u.unlockedBreeds.length >= 5 },
  { id: 'full_kennel', name: 'Full Kennel',   desc: 'Unlock all 9 breeds', icon: '🏆', kibble: 1000, category: 'breeds', check: (u) => u.unlockedBreeds && u.unlockedBreeds.length >= 9 },

  // ── Focus time milestones ──
  { id: 'hour_1',   name: 'First Hour',       desc: 'Focus for a total of 60 minutes', icon: '⏱', kibble: 25,   category: 'time', check: (u) => u.totalFocusMinutes >= 60 },
  { id: 'hour_10',  name: 'Ten Hours Club',   desc: '10 hours total focus',            icon: '📚', kibble: 150,  category: 'time', check: (u) => u.totalFocusMinutes >= 600 },
  { id: 'hour_50',  name: 'Fifty Hour Hero',  desc: '50 hours total focus',            icon: '🎓', kibble: 500,  category: 'time', check: (u) => u.totalFocusMinutes >= 3000 },
  { id: 'hour_100', name: 'Century Focus',    desc: '100 hours total focus',           icon: '🏅', kibble: 1000, category: 'time', check: (u) => u.totalFocusMinutes >= 6000 },

  // ── Charity milestones ──
  { id: 'meals_10',  name: 'Helper',           desc: 'Provide 10 shelter meals',  icon: '🍽', kibble: 50,  category: 'charity', check: (u) => u.totalMealsProvided >= 10 },
  { id: 'meals_50',  name: 'Benefactor',       desc: 'Provide 50 shelter meals',  icon: '❤️', kibble: 200, category: 'charity', check: (u) => u.totalMealsProvided >= 50 },
  { id: 'meals_100', name: 'Charity Champion', desc: '100 shelter meals',         icon: '🏆', kibble: 500, category: 'charity', check: (u) => u.totalMealsProvided >= 100 },

  // ── Special ──
  { id: 'deep_focus_day', name: 'Deep Focus', desc: 'Focus 5+ hours in one day', icon: '🧠', kibble: 300, category: 'special', check: (u, s, ds) => ds && ds.focusMinutes >= 300 },
];

/**
 * Check all achievements for a user after a session completion.
 * Returns an array of newly unlocked achievements.
 */
export async function checkAchievements(userId, session = null, dailyStats = null) {
  try {
    const user = await User.findById(userId);
    if (!user) return [];

    const existing = await Achievement.find({ userId });
    const existingIds = new Set(existing.map(a => a.achievementId));
    const newlyUnlocked = [];

    for (const def of ACHIEVEMENTS) {
      if (existingIds.has(def.id)) continue;

      let passed = false;
      try {
        passed = def.check(user, session, dailyStats);
      } catch {
        passed = false;
      }

      if (passed) {
        try {
          await Achievement.create({
            userId,
            achievementId: def.id,
            kibbleReward: def.kibble,
          });

          newlyUnlocked.push({
            id: def.id,
            name: def.name,
            desc: def.desc,
            icon: def.icon,
            kibble: def.kibble,
            category: def.category,
          });
        } catch (err) {
          // Duplicate key — another concurrent request already created it
          if (err.code !== 11000) console.error('Achievement create error:', err);
        }
      }
    }

    return newlyUnlocked;
  } catch (err) {
    console.error('checkAchievements error:', err);
    return [];
  }
}

/**
 * Claim an unlocked achievement and award kibble.
 */
export async function claimAchievement(userId, achievementId) {
  const achievement = await Achievement.findOne({ userId, achievementId });
  if (!achievement) {
    return { error: 'not_found', message: 'Achievement not found' };
  }
  if (achievement.claimed) {
    return { error: 'already_claimed', message: 'Achievement already claimed' };
  }

  achievement.claimed = true;
  await achievement.save();

  const updatedUser = await User.findOneAndUpdate(
    { _id: userId },
    { $inc: { totalKibble: achievement.kibbleReward } },
    { new: true }
  );

  if (!updatedUser) {
    return { error: 'user_not_found', message: 'User not found' };
  }

  updatedUser.totalMealsProvided = Math.floor(updatedUser.totalKibble / 25);
  const newBreeds = updatedUser.checkBreedUnlocks();
  await updatedUser.save();

  return {
    success: true,
    kibbleAwarded: achievement.kibbleReward,
    totalKibble: updatedUser.totalKibble,
    totalMealsProvided: updatedUser.totalMealsProvided,
    newBreedUnlocked: newBreeds.length > 0 ? newBreeds[0] : null,
  };
}

/**
 * Get all achievements with status for a user.
 */
export async function getAchievements(userId) {
  const user = await User.findById(userId);
  if (!user) return [];

  const userAchievements = await Achievement.find({ userId });
  const achievementMap = new Map(userAchievements.map(a => [a.achievementId, a]));

  return ACHIEVEMENTS.map(def => {
    const record = achievementMap.get(def.id);
    const unlocked = !!record;
    const claimed = record ? record.claimed : false;

    const result = {
      id: def.id,
      name: def.name,
      desc: def.desc,
      icon: def.icon,
      kibble: def.kibble,
      category: def.category,
      unlocked,
      claimed,
      unlockedAt: record ? record.unlockedAt : null,
      progress: getProgress(def, user),
    };

    return result;
  });
}

/**
 * Calculate progress toward an achievement as { current, target, percent }.
 */
function getProgress(def, user) {
  const id = def.id;
  const u = user;

  const progressMap = {
    first_bite:      { current: u.completedSessions, target: 1 },
    getting_started: { current: u.completedSessions, target: 5 },
    dedicated:       { current: u.completedSessions, target: 25 },
    century:         { current: u.completedSessions, target: 100 },
    streak_3:        { current: u.currentStreak, target: 3 },
    streak_7:        { current: u.currentStreak, target: 7 },
    streak_14:       { current: u.currentStreak, target: 14 },
    streak_30:       { current: u.currentStreak, target: 30 },
    breed_3:         { current: u.unlockedBreeds?.length || 0, target: 3 },
    breed_5:         { current: u.unlockedBreeds?.length || 0, target: 5 },
    full_kennel:     { current: u.unlockedBreeds?.length || 0, target: 9 },
    hour_1:          { current: u.totalFocusMinutes, target: 60 },
    hour_10:         { current: u.totalFocusMinutes, target: 600 },
    hour_50:         { current: u.totalFocusMinutes, target: 3000 },
    hour_100:        { current: u.totalFocusMinutes, target: 6000 },
    meals_10:        { current: u.totalMealsProvided, target: 10 },
    meals_50:        { current: u.totalMealsProvided, target: 50 },
    meals_100:       { current: u.totalMealsProvided, target: 100 },
  };

  const entry = progressMap[id];
  if (!entry) return null;

  return {
    current: Math.min(entry.current, entry.target),
    target: entry.target,
    percent: Math.min(100, Math.round((entry.current / entry.target) * 100)),
  };
}

export { ACHIEVEMENTS };
