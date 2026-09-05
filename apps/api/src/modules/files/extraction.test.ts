import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { buildChunks, chunkText, searchChunks } from './document-search.js';
import { clarificationFor, mapColumns, scoreColumn } from './column-mapping.js';
import { csvExtractor, mdExtractor, txtExtractor } from './extractors/text.extractor.js';
import { summariseTable, type ExtractedTable } from './extractors/extractor.js';
import { xlsxExtractor } from './extractors/office.extractor.js';
import { numericValue, queryTable } from './table-query.js';

/**
 * Reading documents, and doing arithmetic over them.
 *
 * The spreadsheet is built here with the same library that will read it, so the
 * test exercises a real XLSX rather than a fixture that might have been made by
 * something with different conventions.
 */
const buildWorkbook = async (
  rows: Array<[string, number, number]>,
  sheetName = 'Sales',
): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.addRow(['Product Name', 'Revenue', 'Qty']);
  rows.forEach((row) => sheet.addRow(row));

  return Buffer.from(await workbook.xlsx.writeBuffer());
};

describe('plain text', () => {
  it('reads a text file', async () => {
    const result = await txtExtractor.extract(Buffer.from('Bugungi savdo yaxshi.'));

    expect(result.text).toBe('Bugungi savdo yaxshi.');
    expect(result.truncated).toBe(false);
  });

  it('drops a byte-order mark, which would otherwise poison the first value', async () => {
    const result = await mdExtractor.extract(Buffer.from('﻿# Sarlavha'));

    expect(result.text).toBe('# Sarlavha');
  });

  it('bounds an enormous file and says that it did', async () => {
    const result = await txtExtractor.extract(Buffer.from('a'.repeat(500_000)));

    expect(result.truncated).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/first/i);
  });
});

describe('CSV', () => {
  it('reads headers and rows, typing numbers as numbers', async () => {
    const result = await csvExtractor.extract(
      Buffer.from('Product,Revenue\nChoy,1200\nQahva,850\n'),
    );
    const table = result.tables[0];

    expect(table?.columns).toEqual(['Product', 'Revenue']);
    expect(table?.rows).toHaveLength(2);
    expect(table?.rows[0]).toEqual({ Product: 'Choy', Revenue: 1_200 });
  });

  it('detects a semicolon delimiter rather than assuming a comma', async () => {
    // Very common in exports from this region. A comma-only reader turns the
    // whole file into one column and reports no error at all.
    const result = await csvExtractor.extract(Buffer.from('Product;Revenue\nChoy;1200\n'));

    expect(result.tables[0]?.columns).toEqual(['Product', 'Revenue']);
    expect(result.tables[0]?.rows[0]).toEqual({ Product: 'Choy', Revenue: 1_200 });
  });

  it('keeps a value that only looks numeric as text', async () => {
    // "1 200" and "$5" are not numbers, and guessing a separator is how a
    // decimal comma turns 1,5 into fifteen.
    const result = await csvExtractor.extract(Buffer.from('a,b\n"1 200","$5"\n'));

    expect(result.tables[0]?.rows[0]).toEqual({ a: '1 200', b: '$5' });
  });

  it('makes duplicate headers unique instead of losing a column', async () => {
    const result = await csvExtractor.extract(Buffer.from('Total,Total\n1,2\n'));

    expect(result.tables[0]?.columns).toEqual(['Total', 'Total_2']);
  });

  it('reports an empty file rather than pretending it read one', async () => {
    const result = await csvExtractor.extract(Buffer.from('   '));

    expect(result.tables).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/topilmadi/);
  });
});

