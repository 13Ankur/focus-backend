import express from 'express';
import crypto from 'crypto';
import FocusRoom from '../models/FocusRoom.js';
import LeaderboardEntry from '../models/LeaderboardEntry.js';
import Focus from '../models/Focus.js';
import User from '../models/User.js';
import protect from '../middleware/auth.middleware.js';
import { requireTier } from '../middleware/subscriptionGate.js';

const router = express.Router();

const MAX_ROOMS_PER_USER = 5;
const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
const MAX_CODE_RETRIES = 3;
const KIBBLE_PER_MEAL = 25;

const BLOCKED_WORDS = [
  'fuck', 'shit', 'ass', 'damn', 'bitch', 'dick', 'cock', 'pussy',
  'nigger', 'faggot', 'retard', 'nazi', 'slut', 'whore', 'cunt',
];

function generateRoomCode() {
  let code = '';
  const bytes = crypto.randomBytes(ROOM_CODE_LENGTH);
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_CHARS[bytes[i] % ROOM_CODE_CHARS.length];
  }
  return code;
}

function containsOffensiveContent(text) {
  const lower = text.toLowerCase().replace(/[^a-z]/g, '');
  return BLOCKED_WORDS.some(w => lower.includes(w));
}

function getWeekKey(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function getMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// ─── POST /social/rooms — Create room (Pro+ only) ─────────────────
router.post('/rooms', protect, requireTier('pro'), async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'invalid_name', message: 'Room name is required' });
    }
    if (name.trim().length > 50) {
      return res.status(400).json({ error: 'invalid_name', message: 'Room name must be 50 characters or less' });
    }
    if (containsOffensiveContent(name)) {
      return res.status(400).json({ error: 'inappropriate_name', message: 'Room name contains inappropriate language' });
    }

    const userRoomCount = await FocusRoom.countDocuments({ 'members.userId': req.user._id });
    if (userRoomCount >= MAX_ROOMS_PER_USER) {
      return res.status(400).json({
        error: 'max_rooms_reached',
        message: `You can only be in ${MAX_ROOMS_PER_USER} rooms at a time`,
      });
    }

    let room = null;
    for (let attempt = 0; attempt < MAX_CODE_RETRIES; attempt++) {
      const code = generateRoomCode();
      try {
        room = await FocusRoom.create({
          roomCode: code,
          createdBy: req.user._id,
          name: name.trim(),
          members: [{
            userId: req.user._id,
            username: req.user.username,
            activeBreed: req.user.activeBreed || 'golden_retriever',
          }],
        });
        break;
      } catch (err) {
        if (err.code !== 11000 || attempt === MAX_CODE_RETRIES - 1) throw err;
      }
    }

    res.status(201).json({ room, code: room.roomCode });
  } catch (err) {
    console.error('POST /social/rooms error:', err.message);
    res.status(500).json({ message: 'Server error creating room' });
  }
});

