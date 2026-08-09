const Fuse = require('fuse.js');
const OwnerMemory = require('../models/ownerMemoryModel');
const TelegramCustomerMessage = require('../models/TelegramCustomerMessage');
const connectorRegistry = require('../connectors/registry');
const { classifyJson } = require('./llmClassify');
const { proxiedFetch } = require('../utils/proxiedFetch');
const proxyPoolService = require('./proxyPoolService');

const HISTORY_TURNS = 20;
const MAX_TOOL_ROUNDS = 3;
const TYPING_CHARS_PER_SEC = 12; // human-ish typing speed used to size the pre-reply delay
const TYPING_MIN_MS = 3000;
const TYPING_MAX_MS = 12000;
const TYPING_REFRESH_MS = 4000; // Telegram clears the "typing" status after ~5s of silence

const SALES_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_products',
      description: "Store Hadiya Billz kataloridan mahsulot qidirish — fuzzy qidiruv, yozuv xatosi yoki qisman nom bilan ham topadi. Narx, mavjudlik yoki SKU haqida gap ketsa albatta shu bilan tekshir, hech qachon narxni o'zingdan to'qima.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: "Mijoz so'ragan mahsulot/model nomi" },
          limit: { type: 'number', description: 'Nechta nomzod qaytarilsin (standart 10)' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'escalate_to_owner',
      description: "Mahsulot topilmasa, mijoz odam/menejer bilan gaplashishni so'rasa, shikoyat qilsa, yoki narx savdolashuvi o'z vakolatingdan tashqariga chiqsa — shuni chaqir. Do'kon egasiga darhol Telegram orqali xabar ketadi. Shundan keyin mijozga qisqa, samimiy kutish xabari yoz (masalan \"hozir tekshirib ko'raman, tez orada javob beraman\") — hech qachon o'zing narx yoki vaqt va'da qilma.",
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: "Nega eskalatsiya qilinayotgani, qisqacha va aniq" }
        },
        required: ['reason']
      }
    }
  }
];

function apiKey() {
  return (process.env.OPENAI_API_KEY || '').trim();
}

/**
 * One classification call: is this a sales inquiry? Fails CLOSED (isSalesInquiry: false) on
 * any error — an API hiccup must never turn into an unreviewed autonomous reply, per the
 * owner's explicit "don't answer everything" rule.
 */
async function classifyMessage(text, key) {
  const fallback = { isSalesInquiry: false };
  if (!text || !text.trim()) return fallback;

  const parsed = await classifyJson({
    apiKey: key,
    systemPrompt: `Sen do'kon Telegram Business chatiga mijozdan kelgan xabarni tasniflaydigan yordamchisan.
Vazifang: bu xabar SOTUV bilan bog'liq so'rovmi (mahsulot, narx, model, mavjudlik, yetkazib berish haqida so'rov) yoki boshqa narsa (salom, shikoyat, umuman mavzusiz suhbat, spam)?
Faqat aniq savdo bilan bog'liq so'rovlarni "isSalesInquiry": true qil. Shubha bo'lsa false qo'y.
Aynan shu JSON formatda javob ber: {"isSalesInquiry": true/false}`,
    userContent: text,
    fallback
  });

  if (!parsed || typeof parsed.isSalesInquiry !== 'boolean') return fallback;
  return { isSalesInquiry: parsed.isSalesInquiry };
}

/** The owner's own "how to sell" documents, already stored via the Knowledge workspace. */
async function loadPlaybook() {
  try {
    const docs = await OwnerMemory.find({ category: { $in: ['business', 'sop'] } }).sort({ updatedAt: -1 }).limit(15).lean();
    return docs.map((d) => `[${d.title}]\n${d.content}`);
  } catch (err) {
    return [];
  }
}

/** Reuses the registry's existing 5-minute cache for the full Store Hadiya catalog. */
async function fetchCatalog() {
  const res = await connectorRegistry.executeTool('billz_get_products', { all: true });
  if (!res || !res.success || !res.isRealData) return [];
  return (res.data && res.data.products) || [];
}

