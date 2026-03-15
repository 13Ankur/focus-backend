import mongoose from 'mongoose';

const memberSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username: { type: String, required: true },
  activeBreed: { type: String, default: 'golden_retriever' },
  joinedAt: { type: Date, default: Date.now },
}, { _id: false });

const focusRoomSchema = new mongoose.Schema({
  roomCode: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    match: /^[A-Z0-9]{6}$/,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50,
  },
  members: [memberSchema],
  maxMembers: {
    type: Number,
    default: 10,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  lastActivityAt: {
    type: Date,
    default: Date.now,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

focusRoomSchema.index({ createdBy: 1 });
focusRoomSchema.index({ 'members.userId': 1 });
// TTL: auto-delete rooms inactive for 30 days
focusRoomSchema.index({ lastActivityAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

const FocusRoom = mongoose.model('FocusRoom', focusRoomSchema);
export default FocusRoom;
