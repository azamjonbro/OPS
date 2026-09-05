import { DOCUMENT_CHUNK, type DocumentChunk, type DocumentSearchHit } from '@hadiya/shared';

import type { ExtractionResult } from './extractors/extractor.js';

/**
 * Finding the part of a document a question is about.
 *
 * Deliberately deterministic — keyword overlap, not embeddings. A vector store
 * is a database to run, a bill to pay and a dependency to keep, and for "what
 * does this report say about marketing budget" over a twelve-page PDF it beats
 * `grep` by very little. The interface below is the seam a semantic retriever
 * would slot into later without anything above it changing.
 *
 * What this buys today is the thing that actually matters: the model receives a
 * few relevant paragraphs instead of the whole document.
 */

/**
 * Splits text into chunks that keep their place in the document.
 *
 * Paragraph boundaries are preferred over a fixed width so a chunk is something
 * a person could read, and consecutive chunks overlap so a sentence that
 * straddles a boundary is findable from either side.
 */
export const chunkText = (
  text: string,
  options: { page?: number | null; sheet?: string | null; startIndex?: number } = {},
): DocumentChunk[] => {
  const clean = text.trim();

  if (clean.length === 0) {
    return [];
  }

  const chunks: DocumentChunk[] = [];
  const paragraphs = clean.split(/\n{2,}/);
  let buffer = '';
  let index = options.startIndex ?? 0;

  const flush = (): void => {
    const body = buffer.trim();

    if (body.length === 0) {
      return;
    }

    chunks.push({
      index,
      text: body,
      page: options.page ?? null,
      sheet: options.sheet ?? null,
    });
    index += 1;
    // Carry the tail forward, so a boundary does not hide a sentence.
    buffer =
      body.length > DOCUMENT_CHUNK.overlapChars ? body.slice(-DOCUMENT_CHUNK.overlapChars) : '';
  };

  for (const paragraph of paragraphs) {
    // A single paragraph longer than the target is split on its own, rather
    // than becoming one enormous chunk that defeats the point of chunking.
    if (paragraph.length > DOCUMENT_CHUNK.targetChars) {
      flush();

      for (let start = 0; start < paragraph.length; start += DOCUMENT_CHUNK.targetChars) {
        chunks.push({
          index,
          text: paragraph.slice(start, start + DOCUMENT_CHUNK.targetChars).trim(),
          page: options.page ?? null,
          sheet: options.sheet ?? null,
        });
        index += 1;
      }

      buffer = '';
      continue;
    }

    if (buffer.length + paragraph.length > DOCUMENT_CHUNK.targetChars) {
      flush();
    }

    buffer = buffer.length > 0 ? `${buffer}\n\n${paragraph}` : paragraph;
  }

  flush();

  return chunks;
};

/**
 * Every chunk of a document, with its page or sheet attached.
 *
 * Pages are chunked individually so a hit can honestly say which page it came
 * from; a document without pages is chunked as one stream. Tables are turned
 * into a readable header line rather than raw rows — a question about a
 * spreadsheet is answered by querying it, not by reading it aloud.
 */
export const buildChunks = (extraction: ExtractionResult): DocumentChunk[] => {
  if (extraction.pages.length > 0) {
    return extraction.pages.flatMap((page, position) =>
      chunkText(page.text, {
        page: page.page,
        // Indices stay unique across pages, so a chunk index identifies one
        // chunk in the document rather than one per page.
        startIndex: position * 1_000,
      }),
    );
  }

  const chunks = chunkText(extraction.text);

  return [
    ...chunks,
    ...extraction.tables.flatMap((table, position) =>
      chunkText(
        [
          `Sheet "${table.name}" has ${table.totalRows} row(s).`,
          `Columns: ${table.columns.join(', ')}.`,
        ].join('\n\n'),
        { sheet: table.name, startIndex: (position + 1) * 1_000_000 },
      ),
    ),
  ];
};

/** Words worth matching on: anything two characters or longer, lowercased. */
const tokenise = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2);

/**
 * Ranks chunks against a question.
 *
 * The score is how many distinct query words a chunk contains, with a small
 * bonus for containing the whole phrase and a mild penalty for length so a very
 * long chunk does not win simply by holding more words. Crude, explainable, and
 * good enough that the model reads the right paragraph.
 */
export const searchChunks = (
  chunks: DocumentChunk[],
  query: string,
  limit = DOCUMENT_CHUNK.maxResults,
): DocumentSearchHit[] => {
  const terms = [...new Set(tokenise(query))];

  if (terms.length === 0) {
    // No usable query. The opening of the document is a more honest answer
    // than an arbitrary ranking of it.
    return chunks.slice(0, limit).map((chunk) => ({ chunk, score: 0 }));
  }

  const phrase = query.trim().toLowerCase();

  return chunks
    .map((chunk) => {
      const haystack = chunk.text.toLowerCase();
      const hits = terms.filter((term) => haystack.includes(term)).length;
      const phraseBonus = phrase.length > 3 && haystack.includes(phrase) ? terms.length : 0;
      const lengthPenalty = Math.min(chunk.text.length / 20_000, 0.5);

      return { chunk, score: hits + phraseBonus - lengthPenalty };
    })
    .filter((hit) => hit.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
};
