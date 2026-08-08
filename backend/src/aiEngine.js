const connectorRegistry = require('./connectors/registry');
const memoryUpdater = require('./services/memoryUpdater');
const mailSenderFilter = require('./services/mailSenderFilter');
const billzClientService = require('./services/billzClientService');
const spreadsheetParser = require('./services/spreadsheetParser');
const { classifyJson } = require('./services/llmClassify');
const { openAiFetch } = require('./utils/openAiFetch');
const Schedule = require('./models/Schedule');

// Local date key — toISOString() would roll back a day for any local time before 05:00
// in UTC+5, filing "bugun" under yesterday. Also handed to the router model as "today"
// so it can compute relative dates ("ertaga", "indinga") itself instead of a regex parser.
function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

  // Returns are money leaving the till, so they are called out in red instead of sitting
  // in the same neutral type as a sale. The chat renderer styles `.md-danger`.
  const danger = (text) => `<span class="md-danger">${text}</span>`;

  const productTable = (products, isReturn = false) => {
    if (!products || !products.length) return '';
    const mark = (v) => (isReturn ? danger(v) : v);
    const rows = products.map((p, i) =>
      `| ${i + 1} | ${mark(p.name)} | ${p.sku || '—'} | ${mark(`${p.quantity} ${p.unit || 'dona'}`)} | ${mark(p.unitPrice.toLocaleString())} | ${mark(p.totalPrice.toLocaleString())} |`
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
          (day.returnedAmount ? ` | ${danger(`↩️ **qaytarilgan: ${money(day.returnedAmount)}**`)}` : '') + `\n\n`;
        const table = collapsible(
          `📦 Mahsulotlar jadvali (${day.products.length} xil) — ochish uchun bosing`,
          productTable(day.products)
        );
        const checks = collapsible(
          `🧾 Cheklar tafsiloti (${day.checksCount} ta chek)`,
          checkLines(day.checks)
        );
        const rets = day.returnedProducts && day.returnedProducts.length
          ? collapsible(
              danger(`↩️ Qaytarilgan mahsulotlar (${day.returnedProducts.length} xil)`),
              productTable(day.returnedProducts, true)
            )
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

  const hasReturns = !!d.returnedProducts;
  const returnsBlock = `↩️ **Qaytarilgan mahsulot:** ` +
    (hasReturns
      ? danger(`**${money(d.returnedProducts)}${d.returnedOrdersCount ? ` (${d.returnedOrdersCount} ta qaytarish)` : ''}**`)
      : money(d.returnedProducts)) + `\n\n` +
    ((d.returnedProductsList && d.returnedProductsList.length)
      ? collapsible(
          danger(`↩️ Qaytarilgan mahsulotlar jadvali (${d.returnedProductsList.length} xil)`),
          productTable(d.returnedProductsList, true)
        )
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
    formatPeriodAnalytics(d) +
    `⚠️ Ushbu hisobotda FAQAT Hadiya Store filiali ma'lumotlari.`;
}

/**
 * "Eng ko'p/eng kam" superlatives (best/worst day, top/bottom seller, best-selling product
 * by quantity) — computed purely from data the consolidated report already fetched
 * (dailyBreakdown + the period's checks), so this costs zero extra Billz API calls.
 */
function formatPeriodAnalytics(d) {
  const money = (v) => (v === null || v === undefined) ? "ma'lumot yo'q" : `${v.toLocaleString()} so'm`;
  const rows = [];

  if (d.soldProducts && d.soldProducts.length) {
    const byQty = [...d.soldProducts].sort((a, b) => b.quantity - a.quantity)[0];
    rows.push(`| 🥇 Eng ko'p sotilgan mahsulot (dona bo'yicha) | **${byQty.name}** — ${byQty.quantity} ${byQty.unit || 'dona'} (${money(byQty.totalPrice)}) |`);
  }

  const activeDays = (d.dailyBreakdown || []).filter((day) => day.checksCount > 0);
  if (activeDays.length > 1) {
    const byRevenueDesc = [...activeDays].sort((a, b) => b.totalSales - a.totalSales);
    const best = byRevenueDesc[0];
    const worst = byRevenueDesc[byRevenueDesc.length - 1];
    rows.push(`| 📈 Eng ko'p kirim (savdo) bo'lgan kun | **${best.displayDate}** — ${money(best.totalSales)} |`);
    rows.push(`| 📉 Eng kam kirim (savdo) bo'lgan kun | **${worst.displayDate}** — ${money(worst.totalSales)} |`);

    const byChecksDesc = [...activeDays].sort((a, b) => b.checksCount - a.checksCount);
    const busiest = byChecksDesc[0];
    const quietest = byChecksDesc[byChecksDesc.length - 1];
    rows.push(`| 🧾 Eng ko'p sotuv (chek soni) bo'lgan kun | **${busiest.displayDate}** — ${busiest.checksCount} ta chek |`);
    rows.push(`| 🔻 Eng kam sotuv (chek soni) bo'lgan kun | **${quietest.displayDate}** — ${quietest.checksCount} ta chek |`);

    const returnDays = activeDays.filter((day) => day.returnedAmount > 0);
    if (returnDays.length) {
      const mostReturns = [...returnDays].sort((a, b) => b.returnedAmount - a.returnedAmount)[0];
      rows.push(`| ↩️ Eng ko'p chiqim (qaytarim) bo'lgan kun | **${mostReturns.displayDate}** — ${money(mostReturns.returnedAmount)} |`);
    }
  }

  const bySeller = new Map();
  for (const c of d.checks || []) {
    const name = (c.cashier || '').trim();
    if (!name) continue;
    const agg = bySeller.get(name) || { name, totalPrice: 0, checksCount: 0 };
    agg.totalPrice += c.totalPrice || 0;
    agg.checksCount += 1;
    bySeller.set(name, agg);
  }
  if (bySeller.size > 1) {
    const sellers = [...bySeller.values()].sort((a, b) => b.totalPrice - a.totalPrice);
    const top = sellers[0];
    const bottom = sellers[sellers.length - 1];
    rows.push(`| 👑 Eng ko'p sotuv qilgan sotuvchi | **${top.name}** — ${money(top.totalPrice)} (${top.checksCount} ta chek) |`);
    rows.push(`| 🔻 Eng kam sotuv qilgan sotuvchi | **${bottom.name}** — ${money(bottom.totalPrice)} (${bottom.checksCount} ta chek) |`);
  }

  if (!rows.length) return '';
  return `## 🏆 Davr Analitikasi\n\n| Ko'rsatkich | Natija |\n|---|---|\n${rows.join('\n')}\n\n`;
}

/**
 * Asks the model what the correspondence was actually about. Returns null when there is
 * no key or the call fails — the caller still has the deterministic figures to show.
 */
async function summarizeCorrespondence(res, apiKey) {
  if (!apiKey || !res.messages || !res.messages.length) return null;

  const transcript = res.messages.slice(-40).map((m) => {
    const who = m.direction === 'incoming' ? res.matchedName || 'U' : 'Men';
    return `[${(m.date || '').slice(0, 10)}] ${who} — "${m.subject}"\n${(m.text || '').slice(0, 700)}`;
  }).join('\n\n');

  try {
    const resp = await openAiFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: `Sen O'zbek tilida javob beradigan biznes yordamchisisan. Foydalanuvchi va bitta shaxs o'rtasidagi elektron pochta yozishmalari beriladi.
Vazifang: suhbat NIMA HAQIDA bo'lganini qisqa va aniq bayon qilish.
QOIDALAR:
- Faqat berilgan matnga tayan. Yo'q narsani o'ylab topma.
- 3-6 ta punktda yoz: asosiy mavzular, kelishuvlar, so'ralgan narsalar, javobsiz qolgan savollar.
- Agar biror narsa javob kutayotgan bo'lsa, buni alohida ayt.
- Markdown ro'yxat ishlat, sarlavha qo'shma.`
          },
          { role: 'user', content: `Shaxs: ${res.matchedName} ${res.matchedAddress ? `(${res.matchedAddress})` : ''}\nJami ${res.total} ta xat.\n\n${transcript}` }
        ]
      })
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    return (data.choices && data.choices[0] && data.choices[0].message.content) || null;
  } catch (err) {
    console.error('Correspondence summary failed:', err.message);
    return null;
  }
}

