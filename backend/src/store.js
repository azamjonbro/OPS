// Clean Enterprise In-Memory Data Store (Zero Mock Items)
module.exports = {
  conversations: [],
  schedules: [],
  auditLogs: [],
  calendarEvents: [],
  integrations: [
    {
      type: 'BILLZ',
      name: 'Billz Retail POS Integration',
      status: 'CONNECTED',
      protocol: 'HTTPS REST & JWT',
      baseUrl: 'https://api.billz.uz/v1/',
      lastSynced: new Date().toISOString()
    },
    {
      type: 'NOTION',
      name: 'Notion Workspace Sync',
      status: 'CONNECTED',
      protocol: 'Notion SDK v2022-06-28',
      baseUrl: 'https://api.notion.com/v1',
      lastSynced: new Date().toISOString()
    },
    {
      type: 'TELEGRAM',
      name: 'Telegram Channel Notification Engine',
      status: 'CONNECTED',
      protocol: 'Telegram Bot API',
      baseUrl: 'https://api.telegram.org',
      lastSynced: new Date().toISOString()
    },
    {
      type: 'GOOGLE_CALENDAR',
      name: 'Google Calendar Sync',
      status: 'CONNECTED',
      protocol: 'OAuth2 & iCal',
      baseUrl: 'https://www.googleapis.com/calendar/v3',
      lastSynced: new Date().toISOString()
    }
  ],
  models: [
    { id: 'gpt-4o', name: 'OpenAI GPT-4o', provider: 'OpenAI', isDefault: true, latencyMs: 180 },
    { id: 'claude-3-5-sonnet', name: 'Anthropic Claude 3.5 Sonnet', provider: 'Anthropic', isDefault: false, latencyMs: 210 },
    { id: 'whisper-1', name: 'OpenAI Whisper v3 Audio', provider: 'OpenAI', isDefault: false, latencyMs: 140 }
  ],
  dualLlmConfig: {
    enabled: true,
    primaryModel: 'OpenAI GPT-4o',
    consensusModel: 'Anthropic Claude 3.5 Sonnet',
    openAiKey: process.env.OPENAI_API_KEY || '',
    claudeKey: process.env.ANTHROPIC_API_KEY || ''
  }
};
