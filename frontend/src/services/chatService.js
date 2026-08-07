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

  /**
   * Streams real backend progress (which tool is running, which model is answering)
   * instead of a canned loading string. EventSource can't send a POST body, so this
   * reads the SSE response manually via fetch + a ReadableStream reader, splitting on
   * the blank-line-terminated frames the backend already writes in chatController.js.
   */
  async sendMessageStream(payload, onProgress = () => {}) {
    const res = await fetch(`${CHAT_URL}/message/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok || !res.body) {
      throw new Error(`Stream request failed: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIndex;
      while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        if (!frame.trim() || frame.startsWith(':')) continue; // heartbeat ping

        let event = 'message';
        let data = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7).trim();
          else if (line.startsWith('data: ')) data += line.slice(6);
        }
        if (!data) continue;

        const parsed = JSON.parse(data);
        if (event === 'progress') onProgress(parsed);
        else if (event === 'done') return parsed;
        else if (event === 'error') throw new Error(parsed.error || 'Stream error');
      }
    }

    throw new Error('Stream ended without a done event');
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
