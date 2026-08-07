const mongoose = require('mongoose');

// The sync log for every message exchanged with a customer through the Telegram
// Business bot — written unconditionally on the way in, before any AI decision is made.
const TelegramCustomerMessageSchema = new mongoose.Schema({
  // Empty for rows backfilled by the MTProto userbot sync — that path has no webhook-issued
  // business_connection_id to attach to, only a chatId.
  businessConnectionId: { type: String, default: '', index: true },
  chatId: { type: String, required: true, index: true },
  customerTelegramUserId: { type: String, default: '' },
  customerName: { type: String, default: '' },
  direction: { type: String, enum: ['in', 'out'], required: true },
  text: { type: String, default: '' },
  intent: { type: String, enum: ['sales', 'other', null], default: null },
  matchedProductName: { type: String, default: '' },
  aiHandled: { type: Boolean, default: false },
  escalated: { type: Boolean, default: false },
  escalationReason: { type: String, default: '' },
  // Which pipeline wrote this row — the real-time Bot API webhook, or the one-off MTProto
  // history backfill (services/telegramUserbotService.js).
  source: { type: String, enum: ['business_webhook', 'userbot_sync'], default: 'business_webhook' },
  // Only set for userbot_sync rows — Telegram's own message id, used to make repeated
  // history syncs idempotent (skip messages already imported for the same chat).
  telegramMessageId: { type: String, default: '', index: true },
  createdAt: { type: Date, default: Date.now }
});

// Backfill dedup key: a given Telegram message id must only be imported once per chat.
// Sparse because live webhook rows never set telegramMessageId.
TelegramCustomerMessageSchema.index({ chatId: 1, telegramMessageId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('TelegramCustomerMessage', TelegramCustomerMessageSchema);
