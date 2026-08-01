require('dotenv').config({ path: '../.env.dev' });
require('dotenv').config({ path: './.env.dev' });
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

// Routes
const chatRoutes = require('./routes/chatRoutes');
const adminRoutes = require('./routes/adminRoutes');
const scheduleRoutes = require('./routes/scheduleRoutes');
const calendarRoutes = require('./routes/calendarRoutes');

// Models (for startup cleanup / seeding)
const Conversation = require('./models/Conversation');
const Schedule = require('./models/Schedule');
const Integration = require('./models/Integration');
const AIModel = require('./models/AIModel');
const Settings = require('./models/Settings');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ai_workspace';

// Services
const billzSyncService = require('./services/billzSyncService');

// Seed baseline collections on first boot (only runs if the collection is empty)
async function seedInitialData() {
  const integrationCount = await Integration.countDocuments();
  if (integrationCount === 0) {
    await Integration.insertMany([
      { type: 'BILLZ', name: 'Billz Retail POS Integration', status: 'CONNECTED' },
      { type: 'NOTION', name: 'Notion Workspace Sync', status: 'CONNECTED' },
      { type: 'TELEGRAM', name: 'Telegram Channel Notification Engine', status: 'CONNECTED' },
      { type: 'CALENDAR', name: 'Google Calendar Sync', status: 'CONNECTED' }
    ]);
  }

  const modelCount = await AIModel.countDocuments();
  if (modelCount === 0) {
    await AIModel.insertMany([
      { provider: 'OpenAI', modelName: 'gpt-4o', displayName: 'OpenAI GPT-4o', isDefault: true, latencyMs: 180 },
      { provider: 'Anthropic', modelName: 'claude-3-5-sonnet', displayName: 'Anthropic Claude 3.5 Sonnet', isDefault: false, latencyMs: 210 },
      { provider: 'OpenAI', modelName: 'whisper-1', displayName: 'OpenAI Whisper v3 Audio', isDefault: false, latencyMs: 140 }
    ]);
  }

  await Settings.findOneAndUpdate(
    { key: 'dual_llm' },
    { $setOnInsert: { enabled: true, primaryModel: 'OpenAI GPT-4o', consensusModel: 'Anthropic Claude 3.5 Sonnet' } },
    { upsert: true }
  );
}

// Connect to MongoDB
mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 2000 })
  .then(async () => {
    console.log('🍃 MongoDB connected successfully via Mongoose');
    try {
      await Promise.all([
        Conversation.deleteMany({ title: { $in: ['Daily Sales & Operations', 'Meeting Schedule & Notion', 'Test Chat'] } }),
        Schedule.deleteMany({ title: { $in: ['Daily Billz POS Sales Summary', 'Morning Meeting & Agenda Briefing'] } })
      ]);
      await seedInitialData();
    } catch (e) {
      console.error('Startup seed error:', e.message);
    }

    // Start Daily Automated Billz POS -> MongoDB Synchronization
    billzSyncService.startDailyCronJob();
  })
  .catch((err) => {
    console.error('🔴 MongoDB connection failed:', err.message);
    billzSyncService.startDailyCronJob();
  });

// Mount API Routers
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/calendar', calendarRoutes);
// Billz Integration Endpoints
const connectorRegistry = require('./connectors/registry');
app.get('/api/integrations/billz/health', async (req, res) => {
  const billzConnector = connectorRegistry.get('BILLZ');
  const health = await billzConnector.checkHealth();
  res.json(health);
});

app.get('/api/integrations/billz/sales', async (req, res) => {
  const { date, daysCount, period } = req.query;
  const billzClient = require('./services/billzClientService');
  const salesData = await billzClient.getSales({ date: date || '2026-05-25', daysCount: daysCount ? parseInt(daysCount, 10) : 0, label: period });
  res.json(salesData);
});

app.listen(PORT, () => {
  console.log(`🚀 Node.js Express Backend (MVC Architecture) running on http://localhost:${PORT}`);
});
