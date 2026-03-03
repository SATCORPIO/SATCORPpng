const express = require('express');
const router  = express.Router();
const Server  = require('../models/Server');
const Channel = require('../models/Channel');
const User    = require('../models/User');
const { authenticate } = require('../middleware/auth');

// helper — check if user is server owner or has administrator role
function isAdmin(server, userId) {
  const uid = userId.toString();
  if (server.owner.toString() === uid) return true;
  const member = server.members.find((m) => m.user.toString() === uid);
  if (!member) return false;
  return member.roles.some((rid) => {
    const role = server.roles.id(rid);
    return role?.permissions?.administrator;
  });
}

// ── GET /api/servers ────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('servers', 'name icon description inviteCode');
    res.json({ servers: user.servers });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch servers.' });
  }
});

// ── POST /api/servers ───────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, description, isPublic, region } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Server name is required.' });

    const server = new Server({
      name: name.trim(),
      description: description?.trim() || '',
      isPublic: !!isPublic,
      region: region || 'auto',
      owner: req.user._id,
      members: [{ user: req.user._id, roles: [] }],
      roles: [
        { name: 'Commander', color: '#e05c5c', hoist: true,  position: 100, permissions: { administrator: true, mentionEveryone: true } },
        { name: 'Operator',  color: '#faa61a', hoist: true,  position: 50,  permissions: { manageMessages: true, kickMembers: true, sendMessages: true, readMessages: true, connect: true, speak: true } },
        { name: 'Operative', color: '#43b581', hoist: false, position: 0,   permissions: { sendMessages: true, readMessages: true, connect: true, speak: true, attachFiles: true, embedLinks: true } },
      ],
      categories: [
        { name: 'INFORMATION', position: 0 },
        { name: 'OPERATIONS',  position: 1 },
        { name: 'VOICE',       position: 2 },
      ],
    });
    await server.save();

    const channels = await Channel.insertMany([
      { name: 'welcome',        type: 'text',         server: server._id, position: 0, topic: 'Welcome to the station.' },
      { name: 'general',        type: 'text',         server: server._id, position: 1, topic: 'General communications.' },
      { name: 'announcements',  type: 'announcement', server: server._id, position: 2, topic: 'Official broadcasts only.' },
      { name: 'mission-log',    type: 'text',         server: server._id, position: 3, topic: 'Log active missions here.' },
      { name: 'Command Bridge', type: 'voice',        server: server._id, position: 4, userLimit: 0  },
      { name: 'Briefing Room',  type: 'voice',        server: server._id, position: 5, userLimit: 10 },
    ]);

    server.systemChannelId = channels[0]._id;
    await server.save();

    await User.findByIdAndUpdate(req.user._id, { $addToSet: { servers: server._id } });

    res.status(201).json({ server, channels });
  } catch (err) {
    console.error('Create server error:', err);
    res.status(500).json({ error: 'Failed to create server.' });
  }
});

// ── GET /api/servers/:id ────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const server = await Server.findById(req.params.id)
      .populate('members.user', 'username displayName avatar status customStatus clearance division')
      .populate('owner', 'username displayName avatar');

    if (!server) return res.status(404).json({ error: 'Server not found.' });

    const isMember = server.members.some((m) => m.user?._id?.toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ error: 'You are not a member of this server.' });

    const channels = await Channel.find({ server: server._id }).sort({ position: 1 });
    res.json({ server, channels });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch server.' });
  }
});

// ── PATCH /api/servers/:id ──────────────────────────────────────────────────
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found.' });
    if (!isAdmin(server, req.user._id)) return res.status(403).json({ error: 'Insufficient permissions.' });

    const allowed = ['name', 'description', 'icon', 'banner', 'isPublic', 'region', 'verificationLevel'];
    allowed.forEach((k) => { if (req.body[k] !== undefined) server[k] = req.body[k]; });
    await server.save();
    res.json({ server });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update server.' });
  }
});

// ── DELETE /api/servers/:id ─────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found.' });
    if (server.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only the server owner can delete it.' });
    }

    await Channel.deleteMany({ server: server._id });
    const memberIds = server.members.map((m) => m.user);
    await User.updateMany({ _id: { $in: memberIds } }, { $pull: { servers: server._id } });
    await server.deleteOne();

    res.json({ message: 'Server deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete server.' });
  }
});

// ── POST /api/servers/join/:inviteCode ──────────────────────────────────────
router.post('/join/:inviteCode', authenticate, async (req, res) => {
  try {
    const server = await Server.findOne({ inviteCode: req.params.inviteCode.toUpperCase() });
    if (!server) return res.status(404).json({ error: 'Invalid invite code.' });

    const alreadyMember = server.members.some((m) => m.user.toString() === req.user._id.toString());
    if (alreadyMember) return res.status(409).json({ error: 'You are already a member of this server.' });

    server.members.push({ user: req.user._id, roles: [] });
    await server.save();
    await User.findByIdAndUpdate(req.user._id, { $addToSet: { servers: server._id } });

    const channels = await Channel.find({ server: server._id }).sort({ position: 1 });
    res.json({ server, channels });
  } catch (err) {
    res.status(500).json({ error: 'Failed to join server.' });
  }
});

// ── DELETE /api/servers/:id/leave ───────────────────────────────────────────
router.delete('/:id/leave', authenticate, async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found.' });
    if (server.owner.toString() === req.user._id.toString()) {
      return res.status(400).json({ error: 'Transfer ownership before leaving your own server.' });
    }

    server.members = server.members.filter((m) => m.user.toString() !== req.user._id.toString());
    await server.save();
    await User.findByIdAndUpdate(req.user._id, { $pull: { servers: server._id } });
    res.json({ message: 'Left server.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to leave server.' });
  }
});

// ── POST /api/servers/:id/members/:userId/kick ──────────────────────────────
router.post('/:id/members/:userId/kick', authenticate, async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found.' });
    if (!isAdmin(server, req.user._id)) return res.status(403).json({ error: 'Insufficient permissions.' });

    server.members = server.members.filter((m) => m.user.toString() !== req.params.userId);
    await server.save();
    await User.findByIdAndUpdate(req.params.userId, { $pull: { servers: server._id } });
    res.json({ message: 'Member kicked.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to kick member.' });
  }
});

// ── PATCH /api/servers/:id/members/:userId/role ─────────────────────────────
router.patch('/:id/members/:userId/role', authenticate, async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found.' });
    if (!isAdmin(server, req.user._id)) return res.status(403).json({ error: 'Insufficient permissions.' });

    const member = server.members.find((m) => m.user.toString() === req.params.userId);
    if (!member) return res.status(404).json({ error: 'Member not found.' });

    member.roles = req.body.roles || [];
    await server.save();
    res.json({ member });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update member role.' });
  }
});

module.exports = router;
