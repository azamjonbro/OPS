const mongoose = require('mongoose');

const IntegrationSchema = new mongoose.Schema({
  type: { 
    type: String, 
    required: true, 
    unique: true,
    enum: ['TELEGRAM', 'BILLZ', 'NOTION', 'GMAIL', 'CALENDAR', 'SLACK', 'WHATSAPP']
  },
  name: { type: String, required: true },
  status: { type: String, enum: ['CONNECTED', 'DISCONNECTED', 'ERROR'], default: 'CONNECTED' },
  credentialsEncrypted: { type: String, default: '' },
  settings: { type: String, default: '{}' },
  healthCheckAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Integration', IntegrationSchema);
