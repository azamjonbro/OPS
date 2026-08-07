const XLSX = require('xlsx');

// Header name variants the owner's Excel/CSV files might use, in Uzbek, Russian and
// English — matched case-insensitively against the parsed header row. This is a fixed
// lookup over spreadsheet COLUMN NAMES, not intent classification, so it stays a plain
// table rather than going through the LLM.
const FIELD_ALIASES = {
  name: ['name', 'nomi', 'nom', 'tovar', 'tovar nomi', 'mahsulot', 'mahsulot nomi', 'наименование', 'товар', 'название'],
  sku: ['sku', 'kod', 'артикул', 'код'],
  barcode: ['barcode', 'shtrixkod', 'shtrix kod', 'штрихкод'],
  price: ['price', 'narx', 'narxi', 'sotish narxi', 'sale price', 'цена', 'сумма'],
  quantity: ['quantity', 'soni', 'miqdor', 'dona', 'kolichestvo', 'количество', 'qty', 'count']
};

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase();
}

function buildHeaderMap(headers) {
  const map = {};
  headers.forEach((rawHeader) => {
    const h = normalizeHeader(rawHeader);
    for (const field of Object.keys(FIELD_ALIASES)) {
      if (map[field]) continue;
      if (FIELD_ALIASES[field].some((alias) => h === alias || h.includes(alias))) {
        map[field] = rawHeader;
      }
    }
  });
  return map;
}

function toNumber(v) {
  if (typeof v === 'number') return v;
  const cleaned = String(v || '').replace(/[^\d.,-]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Decodes the base64 `dataUrl` the chat UI already sends for every attachment and reads
 * it as a workbook — xlsx.read auto-detects xlsx/xls/csv from the buffer itself, so one
 * path covers all three of the accepted spreadsheet extensions.
 */
function parseAttachedSpreadsheet(attachedFile) {
  if (!attachedFile || !attachedFile.dataUrl) {
    return { success: false, error: 'Fayl mazmuni topilmadi' };
  }

  try {
    const base64 = attachedFile.dataUrl.split(',')[1] || '';
    const buffer = Buffer.from(base64, 'base64');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return { success: false, error: "Faylda hech qanday varaq (sheet) topilmadi" };

    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!rows.length) return { success: false, error: "Fayl bo'sh — hech qanday qator topilmadi" };

    const headerMap = buildHeaderMap(Object.keys(rows[0]));
    if (!headerMap.name || !headerMap.price) {
      return {
        success: false,
        error: `Fayl ustunlari tanilmadi — "nomi" va "narxi" ustunlari topilishi kerak. Topilgan ustunlar: ${Object.keys(rows[0]).join(', ')}`
      };
    }

    const products = [];
    let skippedCount = 0;

    rows.forEach((row) => {
      const name = String(row[headerMap.name] || '').trim();
      const price = toNumber(row[headerMap.price]);
      if (!name || price === null) {
        skippedCount++;
        return;
      }
      products.push({
        name,
        price,
        sku: headerMap.sku ? String(row[headerMap.sku] || '').trim() : '',
        barcode: headerMap.barcode ? String(row[headerMap.barcode] || '').trim() : '',
        quantity: headerMap.quantity ? (toNumber(row[headerMap.quantity]) || 0) : 0
      });
    });

    return { success: true, products, skippedCount, totalRows: rows.length };
  } catch (err) {
    return { success: false, error: `Fayl o'qishda xatolik: ${err.message}` };
  }
}

module.exports = { parseAttachedSpreadsheet };
