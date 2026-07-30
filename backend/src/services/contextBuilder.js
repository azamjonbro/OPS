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

    // 1. Fetch Persistent Memory & Owner Profile from MongoDB (General + Targeted Search)
    try {
      const profile = await OwnerMemory.findOne({ key: 'owner-personality-profile' }).lean();
      if (profile) contextData.ownerProfile = profile;

      // Extract search term from quotes or prompt
      const match = userMessage.match(/"([^"]+)"/);
      const cleanTerm = match ? match[1] : userMessage.replace(/xotira hujjati.*/i, '').trim();

      let matchedMemories = [];
      if (cleanTerm && cleanTerm.length > 2) {
        matchedMemories = await OwnerMemory.find({
          key: { $ne: 'owner-personality-profile' },
          $or: [
            { title: { $regex: cleanTerm, $options: 'i' } },
            { content: { $regex: cleanTerm, $options: 'i' } }
          ]
        }).limit(5).lean();
      }

      if (matchedMemories.length > 0) {
        contextData.executedTools.push({
          tool: 'mongo_memory_search',
          label: 'Found Stored Knowledge in MongoDB Memory',
          result: { count: matchedMemories.length, items: matchedMemories }
        });
      }

      const allMemories = await OwnerMemory.find({ key: { $ne: 'owner-personality-profile' } }).sort({ updatedAt: -1 }).limit(15).lean();
      contextData.persistentMemory = allMemories.map(m => `[${m.category.toUpperCase()}] ${m.title}: ${m.content}`);
    } catch (e) {}

    // 2. MongoDB Deep Chat History Search & Turn Retrieval
    try {
      const historyQueryMatch = userMessage.match(/"([^"]+)"/) || userMessage.match(/(\bmen\b|\bkimman\b|\byozganman\b|\byozdim\b|\bjavob\b|\bsavol\b|\btarix\b|\bhistory\b|\beslaysanmi\b)/i);

      if (historyQueryMatch) {
        // Extract key phrase to search in ChatHistory (e.g. "men kimman")
        const quoteMatch = userMessage.match(/"([^"]+)"/);
        const searchPhrase = quoteMatch ? quoteMatch[1] : (userMessage.includes('men kimman') ? 'men kimman' : userMessage.split(/\s+/).slice(0, 3).join(' '));

        if (searchPhrase && searchPhrase.length > 2) {
          const matchedLogs = await ChatHistory.find({
            content: { $regex: searchPhrase, $options: 'i' }
          }).sort({ timestamp: -1 }).limit(10).lean();

          if (matchedLogs.length > 0) {
            // Fetch assistant replies that followed these user messages
            const enrichedHistory = [];
            for (const log of matchedLogs) {
              const reply = await ChatHistory.findOne({
                conversationId: log.conversationId,
                timestamp: { $gte: log.timestamp }
              }).sort({ timestamp: 1 }).lean();

              enrichedHistory.push({
                userPrompt: log.content,
                timestamp: log.timestamp,
                formattedDate: new Date(log.timestamp).toLocaleString(),
                assistantReply: reply ? reply.content : 'No reply found'
              });
            }

            contextData.executedTools.push({
              tool: 'mongo_chat_history_search',
              label: 'MongoDB Deep Chat History Search',
              result: { queryPhrase: searchPhrase, totalFound: enrichedHistory.length, historyRecords: enrichedHistory }
            });
          }
        }
      }

      // Fetch Recent Conversation Turns (User + Assistant)
      const recentLogs = await ChatHistory.find().sort({ timestamp: -1 }).limit(10).lean();
      contextData.chatHistory = recentLogs.reverse().map(h => `${h.role === 'user' ? 'User' : 'Assistant'} [${new Date(h.timestamp).toLocaleTimeString()}]: "${h.content}"`);
    } catch (e) {}

    // 3. Central Server Orchestration: Trigger Notion, Billz, Email, Schedule
    const textLower = userMessage.toLowerCase();

    // Notion Workspace Query (pages, projects, documents, tasks)
    const isNotionRelevant = intent === 'documentation' || intent === 'project' || textLower.includes('notion') || textLower.includes('sahifa') || textLower.includes('loyiha') || textLower.includes('hujjat') || textLower.includes('task') || textLower.includes('kitob') || textLower.includes('tahlil') || textLower.includes('ma\'lumot');
    if (isNotionRelevant) {
      const notionRes = await connectorRegistry.executeTool('notion_search_workspace', { query: userMessage });
      if (notionRes && notionRes.success) {
        contextData.executedTools.push({ tool: 'notion_search_workspace', label: 'Queried Notion Workspace Pages & Databases', result: notionRes.data });
      }
    }

    // Billz POS Live Data Query (sales, products, warehouse, stock, revenue)
    const isBillzRelevant = intent === 'sales' || intent === 'inventory' || textLower.includes('billz') || textLower.includes('savdo') || textLower.includes('ombor') || textLower.includes('mahsulot') || textLower.includes('tushum') || textLower.includes('tovar') || textLower.includes('hisobot') || textLower.includes('pos');
    if (isBillzRelevant) {
      const billzRes = await connectorRegistry.executeTool('billz_get_sales_report', {});
      if (billzRes && billzRes.success) {
        contextData.executedTools.push({ tool: 'billz_get_sales_report', label: 'Fetched Billz POS Sales & Product Data', result: billzRes.data });
      }
    }

    // Email Dispatcher Query (mail, email, pochta)
    if (textLower.includes('email') || textLower.includes('pochta') || textLower.includes('mail') || textLower.includes('xabar yubor')) {
      const emailRes = await connectorRegistry.executeTool('gmail_send_email', { to: 'admin@hadiya.uz', subject: 'Report Update', body: userMessage });
      if (emailRes && emailRes.success) {
        contextData.executedTools.push({ tool: 'gmail_send_email', label: 'Email Dispatcher Notification Status', result: emailRes.data });
      }
    }

    // Schedule / Calendar Query (meeting, schedule, reja, eslatma, avtomatlashtirish, taqvim, vazifa)
    if (intent === 'calendar' || textLower.includes('calendar') || textLower.includes('taqvim') || textLower.includes('meeting') || textLower.includes('eslat') || textLower.includes('reja') || textLower.includes('schedule') || textLower.includes('avtomat') || textLower.includes('vazifa') || textLower.includes('hisobot')) {
      const mongoose = require('mongoose');
      const CalendarEvent = require('../models/CalendarEvent');
      const mockDb = require('../store');

      let calendarEventsData = [];
      if (mongoose.connection.readyState === 1) {
        try {
          const dbEvts = await CalendarEvent.find().sort({ startDate: 1, startTime: 1 }).limit(10).lean();
          if (dbEvts && dbEvts.length > 0) {
            calendarEventsData = dbEvts.map(e => ({
              title: e.title,
              startDate: e.startDate ? new Date(e.startDate).toISOString().split('T')[0] : '',
              startTime: e.startTime,
              endTime: e.endTime,
              priority: e.priority,
              category: e.category,
              status: e.status
            }));
          }
        } catch (e) {}
      }

      if (calendarEventsData.length === 0 && mockDb.calendarEvents) {
        calendarEventsData = mockDb.calendarEvents;
      }

      contextData.executedTools.push({
        tool: 'calendar_list_events',
        label: 'Fetched Calendar Events from MongoDB',
        result: { count: calendarEventsData.length, events: calendarEventsData }
      });
    }

    return contextData;
  }
}

module.exports = new ContextBuilder();
