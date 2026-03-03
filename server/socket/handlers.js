/**
 * SatCorp — Socket.io Real-Time Handlers
 *
 * Covers:
 *  - Room subscription (servers, channels)
 *  - Real-time messaging (send, edit, delete)
 *  - Typing indicators
 *  - Emoji reactions
 *  - Voice channel participation tracking
 *  - WebRTC signaling relay (offer / answer / ICE candidates)
 *  - User presence broadcasting
 *  - @mention push notifications
 */

const Message = require('../models/Message');
const Channel = require('../models/Channel');
const User    = require('../models/User');

// In-memory maps (use Redis in production for multi-instance deployments)
const userSockets    = new Map(); // userId  → socketId
const voiceChannels  = new Map(); // channelId → Set<{ socketId, userId, username, muted, deafened }>

const POPULATE_AUTHOR = 'username displayName avatar status clearance division';

function setupSocketHandlers(io) {
  io.on('connection', async (socket) => {
    console.log(`🔌 Connected: ${socket.username} (${socket.id})`);
    userSockets.set(socket.userId, socket.id);

    // Mark user online
    await User.findByIdAndUpdate(socket.userId, { status: 'online', lastSeen: new Date() }).catch(() => {});

    // Broadcast presence change to everyone
    socket.broadcast.emit('user_status_change', { userId: socket.userId, status: 'online' });

    // ── Room Subscriptions ──────────────────────────────────────────────────

    socket.on('join_server', (serverId) => {
      socket.join(`server:${serverId}`);
    });

    socket.on('leave_server', (serverId) => {
      socket.leave(`server:${serverId}`);
    });

    socket.on('join_channel', (channelId) => {
      if (socket.currentChannel) socket.leave(`channel:${socket.currentChannel}`);
      socket.join(`channel:${channelId}`);
      socket.currentChannel = channelId;
    });

    socket.on('leave_channel', (channelId) => {
      socket.leave(`channel:${channelId}`);
      if (socket.currentChannel === channelId) socket.currentChannel = null;
    });

    // ── Messaging ───────────────────────────────────────────────────────────

    socket.on('send_message', async (data, callback) => {
      try {
        const { channelId, content, replyToId } = data;
        if (!content?.trim() || !channelId) return callback?.({ error: 'Invalid payload.' });

        const channel = await Channel.findById(channelId);
        if (!channel) return callback?.({ error: 'Channel not found.' });

        // Parse @mentions from content
        const mentionMatches = [...content.matchAll(/@(\w+)/g)].map((m) => m[1]);
        let mentions = [];
        if (mentionMatches.length) {
          const mentioned = await User.find({ username: { $in: mentionMatches } }).select('_id');
          mentions = mentioned.map((u) => u._id);
        }

        const mentionEveryone = content.includes('@everyone') || content.includes('@here');

        const message = new Message({
          content: content.trim(),
          channel: channelId,
          server: channel.server || null,
          author: socket.userId,
          replyTo: replyToId || null,
          mentions,
          mentionEveryone,
        });
        await message.save();
        await Channel.findByIdAndUpdate(channelId, { lastMessage: message._id, lastActivity: new Date() });

        const populated = await Message.findById(message._id)
          .populate('author', POPULATE_AUTHOR)
          .populate({ path: 'replyTo', populate: { path: 'author', select: POPULATE_AUTHOR } });

        // Broadcast to all subscribers of this channel
        io.to(`channel:${channelId}`).emit('new_message', { message: populated });

        // Push mention notifications to mentioned users
        mentions.forEach((uid) => {
          const targetSocket = userSockets.get(uid.toString());
          if (targetSocket && uid.toString() !== socket.userId) {
            io.to(targetSocket).emit('mention', {
              message: populated,
              channelId,
              serverId: channel.server,
            });
          }
        });

        callback?.({ success: true, message: populated });
      } catch (err) {
        console.error('send_message error:', err);
        callback?.({ error: 'Failed to send message.' });
      }
    });

    socket.on('edit_message', async ({ messageId, content }) => {
      try {
        const message = await Message.findById(messageId);
        if (!message || message.author.toString() !== socket.userId) return;

        message.content  = content.trim();
        message.edited   = true;
        message.editedAt = new Date();
        await message.save();

        io.to(`channel:${message.channel}`).emit('message_edited', {
          messageId,
          content: message.content,
          editedAt: message.editedAt,
        });
      } catch (err) {
        console.error('edit_message error:', err);
      }
    });

    socket.on('delete_message', async ({ messageId }) => {
      try {
        const message = await Message.findById(messageId);
        if (!message || message.author.toString() !== socket.userId) return;

        message.deleted = true;
        await message.save();

        io.to(`channel:${message.channel}`).emit('message_deleted', { messageId });
      } catch (err) {
        console.error('delete_message error:', err);
      }
    });

    // ── Typing Indicators ───────────────────────────────────────────────────

    const typingTimers = {}; // channelId → timeout

    socket.on('typing_start', (channelId) => {
      socket.to(`channel:${channelId}`).emit('user_typing', {
        userId:   socket.userId,
        username: socket.username,
        channelId,
      });
      clearTimeout(typingTimers[channelId]);
      typingTimers[channelId] = setTimeout(() => {
        socket.to(`channel:${channelId}`).emit('user_stop_typing', { userId: socket.userId, channelId });
      }, 3000);
    });

    socket.on('typing_stop', (channelId) => {
      clearTimeout(typingTimers[channelId]);
      socket.to(`channel:${channelId}`).emit('user_stop_typing', { userId: socket.userId, channelId });
    });

    // ── Reactions ───────────────────────────────────────────────────────────

    socket.on('add_reaction', async ({ messageId, emoji }) => {
      try {
        const message = await Message.findById(messageId);
        if (!message) return;

        const existing = message.reactions.find((r) => r.emoji === emoji);
        if (existing) {
          const idx = existing.users.findIndex((u) => u.toString() === socket.userId);
          if (idx > -1) {
            existing.users.splice(idx, 1);
            existing.count = Math.max(0, existing.count - 1);
            if (existing.count === 0) {
              message.reactions = message.reactions.filter((r) => r.emoji !== emoji);
            }
          } else {
            existing.users.push(socket.userId);
            existing.count++;
          }
        } else {
          message.reactions.push({ emoji, count: 1, users: [socket.userId] });
        }

        await message.save();
        io.to(`channel:${message.channel}`).emit('reaction_update', {
          messageId,
          reactions: message.reactions,
        });
      } catch (err) {
        console.error('add_reaction error:', err);
      }
    });

    // ── Voice Channels ──────────────────────────────────────────────────────

    socket.on('join_voice', async (channelId) => {
      // Leave any previous voice channel
      if (socket.currentVoiceChannel) {
        _leaveVoice(io, socket);
      }

      if (!voiceChannels.has(channelId)) voiceChannels.set(channelId, new Set());
      voiceChannels.get(channelId).add({
        socketId: socket.id,
        userId:   socket.userId,
        username: socket.username,
        muted:    false,
        deafened: false,
      });

      socket.join(`voice:${channelId}`);
      socket.currentVoiceChannel = channelId;

      const participants = [...voiceChannels.get(channelId)];
      io.to(`voice:${channelId}`).emit('voice_participants_update', { channelId, participants });

      // Notify new arrival so existing peers can initiate WebRTC offers
      socket.to(`voice:${channelId}`).emit('voice_user_joined', {
        userId:   socket.userId,
        username: socket.username,
        socketId: socket.id,
      });
    });

    socket.on('leave_voice', () => _leaveVoice(io, socket));

    socket.on('voice_mute_toggle', ({ channelId, muted }) => {
      if (voiceChannels.has(channelId)) {
        for (const p of voiceChannels.get(channelId)) {
          if (p.socketId === socket.id) { p.muted = muted; break; }
        }
        const participants = [...voiceChannels.get(channelId)];
        io.to(`voice:${channelId}`).emit('voice_participants_update', { channelId, participants });
      }
    });

    socket.on('voice_deafen_toggle', ({ channelId, deafened }) => {
      if (voiceChannels.has(channelId)) {
        for (const p of voiceChannels.get(channelId)) {
          if (p.socketId === socket.id) { p.deafened = deafened; break; }
        }
        const participants = [...voiceChannels.get(channelId)];
        io.to(`voice:${channelId}`).emit('voice_participants_update', { channelId, participants });
      }
    });

    // ── WebRTC Signaling Relay ──────────────────────────────────────────────

    socket.on('webrtc_offer', ({ targetUserId, offer }) => {
      const target = userSockets.get(targetUserId);
      if (target) io.to(target).emit('webrtc_offer', { fromUserId: socket.userId, fromSocketId: socket.id, offer });
    });

    socket.on('webrtc_answer', ({ targetUserId, answer }) => {
      const target = userSockets.get(targetUserId);
      if (target) io.to(target).emit('webrtc_answer', { fromUserId: socket.userId, answer });
    });

    socket.on('webrtc_ice_candidate', ({ targetUserId, candidate }) => {
      const target = userSockets.get(targetUserId);
      if (target) io.to(target).emit('webrtc_ice_candidate', { fromUserId: socket.userId, candidate });
    });

    // Screen share signal
    socket.on('webrtc_screen_share_start', ({ channelId }) => {
      socket.to(`voice:${channelId}`).emit('webrtc_screen_share_started', {
        userId: socket.userId, username: socket.username,
      });
    });

    socket.on('webrtc_screen_share_stop', ({ channelId }) => {
      socket.to(`voice:${channelId}`).emit('webrtc_screen_share_stopped', { userId: socket.userId });
    });

    // ── Presence ────────────────────────────────────────────────────────────

    socket.on('update_status', async (status) => {
      try {
        const valid = ['online', 'idle', 'dnd', 'invisible'];
        if (!valid.includes(status)) return;
        await User.findByIdAndUpdate(socket.userId, { status });
        // Broadcast real status; invisible shows as offline to others
        socket.broadcast.emit('user_status_change', {
          userId: socket.userId,
          status: status === 'invisible' ? 'offline' : status,
        });
      } catch (err) {
        console.error('update_status error:', err);
      }
    });

    // ── Disconnect ──────────────────────────────────────────────────────────

    socket.on('disconnect', async () => {
      console.log(`🔌 Disconnected: ${socket.username} (${socket.id})`);

      userSockets.delete(socket.userId);
      Object.values(typingTimers).forEach(clearTimeout);

      if (socket.currentVoiceChannel) _leaveVoice(io, socket);

      try {
        await User.findByIdAndUpdate(socket.userId, { status: 'offline', lastSeen: new Date() });
      } catch {}

      socket.broadcast.emit('user_status_change', { userId: socket.userId, status: 'offline' });
    });
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function _leaveVoice(io, socket) {
  const channelId = socket.currentVoiceChannel;
  if (!channelId) return;

  const vc = voiceChannels.get(channelId);
  if (vc) {
    for (const p of vc) {
      if (p.socketId === socket.id) { vc.delete(p); break; }
    }
    if (vc.size === 0) voiceChannels.delete(channelId);
  }

  socket.leave(`voice:${channelId}`);
  socket.currentVoiceChannel = null;

  const participants = vc ? [...vc] : [];
  io.to(`voice:${channelId}`).emit('voice_participants_update', { channelId, participants });
  io.to(`voice:${channelId}`).emit('voice_user_left', { userId: socket.userId });
}

module.exports = { setupSocketHandlers };
