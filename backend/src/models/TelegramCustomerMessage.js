const mongoose = require('mongoose');

// The sync log for every message exchanged with a customer through the Telegram
// Business bot — written unconditionally on the way in, before any AI decision is made.
const TelegramCustomerMessageSchema = new mongoose.Schema({
  businessConnectionId: { type: String, required: true, index: true },
  chatId: { type: String, required: true, index: true },
  customerTelegramUserId: { type: String, default: '' },
  customerName: { type: String, default: '' },
  direction: { type: String, enum: ['in', 'out'], required: true },
  text: { type: String, default: '' },
  intent: { type: String, enum: ['sales', 'other', null], default: null },
  matchedProductName: { type: String, default: '' },
  aiHandled: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('TelegramCustomerMessage', TelegramCustomerMessageSchema);