/** Fuzzy match over the catalog — tolerates typos/partial/transliterated product names. */
function fuzzySearchProducts(catalog, query, limit) {
  if (!query || !catalog || !catalog.length) return [];
  const fuse = new Fuse(catalog, { keys: ['name', 'sku', 'barcode'], threshold: 0.4, ignoreLocation: true });
  return fuse.search(query).slice(0, limit || 10).map((r) => r.item);
}

/** Both channels — live webhook traffic and the MTProto history backfill — feed the same
 * conversation context, so the AI remembers what was discussed before the bot even existed. */
async function loadConversationHistory(chatId, limit = HISTORY_TURNS) {
  const rows = await TelegramCustomerMessage.find({ chatId }).sort({ createdAt: -1 }).limit(limit).lean();
  return rows.reverse().map((r) => ({ role: r.direction === 'out' ? 'assistant' : 'user', content: r.text }));
}

function buildSystemPrompt(playbook) {
  return `Sen do'konning haqiqiy sotuvchisisan va Telegram Business chat orqali mijozga to'g'ridan-to'g'ri javob yozasan.
QOIDALAR:
- Mijoz qaysi tilda yozgan bo'lsa, o'sha tilda va xuddi shunday ohangda javob yoz (rasmiy yoki samimiy — mijozga moslash).
- Narx, mavjudlik yoki SKU haqida javob berishdan oldin albatta "search_products" tool'ini chaqir — hech qachon narx yoki mavjudlikni o'zingdan to'qib yozma.
- Suhbat tarixini (agar mavjud bo'lsa) hisobga ol — mijoz oldin nima so'ragani, qanday narx aytilgani va qaysi bosqichda ekanini unutma, xuddi shu suhbatni davom ettirgandek yoz.
- Agar mos mahsulot topilmasa yoki mijoz odam/menejer bilan gaplashishni so'rasa — "escalate_to_owner" ni chaqir va mijozga qisqa, samimiy kutish xabari yoz.
- Xabar QISQA, tabiiy va odam yozgandek bo'lsin — savdo hisobotidagi kabi jadval yoki markdown ishlatma, oddiy chat xabari kabi yoz.
- Sotuvni yakunlashga yo'naltirilgan bo'l: narxni ayt, mavjudligini tasdiqla va keyingi qadamni taklif qil (masalan do'konga taklif qil yoki band qilib qo'yishni so'ra).
- Quyidagi sotuv qo'llanmalariga amal qil (agar mavjud bo'lsa):
${playbook.length ? playbook.join('\n\n') : "(qo'llanma kiritilmagan — umumiy do'stona sotuvchi ohangida yoz)"}`;
}

/**
 * Real OpenAI tool-calling loop (assistant tool_calls -> role:'tool' results -> next turn),
 * mirroring aiEngine.js's routing pattern but with the correct multi-turn tool protocol.
 * Caps at MAX_TOOL_ROUNDS so a confused model can't loop forever burning API calls.
 */
async function runAgentLoop({ customerText, history, playbook }, key) {
  const messages = [
    { role: 'system', content: buildSystemPrompt(playbook) },
    ...history,
    { role: 'user', content: customerText }
  ];

  let matchedProductName = '';
  let escalated = false;
  let escalationReason = '';

  const proxy = await proxyPoolService.getWorkingProxy('openai').catch(() => null);

  const callOpenAi = async (withTools) => {
    const body = { model: 'gpt-4o', temperature: 0.5, messages };
    if (withTools) {
      body.tools = SALES_TOOLS;
      body.tool_choice = 'auto';
    }
    const resp = await proxiedFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      proxyUrl: proxy && proxy.url
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return (data.choices && data.choices[0] && data.choices[0].message) || null;
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const msg = await callOpenAi(true);
    if (!msg) return { replyText: null, escalated, escalationReason, matchedProductName };

    if (!msg.tool_calls || !msg.tool_calls.length) {
      const text = (msg.content || '').trim();
      return { replyText: text || null, escalated, escalationReason, matchedProductName };
    }

    messages.push({ role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls });

    for (const call of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch (e) { /* malformed args -> empty */ }

      let resultPayload;
      if (call.function.name === 'search_products') {
        const catalog = await fetchCatalog();
        const found = fuzzySearchProducts(catalog, args.query, args.limit);
        if (found[0]) matchedProductName = found[0].name;
        resultPayload = found.length
          ? found.map((p) => ({ name: p.name, sku: p.sku, price: p.formattedPrice, stock: p.stockInStoreHadiya }))
          : { message: 'Hech qanday mos mahsulot topilmadi' };
      } else if (call.function.name === 'escalate_to_owner') {
        escalated = true;
        escalationReason = args.reason || '';
        resultPayload = { acknowledged: true };
      } else {
        resultPayload = { error: 'unknown tool' };
      }

      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(resultPayload) });
    }
  }

  // Exhausted tool rounds without a final text turn — force one plain answer.
  const finalMsg = await callOpenAi(false);
  const text = finalMsg && (finalMsg.content || '').trim();
  return { replyText: text || null, escalated, escalationReason, matchedProductName };
}

