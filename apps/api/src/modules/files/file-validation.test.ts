import { describe, expect, it } from 'vitest';

import { ApiError } from '../../core/http/api-error.js';
import { isSafeStorageKey } from '../images/storage/storage-provider.js';
import {
  extensionOf,
  looksLikeText,
  sanitiseDisplayName,
  storageKeyFor,
  validateUpload,
} from './file-validation.js';

/**
 * What an upload is allowed to be.
 *
 * This is the security boundary of the phase, so the cases below are mostly
 * attacks: a renamed executable, a filename that climbs out of a directory, a
 * type that disagrees with its own bytes. Each one has to be refused by a rule
 * rather than by luck.
 */
const pdf = (body = 'hello') => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(body)]);
const zip = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 1)]);

describe('reading an extension', () => {
  it('takes the last one, so a double extension cannot mislead', () => {
    // The attack this exists for: `invoice.pdf.exe` must read as `exe`.
    expect(extensionOf('invoice.pdf.exe')).toBe('exe');
    expect(extensionOf('report.XLSX')).toBe('xlsx');
  });

  it('ignores anything that looks like a directory', () => {
    expect(extensionOf('../../etc/passwd.txt')).toBe('txt');
    expect(extensionOf('C:\\Windows\\system32\\evil.csv')).toBe('csv');
  });

  it('reports nothing for a name with no extension', () => {
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('.bashrc')).toBe('');
  });
});

describe('sanitising a display name', () => {
  it('keeps only the final path segment', () => {
    expect(sanitiseDisplayName('../../../etc/passwd')).toBe('passwd');
    expect(sanitiseDisplayName('C:\\Users\\x\\report.xlsx')).toBe('report.xlsx');
  });

  it('strips control characters, so a name cannot forge a second line', () => {
    expect(sanitiseDisplayName('sales\nDELETE EVERYTHING.csv')).toBe('salesDELETE EVERYTHING.csv');
    expect(sanitiseDisplayName('a\u0000b.txt')).toBe('ab.txt');
  });

  it('never returns something empty', () => {
    expect(sanitiseDisplayName('...')).toBe('document');
    expect(sanitiseDisplayName('/')).toBe('document');
  });

  it('bounds the length', () => {
    expect(sanitiseDisplayName(`${'a'.repeat(500)}.csv`).length).toBeLessThanOrEqual(160);
  });
});

describe('validating an upload', () => {
  it('accepts a real PDF', () => {
    const result = validateUpload({
      filename: 'report.pdf',
      declaredContentType: 'application/pdf',
      data: pdf(),
    });

    expect(result.kind).toBe('pdf');
    expect(result.displayName).toBe('report.pdf');
  });

  it('accepts a CSV, which has no signature to check', () => {
    expect(
      validateUpload({
        filename: 'sales.csv',
        declaredContentType: 'text/csv',
        data: Buffer.from('name,total\nChoy,100\n'),
      }).kind,
    ).toBe('csv');
  });

  it('refuses a type it cannot read', () => {
    expect(() =>
      validateUpload({
        filename: 'archive.zip',
        declaredContentType: 'application/zip',
        data: zip(),
      }),
    ).toThrow(/qo‘llab-quvvatlanmaydi/);
  });

  it('refuses an executable renamed to a PDF', () => {
    // Extension says pdf, declared type says pdf, and the bytes are an ELF
    // binary. Only the signature check catches this.
    expect(() =>
      validateUpload({
        filename: 'invoice.pdf',
        declaredContentType: 'application/pdf',
        data: Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64, 0)]),
      }),
    ).toThrow(/mos kelmadi/);
  });

  it('refuses a binary renamed to a text file', () => {
    // No signature exists for `.txt`, so the NUL-byte check is what refuses it.
    expect(() =>
      validateUpload({
        filename: 'notes.txt',
        declaredContentType: 'text/plain',
        data: Buffer.from([0x00, 0x01, 0x02, 0x00, 0x03, 0x04, 0x05, 0x06, 0x07]),
      }),
    ).toThrow(/mos kelmadi/);
  });

  it('refuses a declared type that disagrees with the extension', () => {
    expect(() =>
      validateUpload({
        filename: 'report.pdf',
        declaredContentType: 'text/html',
        data: pdf(),
      }),
    ).toThrow(/mos kelmadi/);
  });

  it('refuses a file that is too large', () => {
    expect(() =>
      validateUpload({
        filename: 'big.csv',
        declaredContentType: 'text/csv',
        data: Buffer.alloc(21 * 1024 * 1024, 0x61),
      }),
    ).toThrow(/limitdan katta/);
  });

  it('refuses an empty file', () => {
    expect(() =>
      validateUpload({
        filename: 'empty.csv',
        declaredContentType: 'text/csv',
        data: Buffer.from(''),
      }),
    ).toThrow(ApiError);
  });

  it('sanitises the name of a file it accepts', () => {
    const result = validateUpload({
      filename: '../../../../etc/report.csv',
      declaredContentType: 'text/csv',
      data: Buffer.from('a,b\n1,2\n'),
    });

    expect(result.displayName).toBe('report.csv');
  });

  it('accepts an XLSX by its ZIP signature', () => {
    expect(
      validateUpload({
        filename: 'book.xlsx',
        declaredContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        data: zip(),
      }).kind,
    ).toBe('xlsx');
  });
});

describe('the storage key', () => {
  it('is built only from the id, so a filename cannot influence it', () => {
    const key = storageKeyFor('68c0000000000000000000a1', 'xlsx');

    expect(key).toBe('documents/68c0000000000000000000a1.xlsx');
    // And it satisfies the storage layer's own pattern, which refuses anything
    // that could climb out of the root.
    expect(isSafeStorageKey(key)).toBe(true);
  });

  it('produces a key the storage layer accepts for every kind', () => {
    for (const kind of ['pdf', 'xlsx', 'csv', 'txt', 'md', 'docx'] as const) {
      expect(isSafeStorageKey(storageKeyFor('68c0000000000000000000a1', kind))).toBe(true);
    }
  });
});

describe('the text heuristic', () => {
  it('accepts ordinary text, including non-Latin scripts', () => {
    expect(looksLikeText(Buffer.from('Bugungi savdo — 1 200 000 soʻm'))).toBe(true);
  });

  it('rejects anything holding a NUL byte', () => {
    expect(looksLikeText(Buffer.from([0x41, 0x00, 0x42]))).toBe(false);
  });
});
