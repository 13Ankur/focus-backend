import express from 'express';
import User from '../models/User.js';
import protect from '../middleware/auth.middleware.js';

const router = express.Router();

// All breed definitions with metadata
const ALL_BREEDS = [
  {
    id: 'golden_retriever',
    name: 'Golden Retriever',
    description: 'Friendly & loyal companion',
    image: 'assets/images/golden_retriever.png',
    eatingImage: 'assets/images/golden_retriever_eating.png',
    sleepingImage: 'assets/images/golden_retriever_sleeping.png',
    unlockRequirement: 0,
    order: 1
  },
  {
    id: 'husky',
    name: 'Husky',
    description: 'Energetic & adventurous',
    image: 'assets/images/husky.png',
    eatingImage: 'assets/images/husky_eating.png',
    sleepingImage: 'assets/images/husky_sleeping.png',
    unlockRequirement: 100,
    order: 2
  },
  {
    id: 'shiba_inu',
    name: 'Shiba Inu',
    description: 'Charming & spirited',
    image: 'assets/images/shiba_inu.png',
    eatingImage: 'assets/images/shiba_inu_eating.png',
    sleepingImage: 'assets/images/shiba_inu_sleeping.png',
    unlockRequirement: 250,
    order: 3
  },
  {
    id: 'cavapoo',
    name: 'Cavapoo',
    description: 'Sweet & cuddly',
    image: 'assets/images/cavapoo.png',
    eatingImage: 'assets/images/cavapoo_eating.png',
    sleepingImage: 'assets/images/cavapoo_sleeping.png',
    unlockRequirement: 500,
    order: 4
  },
  {
    id: 'french_bulldog',
    name: 'French Bulldog',
    description: 'Playful & affectionate',
    image: 'assets/images/french_bulldog.png',
    eatingImage: 'assets/images/french_bulldog_eating.png',
    sleepingImage: 'assets/images/french_bulldog_sleeping.png',
    unlockRequirement: 750,
    order: 5
  },
  {
    id: 'labrador',
    name: 'Labrador Retriever',
    description: 'Gentle & outgoing',
    image: 'assets/images/labrador.png',
    eatingImage: 'assets/images/labrador_eating.png',
    sleepingImage: 'assets/images/labrador_sleeping.png',
    unlockRequirement: 1000,
    order: 6
  },
  {
    id: 'dachshund',
    name: 'Dachshund',
    description: 'Clever & curious',
    image: 'assets/images/dachshund.png',
    eatingImage: 'assets/images/dachshund_eating.png',
    sleepingImage: 'assets/images/dachshund_sleeping.png',
    unlockRequirement: 1500,
    order: 7
  },
  {
    id: 'australian_shepherd',
    name: 'Australian Shepherd',
    description: 'Smart & work-oriented',
    image: 'assets/images/australian_shepherd.png',
    eatingImage: 'assets/images/australian_shepherd_eating.png',
    sleepingImage: 'assets/images/australian_shepherd_sleeping.png',
    unlockRequirement: 2000,
    order: 8
  },
  {
    id: 'maltese',
    name: 'Maltese',
    description: 'Gentle & fearless',
    image: 'assets/images/maltese.png',
    eatingImage: 'assets/images/maltese_eating.png',
    sleepingImage: 'assets/images/maltese_sleeping.png',
    unlockRequirement: 3000,
    order: 9
  }
];

// @route   GET /breeds
// @desc    Get all breeds with unlock status for user
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const user = req.user;
    
    const breeds = ALL_BREEDS.map(breed => ({
      ...breed,
      unlocked: user.unlockedBreeds.includes(breed.id),
      isActive: user.activeBreed === breed.id,
      progress: Math.min(100, (user.totalKibble / breed.unlockRequirement) * 100),
      kibbleToUnlock: Math.max(0, breed.unlockRequirement - user.totalKibble)
    }));
    
    res.json({
      breeds,
      activeBreed: user.activeBreed,
      unlockedBreeds: user.unlockedBreeds,
      totalKibble: user.totalKibble
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
    
    res.json({
      unlockedBreeds: user.unlockedBreeds,
      activeBreed: user.activeBreed,
      totalKibble: user.totalKibble,
      unlockedCount: user.unlockedBreeds.length,
      totalBreeds: ALL_BREEDS.length,
      nextToUnlock: ALL_BREEDS.find(b => 
        !user.unlockedBreeds.includes(b.id) && 
        b.unlockRequirement > user.totalKibble
      ) || null
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
    
    // Check if breed is unlocked
    if (!user.unlockedBreeds.includes(breedId)) {
      return res.status(403).json({ 
        message: 'Breed is locked',
        kibbleNeeded: breed.unlockRequirement - user.totalKibble,
        requirement: breed.unlockRequirement
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
// @desc    Check and apply any new breed unlocks based on kibble
// @access  Private
router.post('/check-unlocks', protect, async (req, res) => {
  try {
    const user = req.user;
    const newlyUnlocked = user.checkBreedUnlocks();
    
    if (newlyUnlocked.length > 0) {
      await user.save();
    }
    
    res.json({
      newlyUnlocked,
      unlockedBreeds: user.unlockedBreeds,
      totalKibble: user.totalKibble
    });
  } catch (error) {
    console.error('Check unlocks error:', error);
    res.status(500).json({ message: 'Server error checking unlocks' });
  }
});

export default router;