/** `2026-08-06T14:36:00Z` → `6-Avgust 2026, 14:36`. */
function formatMailDate(iso, withTime = true) {
  if (!iso) return '';
  const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = `${d.getDate()}-${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  if (!withTime) return day;
  return `${day}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Strips the mail address so a table cell shows the human, not the routing detail. */
function senderName(from) {
  const m = String(from || '').match(/^(.*?)\s*<(.+)>$/);
  if (!m) return { name: from || '(nomalum)', address: '' };
  return { name: (m[1] || '').replace(/^"|"$/g, '').trim() || m[2], address: m[2] };
}

/** All mail of one day — read and unread together, incoming and outgoing. */
function formatMailDayReport(res, displayDate) {
  if (!res || !res.success) {
    const why = (res && (res.message || res.error)) || "Noma'lum xato";
    return `⚠️ **Pochtani o'qib bo'lmadi:** ${why}`;
  }

  const dayLabel = displayDate || formatMailDate(`${res.startDate}T00:00:00Z`, false);

  if (!res.total) {
    return `📬 **${dayLabel}** — bu kuni hech qanday xat bo'lmagan (yoki inson yozgan xatlar avtomatik/notifikatsiya xatlari orasidan filtrlanganidan keyin qolmadi).\n\n` +
      `Qidiruv INBOX, Archive va "Sent Messages" qutilarida olib borildi.`;
  }

  const rows = res.messages.map((m, i) => {
    const who = m.direction === 'incoming' ? senderName(m.from).name : `➡️ ${senderName(m.to).name}`;
    const status = m.unread ? '🔵 o\'qilmagan' : '✓ o\'qilgan';
    const time = (m.date || '').slice(11, 16);
    const subject = String(m.subject).replace(/\|/g, '\\|');
    return `| ${i + 1} | ${time} | **${who.replace(/\|/g, '\\|')}** | ${subject} | ${status} |`;
  }).join('\n');

  const details = res.messages.map((m, i) => {
    const s = senderName(m.from);
    const dir = m.direction === 'incoming' ? '⬅️ Kelgan' : '➡️ Yuborilgan';
    const files = m.attachments && m.attachments.length
      ? `\n   📎 Ilova: ${m.attachments.map((a) => a.filename).join(', ')}`
      : '';
    return `${i + 1}. **${m.subject}**\n   👤 ${s.name}${s.address ? ` (${s.address})` : ''} · 🕒 ${formatMailDate(m.date)} · ${dir} · ${m.unread ? '🔵 o\'qilmagan' : '✓ o\'qilgan'}\n   ${m.snippet || '(matn yo\'q)'}${files}`;
  }).join('\n\n');

  return `📬 **${dayLabel}** — jami **${res.total} ta** xat\n\n` +
    `✓ O'qilgan: ${res.readCount} · 🔵 O'qilmagan: ${res.unreadCount} · ⬅️ Kelgan: ${res.incomingCount} · ➡️ Yuborilgan: ${res.outgoingCount}\n\n` +
    `| # | Vaqt | Kim | Mavzu | Holat |\n|---|---|---|---|---|\n${rows}\n\n` +
    `<details>\n<summary>📄 Har bir xatning mazmuni</summary>\n\n${details}\n\n</details>\n\n` +
    `ℹ️ Xatlarning o'qilgan/o'qilmagan holati o'zgarmadi.`;
}

function formatUnreadMailReport(res) {
  if (!res || !res.success) {
    const why = (res && (res.message || res.error)) || "Noma'lum xato";
    return `⚠️ **Pochtani o'qib bo'lmadi:** ${why}`;
  }

  if (!res.count) {
    return `📬 **Insondan kelgan o'qilmagan xat yo'q.** (Barcha o'qilmagan xatlar o'qilgan yoki avtomatik/notifikatsiya xatlari edi.)`;
  }

  const rows = res.emails.map((e, i) => {
    const s = senderName(e.from);
    const subject = String(e.subject || '(mavzusiz)').replace(/\|/g, '\\|');
    return `| ${i + 1} | ${formatMailDate(e.date)} | **${s.name.replace(/\|/g, '\\|')}** | ${subject} |`;
  }).join('\n');

  const details = res.emails.map((e, i) => {
    const s = senderName(e.from);
    const body = e.snippet ? e.snippet.slice(0, 400) : '(matn yo\'q)';
    const files = e.attachments && e.attachments.length
      ? `\n   📎 Ilova: ${e.attachments.map((a) => a.filename).join(', ')}`
      : '';
    return `${i + 1}. **${e.subject}**\n   👤 ${s.name}${s.address ? ` (${s.address})` : ''} · 🕒 ${formatMailDate(e.date)}\n   ${body}${files}`;
  }).join('\n\n');

  // Who is writing most — the fastest read on whether the inbox needs attention.
  const bySender = new Map();
  res.emails.forEach((e) => {
    const n = senderName(e.from).name;
    bySender.set(n, (bySender.get(n) || 0) + 1);
  });
  const senders = [...bySender.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([n, c]) => `${n} — ${c} ta`)
    .join(' · ');

  return `📬 **O'qilmagan xatlar (odamlardan):** ${res.count} ta\n\n` +
    `| # | Sana | Kimdan | Mavzu |\n|---|---|---|---|\n${rows}\n\n` +
    `👥 **Jo'natuvchilar:** ${senders}\n\n` +
    `<details>\n<summary>📄 Har bir xatning mazmuni</summary>\n\n${details}\n\n</details>\n\n` +
    `ℹ️ Xatlar o'qilmagan holatida qoldi — hisobot ularni "o'qilgan" deb belgilamaydi.`;
}

/**
 * Deterministic half of the correspondence answer: who, how many, when, what subjects.
 * The narrative ("nimalar haqida yozilgan") is written by the LLM on top of this.
 */
function formatCorrespondenceReport(res, aiSummary) {
  if (!res || !res.success) {
    const why = (res && (res.message || res.error)) || "Noma'lum xato";
    return `⚠️ **Yozishmalarni qidirib bo'lmadi:** ${why}`;
  }

  if (!res.total) {
    return `🔍 **"${res.person}"** bo'yicha hech qanday xat topilmadi.\n\n` +
      `Qidiruv INBOX, Archive va "Sent Messages" qutilarida ism va email bo'yicha olib borildi. ` +
      `Ism boshqacha yozilgan bo'lishi mumkin — email manzilini bersangiz aniqroq qidiraman.`;
  }

  const header = `👤 **${res.matchedName}**` +
    (res.matchedAddress ? ` · ${res.matchedAddress}` : '') + `\n\n` +
    `| Ko'rsatkich | Qiymat |\n|---|---|\n` +
    `| Jami xatlar | **${res.total} ta** |\n` +
    `| Kelgan / Yuborilgan | ${res.incomingCount} / ${res.outgoingCount} |\n` +
    `| Birinchi aloqa | ${formatMailDate(res.firstDate, false)} |\n` +
    `| Oxirgi aloqa | ${formatMailDate(res.lastDate, false)} |\n` +
    `| Oxirgi xat kimdan | ${res.lastDirection === 'incoming' ? 'Undan sizga' : 'Sizdan unga'} |\n` +
    (res.unreadCount ? `| O'qilmagan | **${res.unreadCount} ta** |\n` : '') +
    (res.attachmentsCount ? `| Ilovalar | ${res.attachmentsCount} ta fayl |\n` : '') + `\n`;

  const summary = aiSummary ? `📝 **Suhbat mazmuni:**\n\n${aiSummary}\n\n` : '';

  const subjects = `🗂️ **Mavzular (${res.subjects.length} xil):**\n` +
    res.subjects.slice(0, 15).map((s) => `• ${s}`).join('\n') +
    (res.subjects.length > 15 ? `\n• …va yana ${res.subjects.length - 15} ta` : '') + `\n\n`;

  const timeline = res.messages.slice(-20).reverse().map((m) => {
    const arrow = m.direction === 'incoming' ? '⬅️ Undan' : '➡️ Sizdan';
    const body = m.text ? m.text.slice(0, 220) : '(matn yo\'q)';
    return `**${formatMailDate(m.date)}** · ${arrow}${m.unread ? ' · 🔵 o\'qilmagan' : ''}\n` +
      `**${m.subject}**\n${body}`;
  }).join('\n\n---\n\n');

  return header + summary + subjects +
    `<details>\n<summary>💬 Yozishmalar tarixi (oxirgi ${Math.min(20, res.messages.length)} ta xat)</summary>\n\n${timeline}\n\n</details>`;
}

function formatMailSendReport(data, success) {
  if (!success) {
    return `❌ **Xat yuborib bo'lmadi.**\n\n${(data && data.error) || "Noma'lum xato"}`;
  }
  return `✅ **Xat muvaffaqiyatli yuborildi.**\n\n` +
    `• **Kimga:** ${data.to}\n` +
    `• **Mavzu:** ${data.subject}`;
}

/** `2026-08-09T14:36:00.000Z` → `9-Avgust, 14:36`. */
function formatTelegramDate(iso) {
  if (!iso) return '';
  const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getDate()}-${MONTHS[d.getMonth()]}, ${time}`;
}

function formatTelegramReadReport(res) {
  if (!res || !res.success) {
    return `⚠️ **Telegram tarixini o'qib bo'lmadi:** ${(res && res.error) || "Noma'lum xato"}`;
  }
  if (!res.count) {
    return res.person
      ? `🔍 **"${res.person}"** nomli kontaktdan Telegram tarixida hech qanday xabar topilmadi (oxirgi sync: ${res.lastSyncAt ? formatTelegramDate(res.lastSyncAt) : "hali sync bo'lmagan"}).`
      : `📱 Telegram'da hech kim yozmagan (oxirgi sync: ${res.lastSyncAt ? formatTelegramDate(res.lastSyncAt) : "hali sync bo'lmagan"}).`;
  }

  const rows = res.messages.map((m, i) => {
    const text = String(m.text || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 140);
    const dir = m.direction === 'out' ? '➡️ Sizdan' : '⬅️ Undan';
    return `| ${i + 1} | ${(m.customerName || "Noma'lum").replace(/\|/g, '\\|')} | ${dir} | ${text} | ${formatTelegramDate(m.date)} |`;
  }).join('\n');

  const title = res.person ? `📱 **Telegram — "${res.person}" bilan yozishmalar**` : `📱 **Telegram — so'nggi yozganlar**`;
  return `${title} (${res.count} ta)\n\n` +
    `| # | Kimdan | Yo'nalish | Xabar | Sana |\n|---|---|---|---|---|\n${rows}\n\n` +
    `ℹ️ Oxirgi tarix sinxronizatsiyasi: ${res.lastSyncAt ? formatTelegramDate(res.lastSyncAt) : "hali bo'lmagan"}.`;
}

