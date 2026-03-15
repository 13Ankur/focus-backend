import express from 'express';
import Accessory from '../models/Accessory.js';
import User from '../models/User.js';
import protect from '../middleware/auth.middleware.js';
import { getEffectiveTier, TIER_LEVELS } from '../services/subscriptionService.js';

const router = express.Router();

const ACCESSORY_CATALOG = [
  { id: 'party_hat', name: 'Party Hat', slot: 'hat', cost: 50, tier: 'free', icon: '🎉' },
  { id: 'sunglasses', name: 'Sunglasses', slot: 'hat', cost: 75, tier: 'free', icon: '🕶️' },
  { id: 'graduation_cap', name: 'Graduation Cap', slot: 'hat', cost: 100, tier: 'pro', icon: '🎓' },
  { id: 'crown', name: 'Crown', slot: 'hat', cost: 200, tier: 'pro', icon: '👑' },
  { id: 'santa_hat', name: 'Santa Hat', slot: 'hat', cost: 150, tier: 'free', seasonal: true, icon: '🎅' },
  { id: 'basic_collar', name: 'Basic Collar', slot: 'collar', cost: 30, tier: 'free', icon: '📿' },
  { id: 'fancy_collar', name: 'Fancy Collar', slot: 'collar', cost: 100, tier: 'pro', icon: '💎' },
  { id: 'gold_collar', name: 'Gold Collar', slot: 'collar', cost: 0, tier: 'guardian', icon: '🥇' },
  { id: 'park', name: 'Park', slot: 'background', cost: 50, tier: 'free', icon: '🌳' },
  { id: 'beach', name: 'Beach', slot: 'background', cost: 100, tier: 'pro', icon: '🏖️' },
  { id: 'library', name: 'Library', slot: 'background', cost: 75, tier: 'pro', icon: '📚' },
  { id: 'golden_aura', name: 'Golden Aura', slot: 'special', cost: 0, tier: 'guardian', icon: '✨' },
  { id: 'sparkle_effect', name: 'Sparkle Effect', slot: 'special', cost: 300, tier: 'pro', icon: '💫' },
];

function canAccessTier(userTier, requiredTier) {
  return TIER_LEVELS[userTier] >= TIER_LEVELS[requiredTier];
}

// @route   GET /buddy/accessories
// @desc    Get all accessories with owned/equipped status
// @access  Private
router.get('/accessories', protect, async (req, res) => {
  try {
    const user = req.user;
    const userTier = getEffectiveTier(user);
    const owned = await Accessory.find({ userId: user._id }).lean();
    const ownedMap = new Map(owned.map(a => [a.accessoryId, a]));

    const accessories = ACCESSORY_CATALOG.map(item => {
      const ownedItem = ownedMap.get(item.id);
      return {
        ...item,
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

    const item = ACCESSORY_CATALOG.find(a => a.id === accessoryId);
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

    const item = ACCESSORY_CATALOG.find(a => a.id === accessoryId);
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
