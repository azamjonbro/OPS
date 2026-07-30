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

// Models (for startup cleanup if needed)
const Conversation = require('./models/Conversation');
const Schedule = require('./models/Schedule');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ai_workspace';

// Services
const billzSyncService = require('./services/billzSyncService');

// Connect to MongoDB
mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 2000 })
  .then(async () => {
    console.log('🍃 MongoDB connected successfully via Mongoose');
    try {
      await Promise.all([
        Conversation.deleteMany({ title: { $in: ['Daily Sales & Operations', 'Meeting Schedule & Notion', 'Test Chat'] } }),
        Schedule.deleteMany({ title: { $in: ['Daily Billz POS Sales Summary', 'Morning Meeting & Agenda Briefing'] } })
      ]);
    } catch (e) {}

    // Start Daily Automated Billz POS -> MongoDB Synchronization
    billzSyncService.startDailyCronJob();
  })
  .catch(() => {
    console.log('ℹ️ MongoDB URI offline - Operating with high-performance In-Memory DB Store');
    billzSyncService.startDailyCronJob();
  });

// Mount API Routers
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/calendar', calendarRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Node.js Express Backend (MVC Architecture) running on http://localhost:${PORT}`);
});
