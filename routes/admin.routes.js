import crypto from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import Focus from '../models/Focus.js';
import AdminAccount from '../models/AdminAccount.js';
import AppVersion from '../models/AppVersion.js';
import { getEffectiveTier } from '../services/subscriptionService.js';

const router = express.Router();

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function emailHash(email) {
  return crypto.createHash('sha256').update(email).digest('hex');
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ message: 'Sign in required.' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded?.role !== 'admin') {
      return res.status(403).json({ message: 'This account cannot open the admin panel.' });
    }
    req.adminEmail = decoded.email;
    next();
  } catch {
    return res.status(401).json({ message: 'Session expired. Sign in again.' });
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function proFilter(now) {
  return {
    adminProLock: { $ne: 'revoked' },
    $or: [
      { trialEndDate: { $gt: now } },
      {
        subscriptionExpiry: { $gt: now },
        subscriptionTier: { $in: ['pro', 'guardian'] },
      },
    ],
  };
}

function publicUser(user) {
  const tier = getEffectiveTier(user);
  return {
    id: String(user._id),
    username: user.username,
    email: user.email,
    provider: user.provider || 'email',
    emailVerified: !!user.emailVerified,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    loginCount: user.loginCount || 0,
    tier,
    adminProLock: user.adminProLock || null,
    subscriptionTier: user.subscriptionTier || 'free',
    subscriptionExpiry: user.subscriptionExpiry,
    subscriptionPlatform: user.subscriptionPlatform,
    subscriptionCancelled: !!user.subscriptionCancelled,
    trialUsed: !!user.trialUsed,
    trialStartDate: user.trialStartDate,
    trialEndDate: user.trialEndDate,
    razorpaySubscriptionId: user.razorpaySubscriptionId,
    revenuecatId: user.revenuecatId,
    totalKibble: user.totalKibble || 0,
    totalFocusMinutes: user.totalFocusMinutes || 0,
    completedSessions: user.completedSessions || 0,
    currentStreak: user.currentStreak || 0,
    longestStreak: user.longestStreak || 0,
    totalMealsProvided: user.totalMealsProvided || 0,
    activeBreed: user.activeBreed,
    unlockedBreeds: user.unlockedBreeds || [],
    onboardingCompleted: !!user.onboardingCompleted,
    dailyGoalMinutes: user.dailyGoalMinutes,
    focusTags: user.focusTags || [],
  };
}

router.post('/login', wrap(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '').trim();
  const admin = email
    ? await AdminAccount.findOne({ emailHash: emailHash(email) }).select('+passwordHash')
    : null;
  const match = admin?.passwordHash
    ? await bcrypt.compare(password, admin.passwordHash)
    : false;
  if (!match) {
    return res.status(401).json({ message: 'Wrong email or password.' });
  }
  const token = jwt.sign(
    { role: 'admin', email },
    process.env.JWT_SECRET,
    { expiresIn: '12h' },
  );
  res.json({ token, email });
}));

router.use(requireAdmin);

router.get('/overview', wrap(async (_req, res) => {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const pro = proFilter(now);

  const [
    users,
    verified,
    loggedInUsers,
    loginAgg,
    proUsers,
    trials,
    purchases,
    revenueAgg,
    joinedToday,
    joinedWeek,
    loginsToday,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ emailVerified: true }),
    User.countDocuments({ lastLoginAt: { $ne: null } }),
    User.aggregate([{ $group: { _id: null, total: { $sum: '$loginCount' } } }]),
    User.countDocuments(pro),
    User.countDocuments({ adminProLock: { $ne: 'revoked' }, trialEndDate: { $gt: now } }),
    Transaction.countDocuments({ status: 'completed' }),
    Transaction.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: '$source', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
    ]),
    User.countDocuments({ createdAt: { $gte: startOfDay } }),
    User.countDocuments({ createdAt: { $gte: weekAgo } }),
    User.countDocuments({ lastLoginAt: { $gte: startOfDay } }),
  ]);

  res.json({
    users,
    verified,
    loggedInUsers,
    logins: loginAgg[0]?.total || 0,
    loginsToday,
    proUsers,
    trials,
    purchases,
    purchasesBySource: revenueAgg,
    joinedToday,
    joinedWeek,
  });
}));

router.get('/users', wrap(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 25;
  const q = String(req.query.q || '').trim();
  const tier = String(req.query.tier || 'all');
  const now = new Date();
  const parts = [];

  if (q) {
    const search = [
      { email: new RegExp(escapeRegex(q), 'i') },
      { username: new RegExp(escapeRegex(q), 'i') },
    ];
    if (mongoose.isValidObjectId(q)) search.push({ _id: q });
    parts.push({ $or: search });
  }
  if (tier === 'pro') parts.push(proFilter(now));
  if (tier === 'free') parts.push({ $nor: [proFilter(now)] });
  const filter = parts.length ? { $and: parts } : {};

  const [total, users] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
  ]);

  res.json({
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    total,
    users: users.map(publicUser),
  });
}));

