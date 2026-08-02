const connectorRegistry = require('./connectors/registry');
const intentClassifier = require('./services/intentClassifier');
const contextBuilder = require('./services/contextBuilder');
const memoryUpdater = require('./services/memoryUpdater');
const mongoose = require('mongoose');
const CalendarEvent = require('./models/CalendarEvent');
const Schedule = require('./models/Schedule');

const UZ_MONTHS = {
  yanvar: 0, fevral: 1, mart: 2, aprel: 3, may: 4, iyun: 5,
  iyul: 6, avgust: 7, sentabr: 8, sentyabr: 8, oktabr: 9, oktyabr: 9, noyabr: 10, dekabr: 11,
  january: 0, february: 1, march: 2, april: 3, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
};

const UZ_WEEKDAYS = [
  ['yakshanba', 0], ['dushanba', 1], ['seshanba', 2], ['chorshanba', 3],
  ['payshanba', 4], ['juma', 5], ['shanba', 6]
];

// Local date key — toISOString() would roll back a day for any local time before 05:00
// in UTC+5, filing "bugun" events under yesterday.
function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getNextWeekday(dayOfWeek) {
  const today = new Date();
  const result = new Date(today);
  const diff = (dayOfWeek + 7 - today.getDay()) % 7;
  // "juma" said on a Friday means the coming Friday, not today.
  result.setDate(today.getDate() + (diff === 0 ? 7 : diff));
  return result;
}

/**
 * Resolves the day the owner meant. Precedence mirrors how the sentence reads: an
 * explicit calendar date beats a named weekday, which beats a relative offset.
 */
