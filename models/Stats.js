import mongoose from 'mongoose';

const statsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    completedSessions: {
      type: Number,
      default: 0,
    },
    totalMinutes: {
      type: Number,
      default: 0,
    },
    totalKibble: {
      type: Number,
      default: 0,
    },
    longestStreak: {
      type: Number,
      default: 0,
    },
    currentStreak: {
      type: Number,
      default: 0,
    },
    lastActiveDate: {
      type: String, // ISO date string (YYYY-MM-DD)
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Static method to get or create stats for a user
statsSchema.statics.getOrCreate = async function(userId) {
  let stats = await this.findOne({ userId });
  
  if (!stats) {
    stats = new this({
      userId,
      completedSessions: 0,
      totalMinutes: 0,
      totalKibble: 0,
      longestStreak: 0,
      currentStreak: 0,
    });
    await stats.save();
  }
  
  return stats;
};

const Stats = mongoose.model('Stats', statsSchema);

export default Stats;
