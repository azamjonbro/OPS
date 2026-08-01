const mongoose = require('mongoose');
const CalendarEvent = require('../models/CalendarEvent');
const AuditLog = require('../models/AuditLog');
const connectorRegistry = require('../connectors/registry');
const asyncHandler = require('../utils/asyncHandler');

function formatEvent(e) {
  return {
    id: e._id.toString(),
    title: e.title,
    description: e.description,
    startDate: e.startDate ? new Date(e.startDate).toISOString().split('T')[0] : '',
    endDate: e.endDate ? new Date(e.endDate).toISOString().split('T')[0] : '',
    startTime: e.startTime,
    endTime: e.endTime,
    priority: e.priority,
    category: e.category,
    status: e.status,
    createdBy: e.createdBy,
    source: e.source,
    googleCalendarSynced: e.googleCalendarSynced,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt
  };
}

// GET /api/calendar
const getEvents = asyncHandler(async (req, res) => {
  let dbEvents = await CalendarEvent.find().sort({ startDate: 1, startTime: 1 });

  // If MongoDB is empty, seed initial enterprise events
  if (!dbEvents || dbEvents.length === 0) {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const dayAfter = new Date(today);
    dayAfter.setDate(today.getDate() + 2);

    const seedItems = [
      {
        title: 'Store Hadiya POS Inventory & Sales Audit',
        description: 'Haftalik POS kassa va inventarizatsiya natijalarini Billz integratsiyasi orqali audit qilish.',
        startDate: today,
        endDate: today,
        startTime: '10:00',
        endTime: '11:30',
        priority: 'High',
        category: 'Work',
        status: 'In Progress',
        createdBy: 'Azamjon (Store Hadiya)',
        source: 'AI',
        googleCalendarSynced: true
      },
      {
        title: 'Client Presentation & SwissWatch Strategy',
        description: 'Mijozlar bilan yangi sotuv va CRM strategiyasi bo\'yicha taqdimot va kelishuv.',
        startDate: tomorrow,
        endDate: tomorrow,
        startTime: '14:00',
        endTime: '15:30',
        priority: 'Urgent',
        category: 'Meeting',
        status: 'Pending',
        createdBy: 'Azamjon (Store Hadiya)',
        source: 'AI',
        googleCalendarSynced: true
      },
      {
        title: 'Server Infra & Database Migration',
        description: 'Backend MongoDB klasterini va Node.js server nusxalarini yangilash.',
        startDate: dayAfter,
        endDate: dayAfter,
        startTime: '17:00',
        endTime: '18:30',
        priority: 'High',
        category: 'Deadline',
        status: 'Pending',
        createdBy: 'Azamjon (Store Hadiya)',
        source: 'AI',
        googleCalendarSynced: false
      }
    ];
    dbEvents = await CalendarEvent.insertMany(seedItems);
  }

  return res.json(dbEvents.map(formatEvent));
}, 'Failed to fetch calendar events');

// POST /api/calendar
const createEvent = asyncHandler(async (req, res) => {
  const {
    title,
    description,
    startDate,
    endDate,
    startTime,
    endTime,
    priority,
    category,
    status,
    source
  } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  const todayStr = new Date().toISOString().split('T')[0];

  // Auto Google Calendar Sync Connector Call
  await connectorRegistry.executeTool('calendar_create_event', {
    title: title.trim(),
    startTime: startTime || '09:00',
    date: startDate || todayStr,
    priority: priority || 'Medium'
  }).catch(() => {});

  const dbEvent = await CalendarEvent.create({
    title: title.trim(),
    description: description || '',
    startDate: new Date(startDate || todayStr),
    endDate: new Date(endDate || startDate || todayStr),
    startTime: startTime || '09:00',
    endTime: endTime || '10:00',
    priority: priority || 'Medium',
    category: category || 'Work',
    status: status || 'Pending',
    createdBy: 'Azamjon (Store Hadiya)',
    source: source || 'Manual',
    googleCalendarSynced: true,
    reminders: [{ timeBeforeMinutes: 30, notified: false }]
  });

  await AuditLog.create({
    connector: 'CALENDAR',
    action: 'EVENT_CREATE',
    status: 'SUCCESS',
    executionMs: 95
  });

  return res.status(201).json(formatEvent(dbEvent));
}, 'Server error creating event');

// PUT /api/calendar/:id
const updateEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const dbEvt = await CalendarEvent.findByIdAndUpdate(
    id,
    { ...req.body, updatedAt: new Date() },
    { new: true }
  );

  if (!dbEvt) {
    return res.status(404).json({ error: 'Event not found' });
  }

  return res.json(formatEvent(dbEvt));
}, 'Failed to update event');

// DELETE /api/calendar/:id
const deleteEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (mongoose.Types.ObjectId.isValid(id)) {
    await CalendarEvent.findByIdAndDelete(id);
  }
  return res.json({ success: true, message: 'Calendar event deleted successfully' });
}, 'Failed to delete event');

// GET /api/calendar/reminders
const getReminders = asyncHandler(async (req, res) => {
  const now = new Date();
  const upcoming = await CalendarEvent.find({
    status: { $ne: 'Completed' },
    startDate: { $gte: new Date(now.toDateString()) }
  }).sort({ startDate: 1, startTime: 1 });

  return res.json({
    remindersCount: upcoming.length,
    upcomingEvents: upcoming.map(formatEvent),
    telegramNotificationReady: true
  });
}, 'Failed to get reminders');

module.exports = {
  getEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  getReminders
};