describe('XLSX', () => {
  it('reads sheets, headers and typed cells', async () => {
    const data = await buildWorkbook([
      ['Choy', 1_200, 3],
      ['Qahva', 850, 2],
    ]);
    const result = await xlsxExtractor.extract(data);
    const table = result.tables[0];

    expect(table?.name).toBe('Sales');
    expect(table?.columns).toEqual(['Product Name', 'Revenue', 'Qty']);
    expect(table?.totalRows).toBe(2);
    expect(table?.rows[0]).toEqual({ 'Product Name': 'Choy', Revenue: 1_200, Qty: 3 });
  });

  it('reports a malformed workbook as unreadable rather than as empty', async () => {
    await expect(
      xlsxExtractor.extract(
        Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 7)]),
      ),
    ).rejects.toThrow(/o‘qib bo‘lmadi/);
  });

  it('describes a column by what is actually in it', async () => {
    const data = await buildWorkbook([['Choy', 1_200, 3]]);
    const result = await xlsxExtractor.extract(data);
    const summary = summariseTable(result.tables[0] as ExtractedTable);

    expect(summary.columns.find((column) => column.name === 'Revenue')?.kind).toBe('number');
    expect(summary.columns.find((column) => column.name === 'Product Name')?.kind).toBe('text');
  });
});

describe('table arithmetic', () => {
  const table: ExtractedTable = {
    name: 'Sales',
    columns: ['Product', 'Revenue', 'Qty'],
    rows: [
      { Product: 'Choy', Revenue: 1_000, Qty: 2 },
      { Product: 'Qahva', Revenue: 2_000, Qty: 1 },
      { Product: 'Choy', Revenue: 500, Qty: 1 },
      { Product: 'Shakar', Revenue: null, Qty: 4 },
    ],
    totalRows: 4,
    truncated: false,
  };

  it('sums a column', () => {
    const result = queryTable(table, { aggregate: { operation: 'sum', column: 'Revenue' } });

    expect(result.aggregate?.value).toBe(3_500);
    // Only rows that held a number were counted, so a gappy column is visible.
    expect(result.aggregate?.counted).toBe(3);
  });

  it('averages over the rows that held a number, not over every row', () => {
    // The bug this guards: treating the empty cell as zero would report 875.
    const result = queryTable(table, { aggregate: { operation: 'average', column: 'Revenue' } });

    expect(result.aggregate?.value).toBeCloseTo(1_166.67, 1);
  });

  it('answers null rather than zero when nothing in the column is a number', () => {
    const result = queryTable(
      { ...table, rows: [{ Product: 'x', Revenue: 'n/a', Qty: null }] },
      { aggregate: { operation: 'sum', column: 'Revenue' } },
    );

    expect(result.aggregate?.value).toBeNull();
  });

  it('groups and totals, largest first', () => {
    const result = queryTable(table, {
      groupBy: { column: 'Product', valueColumn: 'Revenue' },
    });

    expect(result.groups?.[0]).toEqual({ key: 'Qahva', value: 2_000, rows: 1 });
    expect(result.groups?.find((group) => group.key === 'Choy')?.value).toBe(1_500);
  });

  it('filters before it aggregates', () => {
    const result = queryTable(table, {
      filters: [{ column: 'Product', operator: 'equals', value: 'choy' }],
      aggregate: { operation: 'sum', column: 'Revenue' },
    });

    expect(result.matchedRows).toBe(2);
    expect(result.aggregate?.value).toBe(1_500);
  });

  it('compares numerically for the ordering operators', () => {
    const result = queryTable(table, {
      filters: [{ column: 'Revenue', operator: 'gte', value: '1000' }],
    });

    expect(result.matchedRows).toBe(2);
  });

  it('bounds the rows it returns but not the sum it computes', () => {
    const many: ExtractedTable = {
      ...table,
      rows: Array.from({ length: 500 }, () => ({ Product: 'x', Revenue: 10, Qty: 1 })),
      totalRows: 500,
    };

    const result = queryTable(many, {
      aggregate: { operation: 'sum', column: 'Revenue' },
      limit: 5,
    });

    // The answer to "what is the total?" must not depend on how many rows fit
    // in the reply.
    expect(result.aggregate?.value).toBe(5_000);
    expect(result.rows).toHaveLength(5);
    expect(result.truncated).toBe(true);
  });

  it('names the columns it does have when asked for one it does not', () => {
    expect(() => queryTable(table, { aggregate: { operation: 'sum', column: 'Profit' } })).toThrow(
      /Mavjud ustunlar/,
    );
  });

  it('reads a numeric cell strictly', () => {
    expect(numericValue(12)).toBe(12);
    expect(numericValue('12.5')).toBe(12.5);
    expect(numericValue('1 200')).toBeNull();
    expect(numericValue('')).toBeNull();
    expect(numericValue(null)).toBeNull();
  });
});

