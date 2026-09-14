import type { BusinessFile, FileCategory, PaginatedResult } from '@hadiya/shared';

import { api, type RequestOptions } from './http';

/**
 * Documents, through the same client as everything else.
 *
 * The API scopes every response to the signed-in employee, so nothing here
 * sends a user id and nothing can ask for somebody else's file. Downloads go
 * through an authenticated endpoint rather than a storage URL: there is no
 * link to leak, because there is no link.
 *
 * Uploading is slower than an ordinary request — the server parses the document
 * before it answers — so it gets a longer timeout than the default, which would
 * otherwise abandon a perfectly good spreadsheet halfway through being read.
 */
const UPLOAD_TIMEOUT_MS = 120_000;

/**
 * What travels beside the bytes. A chat attachment sends neither; a document
 * for the knowledge base sends a category, and usually a title to be known by
 * instead of its filename.
 */
export interface UploadFields {
  title?: string;
  category?: FileCategory;
}

export interface ListFilesParams {
  page?: number;
  pageSize?: number;
  category?: FileCategory;
  /** `true` for knowledge-base documents only; `false` for attachments only. */
  knowledgeBase?: boolean;
}

export const fileService = {
  upload: (
    file: File,
    fields: UploadFields = {},
    options: RequestOptions = {},
  ): Promise<BusinessFile> => {
    const form = new FormData();

    form.append('file', file, file.name);

    if (fields.title) {
      form.append('title', fields.title);
    }

    if (fields.category) {
      form.append('category', fields.category);
    }

    return api.post<BusinessFile>('/v1/files', form, {
      timeout: UPLOAD_TIMEOUT_MS,
      ...options,
      // Left to the browser: it has to set the multipart boundary, and naming
      // the type here without one produces a body no parser can read.
      headers: { ...options.headers },
    });
  },

  list: (
    params: ListFilesParams = { pageSize: 20 },
    signal?: AbortSignal,
  ): Promise<PaginatedResult<BusinessFile>> =>
    api.get<PaginatedResult<BusinessFile>>('/v1/files', { params, signal }),

  remove: (id: string): Promise<{ deleted: boolean }> =>
    api.delete<{ deleted: boolean }>(`/v1/files/${id}`),
};
