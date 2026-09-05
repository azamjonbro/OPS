import { FILE_LIMITS } from '@hadiya/shared';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

import { createLogger } from '../../../core/logger/logger.js';
import {
  emptyResult,
  ExtractionError,
  type DocumentExtractor,
  type ExtractedTable,
  type ExtractionResult,
} from './extractor.js';
import { coerceCell, normaliseColumns } from './text.extractor.js';

const log = createLogger('file-extract');

/**
 * The formats that are containers rather than text.
 *
 * Each one is a third-party parser behind the same interface, and each is
 * wrapped the same way: the library's own error is logged and replaced with a
 * sentence, because a parser message names byte offsets, XML parts and
 * occasionally a temporary path — none of which belongs on a shopkeeper's
 * screen or in a model's context.
 *
 * These parsers run over bytes somebody uploaded, which is the most hostile
 * input this system takes. They are therefore bounded before they are trusted:
 * limits are applied to what comes *out*, so a small file that decompresses
 * into something enormous is contained by the same ceilings as a large one.
 */

const failed = (kind: string, error: unknown, message: string): never => {
  log.warn({ kind, err: error }, 'document extraction failed');

  throw new ExtractionError(message);
};

/**
 * PDF text, page by page.
 *
 * The per-page result is kept rather than the flat text, so page boundaries
 * survive — which is what lets an answer cite "2-sahifada" truthfully instead
 * of inventing a number.
 *
 * A PDF with no extractable text is a scan. That is reported as a clear status
 * rather than as an empty success, because an empty document that looks
 * successful is one the assistant will confidently say nothing about.
 */
export const pdfExtractor: DocumentExtractor = {
  kind: 'pdf',
  extract: async (data: Buffer): Promise<ExtractionResult> => {
    // The parser holds a worker and a document handle, so it is destroyed on
    // every path — a leaked handle per upload is how a long-running process
    // quietly runs out of memory.
    const parser = new PDFParse({ data: new Uint8Array(data) });

    try {
      // `first` bounds the read at the source rather than after it, so an
      // 800-page document costs 300 pages of work rather than 800.
      const result = await parser.getText({ first: FILE_LIMITS.maxPages });
      const pages = result.pages.map((page) => ({
        page: page.num,
        text: page.text.replace(/\s+/g, ' ').trim(),
      }));

      const warnings: string[] = [];
      const totalPages = result.total;
      const truncated = totalPages > pages.length;

      if (truncated) {
        warnings.push(`Faylda ${totalPages} sahifa bor; birinchi ${pages.length} tasi o‘qildi.`);
      }

      const text = pages.map((entry) => entry.text).join('\n\n');

      if (text.trim().length === 0) {
        // Said plainly. Every alternative — an empty string, a cheerful success
        // — leads to an assistant answering questions about a document it
        // cannot actually read.
        warnings.push('Bu PDF skan qilingan va matn ajratib olinmadi.');
      }

      const bounded =
        text.length > FILE_LIMITS.maxTextChars ? text.slice(0, FILE_LIMITS.maxTextChars) : text;

      return {
        ...emptyResult('pdf'),
        text: bounded,
        pages,
        pageCount: totalPages,
        warnings,
        truncated: truncated || bounded.length < text.length,
      };
    } catch (error) {
      return failed('pdf', error, 'Fayldan ma’lumot o‘qib bo‘lmadi.');
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  },
};

/**
 * DOCX text, with paragraph structure kept.
 *
 * Mammoth converts to Markdown rather than to HTML here, so headings and lists
 * survive as text a model reads naturally and a person can still read raw. Full
 * Word fidelity is explicitly not attempted: this is for understanding a
 * document, not for rendering one.
 */
export const docxExtractor: DocumentExtractor = {
  kind: 'docx',
  extract: async (data: Buffer): Promise<ExtractionResult> => {
    let converted: { value: string; messages: Array<{ message?: string }> };

    try {
      // `convertToMarkdown` ships in mammoth but is absent from its published
      // types, so the call is cast rather than the result guessed at.
      const convert = (
        mammoth as unknown as {
          convertToMarkdown: (input: { buffer: Buffer }) => Promise<typeof converted>;
        }
      ).convertToMarkdown;

      converted = await convert({ buffer: data });
    } catch (error) {
      return failed('docx', error, 'Fayldan ma’lumot o‘qib bo‘lmadi.');
    }

    const text = converted.value.trim();
    const truncated = text.length > FILE_LIMITS.maxTextChars;
    const warnings: string[] = [];

    if (truncated) {
      warnings.push(`Hujjatning birinchi ${FILE_LIMITS.maxTextChars} belgisi o‘qildi.`);
    }

    if (text.length === 0) {
      warnings.push('Bu hujjatda matn topilmadi.');
    }

    if (converted.messages.length > 0) {
      // Mammoth reports unsupported styles here. Worth a count, never the
      // messages themselves — they name internal Word style identifiers.
      warnings.push('Hujjatning ba’zi qismlari to‘liq o‘qilmadi.');
    }

    return {
      ...emptyResult('docx'),
      text: truncated ? text.slice(0, FILE_LIMITS.maxTextChars) : text,
      warnings,
      truncated,
    };
  },
};

/** Excel dates arrive as `Date`; formulas arrive as an object with a result. */
const cellValue = (value: unknown): string | number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'object') {
    const record = value as {
      result?: unknown;
      text?: unknown;
      richText?: Array<{ text?: string }>;
    };

    if (Array.isArray(record.richText)) {
      return record.richText.map((part) => part.text ?? '').join('');
    }

    // A formula cell: the cached result is what the person sees in Excel, and
    // the formula itself is not something to evaluate here.
    if (record.result !== undefined) {
      return coerceCell(record.result);
    }

    if (record.text !== undefined) {
      return coerceCell(record.text);
    }

    return null;
  }

  return coerceCell(value);
};