router.get('/users/:id', wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Unknown user.' });
  }
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });

  const [purchases, sessions] = await Promise.all([
    Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(30),
    Focus.find({ userId: user._id }).sort({ createdAt: -1 }).limit(20),
  ]);

  res.json({
    user: publicUser(user),
    purchases,
    sessions,
  });
}));

router.post('/users/:id/pro', wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Unknown user.' });
  }
  const days = Math.min(365, Math.max(1, Number(req.body?.days) || 30));
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });

  const expiry = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  user.adminProLock = null;
  user.subscriptionTier = 'pro';
  user.subscriptionExpiry = expiry;
  user.subscriptionPlatform = user.subscriptionPlatform || 'web';
  user.isPremium = true;
  user.subscriptionCancelled = false;
  user.subscriptionGracePeriod = false;
  await user.save();

  res.json({ user: publicUser(user) });
}));

router.post('/users/:id/revoke', wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Unknown user.' });
  }
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });

  user.adminProLock = 'revoked';
  user.subscriptionTier = 'free';
  user.subscriptionExpiry = null;
  user.trialEndDate = null;
  user.isPremium = false;
  user.subscriptionCancelled = true;
  user.subscriptionGracePeriod = false;
  await user.save();

  res.json({ user: publicUser(user) });
}));

router.get('/purchases', wrap(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 25;
  const q = String(req.query.q || '').trim();
  const filter = {};

  if (q) {
    const users = await User.find({
      $or: [
        { email: new RegExp(escapeRegex(q), 'i') },
        { username: new RegExp(escapeRegex(q), 'i') },
      ],
    }).select('_id').limit(50);
    const ids = users.map((user) => user._id);
    filter.$or = [
      { transactionId: new RegExp(escapeRegex(q), 'i') },
      { productId: new RegExp(escapeRegex(q), 'i') },
      { userId: { $in: ids } },
    ];
  }

  const [total, purchases] = await Promise.all([
    Transaction.countDocuments(filter),
    Transaction.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('userId', 'username email'),
  ]);

  res.json({
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    total,
    purchases: purchases.map((purchase) => ({
      id: String(purchase._id),
      transactionId: purchase.transactionId,
      source: purchase.source,
      type: purchase.type,
      productId: purchase.productId,
      amount: purchase.amount,
      status: purchase.status,
      createdAt: purchase.createdAt,
      user: purchase.userId ? {
        id: String(purchase.userId._id || purchase.userId),
        username: purchase.userId.username || '',
        email: purchase.userId.email || '',
      } : null,
    })),
  });
}));

function publicVersion(config) {
  return {
    platform: config.platform,
    currentVersion: config.currentVersion,
    minimumVersion: config.minimumVersion,
    storeUrl: config.storeUrl,
    releaseNotes: config.releaseNotes || '',
    isMaintenanceMode: !!config.isMaintenanceMode,
    maintenanceMessage: config.maintenanceMessage || '',
    forceUpdate: !!config.forceUpdate,
    updatedAt: config.updatedAt,
  };
}

router.get('/versions', wrap(async (_req, res) => {
  const configs = await AppVersion.find({ platform: { $in: ['ios', 'android'] } }).sort({ platform: 1 });
  res.json({ versions: configs.map(publicVersion) });
}));

router.put('/versions/:platform', wrap(async (req, res) => {
  const platform = String(req.params.platform || '').toLowerCase();
  if (!['ios', 'android'].includes(platform)) {
    return res.status(400).json({ message: 'Platform must be ios or android.' });
  }

  const currentVersion = String(req.body?.currentVersion || '').trim();
  const minimumVersion = String(req.body?.minimumVersion || '').trim();
  const storeUrl = String(req.body?.storeUrl || '').trim();
  const versionPattern = /^\d+\.\d+(\.\d+)?$/;
  if (!versionPattern.test(currentVersion) || !versionPattern.test(minimumVersion)) {
    return res.status(400).json({ message: 'Use a version like 1.0.18.' });
  }
  if (!storeUrl) {
    return res.status(400).json({ message: 'Store link is required.' });
  }
  if (AppVersion.compareVersions(minimumVersion, currentVersion) > 0) {
    return res.status(400).json({ message: 'Minimum version cannot be newer than the current version.' });
  }

  const config = await AppVersion.findOneAndUpdate(
    { platform },
    {
      platform,
      currentVersion,
      minimumVersion,
      storeUrl,
      releaseNotes: String(req.body?.releaseNotes || ''),
      isMaintenanceMode: req.body?.isMaintenanceMode === true,
      maintenanceMessage: String(req.body?.maintenanceMessage || 'We are currently performing maintenance. Please try again later.'),
      forceUpdate: req.body?.forceUpdate === true,
    },
    { upsert: true, new: true, runValidators: true },
  );

  res.json({ version: publicVersion(config) });
}));

export default router;
