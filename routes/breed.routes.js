import express from 'express';
import User from '../models/User.js';
import protect from '../middleware/auth.middleware.js';

const router = express.Router();

const SESSION_UNLOCK_THRESHOLDS = {
  golden_retriever: 0,
  husky: 5,
  shiba_inu: 15,
  cavapoo: 30,
  french_bulldog: 50,
  labrador: 75,
  dachshund: 100,
  australian_shepherd: 150,
  maltese: 200,
};

const ALL_BREEDS = [
  {
    id: 'golden_retriever',
    name: 'Golden Retriever',
    description: 'Friendly & loyal companion',
    image: 'assets/images/golden_retriever.png',
    eatingImage: 'assets/images/golden_retriever_eating.png',
    sleepingImage: 'assets/images/golden_retriever_sleeping.png',
    unlockRequirement: 0,
    sessionsRequired: SESSION_UNLOCK_THRESHOLDS.golden_retriever,
    order: 1
  },
  {
    id: 'husky',
    name: 'Husky',
    description: 'Energetic & adventurous',
    image: 'assets/images/husky.png',
    eatingImage: 'assets/images/husky_eating.png',
    sleepingImage: 'assets/images/husky_sleeping.png',
    unlockRequirement: 500,
    sessionsRequired: SESSION_UNLOCK_THRESHOLDS.husky,
    order: 2
  },
  {
    id: 'shiba_inu',
    name: 'Shiba Inu',
    description: 'Charming & spirited',
    image: 'assets/images/shiba_inu.png',
    eatingImage: 'assets/images/shiba_inu_eating.png',
    sleepingImage: 'assets/images/shiba_inu_sleeping.png',
    unlockRequirement: 1000,
    sessionsRequired: SESSION_UNLOCK_THRESHOLDS.shiba_inu,
    order: 3
  },
  {
    id: 'cavapoo',
    name: 'Cavapoo',
    description: 'Sweet & cuddly',
    image: 'assets/images/cavapoo.png',
    eatingImage: 'assets/images/cavapoo_eating.png',
    sleepingImage: 'assets/images/cavapoo_sleeping.png',
    unlockRequirement: 2000,
    sessionsRequired: SESSION_UNLOCK_THRESHOLDS.cavapoo,
    order: 4
  },
  {
    id: 'french_bulldog',
    name: 'French Bulldog',
    description: 'Playful & affectionate',
    image: 'assets/images/french_bulldog.png',
    eatingImage: 'assets/images/french_bulldog_eating.png',
    sleepingImage: 'assets/images/french_bulldog_sleeping.png',
    unlockRequirement: 3000,
    sessionsRequired: SESSION_UNLOCK_THRESHOLDS.french_bulldog,
    order: 5
  },
  {
    id: 'labrador',
    name: 'Labrador Retriever',
    description: 'Gentle & outgoing',
    image: 'assets/images/labrador.png',
    eatingImage: 'assets/images/labrador_eating.png',
    sleepingImage: 'assets/images/labrador_sleeping.png',
    unlockRequirement: 4000,
    sessionsRequired: SESSION_UNLOCK_THRESHOLDS.labrador,
    order: 6
  },
  {
    id: 'dachshund',
    name: 'Dachshund',
    description: 'Clever & curious',
    image: 'assets/images/dachshund.png',
    eatingImage: 'assets/images/dachshund_eating.png',
    sleepingImage: 'assets/images/dachshund_sleeping.png',
    unlockRequirement: 6000,
    sessionsRequired: SESSION_UNLOCK_THRESHOLDS.dachshund,
    order: 7
  },
  {
    id: 'australian_shepherd',
    name: 'Australian Shepherd',
    description: 'Smart & work-oriented',
    image: 'assets/images/australian_shepherd.png',
    eatingImage: 'assets/images/australian_shepherd_eating.png',
    sleepingImage: 'assets/images/australian_shepherd_sleeping.png',
    unlockRequirement: 8000,
    sessionsRequired: SESSION_UNLOCK_THRESHOLDS.australian_shepherd,
    order: 8
  },
  {
    id: 'maltese',
    name: 'Maltese',
    description: 'Gentle & fearless',
    image: 'assets/images/maltese.png',
    eatingImage: 'assets/images/maltese_eating.png',
    sleepingImage: 'assets/images/maltese_sleeping.png',
    unlockRequirement: 10000,
    sessionsRequired: SESSION_UNLOCK_THRESHOLDS.maltese,
    order: 9
  }
];