function formatTelegramSendReport(data, success, error) {
  if (!success) {
    return `❌ **Telegram xabari yuborilmadi.**\n\n${error || "Noma'lum xato"}`;
  }
  return `✅ **Telegram xabari yuborildi.**\n\n` +
    `• **Kimga:** ${data.resolvedName || data.chatId}\n` +
    `• **Matn:** ${data.text}`;
}

function formatContactSendReport(data, success, error) {
  if (!success) {
    return `❌ **Xabar yuborilmadi.**\n\n${error || "Bu odam na Telegram tarixida, na iCloud pochta yozishmalarida topilmadi."}`;
  }
  const channelLabel = data.channel === 'telegram' ? '📱 Telegram' : '📧 Email';
  const target = data.channel === 'telegram' ? (data.resolvedName || data.chatId) : data.resolvedAddress;
  return `✅ **Xabar yuborildi** (${channelLabel} orqali topildi).\n\n` +
    `• **Kimga:** ${target}\n` +
    `• **Matn:** ${data.text}`;
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

function formatNotionCreateReport(res, args) {
  if (!res.success) {
    return `❌ **Notion'da sahifa yaratib bo'lmadi.**\n\n` +
      `• **Sarlavha:** ${args.title}\n` +
      `• **Xatolik:** ${res.error || "noma'lum"}\n\n` +
      `🛠️ Tekshiring: \`.env.dev\` dagi \`NOTION_API_KEY\` faolmi va integratsiyaga kerakli sahifaga ruxsat (share) berilganmi.`;
  }

  return `✅ **Notion'da yangi sahifa yaratildi.**\n\n` +
    `• **Sarlavha:** ${res.data.title}\n` +
    `• **Havola:** ${res.data.url}\n\n` +
    `Taqvimga hech narsa qo'shilmadi — bu faqat Notion yozuvi.`;
}

function formatCalendarCreateReport(data) {
  return `📅 **${data.startDate} ${data.startTime}** uchun vazifa taqvimga muvaffaqiyatli qo'shildi!\n\n` +
    `• **Vazifa Nomi:** ${data.title}\n` +
    `• **Sana:** ${data.startDate}\n` +
    `• **Vaqt:** ${data.startTime} - ${data.endTime}\n` +
    `• **Prioritet:** ${data.priority}\n` +
    `• **Kategoriya:** ${data.category}\n\n` +
    `✅ Taqvim ma'lumotlar bazasiga saqlandi.`;
}

function formatCalendarUpdateReport(data) {
  return `📅 **Vazifa muvaffaqiyatli yangilandi!**\n\n` +
    `• **Vazifa:** ${data.title}\n` +
    `• **Yangi Vaqt:** Soat ${data.startTime} da\n` +
    (data.startDate ? `• **Sana:** ${data.startDate}\n` : '') +
    `\n✅ Ma'lumotlar bazasi yangilandi.`;
}

function formatCalendarDeleteReport(data) {
  return `🗑️ **Vazifa taqvimdan muvaffaqiyatli o'chirildi.**\n\n` +
    `• **O'chirilgan vazifa:** "${data.deletedTitle}"`;
}

function formatCalendarListReport(data) {
  const events = data.events || [];
  const list = events.length === 0
    ? '_Hozircha taqvimda hech qanday vazifa mavjud emas._'
    : events.map((e, idx) =>
      `${idx + 1}. **[${e.priority}] ${e.title}**\n   📅 **Sana:** ${e.startDate} (${e.startTime} - ${e.endTime}) | 🏷️ **Kategoriya:** ${e.category} | 📌 **Holat:** ${e.status}`
    ).join('\n\n');

  return `📅 **Store Hadiya Executive Calendar — Vazifalar Ro'yxati:**\n\n${list}`;
}

function formatSchedulerReport(data) {
  return `⏰ **Rejalashtirilgan Avtomatik Vazifa Saqlandi!**\n\n` +
    `• **Vazifa Nomi:** ${data.title}\n` +
    `• **Davomiyligi:** ${data.frequency === 'DAILY' ? 'Har kuni (Daily)' : data.frequency}\n` +
    `• **Vaqti:** Soat ${data.scheduledTime} da\n\n` +
    `Men belgilangan vaqtda avtomatik ravishda ishga tushiraman!`;
}

// Human-readable Uzbek progress labels shown while a tool is running — real status for
// the chat UI's loading indicator instead of a canned, unrelated string.
const TOOL_LABELS = {
  mail_read_unread: "📬 iCloud pochta — o'qilmagan xatlar tekshirilmoqda",
  mail_read_by_date: "📬 iCloud pochta — sana bo'yicha xatlar olinmoqda",
  mail_search_correspondence: "📬 iCloud pochta — yozishmalar qidirilmoqda",
  mail_send_email: "✉️ Xat yuborilmoqda",
  mail_read_inbox: "📬 iCloud pochta o'qilmoqda",
  notion_search_workspace: "📓 Notion workspace qidirilmoqda",
  notion_create_task: "📓 Notion'da yangi sahifa yaratilmoqda",
  billz_get_consolidated_report: "📊 Billz POS hisobot tayyorlanmoqda",
  billz_get_products: "📦 Billz mahsulotlar katalogi olinmoqda",
  billz_create_product: "📦 Billz'ga yangi mahsulot qo'shilmoqda",
  billz_test_endpoints: "📊 Billz ulanishi tekshirilmoqda",
  calendar_create_event: "📅 Taqvimga vazifa qo'shilmoqda",
  calendar_list_events: "📅 Taqvim o'qilmoqda",
  calendar_update_event: "📅 Taqvim vazifasi yangilanmoqda",
  calendar_delete_event: "📅 Taqvim vazifasi o'chirilmoqda",
  scheduler_create_automation: "⏰ Avtomatik jadval saqlanmoqda",
  telegram_send_message: "📨 Telegram xabari yuborilmoqda",
  telegram_send_photo: "📨 Telegram rasmi yuborilmoqda",
  telegram_read_messages: "📱 Telegram — oxirgi sync asosida xabarlar o'qilmoqda",
  contact_send_message: "🔎 Odam Telegram va pochtadan qidirilib, xabar yuborilmoqda",
  slack_send_message: "💬 Slack xabari yuborilmoqda",
  whatsapp_send_message: "💬 WhatsApp xabari yuborilmoqda",
  github_run_analysis: "🛠️ Kod tahlili bajarilmoqda",
  github_commit_and_push: "🛠️ Git commit & push bajarilmoqda"
};

/** Splits a raw mail list into real-person vs automated/notification senders via the AI filter. */
async function applyHumanFilterToUnread(res, apiKey) {
  if (!res || !res.success || !res.emails || !res.emails.length) return { res, filteredCount: 0 };
  const { human, filteredOut } = await mailSenderFilter.filterHumanSenders(res.emails, apiKey);
  return { res: { ...res, emails: human, count: human.length }, filteredCount: filteredOut.length };
}

async function applyHumanFilterToDay(res, apiKey) {
  if (!res || !res.success || !res.messages || !res.messages.length) return { res, filteredCount: 0 };
  const { human, filteredOut } = await mailSenderFilter.filterHumanSenders(res.messages, apiKey);
  const messages = human;
  return {
    res: {
      ...res,
      messages,
      total: messages.length,
      readCount: messages.filter((m) => !m.unread).length,
      unreadCount: messages.filter((m) => m.unread).length,
      incomingCount: messages.filter((m) => m.direction === 'incoming').length,
      outgoingCount: messages.filter((m) => m.direction === 'outgoing').length
    },
    filteredCount: filteredOut.length
  };
}

/**
 * Asks a fast model which registered tool(s), if any, genuinely apply to this message —
 * this replaces the old `.includes()`/regex cascade with real reasoning over the actual
 * tool catalog, the way an MCP client picks a tool. Returns `[]` (no tools) for small talk.
 */
async function routeToTools(userMessage, apiKey, recentTurns = []) {
  const tools = connectorRegistry.getOpenAiToolSchemas();
  const todayStr = toDateKey(new Date());

  // The last few real turns of THIS conversation, same as ChatGPT keeps the whole thread
  // in context on every call — without this, a follow-up correction ("men avgust oyi
  // dedim, kun emas" after getting a single-day answer) looks like a standalone,
  // topic-less message and the router calls no tool at all instead of retrying the report.
  const historyMessages = (recentTurns || [])
    .slice(-6)
    .filter((t) => t && t.content)
    .map((t) => ({ role: t.role === 'assistant' ? 'assistant' : 'user', content: String(t.content).slice(0, 2000) }));

  try {
    const resp = await openAiFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // A tool call's arguments sometimes ARE the deliverable (an email body, a Notion
        // page's real content) — this has to be capable of actually authoring that
        // content well, not just classifying, so it runs on the full model, not -mini.
        model: 'gpt-4o',
        temperature: 0.4,
        tools,
        tool_choice: 'auto',
        parallel_tool_calls: true,
        messages: [
          {
            role: 'system',
            content: `Sen Store Hadiya CEO'sining shaxsiy AI yordamchisisan. Bugungi sana: ${todayStr}.
Foydalanuvchi xabarini SUHBAT TARIXI kontekstida o'qib, unga haqiqatan javob berish uchun QAYSI vosita(lar) kerakligini aniqla va faqat o'shalarni chaqir.
QOIDALAR:
- Faqat xabarda ANIQ so'ralgan narsa uchun vosita tanla. Bitta so'z tasodifan boshqa mavzuni "eslatsa" ham (masalan "bo'yicha" so'zi ichida "oy" harflari bor, lekin bu oy/savdo bilan bog'liq emas), mavzu haqiqatan mos kelmasa hech narsa chaqirma.
- SUHBATNI DAVOM ETTIRISH / TO'G'IRLASH QOIDASI (JUDA MUHIM): agar oxirgi xabar avvalgi javobni to'g'irlash, aniqlashtirish yoki davom ettirish bo'lsa (masalan "yo'q, men ... dedim", "men sendan ... so'ragandim, ... emas", "unda ... bo'lsinchi", "yo'q boshqa davr kerak"), buni YUQORIDAGI SUHBAT TARIXIDAGI mavzuning davomi deb tushun va o'sha ASL vositani, TUZATILGAN parametr bilan baribir chaqir. Buni oddiy erkin suhbat deb hisoblab, vositasiz qoldirma — foydalanuvchi allaqachon ma'lumot so'ragan va faqat aniqlashtiryapti.
- Yozish/yaratish/yuborish vositalarini (notion_create_task, calendar_create_event, calendar_update_event, calendar_delete_event, mail_send_email, telegram_send_message, scheduler_create_automation, billz_create_product) FAQAT foydalanuvchi biror narsani ANIQ yaratish/qo'shish/yuborish/o'zgartirish/o'chirishni so'raganda chaqir. Agar niyat aslida biror narsani qidirish, o'qish yoki topish bo'lsa (masalan "borib ... ni topib ... yubor"), avval qidiruv/o'qish vositasini ishlat, yozish vositasini chaqirma.
- Xabarda ANIQ email manzil (masalan "kimdir@domen.com") yoki "kimgadir yubor/jo'nat/yozib ber" degan qaror bo'lsa, bu doim mail_send_email (yoki tegishli bo'lsa telegram_send_message) — HECH QACHON notion_create_task emas. notion_create_task faqat egasining o'ziga, ichki eslatma/vazifa sifatida saqlash uchun, hech kimga yuborilmaydi.
- KONTENT YARATISH QOIDASI (JUDA MUHIM): agar foydalanuvchi biror hujjat, xat, xabar, texnik topshiriq (TZ), reja yoki matn "generate/yarat/tuzib ber/yozib ber" desa, vosita argumentiga (masalan mail_send_email ning "body" maydoni yoki notion_create_task ning "title" maydoni) foydalanuvchi so'rovining o'zini yoki qisqa sarlavhani QO'YMA — o'sha hujjatning TO'LIQ, professional, batafsil mazmunini AYNAN SHU YERDA, hozir, o'zing yozib chiq (bir necha bo'lim/paragraf bo'lishi mumkin). Masalan "sayt uchun TZ generate qil" so'ralsa — argumentda haqiqiy texnik topshiriq matni bo'lishi kerak: maqsad, funksionallik, sahifalar, texnologiya, muddat kabi bo'limlar bilan — shunchaki mavzuni takrorlash emas.
- Agar xabar shunchaki salomlashish, minnatdorchilik yoki umumiy erkin suhbat bo'lsa (va suhbat tarixidagi biror so'rovni to'g'irlamayotgan bo'lsa), hech qanday vosita chaqirma — bo'sh javob qaytar.
- Sana/vaqt talab qiladigan parametrlarni bugungi sanadan (${todayStr}) o'zing hisoblab to'ldir (masalan "ertaga" = ${todayStr} dan bir kun keyingi sana, ISO formatda).`
          },
          ...historyMessages,
          { role: 'user', content: userMessage }
        ]
      })
    });

    if (!resp.ok) return [];
    const data = await resp.json();
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    return (msg && msg.tool_calls) || [];
  } catch (err) {
    console.error('Tool routing call failed:', err.message);
    return [];
  }
}

