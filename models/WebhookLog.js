import mongoose from 'mongoose';

const webhookLogSchema = new mongoose.Schema({
  eventId: {
    type: String,
    required: true,
    unique: true,
  },
  eventType: {
    type: String,
    required: true,
  },
  appUserId: {
    type: String,
    default: null,
  },
  productId: {
    type: String,
    default: null,
  },
  receivedAt: {
    type: Date,
    default: Date.now,
  },
  processed: {
    type: Boolean,
    default: false,
  },
  error: {
    type: String,
    default: null,
  },
  rawPayload: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
});

webhookLogSchema.index({ eventType: 1, receivedAt: -1 });
webhookLogSchema.index({ appUserId: 1 });

const WebhookLog = mongoose.model('WebhookLog', webhookLogSchema);
export default WebhookLog;
