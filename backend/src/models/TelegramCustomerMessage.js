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
  // history syncs idempotent (skip messages already imported for the same chat). No default:
  // must stay genuinely absent (not '') on live rows, or the sparse unique index below would
  // treat every second live message in the same chat as a duplicate of the first.
  telegramMessageId: { type: String },
  createdAt: { type: Date, default: Date.now }
});

// Backfill dedup key: a given Telegram message id must only be imported once per chat.
// A plain `sparse` index does NOT do what it sounds like here — on a COMPOUND index, Mongo
// only excludes a doc if *every* indexed field is missing, and chatId is always present, so
// `sparse` alone would still index every live row as telegramMessageId: null and collide.
// partialFilterExpression is the actual fix: only rows that genuinely set telegramMessageId
// (i.e. userbot_sync backfill rows) enter this index at all.
TelegramCustomerMessageSchema.index(
  { chatId: 1, telegramMessageId: 1 },
  { unique: true, partialFilterExpression: { telegramMessageId: { $exists: true } } }
);

module.exports = mongoose.model('TelegramCustomerMessage', TelegramCustomerMessageSchema);
