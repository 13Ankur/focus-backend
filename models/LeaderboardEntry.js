import mongoose from 'mongoose';

const leaderboardEntrySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  username: {
    type: String,
    required: true,
  },
  activeBreed: {
    type: String,
    default: 'golden_retriever',
  },
  period: {
    type: String,
    required: true,
    enum: ['weekly', 'monthly', 'alltime'],
  },
  periodKey: {
    type: String,
    required: true,
  },
  focusMinutes: {
    type: Number,
    default: 0,
  },
  sessionsCompleted: {
    type: Number,
    default: 0,
  },
  mealsProvided: {
    type: Number,
    default: 0,
  },
});

leaderboardEntrySchema.index({ period: 1, periodKey: 1, focusMinutes: -1 });
leaderboardEntrySchema.index({ userId: 1, period: 1, periodKey: 1 }, { unique: true });

const LeaderboardEntry = mongoose.model('LeaderboardEntry', leaderboardEntrySchema);
export default LeaderboardEntry;
