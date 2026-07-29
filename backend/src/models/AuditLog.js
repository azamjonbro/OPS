const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  userId: { type: String, default: 'user-1' },
  connector: { type: String, required: true },
  action: { type: String, required: true },
  status: { type: String, default: 'SUCCESS' },
  executionMs: { type: Number, default: 0 },
  details: { type: String, default: '{}' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('AuditLog', AuditLogSchema);
