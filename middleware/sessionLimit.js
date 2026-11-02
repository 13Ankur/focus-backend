/**
 * Previously enforced 3 free sessions per day.
 * Removed: free users already get only the 15-minute timer, so they can start
 * as many sessions as they want.
 */
export async function checkSessionLimit(_req, _res, next) {
  return next();
}

export default checkSessionLimit;
