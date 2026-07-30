const OwnerMemory = require('../models/ownerMemoryModel');
const ChatHistory = require('../models/chatHistoryModel');
const connectorRegistry = require('../connectors/registry');

class ContextBuilder {
  async buildContext(userMessage, intent) {
    const contextData = {
      intent,
      persistentMemory: [],
      chatHistory: [],
      executedTools: [],
      ownerProfile: null
    };

    // 1. Fetch Persistent Memory & Owner Profile from MongoDB
    try {
      const profile = await OwnerMemory.findOne({ key: 'owner-personality-profile' }).lean();
      if (profile) contextData.ownerProfile = profile;
      const memories = await OwnerMemory.find({ key: { $ne: 'owner-personality-profile' } }).limit(10).lean();
      contextData.persistentMemory = memories.map(m => `[${m.category.toUpperCase()}] ${m.title}: ${m.content}`);
    } catch (e) {}

    // 2. Fetch Relevant Chat History from MongoDB
    try {
      const history = await ChatHistory.find({ role: 'user' }).sort({ timestamp: -1 }).limit(5).lean();
      contextData.chatHistory = history.map(h => `User: "${h.content}"`);
    } catch (e) {}

    // 3. Trigger Tool Connectors Based on Intent
    if (intent === 'sales' || intent === 'inventory') {
      const billzRes = await connectorRegistry.executeTool('billz_get_sales_report', {});
      if (billzRes && billzRes.success) {
        contextData.executedTools.push({ tool: 'billz_get_sales_report', label: 'Billz Sales Data', result: billzRes.data });
      }
    } else if (intent === 'documentation' || intent === 'project') {
      const notionRes = await connectorRegistry.executeTool('notion_search_workspace', { query: userMessage });
      if (notionRes && notionRes.success) {
        contextData.executedTools.push({ tool: 'notion_search_workspace', label: 'Notion Workspace Data', result: notionRes.data });
      }
    } else if (intent === 'calendar') {
      const calRes = await connectorRegistry.executeTool('google_calendar_list_events', {});
      if (calRes && calRes.success) {
        contextData.executedTools.push({ tool: 'google_calendar_list_events', label: 'Calendar Events', result: calRes.data });
      }
    }

    return contextData;
  }
}

module.exports = new ContextBuilder();
