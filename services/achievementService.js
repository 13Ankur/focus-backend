import Achievement from '../models/Achievement.js';
import User from '../models/User.js';
import AchievementDefinition from '../models/AchievementDefinition.js';

/**
 * Check all achievements for a user after a session completion.
 * Returns an array of newly unlocked achievements.
 */
export async function checkAchievements(userId, session = null, dailyStats = null) {
  try {
    const user = await User.findById(userId);
    if (!user) return [];

    const definitions = await AchievementDefinition.find({ isActive: true });
    const existing = await Achievement.find({ userId });
    const existingIds = new Set(existing.map(a => a.achievementId));
    const newlyUnlocked = [];

    for (const def of definitions) {
      if (existingIds.has(def.id)) continue;

      let passed = false;
      try {
        passed = checkRequirement(def, user, session, dailyStats);
      } catch (err) {
        console.error(`Error checking achievement ${def.id}:`, err);
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

  const user = await User.findById(userId);
  if (!user) return { error: 'user_not_found', message: 'User not found' };

  user.totalKibble += achievement.kibbleReward;
  user.totalMealsProvided = Math.floor(user.totalKibble / 25);
  // Manual call to check breeds since kible changed
  // Note: we might need to import breed logic here or just rely on the next call to /breeds

  await user.save();

  return {
    success: true,
    kibbleAwarded: achievement.kibbleReward,
    totalKibble: user.totalKibble,
    totalMealsProvided: user.totalMealsProvided,
  };
}

/**
 * Get all achievements with status for a user.
 */
export async function getAchievements(userId) {
  const user = await User.findById(userId);
  if (!user) return [];

  const definitions = await AchievementDefinition.find({ isActive: true }).sort({ order: 1 });
  const userAchievements = await Achievement.find({ userId });
  const achievementMap = new Map(userAchievements.map(a => [a.achievementId, a]));

  return definitions.map(def => {
    const record = achievementMap.get(def.id);
    const unlocked = !!record;
    const claimed = record ? record.claimed : false;

    return {
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
  });
}

function checkRequirement(def, user, session, dailyStats) {
  const { requirementType, requirementValue } = def;

  switch (requirementType) {
    case 'completedSessions':
      return user.completedSessions >= requirementValue;
    case 'currentStreak':
      return user.currentStreak >= requirementValue;
    case 'unlockedBreeds':
      return (user.unlockedBreeds?.length || 0) >= requirementValue;
    case 'totalFocusMinutes':
      return user.totalFocusMinutes >= requirementValue;
    case 'totalMealsProvided':
      return user.totalMealsProvided >= requirementValue;
    case 'sessionDuration':
      return session && session.duration >= requirementValue;
    case 'sessionTime':
      // This is a special case for early bird/night owl which might need more complex logic
      // For now, we use a simple hour check if possible, or skip if not provided
      if (!session) return false;
      const hour = new Date(session.startTime).getHours();
      if (def.id === 'early_bird') return hour < 8;
      if (def.id === 'night_owl') return hour >= 22;
      return false;
    default:
      return false;
  }
}

function getProgress(def, user) {
  const { requirementType, requirementValue } = def;
  let current = 0;

  switch (requirementType) {
    case 'completedSessions':
      current = user.completedSessions;
      break;
    case 'currentStreak':
      current = user.currentStreak;
      break;
    case 'unlockedBreeds':
      current = user.unlockedBreeds?.length || 0;
      break;
    case 'totalFocusMinutes':
      current = user.totalFocusMinutes;
      break;
    case 'totalMealsProvided':
      current = user.totalMealsProvided;
      break;
    default:
      return null;
  }

  return {
    current: Math.min(current, requirementValue),
    target: requirementValue,
    percent: Math.min(100, Math.round((current / requirementValue) * 100)),
  };
}
