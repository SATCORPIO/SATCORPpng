const jwt  = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'satcorp_dev_secret';

/**
 * Attach req.user from a Bearer token.  Blocks the request if missing / invalid.
 */
const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No authentication token provided.' });
    }

    const token   = header.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await User.findById(decoded.userId).select('-password');
    if (!user) return res.status(401).json({ error: 'User not found.' });

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError')  return res.status(401).json({ error: 'Invalid token.' });
    if (err.name === 'TokenExpiredError')  return res.status(401).json({ error: 'Token expired. Please log in again.' });
    console.error('Auth middleware error:', err);
    res.status(500).json({ error: 'Authentication failed.' });
  }
};

/**
 * Require the authenticated user to have the 'admin' role.
 * Must come after authenticate().
 */
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator clearance required.' });
  }
  next();
};

/**
 * Generate a signed JWT for a user.
 */
const generateToken = (userId, username) =>
  jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '7d' });

module.exports = { authenticate, requireAdmin, generateToken };
