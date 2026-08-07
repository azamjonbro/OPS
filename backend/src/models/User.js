const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  // sparse+unique: only admin-login users carry a username, only chat-profile users
  // (if this model is ever populated for that) carry an email — neither field should
  // collide with other docs leaving it blank.
  username: { type: String, unique: true, sparse: true },
  passwordHash: { type: String, default: '' },
  email: { type: String, unique: true, sparse: true },
  name: { type: String, default: '' },
  role: { type: String, enum: ['SUPERADMIN', 'USER'], default: 'USER' },
  avatar: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
