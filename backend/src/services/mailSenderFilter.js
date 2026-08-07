/**
 * AI-driven classification of mail into real-person correspondence vs automated /
 * notification senders (social-platform alerts, marketing, no-reply, system mail...).
 *
 * Deliberately no hardcoded sender/domain list — the model reasons about each sender
 * the way a person skimming their own inbox would, so it generalizes to senders no one
 * thought to list in advance. On any failure it fails open (treats everyone as human)
 * so a broken API key never hides real mail from the owner.
 */
async function filterHumanSenders(messages, apiKey) {
  if (!messages || !messages.length) return { human: [], filteredOut: [] };
  if (!apiKey) return { human: messages, filteredOut: [] };

  const senderList = messages
    .map((m, i) => `${i}. Kimdan: "${m.from || "noma'lum"}" | Mavzu: "${m.subject || '(mavzusiz)'}"`)
    .join('\n');

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `Sen email jo'natuvchilarni tasniflaydigan yordamchisan. Har bir xatni haqiqiy, jonli INSON yozganmi yoki AVTOMATIK/notifikatsiya tizimi yozganmi — shuni aniqla.
Avtomatik hisoblanadi: ijtimoiy tarmoq bildirishnomalari (masalan LinkedIn, Facebook/Meta, Instagram), tizim xabarlari (masalan Apple, Google), marketing/reklama byulletenlari, "no-reply"/"notifications"/"noreply" kabi manzillar, hisobotlar, avtomatik cheklar. Bu faqat MISOLLAR — ro'yxat bilan cheklanma, mantiqan xulosa chiqar.
Inson hisoblanadi: ism-familiyasi bilan yozgan, shaxsiy va'da/savol/muzokara mazmunidagi xat yuborgan real hamkor, mijoz yoki tanish.
Faqat berilgan indekslardan foydalan (0 dan boshlab). Aynan shu JSON formatda javob ber: {"humanIndices": [0, 2, 5]}`
          },
          { role: 'user', content: senderList }
        ]
      })
    });

    if (!resp.ok) return { human: messages, filteredOut: [] };
    const data = await resp.json();
    const raw = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    const parsed = raw ? JSON.parse(raw) : null;
    const indices = Array.isArray(parsed && parsed.humanIndices) ? parsed.humanIndices : null;

    // A malformed/empty response must not silently hide every message.
    if (!indices) return { human: messages, filteredOut: [] };

    const humanIndices = new Set(indices);
    const human = messages.filter((_, i) => humanIndices.has(i));
    const filteredOut = messages.filter((_, i) => !humanIndices.has(i));
    return { human, filteredOut };
  } catch (err) {
    console.error('Mail sender filter failed:', err.message);
    return { human: messages, filteredOut: [] };
  }
}

module.exports = { filterHumanSenders };
