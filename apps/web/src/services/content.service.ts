import type {
  ContentIdea,
  ContentItem,
  ContentItemStatus,
  ContentPlan,
  ContentPlanDetail,
  ContentPlanStatus,
  ContentPlatform,
  ContentPreferences,
  ContentType,
  GeneratedCaption,
  PaginatedResult,
} from '@hadiya/shared';

import { api } from './http';

/**
 * The content endpoints.
 *
 * Plans and items are separate resources rather than one nested tree, because
 * editing a single day is the common action and a client should be able to
 * patch it without resending the plan around it.
 */
export interface ListPlansParams {
  page?: number;
  pageSize?: number;
  status?: ContentPlanStatus;
  platform?: ContentPlatform;
  search?: string;
}

export interface CreatePlanPayload {
  title: string;
  description?: string | null;
  platform: ContentPlatform;
  /** ISO date, `YYYY-MM-DD`. */
  startDate: string;
  endDate?: string;
  status?: ContentPlanStatus;
  items?: ContentItemPayload[];
}

export interface ContentItemPayload {
  date: string;
  platform?: ContentPlatform;
  contentType: ContentType;
  title: string;
  idea: string;
  caption?: string | null;
  callToAction?: string | null;
  hashtags?: string[];
  status?: ContentItemStatus;
  notes?: string | null;
}

export type UpdateItemPayload = Partial<Omit<ContentItemPayload, 'contentType'>> & {
  contentType?: ContentType;
};

export interface GeneratePlanPayload {
  brief: string;
  platform?: ContentPlatform;
  days?: number;
  startDate?: string;
  title?: string;
  /** False previews the plan without storing it. */
  save?: boolean;
}

export interface GeneratedPlanResponse {
  plan: ContentPlan | null;
  items: ContentItemPayload[];
  appliedPreferences: ContentPreferences;
  model: string;
}

export const contentService = {
  listPlans: (params: ListPlansParams = {}): Promise<PaginatedResult<ContentPlan>> =>
    api.get<PaginatedResult<ContentPlan>>('/v1/content/plans', { params }),

  /** A plan always arrives with its days: nothing useful can be shown without them. */
  getPlan: (id: string): Promise<ContentPlanDetail> =>
    api.get<ContentPlanDetail>(`/v1/content/plans/${id}`),

  createPlan: (payload: CreatePlanPayload): Promise<ContentPlan> =>
    api.post<ContentPlan>('/v1/content/plans', payload),

  updatePlan: (id: string, payload: Partial<CreatePlanPayload>): Promise<ContentPlan> =>
    api.patch<ContentPlan>(`/v1/content/plans/${id}`, payload),

  deletePlan: (id: string): Promise<{ deletedPlan: number; deletedItems: number }> =>
    api.delete<{ deletedPlan: number; deletedItems: number }>(`/v1/content/plans/${id}`),

  generatePlan: (payload: GeneratePlanPayload): Promise<GeneratedPlanResponse> =>
    api.post<GeneratedPlanResponse>('/v1/content/plans/generate', payload),

  addItem: (planId: string, payload: ContentItemPayload): Promise<ContentItem> =>
    api.post<ContentItem>(`/v1/content/plans/${planId}/items`, payload),

  updateItem: (id: string, payload: UpdateItemPayload): Promise<ContentItem> =>
    api.patch<ContentItem>(`/v1/content/items/${id}`, payload),

  deleteItem: (id: string): Promise<{ deleted: number; planId: string }> =>
    api.delete<{ deleted: number; planId: string }>(`/v1/content/items/${id}`),

  regenerateItem: (
    id: string,
    payload: { instruction?: string; fields?: string[] } = {},
  ): Promise<{ item: ContentItem; changed: string[]; model: string }> =>
    api.post<{ item: ContentItem; changed: string[]; model: string }>(
      `/v1/content/items/${id}/regenerate`,
      payload,
    ),

  generateCaption: (payload: {
    topic: string;
    platform?: ContentPlatform;
    existingCaption?: string;
    instruction?: string;
  }): Promise<GeneratedCaption & { appliedPreferences: ContentPreferences }> =>
    api.post<GeneratedCaption & { appliedPreferences: ContentPreferences }>(
      '/v1/content/captions',
      payload,
    ),
};

export type { ContentIdea };
