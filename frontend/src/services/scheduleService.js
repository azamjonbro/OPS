import axios from 'axios';
import { API_BASE } from './api';

const SCHEDULES_URL = `${API_BASE}/api/schedules`;

export const scheduleService = {
  async getSchedules() {
    const res = await axios.get(SCHEDULES_URL);
    return res.data;
  },

  async createSchedule(payload) {
    const res = await axios.post(SCHEDULES_URL, payload);
    return res.data;
  },

  async toggleSchedule(id) {
    const res = await axios.post(`${SCHEDULES_URL}/${id}/toggle`);
    return res.data;
  },

  async deleteSchedule(id) {
    const res = await axios.delete(`${SCHEDULES_URL}/${id}`);
    return res.data;
  }
};

export default scheduleService;
