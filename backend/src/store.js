// Central Database & In-Memory Store
const mockDb = {
  dualLlmConfig: {
    enabled: true,
    openAiKey: process.env.OPENAI_API_KEY || 'sk-proj-openai-live-key-2026',
    claudeKey: process.env.CLAUDE_API_KEY || 'sk-ant-api03-claude-3-5-sonnet-key',
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
  auditLogs: [],
  calendarEvents: [
    {
      id: 'evt-1',
      title: 'Store Hadiya POS Inventory & Sales Audit',
      description: 'Haftalik POS kassa va inventarizatsiya natijalarini Billz integratsiyasi orqali audit qilish.',
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
      startTime: '10:00',
      endTime: '11:30',
      priority: 'High',
      category: 'Work',
      status: 'In Progress',
      createdBy: 'Azamjon (Store Hadiya)',
      source: 'AI',
      googleCalendarSynced: true,
      reminders: [{ timeBeforeMinutes: 30, notified: false }],
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: 'evt-2',
      title: 'Client Presentation & SwissWatch Strategy',
      description: 'Mijozlar bilan yangi sotuv va CRM strategiyasi bo\'yicha taqdimot va kelishuv.',
      startDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
      endDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
      startTime: '14:00',
      endTime: '15:30',
      priority: 'Urgent',
      category: 'Meeting',
      status: 'Pending',
      createdBy: 'Azamjon (Store Hadiya)',
      source: 'AI',
      googleCalendarSynced: true,
      reminders: [{ timeBeforeMinutes: 60, notified: false }],
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: 'evt-3',
      title: 'Server Infra & Database Migration',
      description: 'Backend MongoDB klasterini va Node.js server nusxalarini yangilash.',
      startDate: new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0],
      endDate: new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0],
      startTime: '17:00',
      endTime: '18:30',
      priority: 'High',
      category: 'Deadline',
      status: 'Pending',
      createdBy: 'Azamjon (Store Hadiya)',
      source: 'AI',
      googleCalendarSynced: false,
      reminders: [{ timeBeforeMinutes: 30, notified: false }],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ]
};

module.exports = mockDb;
