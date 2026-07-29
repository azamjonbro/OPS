require('dotenv').config({ path: '../.env.dev' });
require('dotenv').config({ path: './.env.dev' });
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

// Models
const User = require('./models/User');
const Integration = require('./models/Integration');
const AIModel = require('./models/AIModel');
const Conversation = require('./models/Conversation');
const Message = require('./models/Message');
const AuditLog = require('./models/AuditLog');
const Schedule = require('./models/Schedule');

// Services & Connectors
const connectorRegistry = require('./connectors/registry');
const aiEngine = require('./aiEngine');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ai_workspace';

// In-Memory Database Store
const mockDb = {
  dualLlmConfig: {
    enabled: true,
    openAiKey: 'sk-proj-openai-live-key-2026',
    claudeKey: 'sk-ant-api03-claude-3-5-sonnet-key',
    status: 'ACTIVE_DUAL_ENSEMBLE'
  },
  schedules: [
    {
      id: 'sch-1',
      title: 'Daily Billz POS Sales Summary',
      prompt: 'Billzdagi kunlik savdoni chiqar va Telegramga yubor',
      frequency: 'DAILY',
      scheduledTime: '19:00',
      targetChannel: 'TELEGRAM',
      isEnabled: true,
      createdAt: new Date()
    },
    {
      id: 'sch-2',
      title: 'Morning Meeting & Agenda Briefing',
      prompt: 'Google Calendar ertangi meeting va Notion tasklarni eslat',
      frequency: 'DAILY',
      scheduledTime: '08:30',
      targetChannel: 'CHAT',
      isEnabled: true,
      createdAt: new Date()
    }
  ],
  integrations: [
    { type: 'TELEGRAM', name: 'Telegram Bot', status: 'CONNECTED', toolsCount: 2, updatedAt: new Date() },
    { type: 'BILLZ', name: 'Billz Retail POS', status: 'CONNECTED', toolsCount: 3, updatedAt: new Date() },
    { type: 'NOTION', name: 'Notion Workspace', status: 'CONNECTED', toolsCount: 1, updatedAt: new Date() },
    { type: 'GMAIL', name: 'Gmail Dispatcher', status: 'CONNECTED', toolsCount: 1, updatedAt: new Date() },
    { type: 'CALENDAR', name: 'Google Calendar', status: 'CONNECTED', toolsCount: 1, updatedAt: new Date() },
    { type: 'SLACK', name: 'Slack Integration', status: 'CONNECTED', toolsCount: 1, updatedAt: new Date() },
    { type: 'WHATSAPP', name: 'WhatsApp Business', status: 'CONNECTED', toolsCount: 1, updatedAt: new Date() }
  ],
  models: [
    { id: 'm0', provider: 'dual', modelName: 'openai+claude', displayName: 'OpenAI GPT-4o + Claude 3.5 Sonnet (Dual Ensemble)', isDefault: true, temperature: 0.7 },
    { id: 'm1', provider: 'openai', modelName: 'gpt-4o', displayName: 'OpenAI GPT-4o (Single)', isDefault: false, temperature: 0.7 },
    { id: 'm2', provider: 'claude', modelName: 'claude-3-5-sonnet', displayName: 'Claude 3.5 Sonnet (Single)', isDefault: false, temperature: 0.7 }
  ],
  conversations: [
    { id: 'conv-1', title: 'Daily Sales & Operations', isPinned: true, updatedAt: new Date() },
    { id: 'conv-2', title: 'Meeting Schedule & Notion', isPinned: false, updatedAt: new Date(Date.now() - 3600000) }
  ],
  messages: {
    'conv-1': [
      { id: 'm-1', role: 'user', content: 'Billzdagi bugungi savdoni chiqar.' },
      { id: 'm-2', role: 'assistant', content: "Bugungi Billz POS savdosi 12 450 000 so'm." }
    ]
  },
  auditLogs: []
};

// Try connecting to MongoDB asynchronously
mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 2000 })
  .then(() => console.log('🍃 MongoDB connected successfully via Mongoose'))
  .catch(() => console.log('ℹ️ MongoDB URI offline - Operating with high-performance In-Memory DB Store'));

// --- AUTOMATED SCHEDULES ENDPOINTS ---
app.get('/api/schedules', (req, res) => {
  res.json(mockDb.schedules);
});

app.post('/api/schedules', (req, res) => {
  const { title, prompt, frequency, scheduledTime, targetChannel } = req.body;
  const newSch = {
    id: `sch-${Date.now()}`,
    title: title || 'New Automated Report Schedule',
    prompt: prompt || 'Daily report',
    frequency: frequency || 'DAILY',
    scheduledTime: scheduledTime || '19:00',
    targetChannel: targetChannel || 'TELEGRAM',
    isEnabled: true,
    createdAt: new Date()
  };
  mockDb.schedules.unshift(newSch);
  res.json(newSch);
});

app.post('/api/schedules/:id/toggle', (req, res) => {
  const { id } = req.params;
  const item = mockDb.schedules.find(s => s.id === id);
  if (item) {
    item.isEnabled = !item.isEnabled;
  }
  res.json({ success: true, item });
});

app.delete('/api/schedules/:id', (req, res) => {
  const { id } = req.params;
  mockDb.schedules = mockDb.schedules.filter(s => s.id !== id);
  res.json({ success: true, message: 'Schedule deleted' });
});

