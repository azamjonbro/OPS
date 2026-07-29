const connectorRegistry = require('../connectors/registry');
const mockDb = require('../store');
const aiEngine = require('../aiEngine');

const getDashboard = (req, res) => {
  res.json({
    totalUsers: 14,
    totalIntegrations: mockDb.integrations.length,
    connectedIntegrations: mockDb.integrations.filter(i => i.status === 'CONNECTED').length,
    totalAuditLogs: mockDb.auditLogs.length,
    totalConversations: mockDb.conversations.length,
    totalSchedules: mockDb.schedules.length,
    systemStatus: 'OPERATIONAL',
    dualLlmStatus: mockDb.dualLlmConfig.enabled ? 'ACTIVE_DUAL_ENSEMBLE' : 'SINGLE_PROVIDER',
    database: 'MongoDB / Mongoose'
  });
};

const getIntegrations = (req, res) => {
  const registered = connectorRegistry.getAll();
  const result = registered.map(c => ({
    type: c.type,
    name: c.name,
    description: c.description,
    status: 'CONNECTED',
    tools: c.getTools()
  }));
  res.json(result);
};

const updateIntegration = (req, res) => {
  const { type } = req.params;
  const { credentials, settings } = req.body;
  const connector = connectorRegistry.get(type);
  if (connector) {
    connector.connect(credentials, settings);
  }
  const item = mockDb.integrations.find(i => i.type.toUpperCase() === type.toUpperCase());
  if (item) {
    item.status = 'CONNECTED';
    item.updatedAt = new Date();
  }
  res.json({ success: true, message: `${type} integration updated & connected successfully!` });
};

const testIntegration = async (req, res) => {
  const { type } = req.params;
  const connector = connectorRegistry.get(type);
  if (!connector) {
    return res.status(404).json({ success: false, error: 'Connector not found' });
  }
  const health = await connector.healthCheck();
  res.json({ type, ...health });
};

const getModels = (req, res) => {
  res.json(mockDb.models);
};

const setDefaultModel = (req, res) => {
  const { id } = req.params;
  mockDb.models.forEach(m => m.isDefault = (m.id === id));
  res.json({ success: true, models: mockDb.models });
};

const getLogs = (req, res) => {
  res.json(mockDb.auditLogs);
};

const getDualConfig = (req, res) => {
  res.json(mockDb.dualLlmConfig);
};

const updateDualConfig = (req, res) => {
  const { enabled, openAiKey, claudeKey } = req.body;
  mockDb.dualLlmConfig.enabled = enabled;
  if (openAiKey) mockDb.dualLlmConfig.openAiKey = openAiKey;
  if (claudeKey) mockDb.dualLlmConfig.claudeKey = claudeKey;

  aiEngine.setDualLlmConfig(enabled, mockDb.dualLlmConfig.openAiKey, mockDb.dualLlmConfig.claudeKey);

  res.json({
    success: true,
    message: 'Dual LLM (OpenAI + Claude) configuration updated successfully!',
    config: mockDb.dualLlmConfig
  });
};

module.exports = {
  getDashboard,
  getIntegrations,
  updateIntegration,
  testIntegration,
  getModels,
  setDefaultModel,
  getLogs,
  getDualConfig,
  updateDualConfig
};
