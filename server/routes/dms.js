const express  = require('express');
const router   = express.Router();
const Channel  = require('../models/Channel');
const Message  = require('../models/Message');
const User     = require('../models/User');
const { authenticate } = require('../middleware/auth');

const POPULATE_AUTHOR = 'username displayName avatar status clearance division';

// ── POST /api/dms/open ──────────────────────────────────────────────────────
// Open (or get existing) DM channel with another user
router.post('/open', authenticate, async (req, res) => {
  try {
    const { recipientId } = req.body;
    if (!recipientId) return res.status(400).json({ error: 'recipientId is required.' });
    if (recipientId === req.user._id.toString()) {
      return res.status(400).json({ error: 'Cannot open DM with yourself.' });
    }

    const recipient = await User.findById(recipientId);
    if (!recipient) return res.status(404).json({ error: 'User not found.' });

    // Check if a DM channel already exists for these two participants
    let channel = await Channel.findOne({
      type: 'dm',
      participants: { $all: [req.user._id, recipientId], $size: 2 },
    });

    if (!channel) {
      channel = new Channel({
        name: `dm-${req.user.username}-${recipient.username}`,
        type: 'dm',
        participants: [req.user._id, recipientId],
      });
      await channel.save();

      // Track DM channel on both users
      await User.findByIdAndUpdate(req.user._id,  { $addToSet: { dmChannels: channel._id } });
      await User.findByIdAndUpdate(recipientId, { $addToSet: { dmChannels: channel._id } });
    }

    res.json({ channel, recipient: recipient.toPublic() });
  } catch (err) {
    console.error('Open DM error:', err);
    res.status(500).json({ error: 'Failed to open DM channel.' });
  }
});

// ── GET /api/dms ─────────────────────────────────────────────────────────────
// List all DM channels for the current user
router.get('/', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: 'dmChannels',
      populate: { path: 'participants', select: 'username displayName avatar status customStatus' },
    });
    res.json({ channels: user.dmChannels || [] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch DM channels.' });
  }
});

// ── GET /api/dms/:channelId/messages ─────────────────────────────────────────
router.get('/:channelId/messages', authenticate, async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found.' });

    const isParticipant = channel.participants.some((p) => p.toString() === req.user._id.toString());
    if (!isParticipant) return res.status(403).json({ error: 'Access denied.' });

    const { before, limit = 50 } = req.query;
    const query = { channel: req.params.channelId, deleted: false };
    if (before) query.createdAt = { $lt: new Date(before) };

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit), 100))
      .populate('author', POPULATE_AUTHOR);

    res.json({ messages: messages.reverse() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages.' });
  }
});

module.exports = router;