// ─── GET /social/rooms/mine — Get user's rooms ───────────────────
router.get('/rooms/mine', protect, async (req, res) => {
  try {
    const rooms = await FocusRoom.find({ 'members.userId': req.user._id, isActive: true })
      .sort({ lastActivityAt: -1 })
      .lean();
    res.json({ rooms });
  } catch (err) {
    console.error('GET /social/rooms/mine error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /social/rooms/:code — Get room info (public preview) ────
router.get('/rooms/:code', protect, async (req, res) => {
  try {
    const room = await FocusRoom.findOne({
      roomCode: req.params.code.toUpperCase(),
      isActive: true,
    }).lean();

    if (!room) {
      return res.status(404).json({ error: 'room_not_found', message: 'Room not found' });
    }

    res.json({ room });
  } catch (err) {
    console.error('GET /social/rooms/:code error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── POST /social/rooms/:code/join — Join room ──────────────────
router.post('/rooms/:code/join', protect, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const room = await FocusRoom.findOne({ roomCode: code, isActive: true });

    if (!room) {
      return res.status(404).json({ error: 'room_not_found', message: 'Room not found' });
    }

    const alreadyMember = room.members.some(m => m.userId.toString() === req.user._id.toString());
    if (alreadyMember) {
      return res.json({ room });
    }

    if (room.members.length >= room.maxMembers) {
      return res.status(409).json({
        error: 'room_full',
        message: `Room is full (${room.maxMembers}/${room.maxMembers})`,
      });
    }

    const userRoomCount = await FocusRoom.countDocuments({ 'members.userId': req.user._id });
    if (userRoomCount >= MAX_ROOMS_PER_USER) {
      return res.status(400).json({
        error: 'max_rooms_reached',
        message: `You can only be in ${MAX_ROOMS_PER_USER} rooms at a time`,
      });
    }

    room.members.push({
      userId: req.user._id,
      username: req.user.username,
      activeBreed: req.user.activeBreed || 'golden_retriever',
    });
    room.lastActivityAt = new Date();
    await room.save();

    res.json({ room });
  } catch (err) {
    console.error('POST /social/rooms/:code/join error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── POST /social/rooms/:code/leave — Leave room ────────────────
router.post('/rooms/:code/leave', protect, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const room = await FocusRoom.findOne({ roomCode: code, isActive: true });

    if (!room) {
      return res.status(404).json({ error: 'room_not_found', message: 'Room not found' });
    }

    room.members = room.members.filter(m => m.userId.toString() !== req.user._id.toString());

    if (room.members.length === 0) {
      await FocusRoom.deleteOne({ _id: room._id });
      return res.json({ message: 'Left room. Room was deleted because it became empty.' });
    }

    room.lastActivityAt = new Date();
    await room.save();

    res.json({ message: 'Left room', room });
  } catch (err) {
    console.error('POST /social/rooms/:code/leave error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /social/rooms/:code/activity — Recent room activity ─────
router.get('/rooms/:code/activity', protect, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const room = await FocusRoom.findOne({ roomCode: code, isActive: true }).lean();

    if (!room) {
      return res.status(404).json({ error: 'room_not_found', message: 'Room not found' });
    }

    const memberIds = room.members.map(m => m.userId);
    const memberMap = {};
    room.members.forEach(m => {
      memberMap[m.userId.toString()] = { username: m.username, activeBreed: m.activeBreed };
    });

    const sessions = await Focus.find({
      userId: { $in: memberIds },
      status: 'completed',
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const activity = sessions.map(s => {
      const member = memberMap[s.userId.toString()] || {};
      return {
        username: member.username || 'Unknown',
        breed: member.activeBreed || 'golden_retriever',
        duration: s.duration,
        completedAt: s.createdAt,
        tag: s.tag || null,
      };
    });

    res.json({ activity });
  } catch (err) {
    console.error('GET /social/rooms/:code/activity error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /social/leaderboard — Global top 50 ────────────────────
router.get('/leaderboard', protect, async (req, res) => {
  try {
    const period = req.query.period || 'weekly';
    let periodKey;
    if (period === 'weekly') periodKey = getWeekKey();
    else if (period === 'monthly') periodKey = getMonthKey();
    else periodKey = 'alltime';

    const entries = await LeaderboardEntry.find({ period, periodKey })
      .sort({ focusMinutes: -1, sessionsCompleted: -1, _id: 1 })
      .limit(50)
      .lean();

    res.json({ leaderboard: entries, period, periodKey });
  } catch (err) {
    console.error('GET /social/leaderboard error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /social/leaderboard/rank — User's global rank ──────────
router.get('/leaderboard/rank', protect, async (req, res) => {
  try {
    const period = req.query.period || 'weekly';
    let periodKey;
    if (period === 'weekly') periodKey = getWeekKey();
    else if (period === 'monthly') periodKey = getMonthKey();
    else periodKey = 'alltime';

    const userEntry = await LeaderboardEntry.findOne({
      userId: req.user._id,
      period,
      periodKey,
    }).lean();

    if (!userEntry) {
      return res.json({ rank: null, entry: null, nextEntry: null });
    }

    const rank = await LeaderboardEntry.countDocuments({
      period,
      periodKey,
      $or: [
        { focusMinutes: { $gt: userEntry.focusMinutes } },
        {
          focusMinutes: userEntry.focusMinutes,
          sessionsCompleted: { $gt: userEntry.sessionsCompleted },
        },
      ],
    }) + 1;

    // Person one rank above (to show "X minutes away from #Y")
    const nextEntry = await LeaderboardEntry.findOne({
      period,
      periodKey,
      $or: [
        { focusMinutes: { $gt: userEntry.focusMinutes } },
        {
          focusMinutes: userEntry.focusMinutes,
          sessionsCompleted: { $gt: userEntry.sessionsCompleted },
        },
      ],
    })
      .sort({ focusMinutes: 1, sessionsCompleted: 1 })
      .lean();

    res.json({ rank, entry: userEntry, nextEntry });
  } catch (err) {
    console.error('GET /social/leaderboard/rank error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /social/leaderboard/room/:code — Room leaderboard ──────
router.get('/leaderboard/room/:code', protect, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const period = req.query.period || 'weekly';
    let periodKey;
    if (period === 'weekly') periodKey = getWeekKey();
    else if (period === 'monthly') periodKey = getMonthKey();
    else periodKey = 'alltime';

    const room = await FocusRoom.findOne({ roomCode: code, isActive: true }).lean();
    if (!room) {
      return res.status(404).json({ error: 'room_not_found', message: 'Room not found' });
    }

    const memberIds = room.members.map(m => m.userId);

    const entries = await LeaderboardEntry.find({
      userId: { $in: memberIds },
      period,
      periodKey,
    })
      .sort({ focusMinutes: -1, sessionsCompleted: -1, _id: 1 })
      .lean();

    res.json({ leaderboard: entries, period, periodKey, roomName: room.name });
  } catch (err) {
    console.error('GET /social/leaderboard/room/:code error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── Leaderboard update helper (called from focus/complete) ─────
export async function updateLeaderboard(userId, duration) {
  if (duration < 5) return; // Only ≥5 min sessions count

  try {
    const user = await User.findById(userId).lean();
    if (!user) return;

    const now = new Date();
    const weekKey = getWeekKey(now);
    const monthKey = getMonthKey(now);
    const meals = Math.floor(duration / KIBBLE_PER_MEAL);

    const upsertData = {
      username: user.username,
      activeBreed: user.activeBreed || 'golden_retriever',
    };

    const incData = {
      focusMinutes: duration,
      sessionsCompleted: 1,
      mealsProvided: meals,
    };

    await Promise.all([
      LeaderboardEntry.findOneAndUpdate(
        { userId, period: 'weekly', periodKey: weekKey },
        { $set: upsertData, $inc: incData },
        { upsert: true },
      ),
      LeaderboardEntry.findOneAndUpdate(
        { userId, period: 'monthly', periodKey: monthKey },
        { $set: upsertData, $inc: incData },
        { upsert: true },
      ),
      LeaderboardEntry.findOneAndUpdate(
        { userId, period: 'alltime', periodKey: 'alltime' },
        { $set: upsertData, $inc: incData },
        { upsert: true },
      ),
    ]);
  } catch (err) {
    console.error('updateLeaderboard error:', err.message);
  }
}

// ─── Room activity touch helper ─────────────────────────────────
export async function touchRoomActivity(userId) {
  try {
    await FocusRoom.updateMany(
      { 'members.userId': userId, isActive: true },
      { $set: { lastActivityAt: new Date() } },
    );
  } catch (err) {
    console.error('touchRoomActivity error:', err.message);
  }
}

export default router;
