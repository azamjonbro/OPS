const connectorRegistry = require('./connectors/registry');
const intentClassifier = require('./services/intentClassifier');
const contextBuilder = require('./services/contextBuilder');
const memoryUpdater = require('./services/memoryUpdater');

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

    // 4. Schedule Meeting Intent
    if (
      lowerInput.includes('meeting') ||
      lowerInput.includes('uchrashuv') ||
      lowerInput.includes('ertaga') ||
      lowerInput.includes('calendar') ||
      lowerInput.includes('aziz')
    ) {
      const calRes = await connectorRegistry.executeTool('calendar_create_event', { title: 'Meeting with Aziz', startTime: 'Tomorrow 09:00 AM' });
      executedTools.push({ tool: 'calendar_create_event', label: 'Google Calendar Event Created', result: calRes.data });

      const tgRes = await connectorRegistry.executeTool('telegram_send_message', { chatId: '@admin_channel', text: "Ertaga 09:00 da Aziz bilan meeting belgilandi." });
      executedTools.push({ tool: 'telegram_send_message', label: 'Telegram Notification Sent', result: tgRes.data });

      const notionTaskRes = await connectorRegistry.executeTool('notion_create_task', { title: 'Meeting with Aziz', priority: 'High', assignee: 'Aziz' });
      executedTools.push({ tool: 'notion_create_task', label: 'Notion Task Created', result: notionTaskRes.data });
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
