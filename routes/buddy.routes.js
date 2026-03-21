import express from 'express';
import Accessory from '../models/Accessory.js';
import AccessoryItem from '../models/AccessoryItem.js';
import User from '../models/User.js';
import protect from '../middleware/auth.middleware.js';
import { getEffectiveTier, TIER_LEVELS } from '../services/subscriptionService.js';

const router = express.Router();

function canAccessTier(userTier, requiredTier) {
  return TIER_LEVELS[userTier] >= TIER_LEVELS[requiredTier];
}

// @route   GET /buddy
// @desc    Get buddy status (happiness/fullness)
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const user = req.user;
    user.decayBuddyStats();
    await user.save();

    res.json({
      happiness: user.buddyHappiness,
      fullness: user.buddyFullness,
      lastBuddyInteraction: user.lastBuddyInteraction,
    });
  } catch (error) {
    console.error('GET /buddy error:', error.message);
    res.status(500).json({ message: 'Server error fetching buddy status' });
  }
});

// @route   POST /buddy/interact
// @desc    Interact with buddy (pet/play)
// @access  Private
router.post('/interact', protect, async (req, res) => {
  try {
    const { action } = req.body;
    if (!action) return res.status(400).json({ message: 'Action is required' });

    const user = req.user;
    user.decayBuddyStats(); // Decay first to get fresh baseline

    if (action === 'pet') {
      user.buddyHappiness = Math.min(100, user.buddyHappiness + 5);
    } else if (action === 'play') {
      if (user.buddyFullness < 20) {
        return res.status(400).json({ message: 'Too hungry to play! Give a treat first.' });
      }
      user.buddyHappiness = Math.min(100, user.buddyHappiness + 10);
      user.buddyFullness = Math.max(0, user.buddyFullness - 5);
    } else {
      return res.status(400).json({ message: 'Invalid action' });
    }

    user.lastBuddyInteraction = Date.now();
    await user.save();

    res.json({
      success: true,
      happiness: user.buddyHappiness,
      fullness: user.buddyFullness,
    });
  } catch (error) {
    console.error('POST /buddy/interact error:', error.message);
    res.status(500).json({ message: 'Server error interacting with buddy' });
  }
});

// @route   POST /buddy/feed
// @desc    Feed the buddy (costs 10 kibble)
// @access  Private
router.post('/feed', protect, async (req, res) => {
  try {
    const user = req.user;
    const cost = 10;

    if (user.totalKibble < cost) {
      return res.status(400).json({ message: 'Not enough kibble! Complete sessions to earn more.' });
    }

    if (user.buddyFullness >= 100) {
      return res.status(400).json({ message: 'Your buddy is already full!' });
    }

    user.totalKibble -= cost;
    user.buddyFullness = Math.min(100, user.buddyFullness + 20);
    user.buddyHappiness = Math.min(100, user.buddyHappiness + 5);
    user.lastBuddyInteraction = Date.now();

    // Recalculate meals if needed
    user.totalMealsProvided = Math.floor(user.totalKibble / 25);

    await user.save();

    res.json({
      success: true,
      happiness: user.buddyHappiness,
      fullness: user.buddyFullness,
      totalKibble: user.totalKibble,
      totalMealsProvided: user.totalMealsProvided
    });
  } catch (error) {
    console.error('POST /buddy/feed error:', error.message);
    res.status(500).json({ message: 'Server error feeding buddy' });
  }
});