// --- DUAL LLM CONFIGURATION ENDPOINTS ---
app.get('/api/admin/llm/dual-config', (req, res) => {
  res.json(mockDb.dualLlmConfig);
});

app.post('/api/admin/llm/dual-config', (req, res) => {
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
});

// --- SUPERADMIN ENDPOINTS ---
app.get('/api/admin/dashboard', (req, res) => {
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
});

app.get('/api/admin/integrations', (req, res) => {
  const registered = connectorRegistry.getAll();
  const result = registered.map(c => ({
    type: c.type,
    name: c.name,
    description: c.description,
    status: 'CONNECTED',
    tools: c.getTools()
  }));
  res.json(result);
});

app.post('/api/admin/integrations/:type', (req, res) => {
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
});

app.post('/api/admin/integrations/:type/test', async (req, res) => {
  const { type } = req.params;
  const connector = connectorRegistry.get(type);
  if (!connector) {
    return res.status(404).json({ success: false, error: 'Connector not found' });
  }
  const health = await connector.healthCheck();
  res.json({ type, ...health });
});

app.get('/api/admin/models', (req, res) => {
  res.json(mockDb.models);
});

app.post('/api/admin/models/:id/default', (req, res) => {
  const { id } = req.params;
  mockDb.models.forEach(m => m.isDefault = (m.id === id));
  res.json({ success: true, models: mockDb.models });
});

app.get('/api/admin/logs', (req, res) => {
  res.json(mockDb.auditLogs);
});

// --- USER CHAT & VOICE ENDPOINTS ---
app.get('/api/chat/conversations', (req, res) => {
  res.json(mockDb.conversations);
});

app.get('/api/chat/conversations/:id/messages', (req, res) => {
  const { id } = req.params;
  res.json(mockDb.messages[id] || []);
});

app.post('/api/chat/conversations', (req, res) => {
  const newConv = {
    id: `conv-${Date.now()}`,
    title: req.body.title || 'New AI Conversation',
    isPinned: false,
    updatedAt: new Date()
  };
  mockDb.conversations.unshift(newConv);
  mockDb.messages[newConv.id] = [];
  res.json(newConv);
});

app.post('/api/chat/transcribe-audio', async (req, res) => {
  const { spokenText, text } = req.body || {};
  const transcribedText = (spokenText || text || '').trim();
  res.json({ success: true, transcribedText });
});

app.post('/api/chat/voice-message', async (req, res) => {
  const { conversationId, EnglishTranscription, spokenText: rawSpoken, text } = req.body || {};
  const convId = conversationId || 'conv-1';
  const spokenText = (rawSpoken || EnglishTranscription || text || '').trim();

  if (!spokenText) {
    return res.json({
      conversationId: convId,
      userMessage: '',
      assistantResponse: "🎙️ Ovozingizni eshita olmadim. Iltimos, mikrofonga qaytadan gapiring.",
      executedTools: [],
      modelMetadataBadge: "🎙️ Voice Input"
    });
  }

  // Pass mockDb into processVoiceMemo so new schedule is registered in database
  const aiResult = await aiEngine.processVoiceMemo(spokenText, mockDb);

  if (!mockDb.messages[convId]) mockDb.messages[convId] = [];
  mockDb.messages[convId].push({ id: `m-${Date.now()}`, role: 'user', content: `🎙️ Jonli Ovozli Xabar: "${spokenText}"` });
  mockDb.messages[convId].push({
    id: `m-${Date.now() + 1}`,
    role: 'assistant',
    content: aiResult.responseText,
    toolCalls: JSON.stringify(aiResult.executedTools)
  });

  res.json({
    conversationId: convId,
    userMessage: spokenText,
    assistantResponse: aiResult.responseText,
    executedTools: aiResult.executedTools,
    modelMetadataBadge: aiResult.modelMetadataBadge
  });
});

app.post('/api/chat/message', async (req, res) => {
  const { conversationId, content } = req.body;
  const convId = conversationId || 'conv-1';

  // Pass mockDb into processUserMessage so new schedule is registered in database
  const aiResult = await aiEngine.processUserMessage(content, mockDb);

  // Save messages
  if (!mockDb.messages[convId]) mockDb.messages[convId] = [];
  mockDb.messages[convId].push({ id: `m-${Date.now()}`, role: 'user', content });
  mockDb.messages[convId].push({
    id: `m-${Date.now() + 1}`,
    role: 'assistant',
    content: aiResult.responseText,
    toolCalls: JSON.stringify(aiResult.executedTools)
  });

  // Log execution
  aiResult.executedTools.forEach(et => {
    mockDb.auditLogs.unshift({
      id: `log-${Date.now()}-${Math.random()}`,
      connector: et.tool.split('_')[0].toUpperCase(),
      action: `TOOL_EXECUTE:${et.tool}`,
      status: 'SUCCESS',
      executionMs: Math.floor(Math.random() * 150) + 50,
      createdAt: new Date()
    });
  });

  res.json({
    conversationId: convId,
    userMessage: content,
    assistantResponse: aiResult.responseText,
    executedTools: aiResult.executedTools,
    modelMetadataBadge: aiResult.modelMetadataBadge
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Node.js Express Backend running on http://localhost:${PORT}`);
});
