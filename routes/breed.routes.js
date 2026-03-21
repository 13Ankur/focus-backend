import express from 'express';
import protect from '../middleware/auth.middleware.js';
import Breed from '../models/Breed.js';

const router = express.Router();

async function getBreedThresholdMap() {
  const breeds = await Breed.find({ isActive: true });
  const map = {};
  breeds.forEach(b => {
    map[b.id] = b.sessionsRequired || 0;
  });
  return map;
}

export async function checkAndUnlockBreeds(user) {
  const sessions = user.completedSessions || 0;
  const newlyUnlocked = [];

  const allBreeds = await Breed.find({ isActive: true }).sort({ order: 1 });

  for (const breed of allBreeds) {
    if (
      sessions >= (breed.sessionsRequired || 0) &&
      !user.unlockedBreeds.includes(breed.id)
    ) {
      user.unlockedBreeds.push(breed.id);
      newlyUnlocked.push(breed);
    }
  }

  return newlyUnlocked;
}

router.get('/', protect, async (req, res) => {
  try {
    const user = req.user;
    const sessions = user.completedSessions || 0;

    const newlyUnlocked = await checkAndUnlockBreeds(user);
    if (newlyUnlocked.length > 0) {
      await user.save();
    }

    const allBreeds = await Breed.find({ isActive: true }).sort({ order: 1 });
    const breeds = allBreeds.map(breed => ({
      ...breed.toObject(),
      unlocked: user.unlockedBreeds.includes(breed.id),
      isActive: user.activeBreed === breed.id,
      progress: breed.sessionsRequired === 0
        ? 100
        : Math.min(100, (sessions / breed.sessionsRequired) * 100),
      sessionsToUnlock: Math.max(0, breed.sessionsRequired - sessions),
    }));

    res.json({
      breeds,
      activeBreed: user.activeBreed,
      unlockedBreeds: user.unlockedBreeds,
      totalKibble: user.totalKibble,
      completedSessions: sessions,
    });
  } catch (error) {
    console.error('Breeds fetch error:', error);
    res.status(500).json({ message: 'Server error fetching breeds' });
  }
});

router.get('/collection', protect, async (req, res) => {
  try {
    const user = req.user;
    const sessions = user.completedSessions || 0;

    const newlyUnlocked = await checkAndUnlockBreeds(user);
    if (newlyUnlocked.length > 0) {
      await user.save();
    }

    const allBreeds = await Breed.find({ isActive: true }).sort({ order: 1 });
    const nextToUnlock = allBreeds
      .filter(b => !user.unlockedBreeds.includes(b.id))
      .sort((a, b) => a.sessionsRequired - b.sessionsRequired)[0] || null;

    res.json({
      unlockedBreeds: user.unlockedBreeds,
      activeBreed: user.activeBreed,
      totalKibble: user.totalKibble,
      completedSessions: sessions,
      unlockedCount: user.unlockedBreeds.length,
      totalBreeds: allBreeds.length,
      nextToUnlock,
    });
  } catch (error) {
    console.error('Collection fetch error:', error);
    res.status(500).json({ message: 'Server error fetching collection' });
  }
});

router.post('/active', protect, async (req, res) => {
  try {
    const { breedId } = req.body;

    if (!breedId) {
      return res.status(400).json({ message: 'Breed ID is required' });
    }

    // Check if breed exists in DB
    const breed = await Breed.findOne({ id: breedId, isActive: true });
    if (!breed) {
      return res.status(404).json({ message: 'Breed not found' });
    }

    const user = req.user;

    if (!user.unlockedBreeds.includes(breedId)) {
      const threshold = breed.sessionsRequired || 0;
      return res.status(403).json({
        message: 'Breed is locked',
        sessionsNeeded: Math.max(0, threshold - (user.completedSessions || 0)),
        sessionsRequired: threshold,
      });
    }

    // Set active breed
    user.activeBreed = breedId;
    user.selectedBreed = breedId; // Legacy field
    await user.save();

    res.json({
      success: true,
      activeBreed: breedId,
      breed: {
        ...breed.toObject(),
        unlocked: true,
        isActive: true
      }
    });
  } catch (error) {
    console.error('Set active breed error:', error);
    res.status(500).json({ message: 'Server error setting active breed' });
  }
});

router.get('/active', protect, async (req, res) => {
  try {
    const user = req.user;
    const breed = await Breed.findOne({ id: user.activeBreed, isActive: true });

    if (!breed) {
      // Fallback to first breed in DB
      const fallback = await Breed.findOne({ isActive: true }).sort({ order: 1 });
      return res.json(fallback || {});
    }

    res.json({
      ...breed.toObject(),
      unlocked: true,
      isActive: true
    });
  } catch (error) {
    console.error('Active breed fetch error:', error);
    res.status(500).json({ message: 'Server error fetching active breed' });
  }
});

router.post('/check-unlocks', protect, async (req, res) => {
  try {
    const user = req.user;
    const newlyUnlocked = await checkAndUnlockBreeds(user);

    if (newlyUnlocked.length > 0) {
      await user.save();
    }

    res.json({
      newlyUnlocked: newlyUnlocked.map(b => ({ id: b.id, name: b.name, description: b.description })),
      unlockedBreeds: user.unlockedBreeds,
      completedSessions: user.completedSessions || 0,
      totalKibble: user.totalKibble,
    });
  } catch (error) {
    console.error('Check unlocks error:', error);
    res.status(500).json({ message: 'Server error checking unlocks' });
  }
});

router.post('/unlock', protect, async (req, res) => {
  try {
    const { breedId } = req.body;
    if (!breedId) return res.status(400).json({ message: 'Breed ID is required' });

    const breed = await Breed.findOne({ id: breedId, isActive: true });
    if (!breed) return res.status(404).json({ message: 'Breed not found' });

    const user = req.user;

    if (user.unlockedBreeds.includes(breedId)) {
      return res.status(409).json({ message: 'Breed already unlocked' });
    }

    const threshold = breed.sessionsRequired || 0;
    const sessions = user.completedSessions || 0;
    if (sessions < threshold) {
      return res.status(403).json({
        message: 'Not enough sessions',
        sessionsNeeded: threshold - sessions,
        sessionsRequired: threshold,
      });
    }

    user.unlockedBreeds.push(breedId);
    user.activeBreed = breedId;
    user.selectedBreed = breedId;
    await user.save();

    res.json({
      success: true,
      breedId,
      kibbleBalance: user.totalKibble,
      unlockedBreeds: user.unlockedBreeds,
      activeBreed: user.activeBreed,
    });
  } catch (error) {
    console.error('Unlock breed error:', error);
    res.status(500).json({ message: 'Server error unlocking breed' });
  }
});

export default router;
