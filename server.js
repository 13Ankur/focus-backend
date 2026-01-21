// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import connectDB, { isDBConnected } from './config/db.js';
import authRoutes from './routes/auth.routes.js';
import focusRoutes from './routes/focus.routes.js';
import userRoutes from './routes/user.routes.js';
import statsRoutes from './routes/stats.routes.js';
import breedRoutes from './routes/breed.routes.js';
import buddyRoutes from './routes/buddy.routes.js';
import versionRoutes from './routes/version.routes.js';

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

// Validate required environment variables in production
if (isProduction) {
  // NOTE: Social login relies on these being present in production.
  // If they are missing, logins will fail at runtime with confusing "Invalid token" errors.
  const requiredEnvVars = [
    'MONGODB_URI',
    'JWT_SECRET',
    'SENDGRID_API_KEY',
    // Apple Sign-In (required if Apple login is enabled in the app)
    'APPLE_CLIENT_ID',
  ];
  const missingVars = requiredEnvVars.filter(v => !process.env[v]);
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingVars.join(', '));
    process.exit(1);
  }

  // Google Sign-In: require at least one configured audience.
  // (Web client ID recommended, but iOS/Android IDs are acceptable if that is what your app emits in `aud`.)
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

// Security middleware (production only)
if (isProduction) {
  app.use(helmet());
  
  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: { message: 'Too many requests, please try again later.' }
  });
  app.use(limiter);
}

// CORS configuration
const corsOptions = {
  origin: isProduction 
    ? [
        'https://pawsfocus.app',
        'https://staypaws.zavvi.co.in',
        'capacitor://localhost',
        'ionic://localhost',
        'http://localhost:8100', // Local dev testing
        'http://localhost:4200'  // Angular dev server
      ]
    : true, // Allow all in development
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Body parser
app.use(express.json({ limit: '10kb' })); // Limit body size

// Database connection check middleware
app.use((req, res, next) => {
  // Allow health check without DB
  if (req.path === '/health') {
    return next();
  }
  
  // Check if database is connected
  if (!isDBConnected()) {
    return res.status(503).json({ 
      message: 'Database connection unavailable. Please try again later.',
      dbStatus: 'disconnected'
    });
  }
  
  next();
});

// Routes
app.use('/auth', authRoutes);
app.use('/focus', focusRoutes);
app.use('/user', userRoutes);
app.use('/stats', statsRoutes);
app.use('/breeds', breedRoutes);
app.use('/buddy', buddyRoutes);
app.use('/version', versionRoutes);

// Health check route
app.get('/health', (req, res) => {
  res.json({ 
    status: isDBConnected() ? 'ok' : 'degraded',
    database: isDBConnected() ? 'connected' : 'disconnected',
    environment: isProduction ? 'production' : 'development',
    timestamp: new Date().toISOString() 
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err.stack || err.message || err);
  
  // Don't leak error details in production
  const message = isProduction ? 'Internal server error' : (err.message || 'Internal server error');
  res.status(500).json({ message });
});

const PORT = process.env.PORT || 5000;

// Start server and then connect to DB
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${isProduction ? 'PRODUCTION' : 'development'}`);
  console.log('🔌 Connecting to MongoDB...');
  await connectDB();
});
