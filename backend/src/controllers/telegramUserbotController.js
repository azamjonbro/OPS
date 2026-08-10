const telegramUserbotService = require('../services/telegramUserbotService');
const asyncHandler = require('../utils/asyncHandler');

const getStatus = asyncHandler(async (req, res) => {
  res.json({ success: true, ...telegramUserbotService.getStatus() });
}, 'Failed to load Telegram userbot status');

const startLogin = asyncHandler(async (req, res) => {
  const result = await telegramUserbotService.startLogin(req.body && req.body.phone);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
}, 'Failed to start Telegram login');

const submitCode = asyncHandler(async (req, res) => {
  const result = await telegramUserbotService.submitCode(req.body && req.body.code);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
}, 'Failed to submit Telegram code');

const submitPassword = asyncHandler(async (req, res) => {
  const result = await telegramUserbotService.submitPassword(req.body && req.body.password);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
}, 'Failed to submit Telegram 2FA password');

const logout = asyncHandler(async (req, res) => {
  const result = await telegramUserbotService.logout();
  res.json(result);
}, 'Failed to log out Telegram userbot');

const syncHistory = asyncHandler(async (req, res) => {
  // Backfilling a big account can take a while — ack immediately and let the frontend
  // poll /status (syncing + lastSyncStats) rather than holding the HTTP request open.
  if (!telegramUserbotService.isConnected()) {
    return res.status(400).json({ success: false, error: 'Userbot ulanmagan' });
  }
  res.json({ success: true, message: 'Sync boshlandi' });
  telegramUserbotService.syncHistory().catch((err) => {
    console.error('Telegram userbot syncHistory error:', err.message);
  });
}, 'Failed to start Telegram history sync');

module.exports = { getStatus, startLogin, submitCode, submitPassword, syncHistory, logout };
