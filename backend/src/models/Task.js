const mongoose = require('mongoose');

const TASK_STATUSES = ['Todo', 'Doing', 'Done'];
const TASK_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

const TaskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },

  // The planner day this card lives on, stored as a YYYY-MM-DD string so a board
  // lookup is an exact match and never depends on the server's timezone.
  dayKey: { type: String, required: true, index: true },

  status: { type: String, enum: TASK_STATUSES, default: 'Todo', index: true },
  priority: { type: String, enum: TASK_PRIORITIES, default: 'Medium' },

  deadline: { type: Date, default: null },
  completedAt: { type: Date, default: null },

  // Position within its column; gaps are fine, the client sends a full re-index on drop.
  order: { type: Number, default: 0 },

  archived: { type: Boolean, default: false, index: true },
  source: { type: String, default: 'Manual' },

  // Mirrors this card to/from the "Calendar Tasks" Notion database (notionTaskSyncService.js).
  notionPageId: { type: String, default: null }
}, {
  timestamps: true
});

// Every board read filters on these three together.
TaskSchema.index({ dayKey: 1, archived: 1, status: 1, order: 1 });

module.exports = mongoose.model('Task', TaskSchema);
module.exports.TASK_STATUSES = TASK_STATUSES;
module.exports.TASK_PRIORITIES = TASK_PRIORITIES;
