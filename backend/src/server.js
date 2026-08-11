const path = require("path");
const fs = require("fs");
const dns = require("dns");

// OPS NOTE (2026-08-08): on the production host, plain `curl` reliably reaches
// api.telegram.org over IPv6, but Node's own fetch (undici) intermittently fails outright
// ("fetch failed") against the exact same host at the exact same time — undici's Happy
// Eyeballs handling doesn't recover as gracefully as curl's on this network. Forcing IPv4
// first for all of Node's own DNS lookups sidesteps the flaky IPv6 path entirely.
dns.setDefaultResultOrder("ipv4first");

// Konfiguratsiya fayli: avval .env, topilmasa .env.dev.
// Loyihaning qolgan qismi (ENDPOINTS.md, connectors/registry.js) .env.dev dan o'qiydi,
// shuning uchun faqat .env ni qidirish serverni sababsiz ishga tushmaydigan qilib qo'yardi.
const ENV_CANDIDATES = [
  path.resolve(__dirname, "../../.env"),
  path.resolve(__dirname, "../../.env.dev"),
];
const envPath = ENV_CANDIDATES.find((p) => fs.existsSync(p));

if (envPath) {
  require("dotenv").config({ path: envPath });
}

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

// Routes
const chatRoutes = require("./routes/chatRoutes");
const adminRoutes = require("./routes/adminRoutes");
const scheduleRoutes = require("./routes/scheduleRoutes");
const calendarRoutes = require("./routes/calendarRoutes");
const taskRoutes = require("./routes/taskRoutes");
const mailRoutes = require("./routes/mailRoutes");
const telegramBusinessRoutes = require("./routes/telegramBusinessRoutes");
const telegramUserbotRoutes = require("./routes/telegramUserbotRoutes");
const authRoutes = require("./routes/authRoutes");
const requireAdmin = require("./middleware/requireAdmin");

// Models
const Conversation = require("./models/Conversation");
const Schedule = require("./models/Schedule");
const Integration = require("./models/Integration");
const AIModel = require("./models/AIModel");
const Settings = require("./models/Settings");

// Services
const billzSyncService = require("./services/billzSyncService");
const mailSyncService = require("./services/mailSyncService");
const telegramBusinessService = require("./services/telegramBusinessService");
const telegramUserbotService = require("./services/telegramUserbotService");
const billzAdminSessionService = require("./services/billzAdminSessionService");
const billzReportScheduler = require("./services/billzReportScheduler");
const adminAuthService = require("./services/adminAuthService");
const notionTaskSyncService = require("./services/notionTaskSyncService");
const connectorRegistry = require("./connectors/registry");

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ MONGO_URI topilmadi!");
  console.error("Qidirilgan fayllar:", ENV_CANDIDATES.join("  |  "));
  console.error("Topilgan fayl:", envPath || "(hech qaysi)");
  process.exit(1);
}

console.log(
  "📦 Mongo URI:",
  MONGO_URI.replace(/\/\/.*@/, "//****:****@")
);

// Seed baseline collections
async function seedInitialData() {
  const integrationCount = await Integration.countDocuments();

  if (integrationCount === 0) {
    await Integration.insertMany([
      {
        type: "BILLZ",
        name: "Billz Retail POS Integration",
        status: "CONNECTED",
      },
      {
        type: "NOTION",
        name: "Notion Workspace Sync",
        status: "CONNECTED",
      },
      {
        type: "TELEGRAM",
        name: "Telegram Channel Notification Engine",
        status: "CONNECTED",
      },
      {
        type: "CALENDAR",
        name: "Google Calendar Sync",
        status: "CONNECTED",
      },
    ]);
  }

  const modelCount = await AIModel.countDocuments();

  if (modelCount === 0) {
    await AIModel.insertMany([
      {
        provider: "OpenAI",
        modelName: "gpt-4o",
        displayName: "OpenAI GPT-4o",
        isDefault: true,
        latencyMs: 180,
      },
      {
        provider: "Anthropic",
        modelName: "claude-3-5-sonnet",
        displayName: "Anthropic Claude 3.5 Sonnet",
        isDefault: false,
        latencyMs: 210,
      },
      {
        provider: "OpenAI",
        modelName: "whisper-1",
        displayName: "OpenAI Whisper v3 Audio",
        isDefault: false,
        latencyMs: 140,
      },
    ]);
  }

  // The seed block above only runs on an empty collection, so an existing database
  // would never learn about MAIL. Its status follows the credentials in .env.dev.
  const emailService = require("./services/emailService");
  await Integration.findOneAndUpdate(
    { type: "MAIL" },
    {
      status: emailService.isConfigured() ? "CONNECTED" : "DISCONNECTED",
      updatedAt: new Date(),
      $setOnInsert: { name: "iCloud Mail (SMTP + IMAP)" },
    },
    { upsert: true }
  );

  await Settings.findOneAndUpdate(
    { key: "dual_llm" },
    {
      $setOnInsert: {
        enabled: true,
        primaryModel: "OpenAI GPT-4o",
        consensusModel: "Anthropic Claude 3.5 Sonnet",
      },
    },
    { upsert: true }
  );
}

// Mongo ulanish
async function startServer() {
  try {
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
    });

    console.log("🍃 MongoDB connected successfully");

    try {
      await Promise.all([
        Conversation.deleteMany({
          title: {
            $in: [
              "Daily Sales & Operations",
              "Meeting Schedule & Notion",
              "Test Chat",
            ],
          },
        }),
        Schedule.deleteMany({
          title: {
            $in: [
              "Daily Billz POS Sales Summary",
              "Morning Meeting & Agenda Briefing",
            ],
          },
        }),
      ]);

      await seedInitialData();
      await adminAuthService.seedDefaultAdmin();
    } catch (err) {
      console.error("Startup seed error:", err);
    }

    billzSyncService.startDailyCronJob();
    mailSyncService.startBackgroundSync();
    notionTaskSyncService.startBackgroundSync();
    await telegramBusinessService.loadFromDb();
    await telegramUserbotService.loadFromDb();
    telegramUserbotService.startDailyCronJob();
    await billzAdminSessionService.loadFromDb();
    billzReportScheduler.start();

    app.listen(PORT, () => {
      console.log(`🚀 Backend running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ MongoDB connection error");
    console.error(err);
    process.exit(1);
  }
}

startServer();

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/admin", requireAdmin, adminRoutes);
app.use("/api/schedules", scheduleRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/mail", mailRoutes);
app.use("/api/telegram", telegramBusinessRoutes);
app.use("/api/admin/telegram-userbot", requireAdmin, telegramUserbotRoutes);

// Billz
app.get("/api/integrations/billz/health", async (req, res) => {
  const billzConnector = connectorRegistry.get("BILLZ");
  const health = await billzConnector.checkHealth();
  res.json(health);
});

app.get("/api/integrations/billz/sales", async (req, res) => {
  const { date, daysCount, period } = req.query;

  const billzClient = require("./services/billzClientService");

  const salesData = await billzClient.getSales({
    date: date || "2026-05-25",
    daysCount: daysCount ? parseInt(daysCount, 10) : 0,
    label: period,
  });

  res.json(salesData);
});