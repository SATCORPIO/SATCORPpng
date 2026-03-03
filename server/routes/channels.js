const express = require('express');
const router  = express.Router();
const Channel = require('../models/Channel');
const Server  = require('../models/Server');
const { authenticate } = require('../middleware/auth');

function isAdmin(server, userId) {
  const uid = userId.toString();
  if (server.owner.toString() === uid) return true;
  const member = server.members.find((m) => m.user.toString() === uid);
  if (!member) return false;
  return member.roles.some((rid) => {
    const role = server.roles.id(rid);
    return role?.permissions?.administrator || role?.permissions?.manageChannels;
  });
}

// ── POST /api/channels ──────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, type, serverId, topic, categoryId, userLimit, bitrate } = req.body;
    if (!name?.trim() || !serverId) return res.status(400).json({ error: 'Name and serverId are required.' });

    const server = await Server.findById(serverId);
    if (!server) return res.status(404).json({ error: 'Server not found.' });
    if (!isAdmin(server, req.user._id)) return res.status(403).json({ error: 'Insufficient permissions.' });

    const count    = await Channel.countDocuments({ server: serverId });
    const channel  = new Channel({
      name: name.trim(),
      type: type || 'text',
      server: serverId,
      topic: topic || '',
      category: categoryId || null,
      position: count,
      userLimit: userLimit || 0,
      bitrate: bitrate || 64000,
    });
    await channel.save();
    res.status(201).json({ channel });
  } catch (err) {
    console.error('Create channel error:', err);
    res.status(500).json({ error: 'Failed to create channel.' });
  }
});

// ── GET /api/channels/:id ───────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ error: 'Channel not found.' });
    res.json({ channel });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch channel.' });
  }
});

// ── PATCH /api/channels/:id ─────────────────────────────────────────────────
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ error: 'Channel not found.' });

    if (channel.server) {
      const server = await Server.findById(channel.server);
      if (server && !isAdmin(server, req.user._id)) {
        return res.status(403).json({ error: 'Insufficient permissions.' });
      }
    }

    const allowed = ['name', 'topic', 'slowMode', 'nsfw', 'userLimit', 'bitrate', 'position', 'category'];
    allowed.forEach((k) => { if (req.body[k] !== undefined) channel[k] = req.body[k]; });
    await channel.save();
    res.json({ channel });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update channel.' });
  }
});

// ── DELETE /api/channels/:id ────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ error: 'Channel not found.' });

    if (channel.server) {
      const server = await Server.findById(channel.server);
      if (server && !isAdmin(server, req.user._id)) {
        return res.status(403).json({ error: 'Insufficient permissions.' });
      }
    }

    await channel.deleteOne();
    res.json({ message: 'Channel deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete channel.' });
  }
});

module.exports = router;
