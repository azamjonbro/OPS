import axios from 'axios';
import { API_BASE } from './api';

const TASKS_URL = `${API_BASE}/api/tasks`;

export const taskService = {
  async getTasksForDay(dayKey) {
    const res = await axios.get(TASKS_URL, { params: { dayKey } });
    return res.data;
  },

  /** Per-day { total, done } counters used by the calendar grid indicators. */
  async getCounts(from, to) {
    const res = await axios.get(`${TASKS_URL}/counts`, { params: { from, to } });
    return res.data;
  },

  async createTask(payload) {
    const res = await axios.post(TASKS_URL, payload);
    return res.data;
  },

  async updateTask(id, updates) {
    const res = await axios.put(`${TASKS_URL}/${id}`, updates);
    return res.data;
  },

  /** Persists a whole re-indexed column after a drag/drop. */
  async reorder(dayKey, status, orderedIds) {
    const res = await axios.patch(`${TASKS_URL}/reorder`, { dayKey, status, orderedIds });
    return res.data;
  },

  async deleteTask(id) {
    const res = await axios.delete(`${TASKS_URL}/${id}`);
    return res.data;
  }
};

export default taskService;
