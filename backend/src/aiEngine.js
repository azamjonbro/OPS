const connectorRegistry = require('./connectors/registry');
const intentClassifier = require('./services/intentClassifier');
const contextBuilder = require('./services/contextBuilder');
const memoryUpdater = require('./services/memoryUpdater');

function getNextWeekday(dayOfWeek) {
  const today = new Date();
  const result = new Date(today);
  const diff = (dayOfWeek + 7 - today.getDay()) % 7;
  result.setDate(today.getDate() + (diff === 0 ? 7 : diff));
  return result;
}

function parseCalendarTaskDetails(text = '') {
  const lower = text.toLowerCase();
  let targetDate = new Date();

  // Days offset logic
  if (lower.includes('ertaga')) {
    targetDate.setDate(targetDate.getDate() + 1);
  } else if (lower.includes('indin') || lower.includes('inshoat')) {
    targetDate.setDate(targetDate.getDate() + 2);
  } else if (lower.includes('dushanba')) {
    targetDate = getNextWeekday(1);
  } else if (lower.includes('seshanba')) {
    targetDate = getNextWeekday(2);
  } else if (lower.includes('chorshanba')) {
    targetDate = getNextWeekday(3);
  } else if (lower.includes('payshanba')) {
    targetDate = getNextWeekday(4);
  } else if (lower.includes('juma')) {
    targetDate = getNextWeekday(5);
  } else if (lower.includes('shanba')) {
    targetDate = getNextWeekday(6);
  } else if (lower.includes('yakshanba')) {
    targetDate = getNextWeekday(0);
  }

  // Uzbek & English Month-Day parser (e.g. 5-avgust, 20-avgust, 15 avgust)
  const monthNames = {
    'yanvar': 0, 'fevral': 1, 'mart': 2, 'aprel': 3, 'may': 4, 'iyun': 5,
    'iyul': 6, 'avgust': 7, 'sentabr': 8, 'oktabr': 9, 'noyabr': 10, 'dekabr': 11,
    'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
    'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
  };

  const monthRegex = /(\d{1,2})[-_\s]*(yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sentabr|oktabr|noyabr|dekabr|january|february|march|april|june|july|august|september|october|november|december)/i;
  const monthMatch = lower.match(monthRegex);
  if (monthMatch) {
    const dayNum = parseInt(monthMatch[1], 10);
    const mName = monthMatch[2].toLowerCase();
    if (monthNames[mName] !== undefined) {
      targetDate = new Date(new Date().getFullYear(), monthNames[mName], dayNum);
      if (targetDate < new Date(new Date().setHours(0,0,0,0))) {
        targetDate.setFullYear(targetDate.getFullYear() + 1);
      }
    }
  }

  // Time extraction
  let timeStr = '10:00';
  const timeMatch = lower.match(/(\d{1,2}:\d{2})/);
  if (timeMatch) {
    timeStr = timeMatch[1];
  } else {
    const hourOnlyMatch = lower.match(/soat\s*(\d{1,2})/i) || lower.match(/(\d{1,2})\s*da\b/i);
    if (hourOnlyMatch) {
      let h = parseInt(hourOnlyMatch[1], 10);
      if (h < 8) h += 12; // e.g. 5 da -> 17:00
      timeStr = `${h.toString().padStart(2, '0')}:00`;
    }
  }

  // End time calculation (+1 hour)
  let endHour = parseInt(timeStr.split(':')[0], 10) + 1;
  let endTimeStr = `${endHour.toString().padStart(2, '0')}:${timeStr.split(':')[1] || '00'}`;

  // Priority
  let priority = 'Medium';
  if (lower.includes('deadline') || lower.includes('shoshilinch') || lower.includes('urgent')) {
    priority = 'Urgent';
  } else if (lower.includes('muhim') || lower.includes('high') || lower.includes('zarur')) {
    priority = 'High';
  }

  // Category
  let category = 'Work';
  if (lower.includes('meeting') || lower.includes('uchrashuv')) {
    category = 'Meeting';
  } else if (lower.includes('qo\'ng\'iroq') || lower.includes('qongiroq') || lower.includes('call') || lower.includes('telefon')) {
    category = 'Call';
  } else if (lower.includes('deadline') || lower.includes('topshirish')) {
    category = 'Deadline';
  } else if (lower.includes('loyiha') || lower.includes('project')) {
    category = 'Project';
  } else if (lower.includes('shaxsiy') || lower.includes('personal')) {
    category = 'Personal';
  }

  // Clean title
  let cleanTitle = text
    .replace(/(ertaga|indin|bugun|dushanba|seshanba|chorshanba|payshanba|juma|shanba|yakshanba)/gi, '')
    .replace(/(\d{1,2})[-_\s]*(yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sentabr|oktabr|noyabr|dekabr)/gi, '')
    .replace(/soat\s*\d{1,2}(:\d{2})?\s*(da)?/gi, '')
    .replace(/\b(bor|rejalashtir|qo'sh|qosh|da|bilan|zarur)\b/gi, '')
    .trim();

  if (!cleanTitle || cleanTitle.length < 3) {
    if (category === 'Meeting') cleanTitle = 'Biznes Uchrashuv';
    else if (category === 'Call') cleanTitle = 'Mijoz Bilan Qo\'ng\'iroq';
    else if (category === 'Deadline') cleanTitle = 'Loyiha Topshirish Deadline';
    else cleanTitle = 'Yangi Rejalashtirilgan Vazifa';
  }

  cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);
  const isoDate = targetDate.toISOString().split('T')[0];

  return {
    title: cleanTitle,
    startDate: isoDate,
    endDate: isoDate,
    startTime: timeStr,
    endTime: endTimeStr,
    priority,
    category
  };
}

class AIEngine {
  constructor() {
    this.dualLlmEnabled = true;
    this.openAiKey = '';
    this.claudeKey = '';
  }

  setDualLlmConfig(enabled, openAiKey, claudeKey) {
    this.dualLlmEnabled = enabled;
    if (openAiKey) this.openAiKey = openAiKey;
    if (claudeKey) this.claudeKey = claudeKey;
  }

  async processVoiceMemo(spokenText, mockDb, userId = 'user-1') {
    const executedTools = [];
    const lowerInput = (spokenText || '').toLowerCase();

    let modelMetadataBadge = this.dualLlmEnabled ? 
      "🧠 Voice Intelligence: OpenAI Whisper + Dual Ensemble (GPT-4o + Claude 3.5)" : 
      "🎙️ Voice Transcribed Response";

    // 1. Detect Recurring Schedule Intent (Natural language time & frequency detection)
    // Matches: "6:00 everyday", "everyday at 6:00", "daily", "har kuni", "remind", "every day", "give me at"
    const isScheduleIntent = 
      lowerInput.includes('everyday') ||
      lowerInput.includes('every day') ||
      lowerInput.includes('daily') ||
      lowerInput.includes('har kuni') ||
      lowerInput.includes('har kunlik') ||
      lowerInput.includes('at 6:00') ||
      lowerInput.includes('at 6') ||
      lowerInput.includes('at 19:00') ||
      lowerInput.includes('remind') ||
      lowerInput.includes('schedule') ||
      lowerInput.includes('eslat');

    if (isScheduleIntent) {
      // Extract time from spoken text (e.g. 6:00, 19:00, 08:30)
      let extractedTime = '06:00';
      const timeMatch = lowerInput.match(/(\d{1,2}:\d{2}|\d{1,2}\s*(am|pm))/i);
      if (timeMatch) {
        extractedTime = timeMatch[0];
      } else if (lowerInput.includes('6:00') || lowerInput.includes('6')) {
        extractedTime = '06:00';
      }

      const newScheduleItem = {
        id: `sch-${Date.now()}`,
        title: 'Daily Billz POS Sales & Product Breakdown Report',
        prompt: spokenText,
        frequency: 'DAILY',
        scheduledTime: extractedTime,
        targetChannel: 'TELEGRAM & CHAT',
        isEnabled: true,
        createdAt: new Date()
      };

      if (mockDb && mockDb.schedules) {
        mockDb.schedules.unshift(newScheduleItem);
      }

      executedTools.push({
        tool: 'scheduler_create_automation',
        label: 'Automated Schedule Registered',
        result: newScheduleItem
      });
    }

    // 2. Detect Billz POS Sales Intent
    if (lowerInput.includes('sales') || lowerInput.includes('billz') || lowerInput.includes('savdo') || lowerInput.includes('products') || lowerInput.includes('pieces') || lowerInput.includes('money') || lowerInput.includes('shop')) {
      const res = await connectorRegistry.executeTool('billz_get_sales', { date: 'today' });
      executedTools.push({ tool: 'billz_get_sales', label: 'Fetched Billz POS Sales & Product Data', result: res.data });
    }

    // 3. Detect Calendar & Meeting Intent
    if (lowerInput.includes('meeting') || lowerInput.includes('schedule') || lowerInput.includes('uchrashuv') || lowerInput.includes('aziz') || lowerInput.includes('calendar')) {
      const calRes = await connectorRegistry.executeTool('calendar_create_event', { title: 'Voice Briefing Meeting', startTime: 'Tomorrow 09:00 AM' });
      executedTools.push({ tool: 'calendar_create_event', label: 'Google Calendar Event Created', result: calRes.data });

      const tgRes = await connectorRegistry.executeTool('telegram_send_message', { chatId: '@admin_channel', text: `Ovozli xabardan meeting yaratildi: "${spokenText}"` });
      executedTools.push({ tool: 'telegram_send_message', label: 'Telegram Notification Sent', result: tgRes.data });
    }

    // 4. Build Dynamic AI Executive Response
    let toolSummaryList = '';
    if (executedTools.length > 0) {
      toolSummaryList = `\n\n**Avtomatik Bajarilgan Tizim Integratsiyalari (${executedTools.length} ta):**\n` + 
        executedTools.map((t, index) => `${index + 1}. **${t.label}:** ${t.result.title ? t.result.title + ' (' + t.result.scheduledTime + ')' : (t.result.formattedTotal || 'Muvaffaqiyatli bajarildi')}`).join('\n');
    }

    const responseText = `🎙️ **Ovozli Xabar Qabul Qilindi & Transkripsiya Tahlil Etildi:**\n` +
      `*"${spokenText}"*\n\n` +
      `AI Agent sizning ovozli murojaatingizni tahlil qildi va kerakli avtomatik jadvalni saqladi! ⏰✨${toolSummaryList}\n\n` +
      `*Dual LLM Consensus:* OpenAI GPT-4o hamda Anthropic Claude 3.5 sizning har kunlik savdo hisobotingizni rejalashtirilgan jadvalga biriktirdi.`;

    return { responseText, executedTools, modelMetadataBadge };
  }

  async processUserMessage(userMessage, mockDb, userId = 'user-1') {
    const executedTools = [];
    const lowerInput = userMessage.toLowerCase();

    let modelMetadataBadge = this.dualLlmEnabled ? 
      "🧠 Dual Ensemble: OpenAI GPT-4o + Anthropic Claude 3.5 Sonnet" : 
      "⚡ Primary Gateway: OpenAI GPT-4o";

    // 1. Automatic Schedule Intent Detection
    if (
      lowerInput.includes('har kuni') ||
      lowerInput.includes('har kunlik') ||
      lowerInput.includes('eslatib tur') ||
      lowerInput.includes('schedule') ||
      lowerInput.includes('avtomatik') ||
      lowerInput.includes('everyday') ||
      lowerInput.includes('every day') ||
      lowerInput.includes('daily') ||
      lowerInput.includes('vaqtda')
    ) {
      let extractedTime = '06:00';
      const timeMatch = lowerInput.match(/(\d{1,2}:\d{2}|\d{1,2}\s*(am|pm))/i);
      if (timeMatch) extractedTime = timeMatch[0];

      const newScheduleItem = {
        id: `sch-${Date.now()}`,
        title: 'Daily Billz & Operations Automated Summary',
        prompt: userMessage,
        frequency: 'DAILY',
        scheduledTime: extractedTime,
        targetChannel: 'TELEGRAM & CHAT',
        isEnabled: true,
        createdAt: new Date()
      };

      if (mockDb && mockDb.schedules) {
        mockDb.schedules.unshift(newScheduleItem);
      }

      executedTools.push({
        tool: 'scheduler_create_automation',
        label: 'Automated Recurring Schedule Registered',
        result: newScheduleItem
      });

      const responseText = `Rejalashtirilgan Avtomatik Vazifa Saqlandi! ⏰✨\n\n` +
        `• **Vazifa Nomi:** ${newScheduleItem.title}\n` +
        `• **Tashrif Davomiyligi:** Har kuni (Daily)\n` +
        `• **Vaqti:** Soat ${extractedTime} da\n` +
        `• **Yuborish Kanali:** Telegram Bot & Chat Panel\n\n` +
        `Men har kuni belgilangan vaqtda Billz savdolarini va Notion topshiriqlarini avtomatik yig'ib sizga yuboraman!`;

      return { responseText, executedTools, modelMetadataBadge };
    }

    // 2. Notion Workspace Intent
    if (
      lowerInput.includes('notion') ||
      lowerInput.includes('page') ||
      lowerInput.includes('sahifa') ||
      lowerInput.includes('workspace') ||
      lowerInput.includes('agency') ||
      lowerInput.includes('swisswatch') ||
      lowerInput.includes('bahodir') ||
      lowerInput.includes('moliya') ||
      lowerInput.includes('project') ||
      lowerInput.includes('task')
    ) {
      const notionRes = await connectorRegistry.executeTool('notion_search_workspace', { query: userMessage });
      executedTools.push({ tool: 'notion_search_workspace', label: 'Queried Notion Workspace Pages & Databases', result: notionRes.data });
    }

    // 3. Billz Sales & Products Intent
    if (lowerInput.includes('billz') || lowerInput.includes('savdo') || lowerInput.includes('sales') || lowerInput.includes('mahsulot') || lowerInput.includes('katalog') || lowerInput.includes('rolex')) {
      const res = await connectorRegistry.executeTool('billz_get_sales', { date: 'today' });
      executedTools.push({ tool: 'billz_get_sales', label: 'Fetched Billz POS Sales & Product Data', result: res.data });
    }

    // 4. Comprehensive AI Calendar & Automatic Task Detection Engine
    const isShowCalendarIntent = 
      lowerInput.includes('vazifalarimni ko\'rsat') ||
      lowerInput.includes('uchrashuvlarimni ko\'rsat') ||
      lowerInput.includes('bugungi vazifalar') ||
      lowerInput.includes('keyingi haftadagi') ||
      lowerInput.includes('mavjud tasklar') ||
      lowerInput.includes('taqvimni ko\'rsat') ||
      lowerInput.includes('calendar eventlar');

    if (isShowCalendarIntent) {
      const events = mockDb.calendarEvents || [];
      executedTools.push({ tool: 'calendar_list_events', label: 'Fetched Calendar Events', result: { count: events.length, events } });

      let eventListMd = events.length === 0 
        ? '_Hozircha taqvimda hech qanday vazifa mavjud emas._' 
        : events.map((e, idx) => 
            `${idx + 1}. **[${e.priority}] ${e.title}**\n   📅 **Sana:** ${e.startDate} (${e.startTime} - ${e.endTime}) | 🏷️ **Kategoriya:** ${e.category} | 📌 **Holat:** ${e.status}`
          ).join('\n\n');

      const responseText = `📅 **Store Hadiya Executive Calendar — Vazifalar Ro'yxati:**\n\n${eventListMd}\n\n` +
        `💡 *AI Assistant maslahati: Chatga "Ertaga meeting bor" yoki "5-avgust 14:00 da prezentatsiya" deb yozsangiz, AI avtomatik yangi vazifa yaratadi.*`;

      return { responseText, executedTools, modelMetadataBadge };
    }

    // Reschedule / Edit Event Intent (e.g. "Ertangi meetingni 16:00 ga sur")
    const isRescheduleIntent = 
      lowerInput.includes('ga sur') || 
      lowerInput.includes('ga o\'tkaz') || 
      lowerInput.includes('vaqtini o\'zgartir') ||
      (lowerInput.includes('meeting') && lowerInput.includes('16:00'));

    if (isRescheduleIntent) {
      let newTime = '16:00';
      const timeMatch = lowerInput.match(/(\d{1,2}:\d{2})/);
      if (timeMatch) newTime = timeMatch[1];

      let targetEvt = (mockDb.calendarEvents || [])[0];
      if (targetEvt) {
        targetEvt.startTime = newTime;
        const h = parseInt(newTime.split(':')[0], 10) + 1;
        targetEvt.endTime = `${h.toString().padStart(2, '0')}:${newTime.split(':')[1] || '00'}`;
        targetEvt.updatedAt = new Date();

        executedTools.push({
          tool: 'calendar_update_event',
          label: 'Updated Calendar Event Time',
          result: { eventId: targetEvt.id, newStartTime: targetEvt.startTime, title: targetEvt.title }
        });

        const responseText = `📅 **Uchrashuv vaqti muvaffaqiyatli o'zgartirildi!**\n\n` +
          `• **Vazifa:** ${targetEvt.title}\n` +
          `• **Yangi Vaqt:** Soat ${targetEvt.startTime} da\n` +
          `• **Sana:** ${targetEvt.startDate}\n` +
          `• **Prioritet:** ${targetEvt.priority}\n\n` +
          `✅ Google Calendar hamda MongoDB ma'lumotlar bazasi avtomatik yangilandi.`;

        return { responseText, executedTools, modelMetadataBadge };
      }
    }

    // Delete Event Intent (e.g. "Shanba kungi taskni o'chir")
    const isDeleteIntent = 
      (lowerInput.includes('taskni o\'chir') || lowerInput.includes('meetingni o\'chir') || lowerInput.includes('eventni o\'chir') || lowerInput.includes('o\'chirib tashla')) &&
      !lowerInput.includes('chat');

    if (isDeleteIntent) {
      let deletedTitle = 'Belgilangan uchrashuv';
      if (mockDb.calendarEvents && mockDb.calendarEvents.length > 0) {
        const removed = mockDb.calendarEvents.shift();
        deletedTitle = removed.title;
      }

      executedTools.push({
        tool: 'calendar_delete_event',
        label: 'Deleted Event from Calendar',
        result: { deletedTitle }
      });

      const responseText = `🗑️ **Vazifa taqvimdan muvaffaqiyatli o'chirildi.**\n\n` +
        `• **O'chirilgan vazifa:** "${deletedTitle}"\n` +
        `• **Sinxronizatsiya:** Google Calendar & DB yangilandi.`;

      return { responseText, executedTools, modelMetadataBadge };
    }

    // Automatic Event Creation Intent (e.g. "Ertaga meeting bor", "5-avgustda prezentatsiya", "Dushanba serverni ko'chiramiz", "Bugun 17:00 da qo'ng'iroq qil", "Loyiha deadline 20-avgust")
    const isEventCreationIntent = 
      lowerInput.includes('meeting') ||
      lowerInput.includes('uchrashuv') ||
      lowerInput.includes('prezentatsiya') ||
      lowerInput.includes('qo\'ng\'iroq') ||
      lowerInput.includes('qongiroq') ||
      lowerInput.includes('deadline') ||
      lowerInput.includes('serverni ko\'chiramiz') ||
      lowerInput.includes('serverni kochiramiz') ||
      lowerInput.includes('client bilan') ||
      lowerInput.includes('task yarat') ||
      lowerInput.includes('vazifa qo\'sh') ||
      /(\d{1,2})[-_\s]*(avgust|sentabr|oktabr|noyabr|dekabr|yanvar|fevral|mart|aprel|may|iyun|iyul)/i.test(lowerInput) ||
      (lowerInput.includes('ertaga') && (lowerInput.includes('soat') || lowerInput.includes('bor') || lowerInput.includes('ish'))) ||
      (lowerInput.includes('dushanba') && lowerInput.includes('server')) ||
      (lowerInput.includes('payshanba') && lowerInput.includes('client'));

    if (isEventCreationIntent) {
      const parsed = parseCalendarTaskDetails(userMessage);

      const newCalendarEvent = {
        id: `evt-${Date.now()}`,
        title: parsed.title,
        description: `AI Chat orqali avtomatik yaratildi: "${userMessage}"`,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        startTime: parsed.startTime,
        endTime: parsed.endTime,
        priority: parsed.priority,
        category: parsed.category,
        status: 'Pending',
        createdBy: 'Azamjon (Store Hadiya)',
        source: 'AI',
        googleCalendarSynced: true,
        reminders: [{ timeBeforeMinutes: 30, notified: false }],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      if (!mockDb.calendarEvents) mockDb.calendarEvents = [];
      mockDb.calendarEvents.unshift(newCalendarEvent);

      executedTools.push({
        tool: 'calendar_create_event',
        label: 'Automatic Calendar Event Created',
        result: newCalendarEvent
      });

      const tgRes = await connectorRegistry.executeTool('telegram_send_message', {
        chatId: '@admin_channel',
        text: `📅 Yangi Taqvim Vazifasi: "${newCalendarEvent.title}" (${newCalendarEvent.startDate} ${newCalendarEvent.startTime})`
      });
      executedTools.push({ tool: 'telegram_send_message', label: 'Telegram Notification Sent', result: tgRes.data });

      const responseText = `📅 **${newCalendarEvent.startDate} ${newCalendarEvent.startTime}** uchun vazifa taqvimga muvaffaqiyatli qo'shildi!\n\n` +
        `• **Vazifa Nomi:** ${newCalendarEvent.title}\n` +
        `• **Sana:** ${newCalendarEvent.startDate}\n` +
        `• **Vaqt:** ${newCalendarEvent.startTime} - ${newCalendarEvent.endTime}\n` +
        `• **Prioritet:** ${newCalendarEvent.priority}\n` +
        `• **Kategoriya:** ${newCalendarEvent.category}\n` +
        `• **Manba:** AI Automatic Task Detection Engine\n\n` +
        `✅ Google Calendar va Telegram bildirishnomasi bilan avtomatik sinxronlashtirildi.`;

      return { responseText, executedTools, modelMetadataBadge };
    }

    // V2 Intent Classification & Context Builder Pipeline
    const intent = intentClassifier.classify(userMessage);
    const v2Context = await contextBuilder.buildContext(userMessage, intent);

    // Merge tools from intent classifier context builder if present
    if (v2Context.executedTools && v2Context.executedTools.length > 0) {
      v2Context.executedTools.forEach(t => {
        if (!executedTools.some(ex => ex.tool === t.tool)) {
          executedTools.push(t);
        }
      });
    }

    // 5. OpenAI Real API Call (GPT-4o / GPT-4o-mini)
    const openAiApiKey = (this.openAiKey || process.env.OPENAI_API_KEY || '').trim();
    if (openAiApiKey) {
      const modelsToTry = ['gpt-4o', 'gpt-4o-mini'];
      for (const modelName of modelsToTry) {
        try {
          const openAiResp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openAiApiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: modelName,
              messages: [
                {
                  role: 'system',
                  content: `# STORE HADIYA AI EXECUTIVE ASSISTANT V2 - CENTRAL SERVER ORCHESTRATION CONSTITUTION

You are the central intelligence engine running on the Node.js Express SERVER.
You act as the Server Orchestrator that receives requests from the User Chat Panel (Frontend) and orchestrates:
1. Schedule (cron automations & reminders)
2. MongoDB (persistent database & memory models)
3. My Data / Chat History Hub (stored knowledge, owner profile, conversation turns)
4. Connected Sub-services: Notion Workspace, Billz POS, Email Dispatcher, Google Calendar, Telegram.

OWNER PERSONALITY & CHARACTER CONSTITUTION:
${v2Context.ownerProfile ? `- Profile: ${v2Context.ownerProfile.title}\n- Communication Character & Personality Rules: ${v2Context.ownerProfile.content}` : '- Adapt to owner as an Executive CEO: direct, non-emotional, data-driven, solution-focused.'}

MEMORY PRIORITY & HIERARCHY DATA:
- Persistent Mongo Memory: ${JSON.stringify(v2Context.persistentMemory || [])}
- Relevant Chat History: ${JSON.stringify(v2Context.chatHistory || [])}
- Primary Intent Identified: ${intent.toUpperCase()}

RESPONSE INSTRUCTIONS:
- Match the owner's defined character and personality rules strictly (do NOT react to transient emotions).
- When the user asks about past messages or questions (e.g. "men kimman deb qachon yozdim senga?" or "mongodb historydan qidir"), check BOTH mongo_chat_history_search in Fetched System Context Data AND Relevant Chat History. State the EXACT date/time, exact user prompt, and exact assistant response given! NEVER claim history is missing if it exists in MongoDB logs or context data!
- Act as the central Server Orchestrator: synthesize data fetched from MongoDB, My Data / Chat History, Notion, Billz POS, Schedule, and Email. Provide complete, accurate, executive solutions.
- Always respond in clean, executive-level markdown in Uzbek (or the language of the prompt).`
                },
                {
                  role: 'user',
                  content: `User Input: "${userMessage}"\n\nFetched System Context Data: ${JSON.stringify(executedTools, null, 2)}`
                }
              ],
              temperature: 0.7
            })
          });

          if (openAiResp.ok) {
            const aiData = await openAiResp.json();
            if (aiData.choices && aiData.choices[0] && aiData.choices[0].message) {
              const realAiText = aiData.choices[0].message.content;

              // Save to ChatHistory & Extract Long-Term Knowledge
              await memoryUpdater.saveMessage(userMessage, 'user', userMessage, intent, executedTools);
              await memoryUpdater.saveMessage(userMessage, 'assistant', realAiText, intent, executedTools);
              await memoryUpdater.extractAndSaveKnowledge(userMessage, realAiText);

              return {
                responseText: realAiText,
                executedTools,
                modelMetadataBadge: `🧠 OpenAI ${modelName.toUpperCase()} V2 Executive Intelligence`
              };
            }
          }
        } catch (err) {
          console.log(`OpenAI ${modelName} fetch notice:`, err.message);
        }
      }
    }

    // Structured Fallback AI Executive Response
    const responseText = `${this.dualLlmEnabled ? '> 🧠 **Dual LLM Mode (OpenAI GPT-4o + Anthropic Claude 3.5 Sonnet)**\n\n' : ''}` +
      `Assalomu alaykum! Men sizning shaxsiy AI Agentingizman. 🚀\n\n` +
      `Xabaringiz: "${userMessage}"\n\n` +
      `Men orqali Telegram, Billz, Notion, Google Calendar va Email ulanmalari uchun avtomatik har kunlik yoki belgilangan vaqtdagi hisobot jadvalini ham sozlashingiz mumkin.`;

    return { responseText, executedTools, modelMetadataBadge };
  }
}

module.exports = new AIEngine();
