const mongoose = require('mongoose');

const AIModelSchema = new mongoose.Schema({
  provider: { type: String, required: true }, // openai, claude, gemini, deepseek, ollama
  modelName: { type: String, required: true }, // gpt-4o, claude-3-5-sonnet, gemini-1.5-pro, etc.
  displayName: { type: String, required: true },
  isDefault: { type: Boolean, default: false },
  temperature: { type: Number, default: 0.7 },
  isEnabled: { type: Boolean, default: true }
});

module.exports = mongoose.model('AIModel', AIModelSchema);
