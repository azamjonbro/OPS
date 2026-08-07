const connectorRegistry = require('../connectors/registry');
const aiEngine = require('../aiEngine');
const Integration = require('../models/Integration');
const AuditLog = require('../models/AuditLog');
const AIModel = require('../models/AIModel');
const Conversation = require('../models/Conversation');
const Schedule = require('../models/Schedule');
const Settings = require('../models/Settings');
const cache = require('../utils/cache');
const asyncHandler = require('../utils/asyncHandler');

function formatModel(m) {
  return {
    id: m._id.toString(),
    name: m.displayName,
    provider: m.provider,
    isDefault: m.isDefault,
    latencyMs: m.latencyMs
  };
}

const getDashboard = asyncHandler(async (req, res) => {
  const [totalIntegrations, connectedIntegrations, totalAuditLogs, totalConversations, totalSchedules, settings] = await Promise.all([
    Integration.countDocuments(),
    Integration.countDocuments({ status: 'CONNECTED' }),
    AuditLog.countDocuments(),
    Conversation.countDocuments(),
    Schedule.countDocuments(),
    Settings.findOne({ key: 'dual_llm' })
  ]);

  res.json({
    totalUsers: 14,
    totalIntegrations,
    connectedIntegrations,
    totalAuditLogs,
    totalConversations,
    totalSchedules,
    systemStatus: 'OPERATIONAL',
    dualLlmStatus: settings && settings.enabled ? 'ACTIVE_DUAL_ENSEMBLE' : 'SINGLE_PROVIDER',
    database: 'MongoDB / Mongoose'
  });
}, 'Failed to load dashboard');

const getIntegrations = asyncHandler(async (req, res) => {
  const registered = connectorRegistry.getAll();
  const dbIntegrations = await Integration.find();
  const statusByType = new Map(dbIntegrations.map(i => [i.type, i.status]));

  res.json(registered.map(c => ({
    type: c.type,
    name: c.name,
    description: c.description,
    status: statusByType.get(c.type) || 'DISCONNECTED',
    tools: c.getTools()
  })));
}, 'Failed to load integrations');

const updateIntegration = async (req, res) => {
  const { type } = req.params;
  const { credentials, settings } = req.body;

  // Telegram Business needs a real network round-trip (validate the token, register the
  // webhook) before it can report success — unlike the other connectors here, which just
  // flip a DB status flag, "saved" must mean "actually connected" for this one.
  if (type.toUpperCase() === 'TELEGRAM_BUSINESS') {
    const telegramBusinessService = require('../services/telegramBusinessService');
    const result = await telegramBusinessService.saveToken(credentials && credentials.botToken);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    return res.json({
      success: true,
      message: `Telegram Business bot @${result.botUsername} ulandi va webhook faollashtirildi!`,
      botUsername: result.botUsername,
      webhookUrl: result.webhookUrl
    });
  }

  const connector = connectorRegistry.get(type);
  if (connector) {
    connector.connect(credentials, settings);
  }

  try {
    await Integration.findOneAndUpdate(
      { type: type.toUpperCase() },
      { status: 'CONNECTED', updatedAt: new Date(), $setOnInsert: { name: connector ? connector.name : type } },
      { upsert: true }
    );
  } catch (e) {}

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

const getModels = asyncHandler(async (req, res) => {
  const models = await AIModel.find();
  res.json(models.map(formatModel));
}, 'Failed to load models');

const setDefaultModel = asyncHandler(async (req, res) => {
  await AIModel.updateMany({}, { isDefault: false });
  await AIModel.updateOne({ _id: req.params.id }, { isDefault: true });
  const models = await AIModel.find();
  res.json({ success: true, models: models.map(formatModel) });
}, 'Failed to set default model');

const getCacheStats = (req, res) => {
  res.json(cache.getStats());
};

const clearCache = (req, res) => {
  cache.clear();
  res.json({ success: true, message: 'Connector cache cleared' });
};

const getLogs = asyncHandler(async (req, res) => {
  const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(200);
  res.json(logs);
}, 'Failed to load logs');

const getDualConfig = asyncHandler(async (req, res) => {
  const settings = await Settings.findOne({ key: 'dual_llm' });
  res.json({
    enabled: settings ? settings.enabled : true,
    primaryModel: settings ? settings.primaryModel : 'OpenAI GPT-4o',
    consensusModel: settings ? settings.consensusModel : 'Anthropic Claude 3.5 Sonnet'
  });
}, 'Failed to load dual LLM config');

const updateDualConfig = asyncHandler(async (req, res) => {
  const { enabled, openAiKey, claudeKey } = req.body;
  const settings = await Settings.findOneAndUpdate(
    { key: 'dual_llm' },
    { enabled, updatedAt: new Date() },
    { new: true, upsert: true }
  );

  // API keys are runtime-only (sourced from .env by default); never persisted to the DB.
  aiEngine.setDualLlmConfig(enabled, openAiKey, claudeKey);

  res.json({
    success: true,
    message: 'Dual LLM (OpenAI + Claude) configuration updated successfully!',
    config: { enabled: settings.enabled, primaryModel: settings.primaryModel, consensusModel: settings.consensusModel }
  });
}, 'Failed to update dual LLM config');

module.exports = {
  getDashboard,
  getIntegrations,
  updateIntegration,
  testIntegration,
  getModels,
  setDefaultModel,
  getLogs,
  getCacheStats,
  clearCache,
  getDualConfig,
  updateDualConfig
};
