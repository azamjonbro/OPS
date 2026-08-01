/**
 * One-shot codemod: replace hand-written inline <svg> blocks with <Icon name="..." />.
 *
 * Matching is done on the first `d` path so an icon is identified by its actual shape,
 * not by whatever class the author happened to give it. Any <svg> whose path is not in
 * the table is left untouched and reported, so nothing is silently mangled.
 */
const fs = require('fs');
const path = require('path');

const PATH_TO_ICON = [
  ['M6 18L18 6M6 6l12 12', 'close'],
  ['M12 4v16m8-8H4', 'add'],
  ['M5 13l4 4L19 7', 'check'],
  ['M13 10V3L4 14h7v7l9-11h-7z', 'logo'],
  ['M19 7l-.867 12.142', 'delete'],
  ['M12 8v4l3 3m6-3a9 9', 'clock'],
  ['M3 10h10a8 8', 'reply'],
  ['M8 10h.01M12 10h.01', 'chat'],
  ['M8 7V3m8 4V3', 'calendar'],
  ['M14 5l7 7m0 0l-7 7m7-7H3', 'send'],
  ['M8 16H6a2 2', 'copy'],
  ['M9 12h6m-6 4h6m2 5H7a2 2', 'file'],
  ['M15 19l-7-7 7-7', 'prev'],
  ['M3 7v10a2 2', 'projects'],
  ['M17 16l4-4m0 0l-4-4', 'logout'],
  ['M19 11a7 7 0 01-7 7', 'mic'],
  ['M4 4v5h.582', 'refresh'],
  ['M9 5l7 7-7 7', 'next'],
  ['M11 5H6a2 2 0 00-2 2v11', 'edit'],
  ['M7 16a4 4 0 01-.88-7.903', 'upload'],
  ['M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z', 'pin'],
  ['M4 6h16M4 12h16M4 18h16', 'menu'],
  ['M10.325 4.317', 'admin'],
  ['M20 7l-8-4-8 4', 'product'],
  ['M9 19v-6a2 2', 'report'],
  ['M9 17V7m0 10a2 2', 'board'],
  ['M15 17h5l-1.405-1.405', 'bell'],
  ['M9.75 17L9 20l-1 1h8', 'monitor'],
  ['M5 8h14M5 8a2 2 0 110-4', 'archive']
];

// Tailwind width class -> Icon size token.
const WIDTH_TO_SIZE = {
  '2': 'xs', '2.5': 'xs', '3': 'xs',
  '3.5': 'sm',
  '4': 'md',
  '5': 'lg',
  '6': 'xl',
  '7': '2xl', '8': '2xl', '9': '2xl', '10': '2xl'
};

function iconFor(svg) {
  const dMatch = svg.match(/\sd="([^"]+)"/);
  if (!dMatch) return null;
  const d = dMatch[1];
  const hit = PATH_TO_ICON.find(([prefix]) => d.startsWith(prefix));
  return hit ? hit[1] : null;
}

function convert(svg, name) {
  const classMatch = svg.match(/\sclass="([^"]*)"/);
  const original = classMatch ? classMatch[1] : '';

  // Split sizing (which becomes the `size` prop) from everything else (colour,
  // animation, responsive tweaks) which stays as a class.
  const kept = [];
  let size = 'md';
  original.split(/\s+/).filter(Boolean).forEach(cls => {
    const base = cls.match(/^w-(\d+(?:\.\d+)?)$/);
    if (base) {
      size = WIDTH_TO_SIZE[base[1]] || 'md';
      return;
    }
    if (/^h-(\d+(?:\.\d+)?)$/.test(cls)) return;          // paired height
    if (/^(sm|md|lg|xl):[wh]-\d/.test(cls)) return;       // responsive size variants
    kept.push(cls);
  });

  const strokeMatch = svg.match(/stroke-width="([^"]+)"/);
  const stroke = strokeMatch && strokeMatch[1] !== '2' ? ` :stroke-width="${strokeMatch[1]}"` : '';

  const classAttr = kept.length ? ` class="${kept.join(' ')}"` : '';
  return `<Icon name="${name}" size="${size}"${stroke}${classAttr} />`;
}

const files = process.argv.slice(2);
let totalReplaced = 0;
const unmatched = [];

files.forEach(file => {
  const abs = path.resolve(file);
  let source = fs.readFileSync(abs, 'utf8');
  let replaced = 0;

  source = source.replace(/<svg[\s\S]*?<\/svg>/g, (svg) => {
    const name = iconFor(svg);
    if (!name) {
      // No `d` at all means a bespoke graphic (e.g. the waveform bars) — keep it.
      if (/\sd="/.test(svg)) unmatched.push({ file, snippet: svg.slice(0, 90) });
      return svg;
    }
    replaced++;
    return convert(svg, name);
  });

  if (replaced > 0) fs.writeFileSync(abs, source);
  totalReplaced += replaced;
  console.log(`  ${String(replaced).padStart(3)} almashtirildi | ${path.basename(file)}`);
});

console.log(`\nJami: ${totalReplaced} ta ikonka almashtirildi`);
if (unmatched.length) {
  console.log(`\n⚠️ Mos kelmagan ${unmatched.length} ta SVG (tegilmadi):`);
  unmatched.forEach(u => console.log(`   ${path.basename(u.file)}: ${u.snippet.replace(/\s+/g, ' ')}`));
}
