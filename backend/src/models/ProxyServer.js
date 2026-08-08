const mongoose = require('mongoose');

// A pool of SOCKS5/HTTP proxies, managed from the admin panel instead of .env — proxies get
// rotated/replaced often (provider churn, geo-blocks), and re-SSHing to edit .env + restart
// for every swap doesn't scale. `purpose` lets the same pool serve different needs (OpenAI
// calls blocked by region, Telegram MTProto blocked by network) with different working sets.
const ProxyServerSchema = new mongoose.Schema({
  purpose: { type: String, enum: ['openai', 'telegram_mtproto'], required: true, index: true },
  protocol: { type: String, enum: ['socks5', 'http'], default: 'socks5' },
  host: { type: String, required: true },
  port: { type: Number, required: true },
  username: { type: String, default: '' },
  password: { type: String, default: '' },
  label: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  lastCheckedAt: { type: Date, default: null },
  lastCheckOk: { type: Boolean, default: null },
  lastCheckError: { type: String, default: '' },
  // Lower tries first among isActive+lastCheckOk proxies for a given purpose.
  priority: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

ProxyServerSchema.index({ purpose: 1, host: 1, port: 1 }, { unique: true });

module.exports = mongoose.model('ProxyServer', ProxyServerSchema);