/**
 * Workbooks, sheet by sheet.
 *
 * The first row is taken as the header, which is what a business export always
 * is. Rows and sheets are both bounded, and both report their true totals —
 * a workbook whose fourth sheet was not read must not look like a workbook with
 * three sheets.
 */
export const xlsxExtractor: DocumentExtractor = {
  kind: 'xlsx',
  extract: async (data: Buffer): Promise<ExtractionResult> => {
    const workbook = new ExcelJS.Workbook();

    try {
      await workbook.xlsx.load(data as unknown as ArrayBuffer);
    } catch (error) {
      return failed('xlsx', error, 'Fayldan ma’lumot o‘qib bo‘lmadi.');
    }

    const warnings: string[] = [];
    const sheets = workbook.worksheets;
    let truncated = false;

    if (sheets.length > FILE_LIMITS.maxSheets) {
      warnings.push(
        `Faylda ${sheets.length} varaq bor; birinchi ${FILE_LIMITS.maxSheets} tasi o‘qildi.`,
      );
      truncated = true;
    }

    const tables: ExtractedTable[] = [];

    for (const sheet of sheets.slice(0, FILE_LIMITS.maxSheets)) {
      const headerRow = sheet.getRow(1);
      const rawHeaders: unknown[] = [];

      headerRow.eachCell({ includeEmpty: true }, (cell) => {
        rawHeaders.push(cellValue(cell.value));
      });

      if (rawHeaders.length === 0) {
        continue;
      }

      const columns = normaliseColumns(rawHeaders.slice(0, FILE_LIMITS.maxColumns));
      const rows: Array<Record<string, string | number | null>> = [];
      // `rowCount` counts the header, and can overstate on a sheet with stray
      // formatting; the rows actually collected are what gets reported.
      const bodyRows = Math.max(0, sheet.rowCount - 1);
      const sheetTruncated = bodyRows > FILE_LIMITS.maxRows;

      for (
        let index = 2;
        index <= sheet.rowCount && rows.length < FILE_LIMITS.maxRows;
        index += 1
      ) {
        const row = sheet.getRow(index);
        const record: Record<string, string | number | null> = {};
        let hasValue = false;

        columns.forEach((column, columnIndex) => {
          const value = cellValue(row.getCell(columnIndex + 1).value);

          record[column] = value;

          if (value !== null && value !== '') {
            hasValue = true;
          }
        });

        // Entirely blank rows are skipped: a spreadsheet's trailing formatting
        // produces thousands of them, and counting them as data makes every
        // average wrong.
        if (hasValue) {
          rows.push(record);
        }
      }

      if (sheetTruncated) {
        warnings.push(
          `"${sheet.name}" varag‘ida ${bodyRows} satr bor; birinchi ${FILE_LIMITS.maxRows} tasi tahlil qilindi.`,
        );
        truncated = true;
      }

      tables.push({
        name: sheet.name || `Sheet ${tables.length + 1}`,
        columns,
        rows,
        totalRows: sheetTruncated ? bodyRows : rows.length,
        truncated: sheetTruncated,
      });
    }

    if (tables.length === 0) {
      warnings.push('Bu faylda o‘qiladigan jadval topilmadi.');
    }

    return { ...emptyResult('xlsx'), tables, warnings, truncated };
  },
};
