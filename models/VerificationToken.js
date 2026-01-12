import mongoose from 'mongoose';

// Drop old stale indexes on model initialization
const dropStaleIndexes = async () => {
  try {
    const collection = mongoose.connection.collection('verificationtokens');
    const indexes = await collection.indexes();
    
    // Check if old 'token_1' index exists and drop it
    const tokenIndex = indexes.find(idx => idx.name === 'token_1');
    if (tokenIndex) {
      console.log('Dropping stale token_1 index from verificationtokens collection...');
      await collection.dropIndex('token_1');
      console.log('Stale index dropped successfully');
    }
  } catch (error) {
    // Index might not exist, that's fine
    if (error.code !== 27) { // 27 = IndexNotFound
      console.log('Note: Could not drop old token index (may not exist):', error.message);
    }
  }
};

// Run once when mongoose connects
mongoose.connection.once('connected', dropStaleIndexes);

const verificationTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
    },
    otp: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['email', 'password'],
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
    },
    resendCount: {
      type: Number,
      default: 0,
    },
    lastResendAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    // For password reset flow - temporary token after OTP verified
    resetToken: {
      type: String,
    },
    resetTokenExpiresAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Create index for automatic cleanup of expired tokens
verificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Index for faster lookups
verificationTokenSchema.index({ userId: 1, type: 1 });
verificationTokenSchema.index({ email: 1, type: 1 });

// Static method to generate 6-digit OTP
verificationTokenSchema.statics.generateOTP = function() {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Static method to create OTP
verificationTokenSchema.statics.createOTP = async function(userId, email, type) {
  // Check for rate limiting - max 3 resends per 10 minutes
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const existingToken = await this.findOne({ 
    userId, 
    type,
    lastResendAt: { $gte: tenMinutesAgo }
  });

  if (existingToken && existingToken.resendCount >= 3) {
    const waitTime = Math.ceil((existingToken.lastResendAt.getTime() + 10 * 60 * 1000 - Date.now()) / 1000 / 60);
    throw new Error(`Too many requests. Please wait ${waitTime} minute(s) before requesting a new code.`);
  }

  // Delete any existing tokens of the same type for this user
  await this.deleteMany({ userId, type });
  
  const otp = this.generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  
  const verificationToken = await this.create({
    userId,
    email,
    otp,
    type,
    expiresAt,
    resendCount: existingToken ? existingToken.resendCount + 1 : 0,
    lastResendAt: new Date(),
  });
  
  return verificationToken.otp;
};

// Static method to verify OTP
verificationTokenSchema.statics.verifyOTP = async function(userId, otp, type) {
  const verificationToken = await this.findOne({ userId, type });
  
  if (!verificationToken) {
    return { valid: false, error: 'No verification code found. Please request a new one.' };
  }
  
  // Check if expired
  if (verificationToken.expiresAt < new Date()) {
    await this.deleteOne({ _id: verificationToken._id });
    return { valid: false, error: 'Verification code has expired. Please request a new one.', expired: true };
  }
  
  // Check if max attempts exceeded
  if (verificationToken.attempts >= verificationToken.maxAttempts) {
    await this.deleteOne({ _id: verificationToken._id });
    return { valid: false, error: 'Too many failed attempts. Please request a new code.', maxAttempts: true };
  }
  
  // Check if OTP matches
  if (verificationToken.otp !== otp) {
    // Increment attempts
    verificationToken.attempts += 1;
    await verificationToken.save();
    
    const remainingAttempts = verificationToken.maxAttempts - verificationToken.attempts;
    return { 
      valid: false, 
      error: `Invalid code. ${remainingAttempts} attempt${remainingAttempts !== 1 ? 's' : ''} remaining.`,
      remainingAttempts 
    };
  }
  
  // OTP is valid - delete the token
  await this.deleteOne({ _id: verificationToken._id });
  
  return { valid: true, userId: verificationToken.userId };
};

// Static method to check if can resend
verificationTokenSchema.statics.canResend = async function(userId, type) {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const existingToken = await this.findOne({ 
    userId, 
    type,
    lastResendAt: { $gte: tenMinutesAgo }
  });

  if (!existingToken) {
    return { canResend: true, resendCount: 0 };
  }

  if (existingToken.resendCount >= 3) {
    const waitTime = Math.ceil((existingToken.lastResendAt.getTime() + 10 * 60 * 1000 - Date.now()) / 1000);
    return { 
      canResend: false, 
      waitSeconds: waitTime,
      resendCount: existingToken.resendCount 
    };
  }

  return { canResend: true, resendCount: existingToken.resendCount };
};

const VerificationToken = mongoose.model('VerificationToken', verificationTokenSchema);

export default VerificationToken;