/** Sends "typing..." immediately, then holds for a length-scaled human-ish delay before the
 * real reply goes out — refreshing the indicator every ~4s since Telegram clears it at ~5s. */
async function simulateHumanTyping({ businessConnectionId, chatId, replyText }) {
  const telegramBusinessService = require('./telegramBusinessService');
  const delayMs = Math.min(TYPING_MAX_MS, Math.max(TYPING_MIN_MS, Math.round((replyText.length / TYPING_CHARS_PER_SEC) * 1000)));
  const start = Date.now();

  await telegramBusinessService.sendChatAction({ businessConnectionId, chatId, action: 'typing' }).catch(() => {});
  while (Date.now() - start < delayMs) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(TYPING_REFRESH_MS, delayMs - (Date.now() - start))));
    if (Date.now() - start < delayMs) {
      await telegramBusinessService.sendChatAction({ businessConnectionId, chatId, action: 'typing' }).catch(() => {});
    }
  }
}

/**
 * Shared by both the live webhook path and the post-sync catch-up: classify, and if it's a
 * sales inquiry, run the agent loop, escalate/send as needed, and persist the outcome onto
 * the already-created inbound row. `inboundDoc` is mutated + saved by this function.
 */
async function processInquiry({ businessConnectionId, chatId, customerName, text, history, inboundDoc }) {
  const key = apiKey();
  const { isSalesInquiry } = await classifyMessage(text, key);

  inboundDoc.intent = isSalesInquiry ? 'sales' : 'other';
  inboundDoc.aiHandled = false;

  if (!isSalesInquiry) {
    await inboundDoc.save();
    return;
  }

  const playbook = await loadPlaybook();
  const { replyText, escalated, escalationReason, matchedProductName } = await runAgentLoop(
    { customerText: text, history, playbook },
    key
  );

  inboundDoc.escalated = escalated;
  inboundDoc.escalationReason = escalationReason;
  inboundDoc.matchedProductName = matchedProductName;

  if (escalated) {
    const telegramBusinessService = require('./telegramBusinessService');
    telegramBusinessService.notifyOwner(
      `🔔 Savdo botiga yordam kerak\nMijoz: ${customerName}\nXabar: "${text}"\nSabab: ${escalationReason || "aniqlanmagan"}`
    ).catch((err) => console.error('Telegram owner escalation notify failed:', err.message));
  }

  if (!replyText) {
    await inboundDoc.save();
    return;
  }

  const telegramBusinessService = require('./telegramBusinessService');
  await simulateHumanTyping({ businessConnectionId, chatId, replyText });
  const sendRes = await telegramBusinessService.sendBusinessMessage({ businessConnectionId, chatId, text: replyText });

  inboundDoc.aiHandled = !!sendRes.success;
  await inboundDoc.save();

  await TelegramCustomerMessage.create({
    businessConnectionId,
    chatId: String(chatId),
    direction: 'out',
    text: replyText,
    intent: 'sales',
    matchedProductName,
    escalated,
    escalationReason,
    aiHandled: !!sendRes.success
  });
}

