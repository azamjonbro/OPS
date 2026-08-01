const mongoose = require('mongoose');
const Task = require('../models/Task');
const { TASK_STATUSES, TASK_PRIORITIES } = require('../models/Task');
const asyncHandler = require('../utils/asyncHandler');

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function formatTask(t) {
  return {
    id: t._id.toString(),
    title: t.title,
    description: t.description || '',
    dayKey: t.dayKey,
    status: t.status,
    priority: t.priority,
    deadline: t.deadline || null,
    completed: t.status === 'Done',
    completedAt: t.completedAt || null,
    order: t.order,
    archived: t.archived,
    source: t.source,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt
  };
}

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// GET /api/tasks?dayKey=2026-08-01[&archived=true]
const getTasks = asyncHandler(async (req, res) => {
  const { dayKey, from, to, archived } = req.query;

  const filter = { archived: archived === 'true' };

  if (dayKey) {
    if (!DAY_KEY_RE.test(dayKey)) {
      return res.status(400).json({ error: 'dayKey YYYY-MM-DD formatida bo\'lishi kerak' });
    }
    filter.dayKey = dayKey;
  } else if (from && to) {
    // Range read powers the week view's per-day task counters.
    filter.dayKey = { $gte: from, $lte: to };
  }

  const tasks = await Task.find(filter).sort({ status: 1, order: 1, createdAt: 1 });
  res.json(tasks.map(formatTask));
}, 'Failed to fetch tasks');

// GET /api/tasks/counts?from=&to=  -> { '2026-08-01': { total, done }, ... }
const getTaskCounts = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const filter = { archived: false };
  if (from && to) filter.dayKey = { $gte: from, $lte: to };

  const rows = await Task.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$dayKey',
        total: { $sum: 1 },
        done: { $sum: { $cond: [{ $eq: ['$status', 'Done'] }, 1, 0] } }
      }
    }
  ]);

  const counts = {};
  rows.forEach(r => { counts[r._id] = { total: r.total, done: r.done }; });
  res.json(counts);
}, 'Failed to fetch task counts');

// POST /api/tasks
const createTask = asyncHandler(async (req, res) => {
  const { title, description, dayKey, status, priority, deadline, source } = req.body || {};

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Vazifa nomi (title) kiritilishi shart' });
  }
  if (!dayKey || !DAY_KEY_RE.test(dayKey)) {
    return res.status(400).json({ error: 'dayKey YYYY-MM-DD formatida bo\'lishi kerak' });
  }

  const safeStatus = TASK_STATUSES.includes(status) ? status : 'Todo';

  // Append to the bottom of its column.
  const last = await Task.findOne({ dayKey, status: safeStatus, archived: false })
    .sort({ order: -1 })
    .select('order')
    .lean();

  const task = await Task.create({
    title: title.trim(),
    description: description || '',
    dayKey,
    status: safeStatus,
    priority: TASK_PRIORITIES.includes(priority) ? priority : 'Medium',
    deadline: deadline ? new Date(deadline) : null,
    completedAt: safeStatus === 'Done' ? new Date() : null,
    order: last ? last.order + 1 : 0,
    source: source || 'Manual'
  });

  res.status(201).json(formatTask(task));
}, 'Failed to create task');

// PUT /api/tasks/:id
const updateTask = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(404).json({ error: 'Task not found' });

  const existing = await Task.findById(id);
  if (!existing) return res.status(404).json({ error: 'Task not found' });

  const { title, description, status, priority, deadline, dayKey, archived } = req.body || {};

  if (title !== undefined) {
    if (!title.trim()) return res.status(400).json({ error: 'Vazifa nomi bo\'sh bo\'lishi mumkin emas' });
    existing.title = title.trim();
  }
  if (description !== undefined) existing.description = description;
  if (priority !== undefined && TASK_PRIORITIES.includes(priority)) existing.priority = priority;
  if (deadline !== undefined) existing.deadline = deadline ? new Date(deadline) : null;
  if (dayKey !== undefined && DAY_KEY_RE.test(dayKey)) existing.dayKey = dayKey;
  if (archived !== undefined) existing.archived = !!archived;

  if (status !== undefined && TASK_STATUSES.includes(status) && status !== existing.status) {
    existing.status = status;
    // completedAt is derived from the status transition, never sent by the client.
    existing.completedAt = status === 'Done' ? new Date() : null;
  }

  await existing.save();
  res.json(formatTask(existing));
}, 'Failed to update task');

// PATCH /api/tasks/reorder  { dayKey, status, orderedIds: [] }
const reorderTasks = asyncHandler(async (req, res) => {
  const { dayKey, status, orderedIds } = req.body || {};

  if (!DAY_KEY_RE.test(dayKey || '') || !TASK_STATUSES.includes(status) || !Array.isArray(orderedIds)) {
    return res.status(400).json({ error: 'dayKey, status va orderedIds talab qilinadi' });
  }
  if (orderedIds.some(id => !isValidId(id))) {
    return res.status(400).json({ error: 'orderedIds ichida yaroqsiz id bor' });
  }

  // One round trip instead of N saves — the client drops a whole re-indexed column.
  await Task.bulkWrite(orderedIds.map((id, index) => ({
    updateOne: {
      filter: { _id: id },
      update: {
        $set: {
          order: index,
          status,
          dayKey,
          ...(status === 'Done' ? {} : { completedAt: null })
        }
      }
    }
  })));

  // Stamp completedAt only for cards that just entered Done.
  await Task.updateMany(
    { _id: { $in: orderedIds }, status: 'Done', completedAt: null },
    { $set: { completedAt: new Date() } }
  );

  const tasks = await Task.find({ dayKey, archived: false }).sort({ status: 1, order: 1 });
  res.json(tasks.map(formatTask));
}, 'Failed to reorder tasks');

// DELETE /api/tasks/:id
const deleteTask = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(404).json({ error: 'Task not found' });

  const deleted = await Task.findByIdAndDelete(id);
  if (!deleted) return res.status(404).json({ error: 'Task not found' });

  res.json({ success: true, id });
}, 'Failed to delete task');

module.exports = {
  getTasks,
  getTaskCounts,
  createTask,
  updateTask,
  reorderTasks,
  deleteTask
};
