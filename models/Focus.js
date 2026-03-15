import mongoose from 'mongoose';

const focusSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    startTime: {
      type: Date,
      required: [true, 'Start time is required'],
    },
    duration: {
      type: Number,
      required: [true, 'Duration is required'],
      min: [1, 'Duration must be at least 1 minute'],
    },
    status: {
      type: String,
      enum: ['completed', 'failed'],
      required: [true, 'Status is required'],
    },
    tag: {
      type: String,
      enum: ['study', 'work', 'reading', 'exercise', 'meditation', 'creative', 'other', null],
      default: null,
    },
    kibbleEarned: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

focusSchema.index({ userId: 1, createdAt: -1 });

const Focus = mongoose.model('Focus', focusSchema);

export default Focus;
