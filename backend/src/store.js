// Central Database & In-Memory Store
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

module.exports = mockDb;
