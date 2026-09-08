import { debugRaw } from '../modules/integrations/providers/icloud-mail-client.js';

const run = async (): Promise<void> => {
  const raw = await debugRaw(process.env.LEGACY_ICLOUD ?? '', process.env.LEGACY_IPASS ?? '', 6799);
  const sep = /\r?\n\r?\n/.exec(raw);
  const headers = raw.slice(0, sep?.index ?? 0);
  const body = raw.slice((sep?.index ?? 0) + (sep?.[0].length ?? 0));

  const ct = /^Content-Type:[ \t]*(.*(?:\r?\n[ \t]+.*)*)/im.exec(headers)?.[1] ?? '(yo‘q)';
  console.log('TASHQI Content-Type:', JSON.stringify(ct.replace(/\s+/g, ' ')));

  const boundary = /boundary=("?)([^";\s]+)\1/i.exec(ct)?.[2];
  console.log('boundary:', boundary);

  if (!boundary) return;

  const parts = body.split(`--${boundary}`).slice(1, -1);
  console.log('qismlar soni:', parts.length);

  parts.forEach((part, index) => {
    const cleaned = part.replace(/^\r?\n/, '');
    const innerSep = /\r?\n\r?\n/.exec(cleaned);
    const innerHeaders = cleaned.slice(0, innerSep?.index ?? 0);
    console.log(`\n--- qism ${index} sarlavhalari (${innerHeaders.length} belgi) ---`);
    console.log(JSON.stringify(innerHeaders.slice(0, 220)));
  });
};

run().then(() => process.exit(0), (e) => { console.error('XATO:', e instanceof Error ? e.message : e); process.exit(1); });
