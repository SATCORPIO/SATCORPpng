const mongoose = require('mongoose');

const permOverwriteSchema = new mongoose.Schema(
  {
    id:    { type: String, required: true }, // role or user id
    type:  { type: String, enum: ['role', 'member'], required: true },
    allow: [{ type: String }],
    deny:  [{ type: String }],
  },
  { _id: false }
);

const channelSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true, maxlength: 100 },
    type:     {
      type: String,
      enum: ['text', 'voice', 'announcement', 'stage', 'forum', 'dm', 'group_dm'],
      default: 'text',
    },

    server:   { type: mongoose.Schema.Types.ObjectId, ref: 'Server', default: null },
    category: { type: mongoose.Schema.Types.ObjectId, default: null },

    // Text channel fields
    topic:     { type: String, default: '', maxlength: 1024 },
    slowMode:  { type: Number, default: 0 }, // seconds between messages per user
    nsfw:      { type: Boolean, default: false },
    position:  { type: Number, default: 0 },

    // Voice / Stage fields
    userLimit: { type: Number, default: 0 },   // 0 = unlimited
    bitrate:   { type: Number, default: 64000 },
    rtcRegion: { type: String, default: 'auto' },

    // DM participants
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    groupName:    { type: String, default: null },
    groupIcon:    { type: String, default: null },
    groupOwner:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Permissions
    permissionOverwrites: [permOverwriteSchema],

    pinnedMessages: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Message' }],
    lastMessage:    { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    lastActivity:   { type: Date, default: Date.now },
  },
  { timestamps: true }
);

channelSchema.index({ server: 1, position: 1 });
channelSchema.index({ participants: 1 });

module.exports = mongoose.model('Channel', channelSchema);
