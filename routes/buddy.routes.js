import express from 'express';
import User from '../models/User.js';
import protect from '../middleware/auth.middleware.js';

const router = express.Router();

// @route   GET /buddy
// @desc    Get buddy stats (happiness, fullness) with decay applied
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const user = req.user;
    
    // Apply decay based on time since last interaction
    const stats = user.decayBuddyStats();
    await user.save();
    
    res.json({
      happiness: user.buddyHappiness,
      fullness: user.buddyFullness,
      lastInteraction: user.lastBuddyInteraction,
      activeBreed: user.activeBreed,
      hoursSinceInteraction: stats.hoursSinceInteraction,
      status: getBuddyStatus(user.buddyHappiness, user.buddyFullness)
    });
  } catch (error) {
    console.error('Buddy stats error:', error);
    res.status(500).json({ message: 'Server error fetching buddy stats' });
  }
});

// @route   POST /buddy/interact
// @desc    Interact with buddy (pet, play, treat)
// @access  Private
router.post('/interact', protect, async (req, res) => {
  try {
    const { action } = req.body;
    const user = req.user;
    
    let message = '';
    let kibbleSpent = 0;
    
    switch (action) {
      case 'pet':
        user.buddyHappiness = Math.min(100, user.buddyHappiness + 5);
        message = `${getBreedName(user.activeBreed)} loves the pets! 💚`;
        break;
        
      case 'play':
        user.buddyHappiness = Math.min(100, user.buddyHappiness + 10);
        user.buddyFullness = Math.max(0, user.buddyFullness - 5);
        message = `${getBreedName(user.activeBreed)} had a blast playing! 🎾`;
        break;
        
      case 'treat':
        if (user.totalKibble < 10) {
          return res.status(400).json({ 
            message: 'Not enough kibble! Complete focus sessions to earn more.',
            kibbleBalance: user.totalKibble
          });
        }
        user.totalKibble -= 10;
        user.buddyFullness = Math.min(100, user.buddyFullness + 20);
        user.buddyHappiness = Math.min(100, user.buddyHappiness + 5);
        kibbleSpent = 10;
        message = `${getBreedName(user.activeBreed)} gobbled up the treat! 🦴`;
        break;
        
      default:
        return res.status(400).json({ message: 'Invalid action. Use: pet, play, or treat' });
    }
    
    user.lastBuddyInteraction = new Date();
    await user.save();
    
    res.json({
      success: true,
      action,
      message,
      kibbleSpent,
      stats: {
        happiness: user.buddyHappiness,
        fullness: user.buddyFullness,
        kibbleBalance: user.totalKibble
      },
      status: getBuddyStatus(user.buddyHappiness, user.buddyFullness)
    });
  } catch (error) {
    console.error('Buddy interact error:', error);
    res.status(500).json({ message: 'Server error during interaction' });
  }
});

// @route   POST /buddy/feed
// @desc    Feed buddy using earned kibble
// @access  Private
router.post('/feed', protect, async (req, res) => {
  try {
    const { amount = 10 } = req.body;
    const user = req.user;
    
    if (user.totalKibble < amount) {
      return res.status(400).json({ 
        message: 'Not enough kibble!',
        required: amount,
        available: user.totalKibble
      });
    }
    
    // Deduct kibble and increase fullness
    user.totalKibble -= amount;
    user.buddyFullness = Math.min(100, user.buddyFullness + (amount * 2));
    user.buddyHappiness = Math.min(100, user.buddyHappiness + (amount / 2));
    user.lastBuddyInteraction = new Date();
    
    await user.save();
    
    res.json({
      success: true,
      kibbleSpent: amount,
      stats: {
        happiness: user.buddyHappiness,
        fullness: user.buddyFullness,
        kibbleBalance: user.totalKibble
      }
    });
  } catch (error) {
    console.error('Buddy feed error:', error);
    res.status(500).json({ message: 'Server error feeding buddy' });
  }
});

// Helper function to get breed name
function getBreedName(breedId) {
  const names = {
    golden_retriever: 'Golden Retriever',
    husky: 'Husky',
    shiba_inu: 'Shiba Inu',
    cavapoo: 'Cavapoo',
    french_bulldog: 'French Bulldog',
    labrador: 'Labrador',
    dachshund: 'Dachshund',
    australian_shepherd: 'Australian Shepherd',
    maltese: 'Maltese'
  };
  return names[breedId] || 'Buddy';
}

// Helper function to get buddy status
function getBuddyStatus(happiness, fullness) {
  if (fullness < 30) {
    return { text: 'Sleepy & hungry... 💤', emoji: '💤', state: 'sleeping' };
  } else if (happiness >= 90) {
    return { text: 'Super happy! 🎉', emoji: '🎉', state: 'happy' };
  } else if (fullness < 50) {
    return { text: 'Getting hungry... 🥺', emoji: '🥺', state: 'hungry' };
  } else if (happiness < 50) {
    return { text: 'Needs some attention 🐕', emoji: '🐕', state: 'lonely' };
  }
  return { text: 'Happy & content 😊', emoji: '😊', state: 'idle' };
}

export default router;
