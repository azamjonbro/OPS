const express = require('express');
const router = express.Router();
const calendarController = require('../controllers/calendarController');

router.get('/', calendarController.getEvents);
router.post('/', calendarController.createEvent);
router.put('/:id', calendarController.updateEvent);
router.delete('/:id', calendarController.deleteEvent);

router.post('/sync-google', calendarController.syncGoogleCalendar);
router.get('/reminders', calendarController.getReminders);

module.exports = router;
