const mongoose = require('mongoose');

const ScheduleSchema = new mongoose.Schema({
  userId: { type: String, default: 'user-1' },
  title: { type: String, required: true },
  prompt: { type: String, required: true },
  frequency: { type: String, enum: ['DAILY', 'WEEKLY', 'ONCE'], default: 'DAILY' },
  scheduledTime: { type: String, default: '19:00' }, // HH:mm format
  targetChannel: { type: String, enum: ['CHAT', 'TELEGRAM', 'EMAIL'], default: 'TELEGRAM' },
  isEnabled: { type: Boolean, default: true },
  lastRunAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Schedule', ScheduleSchema);