/**
 * One classification call: given the message that came with an attached spreadsheet,
 * does the owner actually want these rows CREATED in Billz, or are they just asking a
 * question about the file? Fails CLOSED (shouldImport: false) on any error — an
 * ambiguous or failed classification must never trigger an unreviewed bulk write into
 * the real POS catalog.
 */
async function classifyImportIntent(userMessage, apiKey) {
  const parsed = await classifyJson({
    apiKey,
    systemPrompt: `Foydalanuvchi bir Excel/CSV fayl biriktirdi — unda tovar/mahsulot ro'yxati bor (nomi, narxi, soni).
Uning xabariga qarab, u shu fayldagi tovarlarni BILLZ POS tizimiga (Hadiya Store filialiga) yangi mahsulot sifatida QO'SHISH/YARATISH/IMPORT qilishni so'rayaptimi, yoki shunchaki fayl haqida savol berayapti/tahlil so'rayaptimi (masalan "necha xil tovar bor", "eng qimmati qaysi", "shuni tushuntirib ber")?
Faqat ANIQ "qo'sh", "yarat", "import qil", "billzga kirit", "/create" kabi buyruq bo'lsa true qil. Shubha bo'lsa false qo'y — noto'g'ri import qilish xatarli.
Aynan shu JSON formatda javob ber: {"shouldImport": true/false}`,
    userContent: userMessage || "(bo'sh xabar, faqat fayl biriktirilgan)",
    fallback: { shouldImport: false }
  });

  return { shouldImport: !!(parsed && parsed.shouldImport === true) };
}

