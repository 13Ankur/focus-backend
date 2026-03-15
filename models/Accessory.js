import mongoose from 'mongoose';

const accessorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    accessoryId: {
      type: String,
      required: true,
    },
    slot: {
      type: String,
      enum: ['hat', 'collar', 'background', 'special'],
      required: true,
    },
    purchasedAt: {
      type: Date,
      default: Date.now,
    },
    isEquipped: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

accessorySchema.index({ userId: 1, accessoryId: 1 }, { unique: true });

const Accessory = mongoose.model('Accessory', accessorySchema);

export default Accessory;
