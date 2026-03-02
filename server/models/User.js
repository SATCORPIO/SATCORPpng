const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    username:      { type: String, required: true, unique: true, trim: true, minlength: 2, maxlength: 32 },
    email:         { type: String, required: true, unique: true, lowercase: true, trim: true },
    password:      { type: String, required: true, minlength: 6 },
    displayName:   { type: String, default: '' },
    avatar:        { type: String, default: null },   // URL or base64 thumb
    banner:        { type: String, default: null },

    status:        { type: String, enum: ['online', 'idle', 'dnd', 'invisible', 'offline'], default: 'offline' },
    customStatus:  { type: String, default: '', maxlength: 128 },
    bio:           { type: String, default: '', maxlength: 256 },

    // SatCorp-specific
    role:          { type: String, enum: ['user', 'operator', 'admin'], default: 'user' },
    clearance:     { type: Number, default: 1, min: 1, max: 5 },
    division:      { type: String, default: 'General Operations' },

    servers:       [{ type: mongoose.Schema.Types.ObjectId, ref: 'Server' }],
    friends:       [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    pendingFriends:[{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    blockedUsers:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    dmChannels:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'Channel' }],

    lastSeen:      { type: Date, default: Date.now },
    createdAt:     { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  if (!this.displayName) this.displayName = this.username;
  next();
});

userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toPublic = function () {
  const o = this.toObject();
  delete o.password;
  delete o.email;
  delete o.blockedUsers;
  return o;
};

userSchema.methods.toSafe = function () {
  const o = this.toObject();
  delete o.password;
  return o;
};

module.exports = mongoose.model('User', userSchema);