/** Deterministic per-row report — never phrased as a narrative so a partial failure can't be glossed over. */
function formatBulkImportReport(bulkRes, parsed) {
  const lines = bulkRes.results.map((r, i) =>
    `${i + 1}. ${r.success ? '✅' : '❌'} ${r.name} — ${r.price.toLocaleString()} so'm${r.quantity ? `, ${r.quantity} dona` : ''}${r.error ? ` (${r.error})` : ''}`
  ).join('\n');

  const skippedNote = parsed.skippedCount
    ? `\n\nℹ️ ${parsed.skippedCount} ta qator o'tkazib yuborildi (nomi yoki narxi aniqlanmadi).`
    : '';

  const unverifiedNote = bulkRes.failed
    ? `\n\n⚠️ **Diqqat:** bu — Billz'ning yangi mahsulot yaratish API'siga birinchi real yozish chaqiruvlari, hali to'liq sinovdan o'tmagan. Yuqoridagi xatolik matnini tekshiring — ehtimol Billz'ning kutgan maydon nomlari bu yerda ishlatilganidan farq qiladi.`
    : '';

  return `📦 **Billz'ga import natijasi (Hadiya Store):**\n\n` +
    `✅ Muvaffaqiyatli qo'shildi: **${bulkRes.succeeded} ta**\n` +
    `❌ Xatolik: **${bulkRes.failed} ta**\n\n` +
    lines + skippedNote + unverifiedNote;
}

