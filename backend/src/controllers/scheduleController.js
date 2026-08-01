const Schedule = require('../models/Schedule');
const asyncHandler = require('../utils/asyncHandler');

function formatSchedule(s) {
  return {
    id: s._id.toString(),
    title: s.title,
    prompt: s.prompt,
    frequency: s.frequency,
    scheduledTime: s.scheduledTime,
    targetChannel: s.targetChannel,
    isEnabled: s.isEnabled,
    createdAt: s.createdAt
  };
}

const getSchedules = asyncHandler(async (req, res) => {
  const schedules = await Schedule.find().sort({ createdAt: -1 });
  res.json(schedules.map(formatSchedule));
}, 'Failed to fetch schedules');

const createSchedule = asyncHandler(async (req, res) => {
  const { title, prompt, frequency, scheduledTime, targetChannel } = req.body;
  const created = await Schedule.create({
    title: title || 'New Automated Report Schedule',
    prompt: prompt || 'Daily report',
    frequency: frequency || 'DAILY',
    scheduledTime: scheduledTime || '19:00',
    targetChannel: targetChannel || 'TELEGRAM',
    isEnabled: true
  });
  res.json(formatSchedule(created));
}, 'Failed to create schedule');

const toggleSchedule = asyncHandler(async (req, res) => {
  const item = await Schedule.findById(req.params.id);
  if (!item) return res.status(404).json({ success: false, error: 'Schedule not found' });
  item.isEnabled = !item.isEnabled;
  await item.save();
  res.json({ success: true, item: formatSchedule(item) });
}, 'Failed to toggle schedule');

const deleteSchedule = asyncHandler(async (req, res) => {
  await Schedule.deleteOne({ _id: req.params.id });
  res.json({ success: true, message: 'Schedule deleted' });
}, 'Failed to delete schedule');

module.exports = {
  getSchedules,
  createSchedule,
  toggleSchedule,
  deleteSchedule
};
