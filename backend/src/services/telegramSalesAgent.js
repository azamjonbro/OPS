const OwnerMemory = require('../models/ownerMemoryModel');
const TelegramCustomerMessage = require('../models/TelegramCustomerMessage');
const connectorRegistry = require('../connectors/registry');

function apiKey() {
  return (process.env.OPENAI_API_KEY || '').trim();
}

/** Case-insensitive substring match over the live Billz catalog — a search utility, not an intent router. */
function matchProducts(products, query) {
  if (!query || !products || !products.length) return [];
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return products
    .filter((p) =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q))
    .slice(0, 5);
}

/**
 * One classification call: is this a sales inquiry, and if so what should we search Billz
 * for? Fails CLOSED (isSalesInquiry: false) on any error — an API hiccup must never turn
 * into an unreviewed autonomous reply, per the owner's explicit "don't answer everything" rule.
 */
async function classifyMessage(text, key) {
  if (!key || !text || !text.trim()) return { isSalesInquiry: false, searchQuery: null };

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `Sen do'kon Telegram Business chatiga mijozdan kelgan xabarni tasniflaydigan yordamchisan.
Vazifang: bu xabar SOTUV bilan bog'liq so'rovmi (mahsulot, narx, model, mavjudlik, yetkazib berish haqida so'rov) yoki boshqa narsa (salom, shikoyat, umuman mavzusiz suhbat, spam)?
Faqat aniq savdo bilan bog'liq so'rovlarni "isSalesInquiry": true qil. Shubha bo'lsa false qo'y.
Agar savdo so'rovi bo'lsa, "searchQuery" maydoniga mijoz so'ragan mahsulot/model nomini yoz (masalan "Al Haramain 6109" yoki "iPhone 15"). Aks holda null.
Aynan shu JSON formatda javob ber: {"isSalesInquiry": true/false, "searchQuery": "..." yoki null}`
          },
          { role: 'user', content: text }
        ]
      })
    });

    if (!resp.ok) return { isSalesInquiry: false, searchQuery: null };
    const data = await resp.json();
    const raw = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed.isSalesInquiry !== 'boolean') return { isSalesInquiry: false, searchQuery: null };
    return { isSalesInquiry: parsed.isSalesInquiry, searchQuery: parsed.searchQuery || null };
  } catch (err) {
    console.error('Telegram sales classify failed:', err.message);
    return { isSalesInquiry: false, searchQuery: null };
  }
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

/** Drafts the actual human-sounding reply from real product data + the owner's playbook. */
async function draftReply({ customerText, matched, playbook }, key) {
  const productLines = matched.length
    ? matched.map((p) => `- ${p.name} | SKU: ${p.sku} | Narx: ${p.formattedPrice} | Ombordagi qoldiq: ${p.stockInStoreHadiya} dona`).join('\n')
    : 'Hech qanday mos mahsulot Billz katalogida topilmadi.';

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        temperature: 0.6,
        messages: [
          {
            role: 'system',
            content: `Sen do'konning haqiqiy sotuvchisisan va Telegram Business chat orqali mijozga to'g'ridan-to'g'ri javob yozasan.
QOIDALAR:
- Mijoz qaysi tilda yozgan bo'lsa, o'sha tilda va xuddi shunday ohangda javob yoz (rasmiy yoki samimiy — mijozga moslash).
- Faqat quyida berilgan HAQIQIY mahsulot/narx ma'lumotidan foydalan. Hech qachon narx yoki mavjudlikni o'zingdan to'qib yozma.
- Agar mos mahsulot topilmagan bo'lsa, buni ochiq ayt va aniqlashtiruvchi savol ber (masalan model raqami yoki rasm so'ra) — ma'lumot yo'qligini yashirma.
- Xabar QISQA, tabiiy va odam yozgandek bo'lsin — savdo hisobotidagi kabi jadval yoki markdown ishlatma, oddiy chat xabari kabi yoz.
- Sotuvni yakunlashga yo'naltirilgan bo'l: narxni ayt, mavjudligini tasdiqla va keyingi qadamni taklif qil (masalan do'konga taklif qil yoki band qilib qo'yishni so'ra).
- Quyidagi sotuv qo'llanmalariga amal qil (agar mavjud bo'lsa):
${playbook.length ? playbook.join('\n\n') : "(qo'llanma kiritilmagan — umumiy do'stona sotuvchi ohangida yoz)"}

MAHSULOT MA'LUMOTI (Billz katalogidan, real vaqt):
${productLines}`
          },
          { role: 'user', content: customerText }
        ]
      })
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || null;
  } catch (err) {
    console.error('Telegram sales reply draft failed:', err.message);
    return null;
  }
}

/** Called for every inbound `business_message` update. Text-only in this iteration. */
async function handleIncomingMessage(message) {
  if (!message || !message.text) return;

  const businessConnectionId = message.business_connection_id;
  const chatId = message.chat && message.chat.id;
  if (!businessConnectionId || !chatId) return;

  const from = message.from || {};
  const customerName = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || "Noma'lum";

  // The sync the owner asked for happens unconditionally, before any AI decision.
  const inboundDoc = await TelegramCustomerMessage.create({
    businessConnectionId: String(businessConnectionId),
    chatId: String(chatId),
    customerTelegramUserId: from.id ? String(from.id) : '',
    customerName,
    direction: 'in',
    text: message.text
  });

  const key = apiKey();
  const { isSalesInquiry, searchQuery } = await classifyMessage(message.text, key);

  inboundDoc.intent = isSalesInquiry ? 'sales' : 'other';
  inboundDoc.aiHandled = false;

  if (!isSalesInquiry) {
    await inboundDoc.save();
    return;
  }

  const [catalog, playbook] = await Promise.all([fetchCatalog(), loadPlaybook()]);
  const matched = matchProducts(catalog, searchQuery);

  const replyText = await draftReply({ customerText: message.text, matched, playbook }, key);
  if (!replyText) {
    await inboundDoc.save();
    return;
  }

  const telegramBusinessService = require('./telegramBusinessService');
  const sendRes = await telegramBusinessService.sendBusinessMessage({ businessConnectionId, chatId, text: replyText });

  inboundDoc.matchedProductName = matched[0] ? matched[0].name : '';
  inboundDoc.aiHandled = !!sendRes.success;
  await inboundDoc.save();

  await TelegramCustomerMessage.create({
    businessConnectionId: String(businessConnectionId),
    chatId: String(chatId),
    direction: 'out',
    text: replyText,
    intent: 'sales',
    matchedProductName: matched[0] ? matched[0].name : '',
    aiHandled: !!sendRes.success
  });
}

module.exports = { handleIncomingMessage };
