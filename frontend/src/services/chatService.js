import axios from 'axios';
import { API_BASE } from './api';

const CHAT_URL = `${API_BASE}/api/chat`;

export const chatService = {
  async getConversations() {
    const res = await axios.get(`${CHAT_URL}/conversations`);
    return res.data;
  },

  async getMessages(convId) {
    const res = await axios.get(`${CHAT_URL}/conversations/${convId}/messages`);
    return res.data;
  },

  async createConversation(title) {
    const res = await axios.post(`${CHAT_URL}/conversations`, { title });
    return res.data;
  },

  async deleteConversation(id) {
    const res = await axios.delete(`${CHAT_URL}/conversations/${id}`);
    return res.data;
  },

  async clearAllConversations() {
    const res = await axios.delete(`${CHAT_URL}/conversations`);
    return res.data;
  },

  async sendMessage(payload) {
    const res = await axios.post(`${CHAT_URL}/message`, payload);
    return res.data;
  },

  async transcribeAudio(payload) {
    const res = await axios.post(`${CHAT_URL}/transcribe-audio`, payload);
    return res.data;
  },

  async getMemoryItems() {
    const res = await axios.get(`${CHAT_URL}/memory/items`);
    return res.data;
  },

  async uploadMemoryItem(payload) {
    const res = await axios.post(`${CHAT_URL}/memory/upload`, payload);
    return res.data;
  },

  async deleteMemoryItem(id) {
    const res = await axios.delete(`${CHAT_URL}/memory/items/${id}`);
    return res.data;
  },

  async getOwnerProfile() {
    const res = await axios.get(`${CHAT_URL}/owner/profile`);
    return res.data;
  },

  async saveOwnerProfile(payload) {
    const res = await axios.post(`${CHAT_URL}/owner/profile`, payload);
    return res.data;
  }
};

export default chatService;
