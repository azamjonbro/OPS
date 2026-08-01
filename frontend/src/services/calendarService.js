import axios from 'axios';
import { API_BASE } from './api';

const CALENDAR_URL = `${API_BASE}/api/calendar`;

export const calendarService = {
  async getEvents() {
    try {
      const response = await axios.get(CALENDAR_URL);
      return response.data;
    } catch (err) {
      console.error('Failed to fetch calendar events:', err);
      return [];
    }
  },

  async createEvent(eventData) {
    try {
      const response = await axios.post(CALENDAR_URL, eventData);
      return response.data;
    } catch (err) {
      console.error('Failed to create calendar event:', err);
      throw err;
    }
  },

  async updateEvent(id, updates) {
    try {
      const response = await axios.put(`${CALENDAR_URL}/${id}`, updates);
      return response.data;
    } catch (err) {
      console.error('Failed to update event:', err);
      throw err;
    }
  },

  async deleteEvent(id) {
    try {
      const response = await axios.delete(`${CALENDAR_URL}/${id}`);
      return response.data;
    } catch (err) {
      console.error('Failed to delete event:', err);
      throw err;
    }
  },

  async getReminders() {
    try {
      const response = await axios.get(`${CALENDAR_URL}/reminders`);
      return response.data;
    } catch (err) {
      console.error('Failed to fetch reminders:', err);
      return { upcomingEvents: [] };
    }
  }
};

export default calendarService;
