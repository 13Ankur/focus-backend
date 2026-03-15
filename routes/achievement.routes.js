import express from 'express';
import protect from '../middleware/auth.middleware.js';
import { getAchievements, claimAchievement, checkAchievements } from '../services/achievementService.js';

const router = express.Router();

// GET /achievements — all achievements with status for current user
router.get('/', protect, async (req, res) => {
  try {
    const achievements = await getAchievements(req.user._id);

    const unlocked = achievements.filter(a => a.unlocked).length;
    const unclaimed = achievements.filter(a => a.unlocked && !a.claimed).length;
    const total = achievements.length;

    res.json({
      achievements,
      summary: { unlocked, unclaimed, total },
    });
  } catch (err) {
    console.error('GET /achievements error:', err);
    res.status(500).json({ message: 'Failed to load achievements' });
  }
});

// POST /achievements/claim — claim an unlocked achievement
router.post('/claim', protect, async (req, res) => {
  try {
    const { achievementId } = req.body;
    if (!achievementId) {
      return res.status(400).json({ message: 'achievementId is required' });
    }

    const result = await claimAchievement(req.user._id, achievementId);

    if (result.error === 'not_found') {
      return res.status(404).json(result);
    }
    if (result.error === 'already_claimed') {
      return res.status(409).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error('POST /achievements/claim error:', err);
    res.status(500).json({ message: 'Failed to claim achievement' });
  }
});

// POST /achievements/check — manually trigger achievement check (e.g. on app open)
router.post('/check', protect, async (req, res) => {
  try {
    const newlyUnlocked = await checkAchievements(req.user._id);
    res.json({ newlyUnlocked });
  } catch (err) {
    console.error('POST /achievements/check error:', err);
    res.status(500).json({ message: 'Failed to check achievements' });
  }
});

export default router;
