require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const authRoutes    = require('./routes/auth');
const serverRoutes  = require('./routes/servers');
const channelRoutes = require('./routes/channels');
const messageRoutes = require('./routes/messages');
const userRoutes    = require('./routes/users');
const dmRoutes      = require('./routes/dms');
const { setupSocketHandlers } = require('./socket/handlers');

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: true,
  },
});

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── REST Routes ─────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/servers',  serverRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/users',    userRoutes);
app.use('/api/dms',      dmRoutes);

app.get('/api/health', (req, res) =>
  res.json({ status: 'SATCORP COMMS ONLINE', timestamp: new Date().toISOString() })
);

// ── Socket.io JWT Guard ─────────────────────────────────────────────────────
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'satcorp_dev_secret');
    socket.userId   = decoded.userId;
    socket.username = decoded.username;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

setupSocketHandlers(io);

// ── Database ────────────────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URI || 'mongodb://localhost:27017/satcorp')
  .then(() => console.log('🛰  MongoDB connected — SatCorp DB online'))
  .catch((err) => console.error('MongoDB connection error:', err));

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () =>
  console.log(`🚀 SatCorp server running on http://localhost:${PORT}`)
);

module.exports = { io };
