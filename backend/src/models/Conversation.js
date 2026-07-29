const mongoose = require('mongoose');

const ConversationSchema = new mongoose.Schema({
  userId: { type: String, default: 'user-1' },
  title: { type: String, default: 'New Chat' },
  isPinned: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Conversation', ConversationSchema);
