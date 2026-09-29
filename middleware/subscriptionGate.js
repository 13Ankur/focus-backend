import User from '../models/User.js';
import { getEffectiveTier, TIER_LEVELS } from '../services/subscriptionService.js';

/**
 * Middleware factory that gates a route behind a minimum subscription tier.
 *
 * Usage:
 *   router.post('/route', protect, requireTier('pro'), handler)
 *   router.post('/route', protect, requireTier('guardian'), handler)
 */
export function requireTier(minimumTier) {
  return async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({
          error: 'unauthorized',
          message: 'Authentication required.',
        });
      }

      const effectiveTier = getEffectiveTier(user);
      const userLevel = TIER_LEVELS[effectiveTier] ?? 0;
      const requiredLevel = TIER_LEVELS[minimumTier] ?? 0;

      if (userLevel < requiredLevel) {
        return res.status(403).json({
          error: 'upgrade_required',
          requiredTier: minimumTier,
          currentTier: effectiveTier,
          message: `This feature requires ${minimumTier}. Upgrade to unlock.`,
        });
      }

      return next();
    } catch (err) {
      console.error('requireTier error:', err.message);
      return res.status(500).json({ message: 'Server error' });
    }
  };
}

export default requireTier;
