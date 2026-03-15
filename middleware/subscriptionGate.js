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
    // Temporarily bypass all subscription checks — everything is free
    return next();
  };
}

export default requireTier;
