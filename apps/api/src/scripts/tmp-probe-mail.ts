import { searchIcloudMail, debugFetchRaw } from '../modules/integrations/providers/icloud-mail-client.js';

const email = process.env.LEGACY_ICLOUD ?? '';
const password = process.env.LEGACY_IPASS ?? '';

const run = async (): Promise<void> => {
  const found = await searchIcloudMail(email, password, {}, 1);
  const first = found[0];

  if (!first) return;

  const whole = await debugFetchRaw(email, password, first.uid);
  const raw = whole.split('@@LITERAL@@\n')[1] ?? '';

  const separator = /\r?\n\r?\n/.exec(raw);
  console.log('bo‘sh qator indeksi:', separator?.index, '| xom uzunlik:', raw.length);

  const headers = separator ? raw.slice(0, separator.index) : raw;
  console.log('header bloki uzunligi:', headers.length);

  const field = (name: string): string | undefined => {
    const m = new RegExp(`^${name}:[ \\t]*([\\s\\S]*?)(?=\\r?\\n[^ \\t]|$)`, 'im').exec(headers);
    return m?.[1];
  };

  for (const name of ['Subject', 'From', 'Content-Type', 'MIME-Version']) {
    const value = field(name);
    console.log(`  ${name}: ${value === undefined ? '(TOPILMADI)' : JSON.stringify(value.slice(0, 90))}`);
  }

  console.log('headerda "Content-Type" satri bormi:', /content-type/i.test(headers));
  console.log('header oxiri:', JSON.stringify(headers.slice(-160)));
};

run().then(() => process.exit(0), (e) => { console.error('XATO:', e instanceof Error ? e.message : e); process.exit(1); });
