const OwnerMemory = require('../models/ownerMemoryModel');
const ChatHistory = require('../models/chatHistoryModel');
const connectorRegistry = require('../connectors/registry');

const MONTH_INDEX = {
  yanvar: 0, fevral: 1, mart: 2, aprel: 3, may: 4, iyun: 5,
  iyul: 6, avgust: 7, sentabr: 8, sentyabr: 8, oktabr: 9, oktyabr: 9,
  noyabr: 10, dekabr: 11
};

// toISOString() shifts to UTC, which reports the wrong day for any local time before
// 05:00 in UTC+5 (Tashkent). Build the key from local parts instead.
function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

class ContextBuilder {
  async buildContext(userMessage, intent, onProgress = () => {}) {
    const contextData = {
      intent,
      persistentMemory: [],
      chatHistory: [],
      executedTools: [],
      ownerProfile: null
    };

    // Runs a connector tool while reporting start/finish to the caller (SSE stream or noop).
    const runTool = async (tool, params, label) => {
      onProgress({ phase: 'tool:start', tool, label });
      const startedAt = Date.now();
      const res = await connectorRegistry.executeTool(tool, params);
      onProgress({ phase: 'tool:done', tool, label, ms: Date.now() - startedAt, ok: !!(res && res.success) });
      return res;
    };

    onProgress({ phase: 'memory', label: 'MongoDB xotira va profil o\'qilmoqda' });

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
            // Fetch the assistant reply that followed each matched user message (in parallel, not N+1)
            const enrichedHistory = await Promise.all(matchedLogs.map(async (log) => {
              const reply = await ChatHistory.findOne({
                conversationId: log.conversationId,
                timestamp: { $gte: log.timestamp }
              }).sort({ timestamp: 1 }).lean();

              return {
                userPrompt: log.content,
                timestamp: log.timestamp,
                formattedDate: new Date(log.timestamp).toLocaleString(),
                assistantReply: reply ? reply.content : 'No reply found'
              };
            }));

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
    const isEmailRelevant = textLower.includes('email') || textLower.includes('pochta') || textLower.includes('mail') || textLower.includes('xabar yubor');
    const dateOpts = isBillzRelevant ? this.parseUzbekDateOptions(userMessage) : null;

    // Every relevant integration is independent, so fan them out instead of awaiting one at a time.
    const plannedCalls = [];

    if (isNotionRelevant) {
      const searchQuery = isRecentQuery || textLower.includes('space') || textLower.includes('haqimda')
        ? ''
        : this.extractNotionQuery(userMessage);
      plannedCalls.push({
        tool: 'notion_search_workspace',
        params: { query: searchQuery },
        label: isRecentQuery ? 'Queried Notion Workspace Recent Additions & Pages' : 'Queried Notion Workspace Pages & Databases (Personal Space, Focus & Businesses)'
      });
    }

    if (isBillzRelevant) {
      plannedCalls.push({
        tool: 'billz_get_sales',
        params: dateOpts,
        label: `Direct Live Store Hadiya Billz POS Sales Summary (${dateOpts.label || dateOpts.date})`
      });
      plannedCalls.push({
        tool: 'billz_get_products',
        params: { limit: 100 },
        label: 'Direct Live Store Hadiya Billz POS Products Catalog'
      });
    }

    if (isEmailRelevant) {
      plannedCalls.push({
        tool: 'gmail_send_email',
        params: { to: 'admin@hadiya.uz', subject: 'Report Update', body: userMessage },
        label: 'Email Dispatcher Notification Status'
      });
    }

    const settled = await Promise.all(
      plannedCalls.map(call => runTool(call.tool, call.params, call.label).catch(() => null))
    );

    settled.forEach((res, i) => {
      if (res && res.success) {
        contextData.executedTools.push({ tool: plannedCalls[i].tool, label: plannedCalls[i].label, result: res.data });
      }
    });

    // Schedule / Calendar Query (meeting, schedule, reja, eslatma, avtomatlashtirish, taqvim, vazifa)
    if (isCalendarRelevant) {
      const CalendarEvent = require('../models/CalendarEvent');
      onProgress({ phase: 'tool:start', tool: 'calendar_list_events', label: 'Taqvim vazifalari o\'qilmoqda' });

      let calendarEventsData = [];
      try {
        const dbEvts = await CalendarEvent.find().sort({ startDate: 1, startTime: 1 }).limit(10).lean();
        calendarEventsData = dbEvts.map(e => ({
          title: e.title,
          startDate: e.startDate ? new Date(e.startDate).toISOString().split('T')[0] : '',
          startTime: e.startTime,
          endTime: e.endTime,
          priority: e.priority,
          category: e.category,
          status: e.status
        }));
      } catch (e) {}

      onProgress({ phase: 'tool:done', tool: 'calendar_list_events', label: 'Taqvim vazifalari o\'qilmoqda', ok: true });
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

  /**
   * Turns a free-form Uzbek phrase into a Billz query window, the way a person reading
   * the sentence would: a named day wins over a relative one, and a relative one wins
   * over a bare period word.
   *
   * Returns either { date } for a single day or { daysCount, label } for a range.
   */
  parseUzbekDateOptions(text) {
    if (!text) return { daysCount: 30, label: 'Oxirgi 30 kunlik savdolar' };

    // Normalise the several apostrophes Uzbek gets typed with (o'/oʻ/o‘/o`).
    const lower = String(text).toLowerCase().replace(/[ʻ‘’`´]/g, "'");

    // --- 1. Explicit calendar dates win outright ---
    const isoMatch = lower.match(/\b(20\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/);
    if (isoMatch) return { date: `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}` };

    // "25-may", "25 -chi may", "5 avgust 2025"
    const dayMonthMatch = lower.match(
      /\b(\d{1,2})[-_\s]*(?:chi|inchi|nchi)?[-_\s]*(yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sentabr|sentyabr|oktabr|oktyabr|noyabr|dekabr)\b(?:[-_\s]*(20\d{2}))?/
    );
    if (dayMonthMatch) {
      const day = parseInt(dayMonthMatch[1], 10);
      const month = MONTH_INDEX[dayMonthMatch[2]];
      if (month !== undefined && day >= 1 && day <= 31) {
        const today = startOfDay(new Date());
        let year = dayMonthMatch[3] ? parseInt(dayMonthMatch[3], 10) : today.getFullYear();
        let target = new Date(year, month, day);
        // No explicit year and the date is still ahead of us: they meant last year's
        // occurrence, because you cannot report on sales that have not happened yet.
        if (!dayMonthMatch[3] && target > today) {
          target = new Date(year - 1, month, day);
        }
        return { date: toDateKey(target) };
      }
    }

    // --- 2. Relative single days ---
    const dayOffsets = [
      [/\b(bugun|bugungi|today)\b/, 0, 'Bugungi savdolar'],
      [/\b(kecha|kechagi|kechan?gi|yesterday)\b/, -1, 'Kechagi savdolar'],
      [/\b(avvalgi\s*kun|olding?i\s*kun)\b/, -2, "Ikki kun oldingi savdolar"]
    ];
    for (const [re, offset] of dayOffsets) {
      if (re.test(lower)) {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return { date: toDateKey(d) };
      }
    }

    // --- 3. Explicit numeric ranges ---
    const dayNumMatch = lower.match(/\b(\d{1,3})\s*(?:ta\s*)?kun(?:lik|da|gi)?\b/);
    if (dayNumMatch) {
      const days = parseInt(dayNumMatch[1], 10);
      if (days > 0) return { daysCount: days, label: `Oxirgi ${days} kunlik savdolar` };
    }

    const weekNumMatch = lower.match(/\b(\d{1,2})\s*(?:ta\s*)?hafta(?:lik|da|gi)?\b/);
    if (weekNumMatch) {
      const weeks = parseInt(weekNumMatch[1], 10);
      if (weeks > 0) {
        const days = weeks * 7;
        return { daysCount: days, label: `Oxirgi ${weeks} haftalik (${days} kunlik) savdolar` };
      }
    }

    const monthNumMatch = lower.match(/\b(\d{1,2})\s*(?:ta\s*)?oy(?:lik|da|gi)?\b/);
    if (monthNumMatch) {
      const months = parseInt(monthNumMatch[1], 10);
      if (months > 0) {
        const days = months * 30;
        return { daysCount: days, label: `Oxirgi ${months} oylik (${days} kunlik) savdolar` };
      }
    }

    // --- 4. Bare period words. Anchored with \b so that "qo'shib qo'y" no longer
    // matches "oy" and silently turns a calendar request into a 30-day sales report. ---
    if (/\b(shu|bu|joriy|o'tgan|otgan|so'nggi|songgi|oxirgi)?\s*hafta(lik|da|gi)?\b/.test(lower)) {
      return { daysCount: 7, label: 'Oxirgi 1 haftalik (7 kunlik) savdolar' };
    }

    if (/\b(shu|bu|joriy)\s*oy(lik|da|gi)?\b/.test(lower)) {
      const now = new Date();
      return { daysCount: now.getDate(), label: `Shu oyning boshidan beri (${now.getDate()} kun) savdolar` };
    }

    if (/\b(o'tgan|otgan|so'nggi|songgi|oxirgi)?\s*oy(lik|da|gi)?\b/.test(lower)) {
      return { daysCount: 30, label: 'Oxirgi 1 oylik (30 kunlik) savdolar' };
    }

    if (/\b(yil|yillik|year)\b/.test(lower)) {
      return { daysCount: 365, label: 'Oxirgi 1 yillik (365 kunlik) savdolar' };
    }

    return { daysCount: 30, label: 'Oxirgi 30 kunlik savdolar' };
  }
}

module.exports = new ContextBuilder();
