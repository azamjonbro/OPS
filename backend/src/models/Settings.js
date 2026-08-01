const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'dual_llm' },
  enabled: { type: Boolean, default: true },
  primaryModel: { type: String, default: 'OpenAI GPT-4o' },
  consensusModel: { type: String, default: 'Anthropic Claude 3.5 Sonnet' },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Settings', SettingsSchema);
