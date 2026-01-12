import express from 'express';
import Focus from '../models/Focus.js';
import User from '../models/User.js';
import protect from '../middleware/auth.middleware.js';

const router = express.Router();

const KIBBLE_PER_SESSION = 10;

// @route   POST /focus/complete
// @desc    Record a completed or failed focus session
// @access  Private
router.post('/complete', protect, async (req, res) => {
  try {
    const { startTime, duration, status } = req.body;

    // Validate required fields
    if (!startTime || !duration || !status) {
      return res.status(400).json({
        message: 'startTime, duration, and status are required',
      });
    }

    // Validate status
    if (!['completed', 'failed'].includes(status)) {
      return res.status(400).json({
        message: 'Status must be either "completed" or "failed"',
      });
    }

    // Validate duration
    if (duration < 1) {
      return res.status(400).json({
        message: 'Duration must be at least 1 minute',
      });
    }

    // Server-side time validation: startTime cannot be in the future
    const sessionStartTime = new Date(startTime);
    const now = new Date();

    if (sessionStartTime > now) {
      return res.status(400).json({
        message: 'Start time cannot be in the future',
      });
    }

    // Validate that startTime + duration doesn't exceed current time significantly
    const sessionEndTime = new Date(sessionStartTime.getTime() + duration * 60000);
    const tolerance = 60000; // 1 minute tolerance

    if (sessionEndTime > new Date(now.getTime() + tolerance)) {
      return res.status(400).json({
        message: 'Session end time exceeds current server time',
      });
    }

    // Create focus session record
    const focusSession = await Focus.create({
      userId: req.user._id,
      startTime: sessionStartTime,
      duration,
      status,
    });

    // If completed, award kibble and update total focus minutes
    let kibbleAwarded = 0;
    if (status === 'completed') {
      kibbleAwarded = KIBBLE_PER_SESSION;

      await User.findByIdAndUpdate(req.user._id, {
        $inc: {
          totalKibble: kibbleAwarded,
          totalFocusMinutes: duration,
        },
      });
    }

    res.status(201).json({
      session: {
        _id: focusSession._id,
        startTime: focusSession.startTime,
        duration: focusSession.duration,
        status: focusSession.status,
      },
      kibbleAwarded,
      message:
        status === 'completed'
          ? `Session completed! You earned ${kibbleAwarded} kibble.`
          : 'Session recorded as failed.',
    });
  } catch (error) {
    console.error('Focus complete error:', error.message);
    res.status(500).json({ message: 'Server error recording focus session' });
  }
});

export default router;