export function checkAndUnlockBreeds(user) {
  const sessions = user.completedSessions || 0;
  const newlyUnlocked = [];

  for (const breed of ALL_BREEDS) {
    if (
      breed.sessionsRequired > 0 &&
      sessions >= breed.sessionsRequired &&
      !user.unlockedBreeds.includes(breed.id)
    ) {
      user.unlockedBreeds.push(breed.id);
      newlyUnlocked.push(breed);
    }
  }

  return newlyUnlocked;
}

export { ALL_BREEDS, SESSION_UNLOCK_THRESHOLDS };

// @route   GET /breeds
// @desc    Get all breeds with unlock status for user
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const user = req.user;
    const sessions = user.completedSessions || 0;

    const newlyUnlocked = checkAndUnlockBreeds(user);
    if (newlyUnlocked.length > 0) {
      await user.save();
    }

    const breeds = ALL_BREEDS.map(breed => ({
      ...breed,
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

// @route   GET /breeds/collection
// @desc    Get user's breed collection summary
// @access  Private
router.get('/collection', protect, async (req, res) => {
  try {
    const user = req.user;
    const sessions = user.completedSessions || 0;

    const newlyUnlocked = checkAndUnlockBreeds(user);
    if (newlyUnlocked.length > 0) {
      await user.save();
    }

    const nextToUnlock = ALL_BREEDS
      .filter(b => !user.unlockedBreeds.includes(b.id))
      .sort((a, b) => a.sessionsRequired - b.sessionsRequired)[0] || null;

    res.json({
      unlockedBreeds: user.unlockedBreeds,
      activeBreed: user.activeBreed,
      totalKibble: user.totalKibble,
      completedSessions: sessions,
      unlockedCount: user.unlockedBreeds.length,
      totalBreeds: ALL_BREEDS.length,
      nextToUnlock,
    });
  } catch (error) {
    console.error('Collection fetch error:', error);
    res.status(500).json({ message: 'Server error fetching collection' });
  }
});

// @route   POST /breeds/active
// @desc    Set active breed
// @access  Private
router.post('/active', protect, async (req, res) => {
  try {
    const { breedId } = req.body;

    if (!breedId) {
      return res.status(400).json({ message: 'Breed ID is required' });
    }

    // Check if breed exists
    const breed = ALL_BREEDS.find(b => b.id === breedId);
    if (!breed) {
      return res.status(404).json({ message: 'Breed not found' });
    }

    const user = req.user;

    if (!user.unlockedBreeds.includes(breedId)) {
      const threshold = SESSION_UNLOCK_THRESHOLDS[breedId] || 0;
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
        ...breed,
        unlocked: true,
        isActive: true
      }
    });
  } catch (error) {
    console.error('Set active breed error:', error);
    res.status(500).json({ message: 'Server error setting active breed' });
  }
});

// @route   GET /breeds/active
// @desc    Get active breed details
// @access  Private
router.get('/active', protect, async (req, res) => {
  try {
    const user = req.user;
    const breed = ALL_BREEDS.find(b => b.id === user.activeBreed);

    if (!breed) {
      // Fallback to golden retriever
      return res.json(ALL_BREEDS[0]);
    }

    res.json({
      ...breed,
      unlocked: true,
      isActive: true
    });
  } catch (error) {
    console.error('Active breed fetch error:', error);
    res.status(500).json({ message: 'Server error fetching active breed' });
  }
});

// @route   POST /breeds/check-unlocks
// @desc    Auto-unlock breeds based on completed sessions
// @access  Private
router.post('/check-unlocks', protect, async (req, res) => {
  try {
    const user = req.user;
    const newlyUnlocked = checkAndUnlockBreeds(user);

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

// @route   POST /breeds/unlock
// @desc    Unlock a breed if session threshold is met (no kibble cost)
// @access  Private
router.post('/unlock', protect, async (req, res) => {
  try {
    const { breedId } = req.body;
    if (!breedId) return res.status(400).json({ message: 'Breed ID is required' });

    const breed = ALL_BREEDS.find(b => b.id === breedId);
    if (!breed) return res.status(404).json({ message: 'Breed not found' });

    const user = req.user;

    if (user.unlockedBreeds.includes(breedId)) {
      return res.status(409).json({ message: 'Breed already unlocked' });
    }

    const threshold = SESSION_UNLOCK_THRESHOLDS[breedId] || 0;
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
