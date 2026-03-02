const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema(
  {
    filename:    { type: String },
    url:         { type: String },
    contentType: { type: String },
    size:        { type: Number },
    width:       { type: Number, default: null },
    height:      { type: Number, default: null },
  },
  { _id: false }
);

const embedSchema = new mongoose.Schema(
  {
    type:        { type: String },
    title:       { type: String },
    description: { type: String },
    url:         { type: String },
    color:       { type: Number },
    thumbnail:   { url: String },
    image:       { url: String },
    author:      { name: String, url: String },
    footer:      { text: String },
    fields:      [{ name: String, value: String, inline: Boolean }],
    timestamp:   { type: Date },
  },
  { _id: false }
);

const reactionSchema = new mongoose.Schema(
  {
    emoji: { type: String, required: true },
    count: { type: Number, default: 0 },
    users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    content:  { type: String, default: '', maxlength: 4000 },
    author:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    channel:  { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true },
    server:   { type: mongoose.Schema.Types.ObjectId, ref: 'Server', default: null },

    type: {
      type: String,
      enum: ['default', 'reply', 'system', 'pin', 'join', 'leave', 'call'],
      default: 'default',
    },

    // Reply / Thread
    replyTo:    { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    threadId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', default: null },

    attachments: [attachmentSchema],
    embeds:      [embedSchema],
    reactions:   [reactionSchema],

    // Mentions
    mentions:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    mentionRoles:    [{ type: String }],
    mentionEveryone: { type: Boolean, default: false },

    pinned:   { type: Boolean, default: false },
    edited:   { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
    deleted:  { type: Boolean, default: false },

    // Voice / call metadata
    callMetadata: {
      duration:     { type: Number, default: 0 },  // seconds
      participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      ended:        { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

messageSchema.index({ channel: 1, createdAt: -1 });
messageSchema.index({ author: 1 });
messageSchema.index({ 'mentions': 1 });

module.exports = mongoose.model('Message', messageSchema);
