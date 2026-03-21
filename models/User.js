import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// Breed unlock requirements (kibble needed)
const BREED_UNLOCK_REQUIREMENTS = {
  golden_retriever: 0,
  husky: 500,
  shiba_inu: 1000,
  cavapoo: 2000,
  french_bulldog: 3000,
  labrador: 4000,
  dachshund: 6000,
  australian_shepherd: 8000,
  maltese: 10000
};

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      minlength: [3, 'Username must be at least 3 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    password: {
      type: String,
      required: function () {
        return this.provider === 'email' || !this.provider;
      },
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
      validate: {
        validator: function (value) {
          if (this.provider === 'email' && value) {
            return value.length >= 6;
          }
          return true;
        },
        message: 'Password must be at least 6 characters'
      }
    },

    // Email verification fields
    emailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: {
      type: String,
      select: false,
    },
    emailVerificationExpires: {
      type: Date,
      select: false,
    },

    // Password reset fields
    passwordResetToken: {
      type: String,
      select: false,
    },
    passwordResetExpires: {
      type: Date,
      select: false,
    },

    // ============ FOCUS STATS ============
    totalKibble: {
      type: Number,
      default: 0,
    },
    totalFocusMinutes: {
      type: Number,
      default: 0,
    },
    completedSessions: {
      type: Number,
      default: 0,
    },
    currentStreak: {
      type: Number,
      default: 0,
    },
    longestStreak: {
      type: Number,
      default: 0,
    },
    lastSessionDate: {
      type: String, // ISO date string (YYYY-MM-DD)
      default: null,
    },
    totalMealsProvided: {
      type: Number,
      default: 0,
    },

    // ============ BREED COLLECTION ============
    unlockedBreeds: {
      type: [String],
      default: ['golden_retriever'],
    },
    activeBreed: {
      type: String,
      default: 'golden_retriever',
    },

    // ============ BUDDY STATS ============
    buddyHappiness: {
      type: Number,
      default: 100,
      min: 0,
      max: 100,
    },
    buddyFullness: {
      type: Number,
      default: 100,
      min: 0,
      max: 100,
    },
    lastBuddyInteraction: {
      type: Date,
      default: Date.now,
    },

    // ============ SOCIAL LOGIN ============
    googleId: {
      type: String,
      sparse: true,
      unique: true,
    },
    appleId: {
      type: String,
      sparse: true,
      unique: true,
    },
    provider: {
      type: String,
      enum: ['email', 'google', 'apple'],
      default: 'email',
    },
    avatar: {
      type: String,
    },

    // ============ SUBSCRIPTION ============
    isPremium: {
      type: Boolean,
      default: false,
    },
    subscriptionPlan: {
      type: String,
      enum: ['none', 'protector', 'champion', 'guardian'],
      default: 'none',
    },

    // ============ SUBSCRIPTION (TIERED) ============
    subscriptionTier: {
      type: String,
      enum: ['free', 'pro', 'guardian'],
      default: 'free',
    },
    subscriptionExpiry: {
      type: Date,
      default: null,
    },
    subscriptionPlatform: {
      type: String,
      enum: ['ios', 'android', 'web', null],
      default: null,
    },
    revenuecatId: {
      type: String,
      default: null,
    },
    subscriptionCancelled: {
      type: Boolean,
      default: false,
    },
    subscriptionGracePeriod: {
      type: Boolean,
      default: false,
    },
    trialUsed: {
      type: Boolean,
      default: false,
    },
    trialStartDate: {
      type: Date,
      default: null,
    },
    trialEndDate: {
      type: Date,
      default: null,
    },
    dailySessionCount: {
      type: Number,
      default: 0,
    },
    lastSessionCountReset: {
      type: String,
      default: null,
    },
    dailyTreatCount: {
      type: Number,
      default: 0,
    },
    lastTreatCountReset: {
      type: String,
      default: null,
    },
    lastShieldUsedDate: {
      type: String,
      default: null,
    },
    equippedAccessories: {
      hat: { type: String, default: null },
      collar: { type: String, default: null },
      background: { type: String, default: null },
      special: { type: String, default: null },
    },
    dailyGoalMinutes: {
      type: Number,
      default: 60,
    },
    focusTags: {
      type: [String],
      default: [],
    },
    onboardingCompleted: {
      type: Boolean,
      default: false,
    },
    founderBonus: {
      type: Boolean,
      default: false,
    },

    // ============ PREFERENCES ============
    settings: {
      soundEnabled: { type: Boolean, default: true },
      notificationsEnabled: { type: Boolean, default: true },
      vibrationEnabled: { type: Boolean, default: true },
      theme: { type: String, enum: ['system', 'light', 'dark'], default: 'system' },
      defaultTimerDuration: { type: Number, default: 25 },
    },

    notificationPrefs: {
      streakReminders: { type: Boolean, default: true },
      dailyReminder: { type: Boolean, default: true },
      reminderTime: { type: String, default: '09:00' },
      buddyHungerAlerts: { type: Boolean, default: true },
      weeklySummary: { type: Boolean, default: true },
    },

    // Legacy field - keeping for compatibility
    selectedBreed: {
      type: String,
      default: 'golden_retriever',
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Check and unlock breeds based on total kibble
userSchema.methods.checkBreedUnlocks = function () {
  // Auto-unlock is disabled. Manual unlocks ONLY via API.
  return [];
};

// Update streak based on session date
userSchema.methods.updateStreak = function (sessionDate) {
  const today = sessionDate || new Date().toISOString().split('T')[0];

  if (!this.lastSessionDate) {
    // First session ever
    this.currentStreak = 1;
  } else {
    const lastDate = new Date(this.lastSessionDate);
    const todayDate = new Date(today);
    const diffDays = Math.floor((todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      // Same day, streak continues (no change)
    } else if (diffDays === 1) {
      // Consecutive day, increment streak
      this.currentStreak += 1;
    } else {
      // Streak broken, reset to 1
      this.currentStreak = 1;
    }
  }

  // Update longest streak
  if (this.currentStreak > this.longestStreak) {
    this.longestStreak = this.currentStreak;
  }

  this.lastSessionDate = today;
};

// Decay buddy stats over time
userSchema.methods.decayBuddyStats = function () {
  const now = new Date();
  const lastInteraction = new Date(this.lastBuddyInteraction);
  const hoursSince = (now.getTime() - lastInteraction.getTime()) / (1000 * 60 * 60);

  // Decay 2 points per hour
  const decay = Math.floor(hoursSince * 2);

  if (decay > 0) {
    this.buddyHappiness = Math.max(20, this.buddyHappiness - decay);
    this.buddyFullness = Math.max(10, this.buddyFullness - decay);
  }

  return {
    happiness: this.buddyHappiness,
    fullness: this.buddyFullness,
    hoursSinceInteraction: hoursSince
  };
};

// Get breed unlock status
userSchema.methods.getBreedStatus = function () {
  const breeds = [];

  for (const [breedId, requirement] of Object.entries(BREED_UNLOCK_REQUIREMENTS)) {
    breeds.push({
      id: breedId,
      unlocked: this.unlockedBreeds.includes(breedId),
      requirement,
      progress: Math.min(100, (this.totalKibble / requirement) * 100),
      kibbleToUnlock: Math.max(0, requirement - this.totalKibble),
      isActive: this.activeBreed === breedId
    });
  }

  return breeds.sort((a, b) => a.requirement - b.requirement);
};

// Static method to get breed unlock requirements
userSchema.statics.getBreedRequirements = function () {
  return BREED_UNLOCK_REQUIREMENTS;
};

const User = mongoose.model('User', userSchema);

export default User;
