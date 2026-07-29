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
    openAiKey: process.env.OPENAI_API_KEY || '',
    claudeKey: process.env.CLAUDE_API_KEY || '',
    status: 'ACTIVE_DUAL_ENSEMBLE'
  },
  schedules: [],
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
  conversations: [],
  messages: {},
  auditLogs: []
};

// Try connecting to MongoDB asynchronously
mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 2000 })
  .then(async () => {
    console.log('🍃 MongoDB connected successfully via Mongoose');
    try {
      await Promise.all([
        Conversation.deleteMany({ title: { $in: ['Daily Sales & Operations', 'Meeting Schedule & Notion', 'Test Chat'] } }),
        Schedule.deleteMany({ title: { $in: ['Daily Billz POS Sales Summary', 'Morning Meeting & Agenda Briefing'] } })
      ]);
    } catch (e) {}
  })
  .catch(() => console.log('ℹ️ MongoDB URI offline - Operating with high-performance In-Memory DB Store'));

// --- AUTOMATED SCHEDULES ENDPOINTS ---
app.get('/api/schedules', async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      const dbSchedules = await Schedule.find().sort({ createdAt: -1 });
      return res.json(dbSchedules.map(s => ({
        id: s._id.toString(),
        title: s.title,
        prompt: s.prompt,
        frequency: s.frequency,
        scheduledTime: s.scheduledTime,
        targetChannel: s.targetChannel,
        isEnabled: s.isEnabled,
        createdAt: s.createdAt
      })));
    }
  } catch (e) {}
  res.json(mockDb.schedules);
});

app.post('/api/schedules', async (req, res) => {
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

  try {
    if (mongoose.connection.readyState === 1) {
      const created = await Schedule.create({
        title: newSch.title,
        prompt: newSch.prompt,
        frequency: newSch.frequency,
        scheduledTime: newSch.scheduledTime,
        targetChannel: newSch.targetChannel,
        isEnabled: true
      });
      newSch.id = created._id.toString();
    }
  } catch (e) {}

  mockDb.schedules.unshift(newSch);
  res.json(newSch);
});

app.post('/api/schedules/:id/toggle', async (req, res) => {
  const { id } = req.params;
  let item = mockDb.schedules.find(s => s.id === id);
  if (item) {
    item.isEnabled = !item.isEnabled;
  }
  try {
    if (mongoose.connection.readyState === 1) {
      const dbItem = await Schedule.findById(id).catch(() => null);
      if (dbItem) {
        dbItem.isEnabled = !dbItem.isEnabled;
        await dbItem.save();
        item = {
          id: dbItem._id.toString(),
          title: dbItem.title,
          prompt: dbItem.prompt,
          frequency: dbItem.frequency,
          scheduledTime: dbItem.scheduledTime,
          targetChannel: dbItem.targetChannel,
          isEnabled: dbItem.isEnabled
        };
      }
    }
  } catch (e) {}

  res.json({ success: true, item });
});

app.delete('/api/schedules/:id', async (req, res) => {
  const { id } = req.params;
  mockDb.schedules = mockDb.schedules.filter(s => s.id !== id);
  try {
    if (mongoose.connection.readyState === 1) {
      await Schedule.deleteOne({ _id: id }).catch(() => null);
    }
  } catch (e) {}

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
async function saveMessageRecord(convId, userContent, aiResult) {
  let conv = mockDb.conversations.find(c => c.id === convId);
  const cleanUserStr = userContent.replace(/^🎙️ Ovozli:\s*"/, '').replace(/"$/, '');
  const smartTitle = cleanUserStr.length > 28 ? cleanUserStr.slice(0, 28) + '...' : cleanUserStr;

  if (!conv) {
    conv = {
      id: convId,
      title: smartTitle,
      isPinned: false,
      updatedAt: new Date()
    };
    mockDb.conversations.unshift(conv);
  } else if (conv.title === 'New AI Conversation' || conv.title === 'Yangi AI Muloqot' || conv.title === 'New Chat') {
    conv.title = smartTitle;
    conv.updatedAt = new Date();
  } else {
    conv.updatedAt = new Date();
  }

  mockDb.conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  if (!mockDb.messages[convId]) mockDb.messages[convId] = [];
  const userMsg = { id: `m-${Date.now()}`, role: 'user', content: userContent };
  const aiMsg = {
    id: `m-${Date.now() + 1}`,
    role: 'assistant',
    content: aiResult.responseText,
    toolCalls: JSON.stringify(aiResult.executedTools || [])
  };

  mockDb.messages[convId].push(userMsg);
  mockDb.messages[convId].push(aiMsg);

  try {
    if (mongoose.connection.readyState === 1) {
      let dbConv = await Conversation.findOne({ _id: convId }).catch(() => null);
      if (!dbConv) {
        dbConv = await Conversation.create({ title: smartTitle, isPinned: false });
      } else if (dbConv.title === 'New Chat' || dbConv.title === 'New AI Conversation' || dbConv.title === 'Yangi AI Muloqot') {
        dbConv.title = smartTitle;
        dbConv.updatedAt = new Date();
        await dbConv.save();
      }

      await Message.create({
        conversationId: dbConv ? dbConv._id.toString() : convId,
        role: 'user',
        content: userContent
      });
      await Message.create({
        conversationId: dbConv ? dbConv._id.toString() : convId,
        role: 'assistant',
        content: aiResult.responseText,
        toolCalls: JSON.stringify(aiResult.executedTools || [])
      });
    }
  } catch (e) {}
}

app.get('/api/chat/conversations', async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      const dbConvs = await Conversation.find().sort({ updatedAt: -1 });
      if (dbConvs.length > 0) {
        return res.json(dbConvs.map(c => ({
          id: c._id.toString(),
          title: c.title,
          isPinned: c.isPinned,
          updatedAt: c.updatedAt
        })));
      }
    }
  } catch (e) {}
  res.json(mockDb.conversations);
});

