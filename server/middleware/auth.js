const express  = require('express');
const router   = express.Router();
const User     = require('../models/User');
const Server   = require('../models/Server');
const Channel  = require('../models/Channel');
const { generateToken, authenticate } = require('../middleware/auth');

// ── POST /api/auth/register ─────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, displayName } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required.' });
    }

    const existing = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] });
    if (existing) {
      return res.status(409).json({
        error: existing.email === email.toLowerCase()
          ? 'That email address is already registered.'
          : 'That username is already taken.',
      });
    }

    const user = new User({
      username,
      email,
      password,
      displayName: displayName?.trim() || username,
    });
    await user.save();

    // ── Provision a personal home server ──────────────────────────────────
    const homeServer = new Server({
      name:        `${user.username}'s Station`,
      description: 'Your personal SatCorp communications hub.',
      owner:       user._id,
      members:     [{ user: user._id, roles: [] }],
      roles: [
        {
          name: 'Commander',
          color: '#e05c5c',
          hoist: true,
          position: 100,
          permissions: { administrator: true },
        },
        {
          name: 'Operative',
          color: '#43b581',
          hoist: false,
          position: 0,
          permissions: { sendMessages: true, readMessages: true, connect: true, speak: true },
        },
      ],
      categories: [
        { name: 'INFORMATION', position: 0 },
        { name: 'OPERATIONS',  position: 1 },
      ],
    });
    await homeServer.save();

    // ── Default channels ───────────────────────────────────────────────────
    const [welcome, general, announcements, voiceBridge] = await Channel.insertMany([
      { name: 'welcome',       type: 'text',         server: homeServer._id, position: 0, topic: 'Welcome to your station.' },
      { name: 'general',       type: 'text',         server: homeServer._id, position: 1, topic: 'General operations channel.' },
      { name: 'announcements', type: 'announcement', server: homeServer._id, position: 2, topic: 'Official broadcasts.' },
      { name: 'Command Bridge',type: 'voice',        server: homeServer._id, position: 3, userLimit: 0 },
    ]);

    homeServer.systemChannelId = welcome._id;
    await homeServer.save();

    user.servers.push(homeServer._id);
    await user.save();

    const token = generateToken(user._id.toString(), user.username);
    res.status(201).json({
      token,
      user: user.toSafe(),
      defaultServerId: homeServer._id,
      defaultChannelId: general._id,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ── POST /api/auth/login ────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) {
      return res.status(400).json({ error: 'Credentials are required.' });
    }

    const user = await User.findOne({
      $or: [{ email: login.toLowerCase() }, { username: login }],
    });
    if (!user) return res.status(401).json({ error: 'Invalid username or password.' });

    const valid = await user.comparePassword(password);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password.' });

    user.status  = 'online';
    user.lastSeen = new Date();
    await user.save();

    const token = generateToken(user._id.toString(), user.username);
    res.json({ token, user: user.toSafe() });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

// ── GET /api/auth/me ────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('servers', 'name icon description inviteCode memberCount')
      .select('-password');
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile.' });
  }
});

// ── POST /api/auth/logout ───────────────────────────────────────────────────
router.post('/logout', authenticate, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { status: 'offline', lastSeen: new Date() });
    res.json({ message: 'Logged out.' });
  } catch (err) {
    res.status(500).json({ error: 'Logout failed.' });
  }
});

module.exports = router;
