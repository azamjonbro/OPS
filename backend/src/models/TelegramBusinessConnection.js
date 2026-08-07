const mongoose = require('mongoose');

// One row per Telegram "business_connection_id" — created/updated whenever the business
// account owner connects, disconnects, or changes permissions for the bot in Telegram's
// own Settings > Business > Chatbots screen (a `business_connection` webhook update).
const TelegramBusinessConnectionSchema = new mongoose.Schema({
  businessConnectionId: { type: String, required: true, unique: true, index: true },
  telegramUserId: { type: String, default: '' },
  isEnabled: { type: Boolean, default: true },
  canReply: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('TelegramBusinessConnection', TelegramBusinessConnectionSchema);
