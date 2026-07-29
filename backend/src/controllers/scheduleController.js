const mongoose = require('mongoose');
const Schedule = require('../models/Schedule');
const mockDb = require('../store');

const getSchedules = async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      const dbSchedules = await Schedule.find().sort({ createdAt: -1 });
      return res.json(dbSchedules.map(s => ({
        id: s._id.toString(),
        title: s.title,
        prompt: s.prompt,
        frequency: s.frequency,
        scheduledTime: s.scheduledTime,
        targetChannel: s.targetChannel,
        isEnabled: s.isEnabled,
        createdAt: s.createdAt
      })));
    }
  } catch (e) {}
  res.json(mockDb.schedules);
};

const createSchedule = async (req, res) => {
  const { title, prompt, frequency, scheduledTime, targetChannel } = req.body;
  const newSch = {
    id: `sch-${Date.now()}`,
    title: title || 'New Automated Report Schedule',
    prompt: prompt || 'Daily report',
    frequency: frequency || 'DAILY',
    scheduledTime: scheduledTime || '19:00',
    targetChannel: targetChannel || 'TELEGRAM',
    isEnabled: true,
    createdAt: new Date()
  };

  try {
    if (mongoose.connection.readyState === 1) {
      const created = await Schedule.create({
        title: newSch.title,
        prompt: newSch.prompt,
        frequency: newSch.frequency,
        scheduledTime: newSch.scheduledTime,
        targetChannel: newSch.targetChannel,
        isEnabled: true
      });
      newSch.id = created._id.toString();
    }
  } catch (e) {}

  mockDb.schedules.unshift(newSch);
  res.json(newSch);
};

const toggleSchedule = async (req, res) => {
  const { id } = req.params;
  let item = mockDb.schedules.find(s => s.id === id);
  if (item) {
    item.isEnabled = !item.isEnabled;
  }
  try {
    if (mongoose.connection.readyState === 1) {
      const dbItem = await Schedule.findById(id).catch(() => null);
      if (dbItem) {
        dbItem.isEnabled = !dbItem.isEnabled;
        await dbItem.save();
        item = {
          id: dbItem._id.toString(),
          title: dbItem.title,
          prompt: dbItem.prompt,
          frequency: dbItem.frequency,
          scheduledTime: dbItem.scheduledTime,
          targetChannel: dbItem.targetChannel,
          isEnabled: dbItem.isEnabled
        };
      }
    }
  } catch (e) {}

  res.json({ success: true, item });
};

const deleteSchedule = async (req, res) => {
  const { id } = req.params;
  mockDb.schedules = mockDb.schedules.filter(s => s.id !== id);
  try {
    if (mongoose.connection.readyState === 1) {
      await Schedule.deleteOne({ _id: id }).catch(() => null);
    }
  } catch (e) {}

  res.json({ success: true, message: 'Schedule deleted' });
};

module.exports = {
  getSchedules,
  createSchedule,
  toggleSchedule,
  deleteSchedule
};
