import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import xss from 'xss-clean';
import connectDB, { isDBConnected } from './config/db.js';
import authRoutes from './routes/auth.routes.js';
import focusRoutes from './routes/focus.routes.js';
import userRoutes from './routes/user.routes.js';
import statsRoutes from './routes/stats.routes.js';
import breedRoutes from './routes/breed.routes.js';
import buddyRoutes from './routes/buddy.routes.js';
import versionRoutes from './routes/version.routes.js';
import subscriptionRoutes from './routes/subscription.js';
import achievementRoutes from './routes/achievement.routes.js';
import socialRoutes from './routes/social.js';
import { startSubscriptionCron } from './services/subscriptionCron.js';
import path from 'path';

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

// ════════════════════════════════════════════════════════════════════
//  Environment validation (production)
// ════════════════════════════════════════════════════════════════════

if (isProduction) {
  const requiredEnvVars = [
    'MONGODB_URI',
    'JWT_SECRET',
    'SENDGRID_API_KEY',
    'APPLE_CLIENT_ID',
  ];
  const missingVars = requiredEnvVars.filter(v => !process.env[v]);
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingVars.join(', '));
    process.exit(1);
  }

  if (!process.env.REVENUECAT_WEBHOOK_SECRET) {
    console.warn('⚠️  Warning: REVENUECAT_WEBHOOK_SECRET is not set. Webhook verification will be disabled.');
  }

  const googleAudiences = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_IOS_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
  ].filter(Boolean);
  if (googleAudiences.length === 0) {
    console.error(
      '❌ Missing Google Sign-In config. Set at least one of: GOOGLE_CLIENT_ID, GOOGLE_IOS_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID'
    );
    process.exit(1);
  }
  console.log('✅ All required environment variables present');
}

// ════════════════════════════════════════════════════════════════════
//  Security middleware
// ════════════════════════════════════════════════════════════════════

// Helmet with CSP
app.use(
  helmet({
    contentSecurityPolicy: isProduction
      ? {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: [
            "'self'",
            'https://staypawsapi.zavvi.co.in',
            'https://api.revenuecat.com',
          ],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: [],
        },
      }
      : false,
    crossOriginEmbedderPolicy: false,
  })
);

// MongoDB query injection prevention
app.use(mongoSanitize());

// XSS prevention — sanitize user input in body, query, params
app.use(xss());

// ── Rate limiters ──

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 100 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many auth attempts, please try again later.' },
});

const focusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 20 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many focus requests, please try again later.' },
});

// Webhook limiter is more generous — RevenueCat may send bursts
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(generalLimiter);

// ════════════════════════════════════════════════════════════════════
//  CORS
// ════════════════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = [
  'https://staypaws.zavvi.co.in',
  'https://pawsfocus.app',
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'http://192.168.29.31',
  'http://192.168.29.31:8100', // Ionic default port
];

const corsOptions = {
  origin: isProduction
    ? (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.some(o => origin.startsWith(o))) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
    : true,
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// ════════════════════════════════════════════════════════════════════
//  Body parser — 1 MB limit
// ════════════════════════════════════════════════════════════════════

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ════════════════════════════════════════════════════════════════════
//  Database connection check
// ════════════════════════════════════════════════════════════════════

app.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/subscription/webhook') {
    return next();
  }
  if (!isDBConnected()) {
    return res.status(503).json({
      message: 'Database connection unavailable. Please try again later.',
      dbStatus: 'disconnected',
    });
  }
  next();
});

// ════════════════════════════════════════════════════════════════════
//  Routes (with per-route rate limiters)
// ════════════════════════════════════════════════════════════════════

app.use('/auth', authLimiter, authRoutes);
app.use('/focus', focusLimiter, focusRoutes);
app.use('/user', userRoutes);
app.use('/stats', statsRoutes);
app.use('/breeds', breedRoutes);
app.use('/buddy', buddyRoutes);
app.use('/version', versionRoutes);
app.use('/subscription/webhook', webhookLimiter);
app.use('/subscription', subscriptionRoutes);
app.use('/achievements', achievementRoutes);
app.use('/social', socialRoutes);

// ════════════════════════════════════════════════════════════════════
//  AdMob app-ads.txt
// ════════════════════════════════════════════════════════════════════

app.get('/app-ads.txt', (req, res) => {
  res.sendFile(path.resolve('app-ads.txt'));
});

// ════════════════════════════════════════════════════════════════════
//  Health check
// ════════════════════════════════════════════════════════════════════

app.get('/health', (req, res) => {
  res.json({
    status: isDBConnected() ? 'ok' : 'degraded',
    database: isDBConnected() ? 'connected' : 'disconnected',
    environment: isProduction ? 'production' : 'development',
    timestamp: new Date().toISOString(),
  });
});

// ════════════════════════════════════════════════════════════════════
//  Error handlers
// ════════════════════════════════════════════════════════════════════

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

app.use((err, req, res, _next) => {
  // CORS rejection
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ message: 'Origin not allowed' });
  }
  console.error('❌ Server error:', err.stack || err.message || err);
  const message = isProduction ? 'Internal server error' : (err.message || 'Internal server error');
  res.status(500).json({ message });
});

// ════════════════════════════════════════════════════════════════════
//  Start
// ════════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${isProduction ? 'PRODUCTION' : 'development'}`);
  console.log('🔌 Connecting to MongoDB...');
  await connectDB();
  startSubscriptionCron();
});