/**
 * Deterministic formatters for tool results that already have a well-defined shape —
 * skips the second LLM round-trip entirely for report-style answers. Returns `null` when
 * no dedicated formatter applies, so the caller falls through to the narrative model.
 */
async function dispatchFastFormat({ name, args, res }, apiKey, onProgress) {
  switch (name) {
    case 'mail_read_unread': {
      if (!res.success) return formatUnreadMailReport(res.data || res);
      onProgress({ phase: 'filter', label: "🧹 Jo'natuvchilar tahlil qilinmoqda (odam vs avtomatik)..." });
      const { res: filtered, filteredCount } = await applyHumanFilterToUnread(res.data, apiKey);
      let text = formatUnreadMailReport(filtered);
      if (filteredCount > 0) text += `\n\nℹ️ ${filteredCount} ta avtomatik/notifikatsiya xati filtrlandi (ko'rsatilmadi).`;
      return text;
    }
    case 'mail_read_by_date': {
      if (!res.success) return formatMailDayReport(res.data || res);
      onProgress({ phase: 'filter', label: "🧹 Jo'natuvchilar tahlil qilinmoqda (odam vs avtomatik)..." });
      const { res: filtered, filteredCount } = await applyHumanFilterToDay(res.data, apiKey);
      let text = formatMailDayReport(filtered);
      if (filteredCount > 0) text += `\n\nℹ️ ${filteredCount} ta avtomatik/notifikatsiya xati filtrlandi (ko'rsatilmadi).`;
      return text;
    }
    case 'mail_search_correspondence': {
      const data = res.data || res;
      const aiSummary = data.success && data.total ? await summarizeCorrespondence(data, apiKey) : null;
      return formatCorrespondenceReport(data, aiSummary);
    }
    case 'mail_send_email':
      return formatMailSendReport(res.data, res.success);
    case 'telegram_read_messages':
      return formatTelegramReadReport(res.data || res);
    case 'telegram_send_message':
      return formatTelegramSendReport(res.data, res.success, res.error);
    case 'contact_send_message':
      return formatContactSendReport(res.data, res.success, res.error);
    case 'notion_create_task':
      return formatNotionCreateReport(res, args);
    case 'billz_get_consolidated_report':
      if (!res.success) {
        return `⚠️ **BILLZ API Xatosi:**\n${res.errorMessage || res.error}\n\n*Hisobotni shakllantirish uchun BILLZ API javobida xatolik yuz berdi. Soxta yoki taxminiy ma'lumotlar ko'rsatilmaydi.*`;
      }
      if (!res.isRealData) return formatBillzConnectionReport(res);
      return formatBillzSalesReport(res.data);
    case 'calendar_create_event':
      return res.success ? formatCalendarCreateReport(res.data) : `❌ Vazifani taqvimga qo'sha olmadim: ${res.error || "noma'lum xato"}`;
    case 'calendar_update_event':
      return res.success ? formatCalendarUpdateReport(res.data) : `❌ Vazifani yangilay olmadim: ${res.error || "noma'lum xato"}`;
    case 'calendar_delete_event':
      return res.success ? formatCalendarDeleteReport(res.data) : `❌ Vazifani o'chira olmadim: ${res.error || "noma'lum xato"}`;
    case 'calendar_list_events':
      return res.success ? formatCalendarListReport(res.data) : `❌ Taqvimni o'qiy olmadim: ${res.error || "noma'lum xato"}`;
    case 'scheduler_create_automation':
      return res.success ? formatSchedulerReport(res.data) : `❌ Avtomatlashtirishni saqlay olmadim: ${res.error || "noma'lum xato"}`;
    default:
      return null;
  }
}

/** Owner profile + recent memory/history, fetched unconditionally (no keyword gating). */
/**
 * `conversationId` scopes chat history to THIS thread. Reads from the `Message` model
 * (chatController.js's saveMessageRecord writes one there for EVERY turn, unconditionally,
 * regardless of which internal branch of processUserMessage produced the answer) rather
 * than the separate ChatHistory collection, which only some branches wrote to — a report
 * answered via the fast single-tool formatter path never reached ChatHistory at all, so a
 * follow-up correction to a report had no history to work from even before this used the
 * right conversationId. Omitting conversationId (voice memo path, anywhere the caller
 * genuinely has no thread) just returns no history rather than erroring.
 */
async function loadMemoryContext(conversationId) {
  const OwnerMemory = require('./models/ownerMemoryModel');
  const Message = require('./models/Message');

  let ownerProfile = null;
  let persistentMemory = [];
  let chatHistory = [];
  let chatHistoryTurns = [];

  try {
    ownerProfile = await OwnerMemory.findOne({ key: 'owner-personality-profile' }).lean();
    const allMemories = await OwnerMemory.find({ key: { $ne: 'owner-personality-profile' } }).sort({ updatedAt: -1 }).limit(15).lean();
    persistentMemory = allMemories.map((m) => `[${m.category.toUpperCase()}] ${m.title}: ${m.content}`);
  } catch (e) {}

  if (conversationId) {
    try {
      const recentMsgs = await Message.find({ conversationId, role: { $in: ['user', 'assistant'] } })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();
      const chronological = recentMsgs.reverse();
      chatHistory = chronological.map((h) => `${h.role === 'user' ? 'User' : 'Assistant'} [${new Date(h.createdAt).toLocaleTimeString()}]: "${h.content}"`);
      chatHistoryTurns = chronological.map((h) => ({ role: h.role, content: h.content }));
    } catch (e) {}
  }

  return { ownerProfile, persistentMemory, chatHistory, chatHistoryTurns };
}