describe('chunking and search', () => {
  it('splits long text and keeps the pieces addressable', () => {
    const chunks = chunkText(
      Array.from({ length: 12 }, (_unused, index) => `Paragraph ${index} ${'x'.repeat(200)}`).join(
        '\n\n',
      ),
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.index).toBe(0);
    expect(chunks[1]?.index).toBe(1);
  });

  it('keeps the page a chunk came from, so a citation can be truthful', () => {
    const chunks = buildChunks({
      kind: 'pdf',
      text: '',
      pages: [
        { page: 1, text: 'Marketing budget is 40 million.' },
        { page: 2, text: 'Salaries are 90 million.' },
      ],
      tables: [],
      pageCount: 2,
      warnings: [],
      truncated: false,
    });

    const hit = searchChunks(chunks, 'marketing budget')[0];

    expect(hit?.chunk.page).toBe(1);
    expect(hit?.chunk.text).toMatch(/Marketing budget/);
  });

  it('returns only the relevant passages', () => {
    const chunks = chunkText(
      ['Sales grew in March.', 'Marketing budget was cut.', 'Staff numbers held.'].join('\n\n'),
    );

    const hits = searchChunks(chunks, 'marketing budget');

    expect(hits).toHaveLength(1);
    expect(hits[0]?.chunk.text).toMatch(/Marketing/);
  });

  it('finds nothing rather than everything for an unrelated question', () => {
    const chunks = chunkText('Sales grew in March.');

    expect(searchChunks(chunks, 'zebra')).toEqual([]);
  });
});

describe('column mapping', () => {
  it('maps the obvious names', () => {
    const mapping = mapColumns(['Product Name', 'Revenue', 'Qty']);

    expect(mapping.find((entry) => entry.field === 'productName')?.column).toBe('Product Name');
    expect(mapping.find((entry) => entry.field === 'revenue')?.column).toBe('Revenue');
    expect(mapping.find((entry) => entry.field === 'quantity')?.column).toBe('Qty');
  });

  it('maps Uzbek and Russian headers', () => {
    const mapping = mapColumns(['Mahsulot nomi', 'Summa', 'Soni']);

    expect(mapping.find((entry) => entry.field === 'productName')?.column).toBe('Mahsulot nomi');
    expect(mapping.find((entry) => entry.field === 'revenue')?.column).toBe('Summa');
    expect(mapping.find((entry) => entry.field === 'quantity')?.column).toBe('Soni');
  });

  it('refuses to choose between two plausible revenue columns', () => {
    const mapping = mapColumns(['Product', 'Revenue', 'Net Revenue']);
    const revenue = mapping.find((entry) => entry.field === 'revenue');

    // Picking one silently produces a confident comparison that is wrong about
    // money, so the choice is escalated instead.
    expect(revenue?.column).toBeNull();
    expect(revenue?.alternatives.length).toBeGreaterThan(1);
  });

  it('turns an unresolved mapping into a question naming the real columns', () => {
    const mapping = mapColumns(['Product', 'Revenue', 'Net Revenue']);
    const question = clarificationFor(mapping, ['revenue']);

    expect(question).toMatch(/Revenue/);
    expect(question).toMatch(/Net Revenue/);
  });

  it('reports nothing to ask when every required field mapped', () => {
    expect(clarificationFor(mapColumns(['Product Name', 'Revenue']), ['revenue'])).toBeNull();
  });

  it('scores an exact header above a partial one', () => {
    expect(scoreColumn('Revenue', 'revenue')).toBeGreaterThan(
      scoreColumn('Adjusted revenue figure', 'revenue'),
    );
    expect(scoreColumn('Customer', 'revenue')).toBe(0);
  });
});