// @route   GET /buddy/accessories
// @desc    Get all accessories with owned/equipped status
// @access  Private
router.get('/accessories', protect, async (req, res) => {
  try {
    const user = req.user;
    const userTier = getEffectiveTier(user);
    const owned = await Accessory.find({ userId: user._id }).lean();
    const ownedMap = new Map(owned.map(a => [a.accessoryId, a]));

    const allAccessories = await AccessoryItem.find({ isActive: true }).sort({ order: 1 });

    const accessories = allAccessories.map(item => {
      const ownedItem = ownedMap.get(item.id);
      return {
        ...item.toObject(),
        owned: !!ownedItem,
        equipped: ownedItem?.isEquipped || false,
        canBuy: canAccessTier(userTier, item.tier) && !ownedItem,
        tierLocked: !canAccessTier(userTier, item.tier),
      };
    });

    res.json({
      accessories,
      equipped: user.equippedAccessories || { hat: null, collar: null, background: null, special: null },
      kibbleBalance: user.totalKibble,
    });
  } catch (error) {
    console.error('GET /buddy/accessories error:', error.message);
    res.status(500).json({ message: 'Server error fetching accessories' });
  }
});

// @route   POST /buddy/accessories/buy
// @desc    Purchase an accessory
// @access  Private
router.post('/accessories/buy', protect, async (req, res) => {
  try {
    const { accessoryId } = req.body;
    if (!accessoryId) return res.status(400).json({ message: 'accessoryId is required' });

    const item = await AccessoryItem.findOne({ id: accessoryId, isActive: true });
    if (!item) return res.status(404).json({ message: 'Accessory not found' });

    const user = req.user;
    const userTier = getEffectiveTier(user);

    if (!canAccessTier(userTier, item.tier)) {
      return res.status(403).json({
        error: 'tier_required',
        requiredTier: item.tier,
        message: `This accessory requires ${item.tier} tier.`,
      });
    }

    const existing = await Accessory.findOne({ userId: user._id, accessoryId });
    if (existing) return res.status(409).json({ message: 'Already owned', owned: true });

    if (item.cost > 0 && user.totalKibble < item.cost) {
      return res.status(400).json({
        error: 'insufficient_kibble',
        needed: item.cost - user.totalKibble,
        message: `Need ${item.cost - user.totalKibble} more kibble.`,
      });
    }

    if (item.cost > 0) {
      await User.findByIdAndUpdate(user._id, { $inc: { totalKibble: -item.cost } });
    }

    await Accessory.create({
      userId: user._id,
      accessoryId,
      slot: item.slot,
      isEquipped: false,
    });

    const updatedUser = await User.findById(user._id);

    res.json({
      success: true,
      accessoryId,
      kibbleSpent: item.cost,
      kibbleBalance: updatedUser.totalKibble,
    });
  } catch (error) {
    console.error('POST /buddy/accessories/buy error:', error.message);
    res.status(500).json({ message: 'Server error purchasing accessory' });
  }
});

// @route   POST /buddy/accessories/equip
// @desc    Equip or unequip an accessory
// @access  Private
router.post('/accessories/equip', protect, async (req, res) => {
  try {
    const { accessoryId, equip } = req.body;
    if (!accessoryId) return res.status(400).json({ message: 'accessoryId is required' });

    const item = await AccessoryItem.findOne({ id: accessoryId, isActive: true });
    if (!item) return res.status(404).json({ message: 'Accessory not found' });

    const owned = await Accessory.findOne({ userId: req.user._id, accessoryId });
    if (!owned) return res.status(400).json({ message: 'You don\'t own this accessory' });

    const shouldEquip = equip !== false;

    if (shouldEquip) {
      await Accessory.updateMany(
        { userId: req.user._id, slot: item.slot, isEquipped: true },
        { isEquipped: false },
      );
      owned.isEquipped = true;
      await owned.save();

      await User.findByIdAndUpdate(req.user._id, {
        [`equippedAccessories.${item.slot}`]: accessoryId,
      });
    } else {
      owned.isEquipped = false;
      await owned.save();

      await User.findByIdAndUpdate(req.user._id, {
        [`equippedAccessories.${item.slot}`]: null,
      });
    }

    const updatedUser = await User.findById(req.user._id);

    res.json({
      success: true,
      accessoryId,
      equipped: shouldEquip,
      equippedAccessories: updatedUser.equippedAccessories,
    });
  } catch (error) {
    console.error('POST /buddy/accessories/equip error:', error.message);
    res.status(500).json({ message: 'Server error equipping accessory' });
  }
});

export default router;
