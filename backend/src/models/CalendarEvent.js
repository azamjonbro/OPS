const mongoose = require('mongoose');

const calendarEventSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date
  },
  startTime: {
    type: String,
    default: '09:00'
  },
  endTime: {
    type: String,
    default: '10:00'
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Urgent'],
    default: 'Medium'
  },
  category: {
    type: String,
    enum: ['Meeting', 'Work', 'Deadline', 'Personal', 'Call', 'Project'],
    default: 'Work'
  },
  status: {
    type: String,
    enum: ['Pending', 'In Progress', 'Completed'],
    default: 'Pending'
  },
  createdBy: {
    type: String,
    default: 'Azamjon (Store Hadiya)'
  },
  source: {
    type: String,
    enum: ['AI', 'Manual'],
    default: 'AI'
  },
  googleCalendarSynced: {
    type: Boolean,
    default: false
  },
  googleEventId: {
    type: String,
    default: null
  },
  reminders: [
    {
      timeBeforeMinutes: { type: Number, default: 30 },
      notified: { type: Boolean, default: false }
    }
  ]
}, {
  timestamps: true
});

module.exports = mongoose.model('CalendarEvent', calendarEventSchema);
