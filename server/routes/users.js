const express = require('express');
const router  = express.Router();
const User    = require('../models/User');
const { authenticate } = require('../middleware/auth');

// ── GET /api/users/:id ──────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password -email -blockedUsers');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user.' });
  }
});

// ── PATCH /api/users/me ─────────────────────────────────────────────────────
router.patch('/me', authenticate, async (req, res) => {
  try {
    const allowed = ['displayName', 'bio', 'customStatus', 'status', 'avatar', 'banner', 'division'];
    const updates = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select('-password');
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// ── PATCH /api/users/me/password ────────────────────────────────────────────
router.patch('/me/password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both current and new password are required.' });
    }

    const user = await User.findById(req.user._id);
    const valid = await user.comparePassword(currentPassword);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

    user.password = newPassword;
    await user.save();
    res.json({ message: 'Password updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update password.' });
  }
});

// ── GET /api/users/me/friends ───────────────────────────────────────────────
router.get('/me/friends', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('friends', 'username displayName avatar status customStatus clearance division')
      .populate('pendingFriends', 'username displayName avatar');
    res.json({ friends: user.friends, pending: user.pendingFriends });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch friends.' });
  }
});

// ── POST /api/users/me/friends/:id ──────────────────────────────────────────
router.post('/me/friends/:id', authenticate, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ error: 'You cannot add yourself as a friend.' });
    }
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });

    await User.findByIdAndUpdate(req.user._id, { $addToSet: { friends: req.params.id } });
    await User.findByIdAndUpdate(req.params.id, { $addToSet: { friends: req.user._id } });
    res.json({ message: 'Friend added.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add friend.' });
  }
});

// ── DELETE /api/users/me/friends/:id ───────────────────────────────────────
router.delete('/me/friends/:id', authenticate, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { $pull: { friends: req.params.id } });
    await User.findByIdAndUpdate(req.params.id, { $pull: { friends: req.user._id } });
    res.json({ message: 'Friend removed.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove friend.' });
  }
});

// ── POST /api/users/me/block/:id ────────────────────────────────────────────
router.post('/me/block/:id', authenticate, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { blockedUsers: req.params.id },
      $pull: { friends: req.params.id },
    });
    res.json({ message: 'User blocked.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to block user.' });
  }
});

module.exports = router;
