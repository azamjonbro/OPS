import axios from 'axios';
import { API_BASE } from './api';

const ADMIN_URL = `${API_BASE}/api/admin`;

// One axios instance (not the global default) so the admin token/401 handling lives in
// exactly one place instead of being repeated on every call below.
const client = axios.create();

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('jarvis_admin_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response && err.response.status === 401) {
      // Session missing/expired — drop it and force the AdminLoginPage gate to show again.
      localStorage.removeItem('jarvis_admin_token');
      window.location.reload();
    }
    return Promise.reject(err);
  }
);

export const adminService = {
  async getDashboard() {
    const res = await client.get(`${ADMIN_URL}/dashboard`);
    return res.data;
  },

  async getIntegrations() {
    const res = await client.get(`${ADMIN_URL}/integrations`);
    return res.data;
  },

  async getModels() {
    const res = await client.get(`${ADMIN_URL}/models`);
    return res.data;
  },

  async getLogs() {
    const res = await client.get(`${ADMIN_URL}/logs`);
    return res.data;
  },

  async getDualConfig() {
    const res = await client.get(`${ADMIN_URL}/llm/dual-config`);
    return res.data;
  },

  async saveDualConfig(config) {
    const res = await client.post(`${ADMIN_URL}/llm/dual-config`, config);
    return res.data;
  },

  async setDefaultModel(id) {
    const res = await client.post(`${ADMIN_URL}/models/${id}/default`);
    return res.data;
  },

  async testIntegrationHealth(type) {
    const res = await client.post(`${ADMIN_URL}/integrations/${type}/test`);
    return res.data;
  },

  async saveIntegrationCredentials(payload) {
    const res = await client.post(`${ADMIN_URL}/integrations/${payload.type}`, payload);
    return res.data;
  },

  // Telegram Userbot (MTProto history sync) — separate stepped login flow from the
  // single-shot saveIntegrationCredentials above.
  async getTelegramUserbotStatus() {
    const res = await client.get(`${ADMIN_URL}/telegram-userbot/status`);
    return res.data;
  },

  async telegramUserbotStartLogin(phone) {
    const res = await client.post(`${ADMIN_URL}/telegram-userbot/start-login`, { phone });
    return res.data;
  },

  async telegramUserbotSubmitCode(code) {
    const res = await client.post(`${ADMIN_URL}/telegram-userbot/submit-code`, { code });
    return res.data;
  },

  async telegramUserbotSubmitPassword(password) {
    const res = await client.post(`${ADMIN_URL}/telegram-userbot/submit-password`, { password });
    return res.data;
  },

  async telegramUserbotSyncHistory() {
    const res = await client.post(`${ADMIN_URL}/telegram-userbot/sync-history`);
    return res.data;
  }
};

export default adminService;
