import mongoose from 'mongoose';

let isConnected = false;
let lastDbError = null;
let retryTimeout = null;

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    isConnected = true;
    return;
  }

  if (mongoose.connection.readyState === 2) {
    // Already connecting
    return;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    lastDbError = 'MONGODB_URI is not defined in environment variables';
    console.error(`❌ MongoDB Connection Error: ${lastDbError}`);
    isConnected = false;
    return;
  }

  try {
    const conn = await mongoose.connect(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4, // Use IPv4
    });
    isConnected = true;
    lastDbError = null;
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    lastDbError = error.message;
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    isConnected = false;

    // Schedule automatic reconnect attempt in 5 seconds
    if (!retryTimeout) {
      retryTimeout = setTimeout(() => {
        retryTimeout = null;
        connectDB();
      }, 5000);
    }
  }
};

// Connection status checker
export const isDBConnected = () => {
  return mongoose.connection.readyState === 1;
};

// Detailed diagnostic status
export const getDBStatus = () => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const stateCode = mongoose.connection.readyState;
  return {
    state: states[stateCode] || 'unknown',
    stateCode,
    isConnected: stateCode === 1,
    hasMongoUri: Boolean(process.env.MONGODB_URI),
    lastError: lastDbError,
    host: mongoose.connection.host || null,
  };
};

// Handle connection events
mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected, attempting reconnect...');
  isConnected = false;
  if (!retryTimeout) {
    retryTimeout = setTimeout(() => {
      retryTimeout = null;
      connectDB();
    }, 5000);
  }
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err.message);
  lastDbError = err.message;
  isConnected = false;
});

export default connectDB;
