import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    transactionId: {
      type: String,
      required: true,
      unique: true,
    },
    source: {
      type: String,
      enum: ['purchase', 'reward_ad', 'session', 'refund', 'webhook'],
      required: true,
    },
    type: {
      type: String,
      enum: ['subscription', 'consumable', 'kibble_pack', 'ad_reward'],
      default: 'consumable',
    },
    productId: {
      type: String,
      default: null,
    },
    packId: {
      type: String,
      default: null,
    },
    amount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['completed', 'refunded'],
      default: 'completed',
    },
  },
  { timestamps: true }
);

transactionSchema.index({ userId: 1, createdAt: -1 });

const Transaction = mongoose.model('Transaction', transactionSchema);
export default Transaction;