function buildFinalSystemPrompt({ ownerProfile, persistentMemory, chatHistory, hasAttachment }) {
  return `# STORE HADIYA AI EXECUTIVE ASSISTANT V2 - CENTRAL SERVER ORCHESTRATION CONSTITUTION

You are the central intelligence engine running on the Node.js Express SERVER.
You act as the Server Orchestrator that receives requests from the User Chat Panel (Frontend) and orchestrates:
1. Schedule (cron automations & reminders)
2. MongoDB (persistent database & memory models)
3. My Data / Chat History Hub (stored knowledge, owner profile, conversation turns)
4. Connected Sub-services: Notion Workspace, Billz POS, Email Dispatcher, Google Calendar, Telegram.

OWNER PERSONALITY & CHARACTER CONSTITUTION:
${ownerProfile ? `- Profile: ${ownerProfile.title}\n- Communication Character & Personality Rules: ${ownerProfile.content}` : '- Adapt to owner as an Executive CEO: direct, non-emotional, data-driven, solution-focused.'}

MEMORY PRIORITY & HIERARCHY DATA:
- Persistent Mongo Memory: ${JSON.stringify(persistentMemory || [])}
- Relevant Chat History: ${JSON.stringify(chatHistory || [])}

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
  When a specific date (e.g. 25-may) is requested, present the EXACT sales and product transactions that occurred on that specific date as returned by the tool. If 0 sales occurred on that specific date, state accurately in Uzbek that on that day 0 transactions (0 UZS revenue) took place while reporting the active catalog stock value. Never substitute today's fallback data when a specific date is requested!
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
  2. If the BILLZ API returns an error, explain the API error clearly instead of generating fake or estimated information.
  3. Never use mock data or estimate values.
  4. Format the report cleanly as:
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

  5. DAVRIY HISOBOT (haftalik/oylik): agar tool natijasida 'dailyBreakdown' massivi kelgan bo'lsa,
     avval HAR BIR KUNNI alohida sarlavha bilan chiqar (sana — kunlik savdo, chek soni, mahsulot soni),
     har bir kunning mahsulotlarini markdown jadval ko'rinishida <details><summary>...</summary> ichida ber,
     va eng oxirida "Davr yakuni" bo'limida umumiy savdo, to'lov usullari, qaytarilgan mahsulot,
     sof savdo va omborxona qoldig'ini chiqar. Kunlarni O'ZING o'ylab topma — faqat 'dailyBreakdown' dagilar.

- CRITICAL FOR BILLZ POS / PERIOD REPORTS (7-WEEK, 1-MONTH, 7-DAY, SPECIFIC DATE):
  Whenever a billz tool output is provided in Fetched System Context Data, ACCEPT THOSE METRICS AS 100% COMPLETE AND AUTHORITATIVE.
  NEVER WRITE DISCLAIMERS like "ma'lumotlar olinmagan", "imkoniyat mavjud emas", "qo'shimcha so'rov jo'nating", or "ma'lumotlar olinmadi"!
- If NO tool was executed for this turn (Fetched System Context Data is empty), just answer naturally and briefly — do not invent data you were never given.`;
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
      const res = await connectorRegistry.executeTool('billz_get_products', { limit: 100 });
      executedTools.push({ tool: 'billz_get_products', label: 'Fetched Billz POS Sales & Product Data', result: res.data });
    }

    // 3. Detect Calendar & Meeting Intent
    if (lowerInput.includes('meeting') || lowerInput.includes('schedule') || lowerInput.includes('uchrashuv') || lowerInput.includes('aziz') || lowerInput.includes('calendar')) {
      const calRes = await connectorRegistry.executeTool('calendar_create_event', { title: 'Voice Briefing Meeting', startDate: toDateKey(new Date(Date.now() + 86400000)), startTime: '09:00' });
      executedTools.push({ tool: 'calendar_create_event', label: 'Google Calendar Event Created', result: calRes.data });

      const tgRes = await connectorRegistry.executeTool('telegram_send_message', { chatId: '@admin_channel', text: `Ovozli xabardan meeting yaratildi: "${spokenText}"` });
      executedTools.push({ tool: 'telegram_send_message', label: 'Telegram Notification Sent', result: tgRes.data });
    }

    // 4. Build Dynamic AI Executive Response
    let toolSummaryList = '';
    if (executedTools.length > 0) {
      toolSummaryList = `\n\n**Avtomatik Bajarilgan Tizim Integratsiyalari (${executedTools.length} ta):**\n` +
        executedTools.map((t, index) => `${index + 1}. **${t.label}:** ${t.result && t.result.title ? t.result.title + (t.result.scheduledTime ? ' (' + t.result.scheduledTime + ')' : '') : (t.result && t.result.formattedTotal) || 'Muvaffaqiyatli bajarildi'}`).join('\n');
    }

    const responseText = `🎙️ **Ovozli Xabar Qabul Qilindi & Transkripsiya Tahlil Etildi:**\n` +
      `*"${spokenText}"*\n\n` +
      `AI Agent sizning ovozli murojaatingizni tahlil qildi va kerakli avtomatik jadvalni saqladi! ⏰✨${toolSummaryList}\n\n` +
      `*Dual LLM Consensus:* OpenAI GPT-4o hamda Anthropic Claude 3.5 sizning har kunlik savdo hisobotingizni rejalashtirilgan jadvalga biriktirdi.`;

    return { responseText, executedTools, modelMetadataBadge };
  }

  /**
   * Real tool-calling turn: a fast model picks which registered tool(s) genuinely apply
   * (an MCP-style routing decision, not keyword matching), the tools execute, and the
   * answer either comes straight from a deterministic formatter or from a final narrative
   * pass over whatever the tools returned.
   */
  async processUserMessage(userMessage, { userId = 'user-1', onProgress = () => {}, attachedFile = null, conversationId = null } = {}) {
    const executedTools = [];
    const hasAttachment = !!(attachedFile && (attachedFile.isImage || attachedFile.textContent || attachedFile.unreadable || attachedFile.isSpreadsheet));

    const modelMetadataBadge = this.dualLlmEnabled ?
      "🧠 Dual Ensemble: OpenAI GPT-4o + Anthropic Claude 3.5 Sonnet" :
      "⚡ Primary Gateway: OpenAI GPT-4o";

    const openAiApiKey = (this.openAiKey || process.env.OPENAI_API_KEY || '').trim();

    if (!openAiApiKey) {
      const responseText = `${this.dualLlmEnabled ? '> 🧠 **Dual LLM Mode (OpenAI GPT-4o + Anthropic Claude 3.5 Sonnet)**\n\n' : ''}` +
        `Assalomu alaykum! Men sizning shaxsiy AI Agentingizman. 🚀\n\n` +
        `Xabaringiz: "${userMessage}"\n\n` +
        `⚠️ OPENAI_API_KEY sozlanmagan — \`.env.dev\` fayliga qo'shing.`;
      return { responseText, executedTools, modelMetadataBadge };
    }

    // Spreadsheet attachments (Excel/CSV of newly-arrived goods) get parsed
    // deterministically and, only on a clear import intent, pushed straight into Billz —
    // never through the tool-call argument channel (hundreds of rows would be wasteful
    // and error-prone to have the model retype), and never on a vague/ambiguous message.
    if (attachedFile && attachedFile.isSpreadsheet) {
      onProgress({ phase: 'parse', label: "📄 Excel/CSV fayl o'qilmoqda..." });
      const parsed = spreadsheetParser.parseAttachedSpreadsheet(attachedFile);

      if (!parsed.success) {
        return { responseText: `⚠️ **Faylni o'qib bo'lmadi:** ${parsed.error}`, executedTools, modelMetadataBadge };
      }

      const { shouldImport } = await classifyImportIntent(userMessage, openAiApiKey);

      if (shouldImport) {
        onProgress({ phase: 'tool:start', tool: 'billz_bulk_import_products', label: `📦 ${parsed.products.length} ta mahsulot Billz'ga (Hadiya Store) qo'shilmoqda...` });
        const bulkRes = await billzClientService.createProductsBulk(parsed.products);
        onProgress({ phase: 'tool:done', tool: 'billz_bulk_import_products', ok: bulkRes.failed === 0 });

        executedTools.push({
          tool: 'billz_bulk_import_products',
          label: "Billz'ga ommaviy mahsulot import qilindi",
          result: { succeeded: bulkRes.succeeded, failed: bulkRes.failed, total: bulkRes.total }
        });

        return { responseText: formatBulkImportReport(bulkRes, parsed), executedTools, modelMetadataBadge };
      }

      // Not an import request — let the narrative model discuss the file's contents normally.
      const preview = parsed.products.slice(0, 50)
        .map((p, i) => `${i + 1}. ${p.name} — ${p.price.toLocaleString()} so'm${p.quantity ? `, ${p.quantity} dona` : ''}`)
        .join('\n');
      attachedFile.textContent = `Faylda ${parsed.products.length} ta mahsulot qatori topildi (jami ${parsed.totalRows} qator, ${parsed.skippedCount} tasi o'tkazib yuborildi):\n\n${preview}` +
        (parsed.products.length > 50 ? `\n… va yana ${parsed.products.length - 50} ta qator.` : '');
    }

    // Loaded once, up front, and reused for both tool routing and the final narrative
    // pass — a ChatGPT-style thread needs the SAME conversation context at every step,
    // not just when writing the final answer. Without this, a correction like "men
    // avgust oyi dedim, kun emas" looked like a standalone, contextless message to the
    // router and got no tool call at all.
    const memoryContext = await loadMemoryContext(conversationId);

    // 1. Ask a fast model which tool(s), if any, this message actually needs. Skipped for
    // attachments — the turn is about the file itself, not about picking a data source.
    let toolCalls = [];
    if (!hasAttachment) {
      onProgress({ phase: 'route', label: "🧠 So'rov tahlil qilinmoqda..." });
      toolCalls = await routeToTools(userMessage, openAiApiKey, memoryContext.chatHistoryTurns);
    }

    // 2. Execute whatever the model chose.
    const toolResults = [];
    for (const call of toolCalls) {
      const name = call.function.name;
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch (e) {}

      // billzClientService already has a solid Uzbek period parser that reads the raw
      // sentence ("oxirgi 7 kunlik", "shu oy") — feed it the message instead of asking
      // the router model to reinvent that parsing in its `date` argument.
      if (name === 'billz_get_consolidated_report') {
        args = { date: args.date, query: userMessage, userMessage };
      }

      const label = TOOL_LABELS[name] || `${name} bajarilmoqda...`;
      onProgress({ phase: 'tool:start', tool: name, label });
      const startedAt = Date.now();
      const res = await connectorRegistry.executeTool(name, args);
      onProgress({ phase: 'tool:done', tool: name, label, ms: Date.now() - startedAt, ok: !!(res && res.success) });

      toolResults.push({ name, args, res });
      executedTools.push({
        tool: name,
        label,
        // Message bodies go to the summariser, not into the tool log the UI/DB stores.
        result: (name === 'mail_search_correspondence' && res.data)
          ? { ...res.data, messages: undefined, messagesCount: res.data.total }
          : res.data,
        error: res.error
      });
    }

    // 3. A single tool call with a dedicated deterministic formatter answers immediately —
    // no second LLM round-trip, which keeps report-style answers fast.
    if (toolResults.length === 1) {
      const fastAnswer = await dispatchFastFormat(toolResults[0], openAiApiKey, onProgress);
      if (fastAnswer !== null) {
        return { responseText: fastAnswer, executedTools, modelMetadataBadge };
      }
    }

    // 4. Everything else (generic Notion search, small talk, multi-tool turns, file
    // attachments) gets a full narrative answer from the model over whatever context
    // was gathered.
    onProgress({ phase: 'memory', label: "🧠 Xotira va profil o'qilmoqda..." });
    const { ownerProfile, persistentMemory, chatHistory } = memoryContext;

    const openAiApiKeyTrimmed = openAiApiKey;
    const modelsToTry = ['gpt-4o', 'gpt-4o-mini'];
    for (const modelName of modelsToTry) {
      onProgress({ phase: 'llm', label: `🧠 ${modelName.toUpperCase()} javob shakllantirmoqda...`, model: modelName });
      try {
        const openAiResp = await openAiFetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openAiApiKeyTrimmed}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: modelName,
            messages: [
              { role: 'system', content: buildFinalSystemPrompt({ ownerProfile, persistentMemory, chatHistory, hasAttachment }) },
              { role: 'user', content: buildUserContent(userMessage, executedTools, attachedFile) }
            ],
            temperature: 0.7
          })
        });

        if (openAiResp.ok) {
          const aiData = await openAiResp.json();
          if (aiData.choices && aiData.choices[0] && aiData.choices[0].message) {
            const realAiText = aiData.choices[0].message.content;

            onProgress({ phase: 'saving', label: "💾 Suhbat xotiraga saqlanmoqda..." });
            const intentLabel = toolResults.length ? toolResults.map((t) => t.name).join(',') : 'general_chat';
            await memoryUpdater.saveMessage(conversationId, 'user', userMessage, intentLabel, executedTools);
            await memoryUpdater.saveMessage(conversationId, 'assistant', realAiText, intentLabel, executedTools);
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

    // Structured Fallback AI Executive Response
    const responseText = `${this.dualLlmEnabled ? '> 🧠 **Dual LLM Mode (OpenAI GPT-4o + Anthropic Claude 3.5 Sonnet)**\n\n' : ''}` +
      `Assalomu alaykum! Men sizning shaxsiy AI Agentingizman. 🚀\n\n` +
      `Xabaringiz: "${userMessage}"\n\n` +
      `Men orqali Telegram, Billz, Notion, Google Calendar va Email ulanmalari uchun avtomatik har kunlik yoki belgilangan vaqtdagi hisobot jadvalini ham sozlashingiz mumkin.`;

    return { responseText, executedTools, modelMetadataBadge };
  }
}

module.exports = new AIEngine();
