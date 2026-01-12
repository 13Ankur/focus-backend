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
  },
  {
    timestamps: true,
  }
);

const Focus = mongoose.model('Focus', focusSchema);

export default Focus;
