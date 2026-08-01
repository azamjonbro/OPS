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

    // Billz POS Direct Live API Query (checked first so Notion fallback below can exclude it)
    const isBillzRelevant = intent === 'sales' || intent === 'inventory' || textLower.includes('billz') || textLower.includes('bills') || textLower.includes('savdo') || textLower.includes('ombor') || textLower.includes('mahsulot') || textLower.includes('tushum') || textLower.includes('tovar') || textLower.includes('hisobot') || textLower.includes('pos') || textLower.includes('sotuv') || textLower.includes('kassada') || textLower.includes('kassa') || textLower.includes('hafta') || textLower.includes('oy') || textLower.includes('report');

    // Calendar / Schedule intent (checked here only to exclude it from the Notion fallback below)
    const isCalendarRelevant = intent === 'calendar' || textLower.includes('calendar') || textLower.includes('taqvim') || textLower.includes('meeting') || textLower.includes('eslat') || textLower.includes('reja') || textLower.includes('schedule') || textLower.includes('avtomat') || textLower.includes('vazifa');

    // Notion Workspace Query (pages, projects, documents, tasks, space, owner profile, focus, interests, recent updates)
    const isRecentQuery = textLower.includes('kecha') || textLower.includes('kechag') || textLower.includes('kiritilgan') || textLower.includes('qoshimcha') || textLower.includes('yangilik');
    const hasExplicitNotionKeyword = intent === 'documentation' || intent === 'project' || textLower.includes('notion') || textLower.includes('sahifa') || textLower.includes('loyiha') || textLower.includes('hujjat') || textLower.includes('task') || textLower.includes('kitob') || textLower.includes('tahlil') || textLower.includes('ma\'lumot') || textLower.includes('haqimda') || textLower.includes('shaxsiy') || textLower.includes('biznes') || textLower.includes('focus') || textLower.includes('fokus') || textLower.includes('space') || textLower.includes('qiziqish') || textLower.includes('harakat') || textLower.includes('nazorat') || textLower.includes('profil') || isRecentQuery;

    // Fallback: any substantive query that isn't clearly Billz/Calendar related is treated as
    // a Notion workspace lookup (e.g. "hodim olish", "mijozlar ro'yxati" etc. have no fixed keyword match).
    const isGenericLookup = !isBillzRelevant && !isCalendarRelevant && userMessage.trim().split(/\s+/).length >= 2;

    const isNotionRelevant = hasExplicitNotionKeyword || isGenericLookup;
    if (isNotionRelevant) {
      const searchQuery = isRecentQuery || textLower.includes('space') || textLower.includes('haqimda')
        ? ''
        : this.extractNotionQuery(userMessage);
      const notionRes = await connectorRegistry.executeTool('notion_search_workspace', { query: searchQuery });
      if (notionRes && notionRes.success) {
        contextData.executedTools.push({
          tool: 'notion_search_workspace',
          label: isRecentQuery ? 'Queried Notion Workspace Recent Additions & Pages' : 'Queried Notion Workspace Pages & Databases (Personal Space, Focus & Businesses)',
          result: notionRes.data
        });
      }
    }

    if (isBillzRelevant) {
      const dateOpts = this.parseUzbekDateOptions(userMessage);
      const salesRes = await connectorRegistry.executeTool('billz_get_sales', dateOpts);
      if (salesRes && salesRes.success) {
        contextData.executedTools.push({
          tool: 'billz_get_sales',
          label: `Direct Live Store Hadiya Billz POS Sales Summary (${dateOpts.label || dateOpts.date})`,
          result: salesRes.data
        });
      }

      const prodRes = await connectorRegistry.executeTool('billz_get_products', { limit: 100 });
      if (prodRes && prodRes.success) {
        contextData.executedTools.push({
          tool: 'billz_get_products',
          label: 'Direct Live Store Hadiya Billz POS Products Catalog',
          result: prodRes.data
        });
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
    if (isCalendarRelevant) {
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

  // Strips conversational filler so Notion's title/content search gets a clean keyword
  // phrase instead of a whole sentence (e.g. "men hozir hodim olish deb qidirsam" -> "hodim olish")
  extractNotionQuery(text = '') {
    const fillerWords = new Set([
      'men', 'menga', 'hozir', 'iltimos', 'deb', 'topib', 'ber', 'bering', 'berasan',
      'chiqar', 'chiqarib', 'korsat', "ko'rsat", 'korsatib', "ko'rsatib", 'qidir', 'qidirsam',
      'qidiraman', 'qidiryapman', 'izla', 'izlayapman', 'izlab', 'haqida', 'haqimda',
      'malumot', "ma'lumot", 'malumotlarni', "ma'lumotlarni", 'olib', 'kel', 'kelib',
      'bor', 'bormi', 'kerak', 'uchun', 'nima', 'qanaqa', 'qanday', 'notiondan', 'notionga',
      'notion', 'workspace', 'ichidan', 'topilsin', 'top'
    ]);

    const cleaned = text
      .split(/\s+/)
      .filter(word => !fillerWords.has(word.toLowerCase().replace(/["'.,!?]/g, '')))
      .join(' ')
      .trim();

    return cleaned.length > 1 ? cleaned : text;
  }

  parseUzbekDateOptions(text) {
    if (!text) return { date: '2026-07-30' };
    const lower = text.toLowerCase();

    // Check for N weeks (7 haftalik / 7 hafta / 2 haftalik / haftalik):
    const weekNumMatch = lower.match(/(\d{1,2})\s*hafta/i);
    if (weekNumMatch) {
      const weeks = parseInt(weekNumMatch[1], 10);
      const days = weeks * 7;
      return { daysCount: days, label: `Oxirgi ${weeks} haftalik (${days} kunlik) savdolar` };
    }

    if (lower.includes('haftalik') || lower.includes('1 hafta') || lower.includes('hafta')) {
      return { daysCount: 7, label: 'Oxirgi 1 haftalik (7 kunlik) savdolar' };
    }

    // Check for N months (1 oylik / 3 oylik / oylik):
    const monthNumMatch = lower.match(/(\d{1,2})\s*oy/i);
    if (monthNumMatch) {
      const months = parseInt(monthNumMatch[1], 10);
      const days = months * 30;
      return { daysCount: days, label: `Oxirgi ${months} oylik (${days} kunlik) savdolar` };
    }

    if (lower.includes('oylik') || lower.includes('1 oy') || lower.includes('oy')) {
      return { daysCount: 30, label: 'Oxirgi 1 oylik (30 kunlik) savdolar' };
    }

    const dayNumMatch = lower.match(/(\d{1,2})\s*kun/i);
    if (dayNumMatch) {
      const days = parseInt(dayNumMatch[1], 10);
      return { daysCount: days, label: `Oxirgi ${days} kunlik savdolar` };
    }

    const isoMatch = lower.match(/\b(20\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/);
    if (isoMatch) return { date: isoMatch[0] };

    const monthsMap = {
      'yanvar': '01', 'fevral': '02', 'mart': '03', 'aprel': '04',
      'may': '05', 'iyun': '06', 'iyul': '07', 'avgust': '08',
      'sentabr': '09', 'oktabr': '10', 'noyabr': '11', 'dekabr': '12'
    };

    // Allows the Uzbek ordinal suffix "-chi" between the day number and month (e.g. "25 -chi may")
    const dayMonthMatch = lower.match(/(\d{1,2})[-_\s]*(?:chi[-_\s]*)?(yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sentabr|oktabr|noyabr|dekabr)/i);
    if (dayMonthMatch) {
      const day = dayMonthMatch[1].padStart(2, '0');
      const month = monthsMap[dayMonthMatch[2].toLowerCase()];
      return { date: `2026-${month}-${day}` };
    }

    if (lower.includes('bugun') || lower.includes('today')) {
      return { date: new Date().toISOString().split('T')[0] };
    }

    if (lower.includes('kecha') || lower.includes('yesterday')) {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return { date: d.toISOString().split('T')[0] };
    }

    return { daysCount: 30, label: 'Oxirgi Billz POS ma\'lumotlari' };
  }
}

module.exports = new ContextBuilder();
