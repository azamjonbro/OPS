const mongoose = require('mongoose');

const chatHistorySchema = new mongoose.Schema({
  conversationId: { type: String, required: true, index: true },
  role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
  content: { type: String, required: true },
  intent: { type: String, default: 'general_chat' },
  executedTools: { type: Array, default: [] },
  attachedFile: { type: Object, default: null },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

chatHistorySchema.index({ content: 'text' });

const ChatHistory = mongoose.model('ChatHistory', chatHistorySchema);

module.exports = ChatHistory;
