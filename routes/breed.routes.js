import express from 'express';
import protect from '../middleware/auth.middleware.js';
import Breed from '../models/Breed.js';
import { getEffectiveTier } from '../services/subscriptionService.js';

const router = express.Router();

async function getBreedThresholdMap() {
  const breeds = await Breed.find({ isActive: true });
  const map = {};
  breeds.forEach(b => {
    map[b.id] = b.sessionsRequired || 0;
  });
  return map;
}

const STARTER_BREEDS = ['golden_retriever', 'husky'];

/** Paid breeds keep a kibble floor even if the database row was saved as 0. */
const BREED_KIBBLE_FLOOR = {
  shiba_inu: 350,
  cavapoo: 700,
  french_bulldog: 1000,
  labrador: 1400,
  dachshund: 1800,
  australian_shepherd: 2400,
  maltese: 3200,
};

function breedCost(breed) {
  const floor = BREED_KIBBLE_FLOOR[breed.id] ?? 0;
  return Math.max(Number(breed.unlockRequirement || 0), floor);
}

export async function checkAndUnlockBreeds(user) {
  const kibble = user.totalKibble || 0;
  const newlyUnlocked = [];
  const paid = getEffectiveTier(user) !== 'free';

  if (!Array.isArray(user.unlockedBreeds)) user.unlockedBreeds = [];
  let changed = false;
  for (const id of STARTER_BREEDS) {
    if (!user.unlockedBreeds.includes(id)) {
      user.unlockedBreeds.push(id);
      changed = true;
    }
  }

  const allBreeds = await Breed.find({ isActive: true }).sort({ order: 1 });
  const affordable = new Set(STARTER_BREEDS);
  for (const breed of allBreeds) {
    if (kibble >= breedCost(breed)) affordable.add(breed.id);
  }

  if (!paid) {
    const before = user.unlockedBreeds.join(',');
    user.unlockedBreeds = user.unlockedBreeds.filter(id => affordable.has(id));
    for (const id of affordable) {
      if (!user.unlockedBreeds.includes(id)) user.unlockedBreeds.push(id);
    }
    if (before !== user.unlockedBreeds.join(',')) changed = true;
    if (!affordable.has(user.activeBreed)) {
      user.activeBreed = 'golden_retriever';
      user.selectedBreed = 'golden_retriever';
      changed = true;
    }
  }

  for (const breed of allBreeds) {
    if (affordable.has(breed.id) && !user.unlockedBreeds.includes(breed.id)) {
      user.unlockedBreeds.push(breed.id);
      newlyUnlocked.push(breed);
      changed = true;
    }
  }

  if (changed) await user.save();
  return newlyUnlocked;
}

router.get('/', protect, async (req, res) => {
  try {
    const user = req.user;
    const kibble = user.totalKibble || 0;

    const newlyUnlocked = await checkAndUnlockBreeds(user);
    if (newlyUnlocked.length > 0) {
      await user.save();
    }

    const allBreeds = await Breed.find({ isActive: true }).sort({ order: 1 });
    const breeds = allBreeds.map(breed => ({
      ...breed.toObject(),
      unlocked: user.unlockedBreeds.includes(breed.id),
      isActive: user.activeBreed === breed.id,
      progress: breed.unlockRequirement === 0
        ? 100
        : Math.min(100, (kibble / breed.unlockRequirement) * 100),
      kibbleToUnlock: Math.max(0, breed.unlockRequirement - kibble),
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

    const paid = getEffectiveTier(user) !== 'free';
    const threshold = breedCost(breed);
    const earned = (user.totalKibble || 0) >= threshold || STARTER_BREEDS.includes(breedId);
    if (!paid && !earned) {
      return res.status(403).json({
        message: 'Breed is locked',
        kibbleNeeded: Math.max(0, threshold - (user.totalKibble || 0)),
        kibbleRequired: threshold,
      });
    }
    if (!user.unlockedBreeds.includes(breedId)) {
      user.unlockedBreeds.push(breedId);
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

    const threshold = breedCost(breed);
    const kibble = user.totalKibble || 0;
    if (kibble < threshold) {
      return res.status(403).json({
        message: 'Not enough kibble',
        kibbleNeeded: threshold - kibble,
        kibbleRequired: threshold,
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
