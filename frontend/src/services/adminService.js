import axios from 'axios';
import { API_BASE } from './api';

const ADMIN_URL = `${API_BASE}/api/admin`;

export const adminService = {
  async getDashboard() {
    const res = await axios.get(`${ADMIN_URL}/dashboard`);
    return res.data;
  },

  async getIntegrations() {
    const res = await axios.get(`${ADMIN_URL}/integrations`);
    return res.data;
  },

  async getModels() {
    const res = await axios.get(`${ADMIN_URL}/models`);
    return res.data;
  },

  async getLogs() {
    const res = await axios.get(`${ADMIN_URL}/logs`);
    return res.data;
  },

  async getDualConfig() {
    const res = await axios.get(`${ADMIN_URL}/llm/dual-config`);
    return res.data;
  },

  async saveDualConfig(config) {
    const res = await axios.post(`${ADMIN_URL}/llm/dual-config`, config);
    return res.data;
  },

  async setDefaultModel(id) {
    const res = await axios.post(`${ADMIN_URL}/models/${id}/default`);
    return res.data;
  },

  async testIntegrationHealth(type) {
    const res = await axios.post(`${ADMIN_URL}/integrations/${type}/test`);
    return res.data;
  },

  async saveIntegrationCredentials(payload) {
    const res = await axios.post(`${ADMIN_URL}/integrations/${payload.type}`, payload);
    return res.data;
  }
};

export default adminService;
