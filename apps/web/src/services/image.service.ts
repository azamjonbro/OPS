import type {
  ImageAsset,
  ImageAspectRatio,
  ImageAssetStatus,
  ImageQuality,
  ImageStyle,
  PaginatedResult,
} from '@hadiya/shared';

import { api, httpClient } from './http';

/**
 * The image endpoints.
 *
 * The bytes are fetched with the same bearer token as everything else, because
 * images are not served from a public directory: an unreleased product or a
 * draft price should not be readable by anyone who guesses a URL. That is why
 * `fetchBlobUrl` exists — an `<img src>` cannot carry a header, so the client
 * downloads the file and hands the element an object URL instead.
 */
export interface GenerateImagePayload {
  prompt: string;
  aspectRatio?: ImageAspectRatio;
  style?: ImageStyle;
  quality?: ImageQuality;
  count?: number;
  contentItemId?: string | null;
}

export interface GenerateImageResponse {
  images: ImageAsset[];
  note: string | null;
}

export interface ListImagesParams {
  page?: number;
  pageSize?: number;
  status?: ImageAssetStatus;
  contentItemId?: string;
  unattached?: boolean;
  search?: string;
}

export interface ImageProviderStatus {
  provider: string;
  available: boolean;
  model: string | null;
  maxImagesPerRequest: number;
  storage: string;
  reason: string | null;
}

export const imageService = {
  list: (params: ListImagesParams = {}): Promise<PaginatedResult<ImageAsset>> =>
    api.get<PaginatedResult<ImageAsset>>('/v1/images', { params }),

  get: (id: string): Promise<ImageAsset> => api.get<ImageAsset>(`/v1/images/${id}`),

  generate: (payload: GenerateImagePayload): Promise<GenerateImageResponse> =>
    api.post<GenerateImageResponse>('/v1/images/generate', payload),

  attach: (id: string, contentItemId: string | null): Promise<ImageAsset> =>
    api.post<ImageAsset>(`/v1/images/${id}/attach`, { contentItemId }),

  remove: (id: string): Promise<{ deleted: number }> =>
    api.delete<{ deleted: number }>(`/v1/images/${id}`),

  status: (): Promise<ImageProviderStatus> => api.get<ImageProviderStatus>('/v1/images/status'),

  /**
   * Downloads an image and returns an object URL for it.
   *
   * The caller owns the URL and must revoke it when the element goes away, or
   * the blob stays in memory for the life of the tab.
   */
  fetchBlobUrl: async (id: string): Promise<string> => {
    const response = await httpClient.request<Blob>({
      method: 'GET',
      url: `/v1/images/${id}/file`,
      responseType: 'blob',
    });

    return URL.createObjectURL(response.data);
  },
};
