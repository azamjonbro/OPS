const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  conversationId: { type: String, required: true },
  role: { type: String, required: true }, // user, assistant, system
  content: { type: String, required: true },
  attachedFile: { type: String, default: null },
  // Quoted excerpt this message is replying to: { messageId, role, snippet }
  replyTo: { type: Object, default: null },
  toolCalls: { type: String, default: '[]' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', MessageSchema);