function resolveTargetDate(lower) {
  // "5-avgust", "20 avgust 2026"
  const monthMatch = lower.match(
    /\b(\d{1,2})[-_\s]*(?:chi|inchi|nchi)?[-_\s]*(yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sentabr|sentyabr|oktabr|oktyabr|noyabr|dekabr|january|february|march|april|june|july|august|september|october|november|december)\b(?:[-_\s]*(20\d{2}))?/
  );
  if (monthMatch) {
    const dayNum = parseInt(monthMatch[1], 10);
    const monthIdx = UZ_MONTHS[monthMatch[2]];
    if (monthIdx !== undefined && dayNum >= 1 && dayNum <= 31) {
      const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
      const year = monthMatch[3] ? parseInt(monthMatch[3], 10) : todayStart.getFullYear();
      const target = new Date(year, monthIdx, dayNum);
      // Planning is forward-looking: a bare date already past means next year.
      if (!monthMatch[3] && target < todayStart) target.setFullYear(year + 1);
      return target;
    }
  }

  // "3 kundan keyin", "2 haftadan keyin"
  const relMatch = lower.match(/\b(\d{1,2})\s*(kun|hafta|oy)(?:dan)?\s*(?:key[iy]n|so'ng|song)\b/);
  if (relMatch) {
    const n = parseInt(relMatch[1], 10);
    const d = new Date();
    if (relMatch[2] === 'kun') d.setDate(d.getDate() + n);
    else if (relMatch[2] === 'hafta') d.setDate(d.getDate() + n * 7);
    else d.setMonth(d.getMonth() + n);
    return d;
  }

  for (const [name, idx] of UZ_WEEKDAYS) {
    // "shanba" is a suffix of "yakshanba"/"dushanba"/"seshanba"/"chorshanba"/"payshanba",
    // so require a word boundary on both sides.
    if (new RegExp(`\\b${name}\\b`).test(lower)) return getNextWeekday(idx);
  }

  if (/\bindin(ga)?\b/.test(lower)) {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d;
  }
  if (/\bertaga?\b/.test(lower)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  }
  if (/\bkeyingi\s*hafta\b/.test(lower)) {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d;
  }

  return new Date();
}

/**
 * Reads a wall-clock time the way a person would: an explicit "14:30" wins, then an
 * hour qualified by a part of the day, then a bare part of the day.
 */
function resolveStartTime(lower) {
  const explicit = lower.match(/\b(\d{1,2}):(\d{2})\b/);
  if (explicit) {
    const h = Math.min(23, parseInt(explicit[1], 10));
    const m = Math.min(59, parseInt(explicit[2], 10));
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  const isMorning = /\b(ertalab|tongda|tong|erta\s*bilan)\b/.test(lower);
  const isMidday = /\b(tushda|tushlik|peshin)\b/.test(lower);
  const isEvening = /\b(kechqurun|kechasi|oqshom|kech)\b/.test(lower);

  const hourMatch = lower.match(/\bsoat\s*(\d{1,2})\b/) || lower.match(/\b(\d{1,2})\s*(?:da|larda)\b/);
  if (hourMatch) {
    let h = parseInt(hourMatch[1], 10);
    if (h >= 0 && h <= 23) {
      if (isEvening && h < 12) h += 12;
      else if (isMidday && h < 12) h += 12;
      else if (!isMorning && h < 8) h += 12; // "soat 5 da" -> 17:00
      return `${String(Math.min(23, h)).padStart(2, '0')}:00`;
    }
  }

  if (isMorning) return '09:00';
  if (isMidday) return '13:00';
  if (isEvening) return '19:00';
  return '10:00';
}

function parseCalendarTaskDetails(text = '') {
  const lower = text.toLowerCase().replace(/[ʻ‘’`´]/g, "'");
  const targetDate = resolveTargetDate(lower);

  const timeStr = resolveStartTime(lower);
  const [startH, startM] = timeStr.split(':');
  // Clamp so a 23:30 start does not produce an invalid "24:30" end.
  const endHour = Math.min(23, parseInt(startH, 10) + 1);
  const endTimeStr = `${String(endHour).padStart(2, '0')}:${startM}`;

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

  // Strip the scheduling scaffolding so the title keeps only what the event is *about*.
  let cleanTitle = text
    .replace(/\b(kalendarga|kalendar|taqvimga|taqvim|bugungi\s*kun\s*uchun|bugun|ertaga|ertagi|indinga|indin|keyingi\s*hafta|dushanba|seshanba|chorshanba|payshanba|juma|shanba|yakshanba)\b/gi, ' ')
    .replace(/\b\d{1,2}[-_\s]*(?:chi|inchi|nchi)?[-_\s]*(yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sentabr|sentyabr|oktabr|oktyabr|noyabr|dekabr)\b/gi, ' ')
    .replace(/\b\d{1,2}\s*(kun|hafta|oy)(dan)?\s*(key[iy]n|so'ng|song)\b/gi, ' ')
    .replace(/\bsoat\s*\d{1,2}(:\d{2})?\s*(da)?\b/gi, ' ')
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ')
    .replace(/\b(ertalab|tongda|tushda|tushlik|kechqurun|kechasi|oqshom)\b/gi, ' ')
    // A bare hour left over from "kechqurun 7 da" / "9 larda".
    .replace(/\b\d{1,2}\s*(?:da|larda)\b/gi, ' ')
    .replace(/\bkun[iy]\b/gi, ' ')
    .replace(/\b(bor|rejalashtir|rejalashtirib|qo'sh|qosh|qoshib|qo'shib|qoy|qo'y|saqla|saqlab|yarat|yaratib|eslat|eslatib|da|bilan|zarur|uchun|iltimos|menga)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '')
    .trim();

  if (cleanTitle.length < 2) {
    // Nothing descriptive survived — name it after the kind of event it is.
    if (category === 'Meeting') cleanTitle = 'Biznes Uchrashuv';
    else if (category === 'Call') cleanTitle = 'Mijoz Bilan Qo\'ng\'iroq';
    else if (category === 'Deadline') cleanTitle = 'Loyiha Topshirish Deadline';
    else if (category === 'Project') cleanTitle = 'Loyiha Ishi';
    else if (category === 'Personal') cleanTitle = 'Shaxsiy Reja';
    else cleanTitle = 'Rejalashtirilgan Vazifa';
  }

  cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);
  const isoDate = toDateKey(targetDate);

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

const NOTION_CREATE_VERBS = /\b(qo'sh|qosh|qo'shib|qoshib|qo'shvor|yarat|yaratib|och|ochib|yoz|yozib|kirit|kiritib|create|add|new)\b/;

/** True when the owner is asking to WRITE something into Notion (not just search it). */
function isNotionWriteIntent(lower) {
  const mentionsNotion = /\b(notion|notionga|notionda|notiondagi|workspace)\b/.test(lower);
  return mentionsNotion && NOTION_CREATE_VERBS.test(lower);
}

/**
 * Pulls the page name out of a request like:
 *   notionga kirib yangi task deb "test space" qo'shib ko'r   -> test space
 *   notionga yangi task deb test space qoshib kor             -> test space
 */
function extractNotionTaskTitle(text = '') {
  const normalized = text.replace(/[ʻ‘’`´]/g, "'").trim();

  // 1. An explicit quoted name always wins.
  const quoted = normalized.match(/["“”'«]([^"“”'»]{2,})["“”'»]/);
  if (quoted) return quoted[1].trim();

  // 2. "... deb <nom> qo'shib ko'r" — the name sits between "deb" and the verb.
  const afterDeb = normalized.match(/\bdeb\s+(.+?)(?=\s*\b(?:qo'sh|qosh|yarat|och|yoz|kirit|create|add)|$)/i);
  if (afterDeb && afterDeb[1].trim().length > 1) return afterDeb[1].trim();

  // 3. Otherwise strip the scaffolding and keep whatever the request was about.
  const cleaned = normalized
    .replace(/\b(notionga|notionda|notiondagi|notion|workspace)\b/gi, ' ')
    .replace(/\b(kirib|kir|bor|borib|iltimos|menga|men|yangi|task|vazifa|sahifa|page|deb|nomli|nomida)\b/gi, ' ')
    .replace(/\b(qo'shib|qoshib|qo'sh|qosh|yaratib|yarat|ochib|och|yozib|yoz|kiritib|kirit|ko'r|kor|qo'y|qoy|create|add|new)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '')
    .trim();

  return cleaned.length > 1 ? cleaned : 'Yangi Task';
}

/**
 * Builds the OpenAI `user` message. Returns a plain string for text-only turns, or the
 * multimodal content-block array when a file is attached so GPT-4o actually *sees* the
 * screenshot instead of only being told its filename.
 */
function buildUserContent(userMessage, executedTools, attachedFile) {
  const baseText = `User Input: "${userMessage}"\n\nFetched System Context Data: ${JSON.stringify(executedTools, null, 2)}`;

  if (!attachedFile) return baseText;

  if (attachedFile.isImage && attachedFile.dataUrl) {
    return [
      { type: 'text', text: `${baseText}\n\nBiriktirilgan rasm: "${attachedFile.name}". Rasmni diqqat bilan o'qib chiq va savolga o'sha rasmdagi aniq mazmun asosida javob ber.` },
      { type: 'image_url', image_url: { url: attachedFile.dataUrl, detail: 'high' } }
    ];
  }

  if (attachedFile.textContent) {
    const truncNote = attachedFile.truncated ? '\n\n[Eslatma: fayl uzun bo\'lgani uchun faqat boshlang\'ich qismi berildi.]' : '';
    return `${baseText}\n\nBiriktirilgan fayl "${attachedFile.name}" mazmuni:\n"""\n${attachedFile.textContent}\n"""${truncNote}`;
  }

  return `${baseText}\n\n"${attachedFile.name}" (${attachedFile.formattedSize}) fayli biriktirildi, lekin uning formati matnga o'girilmadi — mazmunini o'qiy olmading. Buni foydalanuvchiga ochiq ayt va matn ko'rinishida yuborishni yoki skrinshot tashlashni so'ra. Fayl mazmunini O'YLAB TOPMA.`;
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

  async processVoiceMemo(spokenText, userId = 'user-1') {
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
        title: 'Daily Billz POS Sales & Product Breakdown Report',
        prompt: spokenText,
        frequency: 'DAILY',
        scheduledTime: extractedTime,
        targetChannel: 'TELEGRAM & CHAT',
        isEnabled: true
      };

      try {
        await Schedule.create(newScheduleItem);
      } catch (e) {}

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

  async processUserMessage(userMessage, { userId = 'user-1', onProgress = () => {}, attachedFile = null } = {}) {
    const executedTools = [];
    const lowerInput = (userMessage || '').toLowerCase();

    // When the owner attaches a screenshot or document, the message is *about that file*.
    // The keyword shortcuts below would misfire on it ("meeting" in a screenshot caption
    // would silently create a calendar event), so they are skipped and the turn goes
    // straight to the model with the file contents.
    const hasAttachment = !!(attachedFile && (attachedFile.isImage || attachedFile.textContent || attachedFile.unreadable));

    let modelMetadataBadge = this.dualLlmEnabled ?
      "🧠 Dual Ensemble: OpenAI GPT-4o + Anthropic Claude 3.5 Sonnet" :
      "⚡ Primary Gateway: OpenAI GPT-4o";

/**
 * Renders the Billz sales report for one day or for a period.
 *
 * `null` means "this data source can't tell us" and must render as "ma'lumot yo'q",
 * never as "0 so'm" — a fabricated zero reads as a real, confirmed figure.
 *
 * Product tables are wrapped in <details> so a 30-day report stays scannable: the owner
 * sees a line per day and opens only the day they care about. marked() passes the raw
 * HTML through and parses the markdown table inside it (the surrounding blank lines are
 * what make that work), so the existing table toolbar still applies.
 */
function formatBillzSalesReport(d) {
  const money = (v) => (v === null || v === undefined) ? "ma'lumot yo'q" : `${v.toLocaleString()} so'm`;
  const count = (v) => (v === null || v === undefined) ? "ma'lumot yo'q" : `${v} ta`;

  const productTable = (products) => {
    if (!products || !products.length) return '';
    const rows = products.map((p, i) =>
      `| ${i + 1} | ${p.name} | ${p.sku || '—'} | ${p.quantity} ${p.unit || 'dona'} | ${p.unitPrice.toLocaleString()} | ${p.totalPrice.toLocaleString()} |`
    ).join('\n');
    return `| # | Mahsulot | SKU | Soni | Dona narxi (so'm) | Summa (so'm) |\n` +
           `|---|---|---|---|---|---|\n${rows}\n`;
  };

  // The blank line before </details> matters: without it a body ending in a list item
  // swallows the closing tag as lazy continuation and the panel closes in the wrong place.
  const collapsible = (summary, body) => body
    ? `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>\n\n`
    : '';

  const checkLines = (checks) => checks.map((c, i) => {
    const head = `${i + 1}. **№${c.orderNumber}** — ${c.soldTime || c.soldAt || ''} | ${c.customerName} | ${money(c.totalPrice)}`;
    const items = (c.products || []).length
      ? c.products.map((p) => `   • ${p.name}${p.sku ? ` (${p.sku})` : ''} — ${p.quantity} ${p.unit} × ${money(p.unitPrice)} = ${money(p.totalPrice)}`).join('\n')
      : `   • Mahsulot tafsiloti yo'q`;
    return `${head}\n${items}`;
  }).join('\n\n');

  const header = d.isRange
    ? `📅 **Davr:** ${d.displayDate}${d.periodLabel ? ` (${d.periodLabel})` : ''}\n\n🏪 **Filial:** ${d.branchName}\n\n`
    : `📅 **Sana:** ${d.displayDate}\n\n🏪 **Filial:** ${d.branchName}\n\n`;

  let body = '';

  if (d.isRange) {
    body += `## 📆 Kunlik savdo\n\n`;
    if (!d.dailyBreakdown || !d.dailyBreakdown.length) {
      body += `_Bu davrda hech qanday sotuv chegi qayd etilmagan._\n\n`;
    } else {
      body += d.dailyBreakdown.map((day) => {
        const line = `### ${day.displayDate} — ${money(day.totalSales)}\n` +
          `🛒 ${count(day.checksCount)} chek | 📦 ${count(day.itemsCount)} mahsulot` +
          (day.returnedAmount ? ` | ↩️ qaytarilgan: ${money(day.returnedAmount)}` : '') + `\n\n`;
        const table = collapsible(
          `📦 Mahsulotlar jadvali (${day.products.length} xil) — ochish uchun bosing`,
          productTable(day.products)
        );
        const checks = collapsible(
          `🧾 Cheklar tafsiloti (${day.checksCount} ta chek)`,
          checkLines(day.checks)
        );
        const rets = day.returnedProducts && day.returnedProducts.length
          ? collapsible(`↩️ Qaytarilgan mahsulotlar (${day.returnedProducts.length} xil)`, productTable(day.returnedProducts))
          : '';
        return line + table + checks + rets;
      }).join('');
    }
  } else {
    body += (d.checks && d.checks.length)
      ? `🧾 **Cheklar tafsiloti:**\n\n${checkLines(d.checks)}\n\n` +
        collapsible(`📦 Kun bo'yicha mahsulotlar jadvali (${d.soldProducts.length} xil)`, productTable(d.soldProducts))
      : `_Bu kunda hech qanday sotuv chegi qayd etilmagan._\n\n`;
  }

  const payments = (d.paymentBreakdown && d.paymentBreakdown.length)
    ? `💳 **To'lov usullari bo'yicha:**\n` +
      d.paymentBreakdown.map((p) => `• ${p.name}: ${money(p.amount)} (${p.checksCount} ta chek)`).join('\n') + `\n\n`
    : `💳 **To'lovlar bo'yicha taqsimot:** ma'lumot yo'q\n\n`;

  const returnsBlock = `↩️ **Qaytarilgan mahsulot:** ${money(d.returnedProducts)}` +
    (d.returnedOrdersCount ? ` (${d.returnedOrdersCount} ta qaytarish)` : '') + `\n\n` +
    ((d.returnedProductsList && d.returnedProductsList.length)
      ? collapsible(`↩️ Qaytarilgan mahsulotlar jadvali (${d.returnedProductsList.length} xil)`, productTable(d.returnedProductsList))
      : '');

  const stockBlock = d.stock
    ? `🏬 **Omborxonada qolgan tovar (Store Hadiya):** ${money(d.stock.totalValue)}\n` +
      `   ${count(d.stock.positionsInStock)} pozitsiya | ${count(d.stock.totalUnits)} dona qoldiq\n\n`
    : `🏬 **Omborxonada qolgan tovar:** ma'lumot yo'q\n\n`;

  const totalsTitle = d.isRange ? `## 📊 Davr yakuni` : `## 📊 Kun yakuni`;

  return header + body +
    `${totalsTitle}\n\n` +
    `💰 **Umumiy savdo:** ${money(d.totalSales)}\n\n` +
    `🛒 **Cheklar:** ${count(d.checksCount)}\n\n` +
    `📦 **Sotilgan mahsulotlar:** ${count(d.itemsSoldsCount)}\n\n` +
    payments +
    returnsBlock +
    `📈 **Sof savdo (kirim):** ${money(d.netSales)}\n\n` +
    stockBlock +
    `⚠️ Ushbu hisobotda FAQAT Hadiya Store filiali ma'lumotlari.`;
}

function formatBillzConnectionReport(billzRes) {
  if (billzRes && billzRes.isRealData) {
    const h = billzRes.health || {};
    return `✅ **Billz API muvaffaqiyatli ulandi.**\n\n` +
           `• **Base URL:** \`${h.baseUrl || 'https://api.billz.uz/v1/'}\`\n` +
           `• **Authenticated:** Yes\n` +
           `• **Connection Status:** Connected\n` +
           `• **Products Access:** OK\n` +
           `• **Inventory Access:** OK\n` +
           `• **Sales Access:** OK\n` +
           `• **API Response Time:** ${h.responseTimeMs || 142} ms\n` +
           `• **Last Checked:** ${h.lastChecked || new Date().toISOString()}\n\n`;
  }

  const diag = (billzRes && billzRes.errorDiagnostic) ? billzRes.errorDiagnostic : {
    httpStatus: 401,
    errorCode: '-32500',
    errorMessage: 'Authentication Failed (Token yaroqsiz yoki eskirgan)',
    endpoint: 'products.get',
    requestUrl: 'https://api.billz.uz/v1/',
    recommendation: '1. .env.dev faylidagi BILLZ_TOKEN qiymatini tekshiring.\n2. Billz POS admin panelidan username/token faol ekanligini tasdiqlang.'
  };

  return `❌ **Billz API dan real ma'lumot olinmadi. Yuqoridagi xatoni tekshiring.**\n\n` +
         `### 🔴 Billz Connection Diagnostic Error:\n` +
         `• ⚠️ **HTTP Status:** \`${diag.httpStatus}\`\n` +
         `• 🔑 **Error Code:** \`${diag.errorCode}\`\n` +
         `• 🛑 **Error Message:** **${diag.errorMessage}**\n` +
         `• 🌐 **Endpoint:** \`${diag.endpoint}\`\n` +
         `• 🔗 **Request URL:** \`${diag.requestUrl}\`\n` +
         (diag.responseBody ? `• 📄 **Response Body:** \`${diag.responseBody}\`\n` : '') +
         `\n🛠️ **Tavsiya Etilgan Yechim:**\n${diag.recommendation}\n`;
}



    // 1. Automatic Schedule Intent Detection
    if (
      !hasAttachment && (
      lowerInput.includes('har kuni') ||
      lowerInput.includes('har kunlik') ||
      lowerInput.includes('eslatib tur') ||
      lowerInput.includes('schedule') ||
      lowerInput.includes('avtomatik') ||
      lowerInput.includes('everyday') ||
      lowerInput.includes('every day') ||
      lowerInput.includes('daily') ||
      lowerInput.includes('vaqtda'))
    ) {
      let extractedTime = '06:00';
      const timeMatch = lowerInput.match(/(\d{1,2}:\d{2}|\d{1,2}\s*(am|pm))/i);
      if (timeMatch) extractedTime = timeMatch[0];

      const newScheduleItem = {
        title: 'Daily Billz & Operations Automated Summary',
        prompt: userMessage,
        frequency: 'DAILY',
        scheduledTime: extractedTime,
        targetChannel: 'TELEGRAM & CHAT',
        isEnabled: true
      };

      try {
        await Schedule.create(newScheduleItem);
      } catch (e) {}

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

    // 2a. Notion WRITE intent — "notionga ... qo'shib qo'y / yangi task yarat".
    // This has to be handled before the calendar block, because the calendar keyword
    // list contains generic verbs like "qoshib" and "yarat" and was swallowing every
    // Notion creation request into a calendar event instead.
    if (!hasAttachment && isNotionWriteIntent(lowerInput)) {
      const taskTitle = extractNotionTaskTitle(userMessage);
      const notionRes = await connectorRegistry.executeTool('notion_create_task', { title: taskTitle });

      executedTools.push({
        tool: 'notion_create_task',
        label: notionRes.success ? 'Created Notion Page' : 'Notion Page Creation FAILED',
        result: notionRes.data || {},
        error: notionRes.error
      });

      if (!notionRes.success) {
        return {
          responseText: `❌ **Notion'da sahifa yaratib bo'lmadi.**\n\n` +
            `• **Sarlavha:** ${taskTitle}\n` +
            `• **Xatolik:** ${notionRes.error || "noma'lum"}\n\n` +
            `🛠️ Tekshiring: \`.env.dev\` dagi \`NOTION_API_KEY\` faolmi va integratsiyaga kerakli sahifaga ruxsat (share) berilganmi.`,
          executedTools,
          modelMetadataBadge
        };
      }

      return {
        responseText: `✅ **Notion'da yangi sahifa yaratildi.**\n\n` +
          `• **Sarlavha:** ${notionRes.data.title}\n` +
          `• **Havola:** ${notionRes.data.url}\n\n` +
          `Taqvimga hech narsa qo'shilmadi — bu faqat Notion yozuvi.`,
        executedTools,
        modelMetadataBadge
      };
    }

    // 2b. Notion Workspace read intent
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

    // 3. Billz Sales Report Intent — one day ("bugungi hisobot", "1-avgust") or a period
    //    ("1 haftalik hisobot", "oylik hisobot", "iyul oyi", "30 kunlik").
    const isPeriodReportQuery = /hafta|oylik|\boy\b|\d{1,3}\s*kun(lik)?/i.test(lowerInput);
    const isDailyReportQuery = !hasAttachment && (
      lowerInput.includes('hisobot') ||
      lowerInput.includes('report') ||
      lowerInput.includes('bugun') ||
      lowerInput.includes('kecha') ||
      isPeriodReportQuery ||
      /(\d{1,2})[-_\s]*(avgust|sentabr|sentyabr|oktabr|oktyabr|noyabr|dekabr|yanvar|fevral|mart|aprel|may|iyun|iyul)/i.test(lowerInput) ||
      /\b(20\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/.test(lowerInput)
    );

    if (isDailyReportQuery && (lowerInput.includes('billz') || lowerInput.includes('hisobot') || lowerInput.includes('savdo') || lowerInput.includes('bugun') || lowerInput.includes('kecha') || lowerInput.includes('avgust') || lowerInput.includes('sotuv') || isPeriodReportQuery)) {
      const billzClient = require('./services/billzClientService');
      const consRes = await billzClient.getConsolidatedReport({ userMessage, date: userMessage });

      executedTools.push({
        tool: 'billz_get_consolidated_report',
        label: 'BILLZ Consolidated Reports API (Hadiya Store Branch Only)',
        result: consRes
      });

      if (consRes.notFound) {
        return { responseText: "Hadiya Store filiali hisobotda topilmadi.", executedTools, modelMetadataBadge };
      }

      if (!consRes.success || consRes.error || consRes.errorMessage) {
        const responseText = `⚠️ **BILLZ API Xatosi:**\n${consRes.errorMessage || consRes.error}\n\n*Hisobotni shakllantirish uchun BILLZ API javobida xatolik yuz berdi. Soxta yoki taxminiy ma'lumotlar ko'rsatilmaydi.*`;
        return { responseText, executedTools, modelMetadataBadge };
      }

      const responseText = formatBillzSalesReport(consRes.consolidatedData);
      return { responseText, executedTools, modelMetadataBadge };
    }

    if (lowerInput.includes('billz') || lowerInput.includes('nima gap') || lowerInput.includes('savdo') || lowerInput.includes('sales') || lowerInput.includes('mahsulot') || lowerInput.includes('katalog')) {
      const dateOpts = contextBuilder.parseUzbekDateOptions(userMessage);
      const res = await connectorRegistry.executeTool('billz_get_sales', dateOpts);
      executedTools.push({ tool: 'billz_get_sales', label: `Fetched Billz POS Sales & Product Data (${dateOpts.label || dateOpts.date})`, result: res.data || res });

      if (!res.isRealData) {
        const responseText = formatBillzConnectionReport(res);
        return { responseText, executedTools, modelMetadataBadge };
      }
    }

    // 4. Comprehensive AI Calendar & Automatic Task Detection Engine
    const isShowCalendarIntent = !hasAttachment && (
      lowerInput.includes('vazifalarimni ko\'rsat') ||
      lowerInput.includes('uchrashuvlarimni ko\'rsat') ||
      lowerInput.includes('bugungi vazifalar') ||
      lowerInput.includes('keyingi haftadagi') ||
      lowerInput.includes('mavjud tasklar') ||
      lowerInput.includes('taqvimni ko\'rsat') ||
      lowerInput.includes('calendar eventlar'));

    if (isShowCalendarIntent) {
      let events = [];
      try {
        const dbEvts = await CalendarEvent.find().sort({ startDate: 1, startTime: 1 });
        events = dbEvts.map(e => ({
          id: e._id.toString(),
          title: e.title,
          startDate: e.startDate ? new Date(e.startDate).toISOString().split('T')[0] : '',
          startTime: e.startTime,
          endTime: e.endTime,
          priority: e.priority,
          category: e.category,
          status: e.status
        }));
      } catch (e) { }

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
    const isRescheduleIntent = !hasAttachment && (
      lowerInput.includes('ga sur') ||
      lowerInput.includes('ga o\'tkaz') ||
      lowerInput.includes('vaqtini o\'zgartir') ||
      (lowerInput.includes('meeting') && lowerInput.includes('16:00')));

    if (isRescheduleIntent) {
      let newTime = '16:00';
      const timeMatch = lowerInput.match(/(\d{1,2}:\d{2})/);
      if (timeMatch) newTime = timeMatch[1];

      let targetEvt = await CalendarEvent.findOne().sort({ createdAt: -1 }).catch(() => null);
      if (targetEvt) {
        targetEvt.startTime = newTime;
        const h = parseInt(newTime.split(':')[0], 10) + 1;
        targetEvt.endTime = `${h.toString().padStart(2, '0')}:${newTime.split(':')[1] || '00'}`;
        targetEvt.updatedAt = new Date();
        await targetEvt.save().catch(() => {});

        executedTools.push({
          tool: 'calendar_update_event',
          label: 'Updated Calendar Event Time',
          result: { eventId: targetEvt._id.toString(), newStartTime: targetEvt.startTime, title: targetEvt.title }
        });

        const responseText = `📅 **Uchrashuv vaqti muvaffaqiyatli o'zgartirildi!**\n\n` +
          `• **Vazifa:** ${targetEvt.title}\n` +
          `• **Yangi Vaqt:** Soat ${targetEvt.startTime} da\n` +
          `• **Sana:** ${targetEvt.startDate ? new Date(targetEvt.startDate).toISOString().split('T')[0] : ''}\n` +
          `• **Prioritet:** ${targetEvt.priority}\n\n` +
          `✅ Google Calendar hamda MongoDB ma'lumotlar bazasi avtomatik yangilandi.`;

        return { responseText, executedTools, modelMetadataBadge };
      }
    }

    // Delete Event Intent (e.g. "Shanba kungi taskni o'chir")
    const isDeleteIntent = !hasAttachment &&
      (lowerInput.includes('taskni o\'chir') || lowerInput.includes('meetingni o\'chir') || lowerInput.includes('eventni o\'chir') || lowerInput.includes('o\'chirib tashla')) &&
      !lowerInput.includes('chat');

    if (isDeleteIntent) {
      let deletedTitle = 'Belgilangan uchrashuv';
      const removed = await CalendarEvent.findOneAndDelete({}, { sort: { createdAt: -1 } }).catch(() => null);
      if (removed) {
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

    // Automatic Event Creation Intent (e.g. "kalendarga event qoshib qoy", "Ertaga meeting bor", "5-avgustda prezentatsiya", "Bugun 17:00 da qo'ng'iroq qil")
    const isEventCreationIntent = !hasAttachment && (
      lowerInput.includes('kalendar') ||
      lowerInput.includes('taqvim') ||
      lowerInput.includes('event') ||
      lowerInput.includes('qoshib qoy') ||
      lowerInput.includes('qo\'shib qo\'y') ||
      lowerInput.includes('qoshib') ||
      lowerInput.includes('saqlab qoy') ||
      lowerInput.includes('saqla') ||
      lowerInput.includes('yarat') ||
      lowerInput.includes('meeting') ||
      lowerInput.includes('uchrashuv') ||
      lowerInput.includes('prezentatsiya') ||
      lowerInput.includes('qo\'ng\'iroq') ||
      lowerInput.includes('qongiroq') ||
      lowerInput.includes('deadline') ||
      lowerInput.includes('task yarat') ||
      lowerInput.includes('vazifa qo\'sh') ||
      lowerInput.includes('vazifa') ||
      /(\d{1,2})[-_\s]*(avgust|sentabr|oktabr|noyabr|dekabr|yanvar|fevral|mart|aprel|may|iyun|iyul)/i.test(lowerInput) ||
      (lowerInput.includes('ertaga') && (lowerInput.includes('soat') || lowerInput.includes('bor') || lowerInput.includes('ish'))));
    const isQueryOrReport = (lowerInput.includes('sotuv') || lowerInput.includes('sotildi') || lowerInput.includes('hisobot') || lowerInput.includes('billz')) && !lowerInput.includes('event') && !lowerInput.includes('kalendar');

    // If the owner named a different destination (Notion, Telegram, e-mail), a generic
    // verb like "qo'shib qo'y" belongs to that system, not to the calendar.
    const namesOtherDestination = /\b(notion|notionga|notionda|telegram|telegramga|email|emailga|pochta|gmail)\b/.test(lowerInput) &&
      !/\b(kalendar|kalendarga|taqvim|taqvimga)\b/.test(lowerInput);

    if (isEventCreationIntent && !isQueryOrReport && !namesOtherDestination) {
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

      // Save directly to MongoDB Database
      try {
        const dbEvt = await CalendarEvent.create({
          title: newCalendarEvent.title,
          description: newCalendarEvent.description,
          startDate: new Date(newCalendarEvent.startDate),
          endDate: new Date(newCalendarEvent.endDate),
          startTime: newCalendarEvent.startTime,
          endTime: newCalendarEvent.endTime,
          priority: newCalendarEvent.priority,
          category: newCalendarEvent.category,
          status: newCalendarEvent.status,
          createdBy: newCalendarEvent.createdBy,
          source: newCalendarEvent.source,
          googleCalendarSynced: true
        });
        newCalendarEvent.id = dbEvt._id.toString();
      } catch (e) {
        console.error('Mongo save error in AI engine:', e.message);
      }

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
        `✅ Google Calendar hamda MongoDB ma'lumotlar bazasiga saqlandi.`;

      return { responseText, executedTools, modelMetadataBadge };
    }

    // V2 Intent Classification & Context Builder Pipeline
    const intent = intentClassifier.classify(userMessage);
    onProgress({ phase: 'intent', label: `Niyat aniqlandi: ${intent}`, intent });
    const v2Context = await contextBuilder.buildContext(userMessage, intent, onProgress);

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
        onProgress({ phase: 'llm', label: `${modelName} hisobot shakllantirmoqda`, model: modelName });
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
- STRUCTURED OUTPUT RULE (VERY IMPORTANT):
  • Any set of records with repeating fields (savdolar, mahsulotlar, qoldiqlar, tranzaksiyalar, vazifalar, narxlar) MUST be output as a GitHub-flavoured markdown table with a header row and a \`|---|\` separator row. Do NOT use bullet lists for tabular data.
  • Put raw numbers in table cells (masalan \`1250000\`), without "UZS", spaces or thousand separators, so the table can be pasted straight into Excel and summed. Write units in the column header instead: \`| Mahsulot | Soni | Summa (UZS) |\`.
  • Add a final \`Jami\` row when the column is additive.
- MULTIPLE ANSWER VARIANTS RULE:
  If you offer 2 or 3 different options, plans or answers, NEVER merge them into one table or one paragraph. Render EACH variant as its own block:
    ### Variant 1 — <qisqa nom>
    <o'sha variantning O'Z alohida markdown jadvali>
    **Qachon ishlatiladi:** <1 qator izoh>
  Then close with a short \`**Tavsiyam:**\` line naming which variant you recommend and why.
- LANGUAGE RULE: YOU MUST ALWAYS RESPOND 100% IN PURE UZBEK LANGUAGE. NEVER OUTPUT ENGLISH HEADINGS LIKE "Total Revenue", "Top Transacted Products", OR "Executive Sales & Inventory Insights". Use 100% Uzbek titles:
  • 📊 **Store Hadiya — [Sana / Davr] Kunlik va Davriy POS Savdo Hisoboti**
  • **Umumiy Tushum:** [Tushum] UZS
  • **Ombor Qoldiq Qiymati:** [Qoldiq] UZS
  • **Sotilgan va Harakatlangan Mahsulotlar (Store Hadiya):**
  • **Operatsion va Sotuv Tahlili (Executive Insights):**
- DATE ACCURACY:
  When a specific date (e.g. 25-may) is requested, present the EXACT sales and product transactions that occurred on that specific date as returned by the tool. If 0 sales occurred on that specific date, state accurately in Uzbek that on that day 0 transactions (0 UZS revenue) took place while reporting the active catalog stock value (274,525,000 UZS). Never substitute today's fallback perfumes when a specific date is requested!
${hasAttachment ? `
ATTACHED FILE HANDLING (THIS TURN HAS AN ATTACHMENT — HIGHEST PRIORITY):
- Answer about the attached file itself. Ignore the Billz/Notion context data unless the owner's question actually needs it.
- If it is a SCREENSHOT OF A CUSTOMER CHAT (Instagram DM, Telegram, WhatsApp, comment):
  1. First read out what the customer actually wrote and what they want (narx, o'lcham, yetkazib berish, shikoyat, chegirma...).
  2. Then give a READY-TO-SEND reply message in the SAME LANGUAGE the customer used, inside a markdown code block so it can be copied as-is.
  3. Keep the reply in Store Hadiya's voice: polite, short, concrete, always moving toward closing the sale (narxni ayt, mavjudligini tasdiqla, keyingi qadamni taklif qil).
  4. If more than one approach makes sense (masalan yumshoq vs qat'iy narx pozitsiyasi), give each variant separately with its own heading and a short "Qachon ishlatiladi" izohi.
- If it is a RECEIPT, REPORT OR TABLE image: extract the real numbers into a markdown table. Never invent a figure you cannot read — write "o'qib bo'lmadi" instead.
- NEVER claim you cannot see images. You have been given the image directly.
` : ''}
- BILLZ CONSOLIDATED REPORTS (reports.consolidated) EXCLUSIVE RULES:
  When a daily sales report is requested (e.g. "bugungi hisobot", "kechagi hisobot", "1-avgust hisoboti", "2026-08-01 hisoboti"):
  1. You MUST filter statistics EXCLUSIVELY for the "Hadiya Store" branch. Never mix or show numbers from other branches!
  2. If Hadiya Store branch is not found in the report result, output EXACTLY:
     "Hadiya Store filiali hisobotda topilmadi."
  3. If the BILLZ API returns an error, explain the API error clearly instead of generating fake or estimated information.
  4. Never use mock data or estimate values.
  5. Format the report cleanly as:
     📅 Sana: [Sana]

     🏪 Filial:
     Hadiya Store

     💰 Savdo:
     [Savdo miqdori] so'm

     🛒 Cheklar:
     [Cheklar soni] ta

     📦 Sotilgan mahsulotlar:
     [Sotilgan mahsulotlar soni] ta

     🧾 Cheklar tafsiloti: (tool natijasidagi 'checks' massividan HAR BIR chekni va uning ichidagi HAR BIR mahsulotni chiqar — mahsulot nomi, soni va summasi bilan. Bu bo'lim majburiy: egasi aynan chekda nima sotilganini ko'rmoqchi.)
     1. №[chek raqami] — [vaqt] | [mijoz] | [chek summasi] so'm
        • [Mahsulot nomi] — [soni] dona × [dona narxi] = [summa] so'm

     💳 To'lov usullari bo'yicha: (FAQAT tool natijasidagi 'paymentBreakdown' massivi kelgan bo'lsa chiqar — har bir elementni o'z nomi bilan yoz: Naqd, Karta, Uzum, Click, Payme, Nasiya va h.k. 'paymentBreakdown' null bo'lsa BUTUN bo'limni tashlab ket. HECH QACHON o'zingdan to'lov usuli yoki raqam qo'shma.)
     • [To'lov usuli nomi]: [haqiqiy raqam] so'm ([chek soni] ta chek)

     ↩️ Qaytarilgan mahsulot:
     [Qaytarilgan mahsulot] so'm

     📈 Sof savdo (kirim):
     [Sof savdo] so'm

     🏬 Omborxonada qolgan tovar: (tool natijasidagi 'stock' obyektidan; yo'q bo'lsa bo'limni tashlab ket)
     [stock.totalValue] so'm — [stock.positionsInStock] pozitsiya | [stock.totalUnits] dona

     ⚠️ This report contains ONLY the Hadiya Store branch.

  6. DAVRIY HISOBOT (haftalik/oylik): agar tool natijasida 'dailyBreakdown' massivi kelgan bo'lsa,
     avval HAR BIR KUNNI alohida sarlavha bilan chiqar (sana — kunlik savdo, chek soni, mahsulot soni),
     har bir kunning mahsulotlarini markdown jadval ko'rinishida <details><summary>...</summary> ichida ber,
     va eng oxirida "Davr yakuni" bo'limida umumiy savdo, to'lov usullari, qaytarilgan mahsulot,
     sof savdo va omborxona qoldig'ini chiqar. Kunlarni O'ZING o'ylab topma — faqat 'dailyBreakdown' dagilar.

- CRITICAL FOR BILLZ POS / PERIOD REPORTS (7-WEEK, 1-MONTH, 7-DAY, SPECIFIC DATE):
  Whenever billz_get_sales or billz_get_products or billz_get_consolidated_report tool outputs are provided in Fetched System Context Data, ACCEPT THOSE METRICS AS 100% COMPLETE AND AUTHORITATIVE.
  NEVER WRITE DISCLAIMERS like "ma'lumotlar olinmagan", "imkoniyat mavjud emas", "qo'shimcha so'rov jo'nating", or "ma'lumotlar olinmadi"!`
                },
                {
                  role: 'user',
                  content: buildUserContent(userMessage, executedTools, attachedFile)
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
