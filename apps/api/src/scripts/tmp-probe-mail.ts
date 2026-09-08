import { readIcloudMessage, searchIcloudMail } from '../modules/integrations/providers/icloud-mail-client.js';

const email = process.env.LEGACY_ICLOUD ?? '';
const password = process.env.LEGACY_IPASS ?? '';

const run = async (): Promise<void> => {
  const found = await searchIcloudMail(email, password, {}, 5);
  for (const h of found.slice(0, 4)) {
    const m = await readIcloudMessage(email, password, h.uid, 200);
    console.log(`[${h.uid}] "${m.subject}"`);
    console.log('   ' + m.text.slice(0, 150).replace(/\n/g, ' ⏎ '));
  }

  const filtered = await searchIcloudMail(email, password, { from: 'openai' }, 3);
  console.log(`\nFROM=openai qidiruvi: ${filtered.length} ta`);
  for (const h of filtered) console.log(`   [${h.uid}] ${h.subject}`);
};

run().then(() => process.exit(0), (e) => { console.error('XATO:', e instanceof Error ? e.message : e); process.exit(1); });
