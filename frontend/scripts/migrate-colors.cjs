/**
 * Replaces arbitrary Tailwind colour values (`bg-[#14161C]`) with the semantic tokens
 * declared in tailwind.config.js (`bg-card`).
 *
 * Near-duplicate shades that existed only because they were typed by hand
 * (#14161B vs #14161C, #0E1013 vs #0E1015) collapse onto one token — that
 * consolidation is the point, not a side effect.
 */
const fs = require('fs');
const path = require('path');

const TOKENS = {
  '#0B0C0E': 'canvas',
  '#0E1013': 'sunken',
  '#0E1014': 'sunken',
  '#0E1015': 'sunken',
  '#111317': 'surface',
  '#14161B': 'card',
  '#14161C': 'card',
  '#161820': 'raised',
  '#161922': 'raised',
  '#171922': 'raised',
  '#171A22': 'raised',
  '#191C24': 'raised',
  '#1A1D24': 'muted',
  '#1A1D26': 'muted',
  '#1C1F27': 'sunken',
  '#1C1F2A': 'sunken',
  '#1D212C': 'muted',
  '#1E1F24': 'muted',
  '#1E2330': 'hover',
  '#202430': 'hover',
  '#22252E': 'hover',
  '#222530': 'hover',
  '#252834': 'hover',
  '#252936': 'hover',
  '#2A2B32': 'hover',
  '#2C3040': 'line-hover',
  '#1F222A': 'line',
  '#222632': 'line',
  '#232733': 'line',
  '#262A36': 'line-strong',
  '#2D3242': 'line-hover',
  '#2A2E3B': 'line-hover',
  '#343848': 'line-hover',
  '#34353E': 'hover',
  '#2C2D33': 'line-strong'
};

const files = process.argv.slice(2);
let total = 0;
const leftovers = new Map();

files.forEach(file => {
  const abs = path.resolve(file);
  let src = fs.readFileSync(abs, 'utf8');
  let count = 0;

  // Only touch Tailwind arbitrary-value syntax: <utility>-[#RRGGBB].
  src = src.replace(/([a-z-]+)-\[(#[0-9A-Fa-f]{6})\]/g, (whole, utility, hex) => {
    const token = TOKENS[hex.toUpperCase()];
    if (!token) {
      leftovers.set(hex.toUpperCase(), (leftovers.get(hex.toUpperCase()) || 0) + 1);
      return whole;
    }
    count++;
    return `${utility}-${token}`;
  });

  if (count) fs.writeFileSync(abs, src);
  total += count;
  console.log(`  ${String(count).padStart(3)} almashtirildi | ${path.basename(file)}`);
});

console.log(`\nJami: ${total} ta rang tokenga o'tkazildi`);
if (leftovers.size) {
  console.log('\nQolgan (xaritada yo\'q, tegilmadi):');
  [...leftovers.entries()].sort((a, b) => b[1] - a[1])
    .forEach(([hex, n]) => console.log(`   ${String(n).padStart(3)} × ${hex}`));
}