/** Called for every inbound `business_message` update. Text-only in this iteration. */
async function handleIncomingMessage(message) {
  if (!message || !message.text) return;

  const businessConnectionId = message.business_connection_id;
  const chatId = message.chat && message.chat.id;
  if (!businessConnectionId || !chatId) return;

  const from = message.from || {};

  // Telegram fires a `business_message` update for EVERY message in a connected chat,
  // including ones the owner sends from their own Telegram app (not through the bot) — the
  // update carries no separate "outgoing" flag, only the real sender in `from`. Without this
  // check, the owner's own messages got logged as an incoming customer inquiry (under the
  // OWNER'S OWN NAME as "customerName") and handed to the sales agent to auto-reply to. The
  // MTProto userbot sync already captures these correctly as `direction: 'out'`, so this is
  // a pure duplicate-and-misclassify to skip, not a message to save any other way.
  // TelegramBusinessConnection.telegramUserId is populated from the `business_connection`
  // webhook update, which isn't reliably received on this account — the userbot's own
  // logged-in session id is the source that's actually always available.
  const telegramUserbotService = require('./telegramUserbotService');
  const [ownUserId, conn] = await Promise.all([
    telegramUserbotService.getOwnUserId().catch(() => null),
    require('../models/TelegramBusinessConnection').findOne({ businessConnectionId: String(businessConnectionId) }).lean().catch(() => null)
  ]);
  const ownerIds = [ownUserId, conn && conn.telegramUserId].filter(Boolean);
  if (from.id && ownerIds.includes(String(from.id))) {
    return;
  }

  const customerName = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || "Noma'lum";
  const chatIdStr = String(chatId);

  // Conversation context (both live webhook history and MTProto-synced history) is loaded
  // before the inbound row is written, so it never includes the current message itself.
  const history = await loadConversationHistory(chatIdStr);

  const inboundDoc = await TelegramCustomerMessage.create({
    businessConnectionId: String(businessConnectionId),
    chatId: chatIdStr,
    customerTelegramUserId: from.id ? String(from.id) : '',
    customerName,
    direction: 'in',
    text: message.text
  });

  await processInquiry({
    businessConnectionId: String(businessConnectionId),
    chatId,
    customerName,
    text: message.text,
    history,
    inboundDoc
  });
}

const CATCH_UP_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // only still-recent threads — don't resurrect month-old chats
const CATCH_UP_LIMIT = 30; // safety cap per sync run

/**
 * Run after every MTProto history sync (services/telegramUserbotService.js): finds chats
 * whose most recent message is an unanswered customer message (nobody — human or AI — has
 * replied since), and runs each one through the exact same classify+agent pipeline as a
 * live webhook message. A synced-in "Al Haramain 6109 bormi?" gets treated identically to
 * one that arrived just now — the AI doesn't care which pipe it came in on.
 */
async function catchUpUnansweredChats({ maxAgeMs = CATCH_UP_MAX_AGE_MS, limit = CATCH_UP_LIMIT } = {}) {
  const telegramBusinessService = require('./telegramBusinessService');
  const businessConnectionId = await telegramBusinessService.getActiveConnectionId();
  if (!businessConnectionId) return { processed: 0, skipped: 'no active business connection' };

  const cutoff = new Date(Date.now() - maxAgeMs);

  const openThreads = await TelegramCustomerMessage.aggregate([
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$chatId', doc: { $first: '$$ROOT' } } },
    { $match: { 'doc.direction': 'in', 'doc.aiHandled': false, 'doc.intent': null, 'doc.createdAt': { $gte: cutoff } } },
    { $limit: limit }
  ]);

  let processed = 0;
  for (const row of openThreads) {
    const inboundDoc = await TelegramCustomerMessage.findById(row.doc._id);
    if (!inboundDoc || inboundDoc.intent) continue; // already classified since the aggregation snapshot

    const history = await loadConversationHistory(inboundDoc.chatId);
    const historyWithoutCurrent = history.slice(0, -1); // the aggregated message is already the newest entry

    try {
      await processInquiry({
        businessConnectionId,
        chatId: inboundDoc.chatId,
        customerName: inboundDoc.customerName,
        text: inboundDoc.text,
        history: historyWithoutCurrent,
        inboundDoc
      });
      processed++;
    } catch (err) {
      console.error(`Telegram sales catch-up failed for chat ${inboundDoc.chatId}:`, err.message);
    }
  }

  return { processed };
}

module.exports = { handleIncomingMessage, catchUpUnansweredChats };