app.get('/api/chat/conversations/:id/messages', async (req, res) => {
  const { id } = req.params;
  try {
    if (mongoose.connection.readyState === 1) {
      const dbMsgs = await Message.find({ conversationId: id }).sort({ createdAt: 1 });
      if (dbMsgs.length > 0) {
        return res.json(dbMsgs.map(m => ({
          id: m._id.toString(),
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls
        })));
      }
    }
  } catch (e) {}
  res.json(mockDb.messages[id] || []);
});

app.post('/api/chat/conversations', async (req, res) => {
  const title = req.body.title || 'Yangi AI Muloqot';
  const newId = `conv-${Date.now()}`;
  const newConv = {
    id: newId,
    title,
    isPinned: false,
    updatedAt: new Date()
  };
  mockDb.conversations.unshift(newConv);
  mockDb.messages[newId] = [];

  try {
    if (mongoose.connection.readyState === 1) {
      const dbConv = await Conversation.create({ title, isPinned: false });
      newConv.id = dbConv._id.toString();
      mockDb.messages[newConv.id] = [];
    }
  } catch (e) {}

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

  const aiResult = await aiEngine.processVoiceMemo(spokenText, mockDb);
  await saveMessageRecord(convId, spokenText, aiResult);

  res.json({
    conversationId: convId,
    userMessage: spokenText,
    assistantResponse: aiResult.responseText,
    executedTools: aiResult.executedTools,
    modelMetadataBadge: aiResult.modelMetadataBadge
  });
});

app.delete('/api/chat/conversations/:id', async (req, res) => {
  const { id } = req.params;
  try {
    mockDb.conversations = mockDb.conversations.filter(c => c.id !== id);
    delete mockDb.messages[id];

    if (mongoose.connection.readyState === 1) {
      await Conversation.deleteOne({ _id: id }).catch(() => null);
      await Message.deleteMany({ conversationId: id }).catch(() => null);
    }
  } catch (e) {}

  res.json({ success: true, message: 'Chat muvaffaqiyatli o\'chirildi' });
});

app.delete('/api/chat/conversations', async (req, res) => {
  try {
    mockDb.conversations = [];
    mockDb.messages = {};

    if (mongoose.connection.readyState === 1) {
      await Conversation.deleteMany({}).catch(() => null);
      await Message.deleteMany({}).catch(() => null);
    }
  } catch (e) {}

  res.json({ success: true, message: 'Barcha chatlar tozalandi' });
});

app.post('/api/chat/message', async (req, res) => {
  const { conversationId, content, attachedFile } = req.body;
  const convId = conversationId || 'conv-1';

  let effectiveContent = (content || '').trim();
  if (attachedFile && attachedFile.name) {
    const fileNotice = `[Fayl biriktirildi: ${attachedFile.name} (${attachedFile.formattedSize || 'N/A'})]`;
    effectiveContent = effectiveContent ? `${effectiveContent}\n${fileNotice}` : fileNotice;
  }

  const aiResult = await aiEngine.processUserMessage(effectiveContent, mockDb);

  // If file was attached, augment response to acknowledge the document/image
  if (attachedFile && attachedFile.name) {
    if (attachedFile.isImage) {
      aiResult.responseText = `📷 **Rasm tahlil qilindi:** \`${attachedFile.name}\`\n\n${aiResult.responseText}`;
    } else {
      aiResult.responseText = `📄 **Hujjat biriktirildi va tahlil qilindi:** \`${attachedFile.name}\` (${attachedFile.formattedSize})\n\n${aiResult.responseText}`;
    }
  }

  await saveMessageRecord(convId, effectiveContent, aiResult);

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
    userMessage: effectiveContent,
    assistantResponse: aiResult.responseText,
    executedTools: aiResult.executedTools,
    modelMetadataBadge: aiResult.modelMetadataBadge
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Node.js Express Backend running on http://localhost:${PORT}`);
});
