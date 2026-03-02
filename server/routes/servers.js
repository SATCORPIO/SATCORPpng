const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const roleSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true },
    color:       { type: String, default: '#99aab5' },
    hoist:       { type: Boolean, default: false },   // show separately in member list
    mentionable: { type: Boolean, default: true },
    position:    { type: Number, default: 0 },
    permissions: {
      administrator:   { type: Boolean, default: false },
      manageServer:    { type: Boolean, default: false },
      manageChannels:  { type: Boolean, default: false },
      manageRoles:     { type: Boolean, default: false },
      manageMessages:  { type: Boolean, default: false },
      kickMembers:     { type: Boolean, default: false },
      banMembers:      { type: Boolean, default: false },
      sendMessages:    { type: Boolean, default: true },
      readMessages:    { type: Boolean, default: true },
      embedLinks:      { type: Boolean, default: true },
      attachFiles:     { type: Boolean, default: true },
      mentionEveryone: { type: Boolean, default: false },
      connect:         { type: Boolean, default: true },
      speak:           { type: Boolean, default: true },
      muteMembers:     { type: Boolean, default: false },
      deafenMembers:   { type: Boolean, default: false },
    },
  },
  { _id: true }
);

const memberSchema = new mongoose.Schema(
  {
    user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    nickname: { type: String, default: null },
    roles:    [{ type: mongoose.Schema.Types.ObjectId }], // role _ids from roles array
    muted:    { type: Boolean, default: false },
    deafened: { type: Boolean, default: false },
    joinedAt: { type: Date, default: Date.now },
    banned:   { type: Boolean, default: false },
    banReason:{ type: String, default: '' },
  },
  { _id: false }
);

const serverSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, default: '', maxlength: 1024 },
    icon:        { type: String, default: null },
    banner:      { type: String, default: null },
    owner:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    inviteCode:  { type: String, unique: true, default: () => uuidv4().split('-')[0].toUpperCase() },
    isPublic:    { type: Boolean, default: false },
    region:      { type: String, default: 'auto' },

    members:     [memberSchema],
    roles:       [roleSchema],

    categories: [
      {
        name:     { type: String },
        position: { type: Number, default: 0 },
      },
    ],

    // Moderation
    verificationLevel:      { type: Number, default: 0, min: 0, max: 4 },
    explicitContentFilter:  { type: Number, default: 0 },
    systemChannelId:        { type: mongoose.Schema.Types.ObjectId, default: null },

    // Boosts / cosmetics
    boostLevel:  { type: Number, default: 0, min: 0, max: 3 },
    boostCount:  { type: Number, default: 0 },
  },
  { timestamps: true }
);

serverSchema.virtual('memberCount').get(function () {
  return this.members.filter((m) => !m.banned).length;
});

module.exports = mongoose.model('Server', serverSchema);
