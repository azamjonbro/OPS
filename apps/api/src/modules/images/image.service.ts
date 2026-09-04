import {
  buildPaginationMeta,
  IMAGE_DEFAULT_COUNT,
  IMAGE_FILE_EXTENSIONS,
  IMAGE_MAX_COUNT,
  IMAGE_MAX_PER_CONTENT_ITEM,
  isObjectIdString,
  resolvePagination,
  type AuthenticatedUser,
  type ImageAspectRatio,
  type ImageAssetStatus,
  type ImageContentType,
  type ImageQuality,
  type ImageStyle,
  type PaginatedResult,
} from '@hadiya/shared';

import { toObjectId, toObjectIdOrNull } from '../../core/db/object-id.js';
import { ApiError } from '../../core/http/api-error.js';
import { createLogger } from '../../core/logger/logger.js';
import { isAiProviderError } from '../ai/provider/index.js';
import * as contentService from '../content/content.service.js';
import { ImageAssetModel, type ImageAssetDocument } from './image-asset.model.js';
import { getImageProvider } from './providers/index.js';
import type { ImageProvider } from './providers/image-provider.js';
import { getStorageProvider, type RetrievedObject } from './storage/index.js';

const log = createLogger('images');

/**
 * Generated images, scoped to one person.
 *
 * Every read and write filters on the actor's id — including the one that
 * serves the bytes, which is the point: an image is a business asset that may
 * show unreleased products or draft pricing, so a URL that anyone could guess
 * would be a leak. The filter *is* the authorisation, so a query that cannot
 * match another account's row cannot expose it.
 */
const ownedBy = (actor: AuthenticatedUser, extra: Record<string, unknown> = {}) => ({
  user: toObjectId(actor.id),
  ...extra,
});

/**
 * The path that serves an image's bytes.
 *
 * Relative and authenticated, not a storage location: the client fetches it
 * with its token like any other endpoint, which is what keeps a private asset
 * private regardless of what the storage driver happens to be underneath.
 */
export const imageUrl = (assetId: string): string => `/api/v1/images/${assetId}/file`;

/** Server-chosen, derived from ids only, so nothing a client sends reaches a path. */
const storageKeyFor = (
  userId: string,
  assetId: string,
  contentType: ImageContentType,
): string => `images/${userId.toLowerCase()}/${assetId.toLowerCase()}.${IMAGE_FILE_EXTENSIONS[contentType]}`;

/** The shape a client renders: the row plus the URL its bytes are served from. */
export interface ImageAssetView extends ImageAssetDocument {
  url: string | null;
}

export const toView = (asset: ImageAssetDocument): ImageAssetView => ({
  ...asset,
  // Only a completed asset has anything to serve; a URL on a failed one would
  // be an invitation to a broken image.
  url: asset.status === 'completed' && asset.storageKey ? imageUrl(String(asset._id)) : null,
});

/** Turns a provider failure into the one error shape callers handle. */
const generationFailed = (error: unknown): ApiError => {
  if (error instanceof ApiError) {
    return error;
  }

  if (isAiProviderError(error)) {
    // The provider's own message is safe — it is written by us, never copied
    // from an upstream body that could echo a credential back.
    return error.kind === 'rate_limited'
      ? ApiError.rateLimited('Image generation is busy, please try again shortly', {
          cause: error,
          details: { integration: 'images', kind: error.kind },
        })
      : ApiError.dependencyUnavailable(`Image generation failed: ${error.message}`, {
          cause: error,
          details: { integration: 'images', kind: error.kind },
        });
  }

  return ApiError.dependencyUnavailable('Image generation failed', { cause: error });
};

/**
 * Confirms the content item belongs to the actor before anything is attached.
 *
 * Reached through the content service, so the ownership rule lives in one place
 * rather than being re-implemented here with a subtly different filter.
 */
const assertContentItemOwned = async (
  actor: AuthenticatedUser,
  contentItemId: string,
): Promise<void> => {
  // Throws `404` when it belongs to somebody else, which is what a stranger
  // should see: a `403` would confirm the id exists.
  await contentService.getItem(actor, contentItemId);

  const attached = await ImageAssetModel.countDocuments(
    ownedBy(actor, { contentItem: contentItemId, status: { $ne: 'failed' } }),
  ).exec();

  if (attached >= IMAGE_MAX_PER_CONTENT_ITEM) {
    throw ApiError.badRequest(
      `A content item may hold at most ${IMAGE_MAX_PER_CONTENT_ITEM} images`,
    );
  }
};

export interface GenerateImagesInput {
  prompt: string;
  aspectRatio?: ImageAspectRatio | undefined;
  quality?: ImageQuality | undefined;
  style?: ImageStyle | undefined;
  count?: number | undefined;
  contentItemId?: string | null | undefined;
  conversationId?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface GenerateImagesResult {
  images: ImageAssetView[];
  /** Set when fewer images came back than were asked for, and why. */
  note: string | null;
}

export interface GenerationDependencies {
  provider?: ImageProvider | undefined;
}

/**
 * Generates images, stores them, and records what happened.
 *
 * The order matters. Ownership is checked first, so a request that could never
 * be attached never reaches a paid API. Rows are written as `generating`
 * *before* the provider is called, so a crash mid-flight leaves visible
 * evidence rather than nothing. The bytes are copied into storage before a row
 * is marked `completed`, so a completed asset always has something behind it.
 * And a failure marks the rows `failed` with a reason rather than deleting
 * them — a person who paid for a generation that did not work should be able to
 * see that, not wonder whether they imagined it.
 */
export const generateImages = async (
  actor: AuthenticatedUser,
  input: GenerateImagesInput,
  dependencies: GenerationDependencies = {},
): Promise<GenerateImagesResult> => {
  const provider = dependencies.provider ?? getImageProvider();
  const storage = getStorageProvider();

  if (!provider.isConfigured) {
    // Asks the provider to produce its own refusal, so the reason is the
    // provider's rather than a guess made here.
    await provider.generate({ prompt: input.prompt, count: 1, aspectRatio: '1:1' });
  }

  const contentItemId = isObjectIdString(input.contentItemId) ? input.contentItemId : null;

  if (contentItemId) {
    await assertContentItemOwned(actor, contentItemId);
  }

  const requested = Math.max(1, Math.min(input.count ?? IMAGE_DEFAULT_COUNT, IMAGE_MAX_COUNT));
  const count = Math.max(1, Math.min(requested, provider.maxImagesPerRequest || 1));
  const aspectRatio = input.aspectRatio ?? '1:1';

  const drafts = await ImageAssetModel.create(
    Array.from({ length: count }, () => ({
      user: toObjectId(actor.id),
      prompt: input.prompt,
      revisedPrompt: null,
      provider: provider.name,
      model: provider.model,
      status: 'generating' as ImageAssetStatus,
      aspectRatio,
      quality: input.quality ?? null,
      style: input.style ?? null,
      contentItem: toObjectIdOrNull(contentItemId),
      conversation: isObjectIdString(input.conversationId)
        ? toObjectIdOrNull(input.conversationId)
        : null,
      metadata: input.metadata ?? {},
    })),
  );

  const draftIds = drafts.map((draft) => draft._id);

  try {
    const generated = await provider.generate({
      prompt: input.prompt,
      count,
      aspectRatio,
      quality: input.quality,
      style: input.style,
    });

    const completed: ImageAssetView[] = [];

    for (const [index, draftId] of draftIds.entries()) {
      const image = generated.images[index];

      if (!image) {
        // The provider returned fewer than it was asked for. The extra rows are
        // not left claiming to be generating for ever.
        await ImageAssetModel.updateOne(
          { _id: draftId },
          {
            $set: {
              status: 'failed',
              failureReason: 'The provider returned fewer images than were requested',
            },
          },
        ).exec();
        continue;
      }

      const key = storageKeyFor(actor.id, String(draftId), image.contentType);
      const stored = await storage.put(key, image.data, image.contentType);

      const updated = await ImageAssetModel.findOneAndUpdate(
        { _id: draftId },
        {
          $set: {
            status: 'completed',
            model: generated.model,
            revisedPrompt: image.revisedPrompt,
            width: image.width,
            height: image.height,
            storageKey: stored.key,
            contentType: stored.contentType,
            sizeBytes: stored.sizeBytes,
            failureReason: null,
          },
        },
        { returnDocument: 'after' },
      )
        .lean<ImageAssetDocument | null>()
        .exec();

      if (updated) {
        completed.push(toView(updated));
      }
    }

    log.info(
      {
        requested,
        produced: completed.length,
        provider: provider.name,
        model: generated.model,
        contentItemId,
      },
      'images generated',
    );

    return {
      images: completed,
      note:
        completed.length < requested
          ? `${completed.length} of ${requested} images were produced; ${provider.name} returns at most ${provider.maxImagesPerRequest} per request.`
          : null,
    };
  } catch (error) {
    const failure = generationFailed(error);

    await ImageAssetModel.updateMany(
      { _id: { $in: draftIds }, status: 'generating' },
      { $set: { status: 'failed', failureReason: failure.message.slice(0, 500) } },
    ).exec();

    log.warn({ err: error, provider: provider.name }, 'image generation failed');

    throw failure;
  }
};

export interface ListImagesQuery {
  page: number;
  pageSize: number;
  status?: ImageAssetStatus | undefined;
  contentItemId?: string | undefined;
  /** True lists only images not yet attached to a content item. */
  unattached?: boolean | undefined;
  search?: string | undefined;
}

export const listImages = async (
  actor: AuthenticatedUser,
  query: ListImagesQuery,
): Promise<PaginatedResult<ImageAssetView>> => {
  const filter: Record<string, unknown> = ownedBy(actor);

  if (query.status) {
    filter.status = query.status;
  }

  if (query.contentItemId) {
    filter.contentItem = query.contentItemId;
  } else if (query.unattached) {
    filter.contentItem = null;
  }

  if (query.search) {
    filter.prompt = { $regex: query.search, $options: 'i' };
  }

  const { page, pageSize, skip, limit } = resolvePagination(query);

  const [items, total] = await Promise.all([
    ImageAssetModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<ImageAssetDocument[]>()
      .exec(),
    ImageAssetModel.countDocuments(filter).exec(),
  ]);

  return { items: items.map(toView), pagination: buildPaginationMeta({ page, pageSize }, total) };
};

export const getImage = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<ImageAssetDocument> => {
  const asset = await ImageAssetModel.findOne(ownedBy(actor, { _id: id }))
    .lean<ImageAssetDocument | null>()
    .exec();

  if (!asset) {
    throw ApiError.notFound('Image not found');
  }

  return asset;
};

/** The bytes, read only after the row proved the caller owns them. */
export const readImageFile = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<RetrievedObject> => {
  const asset = await getImage(actor, id);

  if (asset.status !== 'completed' || !asset.storageKey) {
    throw ApiError.notFound('This image has no file');
  }

  return getStorageProvider().read(asset.storageKey);
};

/**
 * Attaches an image to a day of a plan, or detaches it when given `null`.
 *
 * Both sides are checked: the image must be the actor's, and so must the
 * content item. Confirming only one would let somebody staple their own image
 * onto another account's plan.
 */
export const attachImage = async (
  actor: AuthenticatedUser,
  id: string,
  contentItemId: string | null,
): Promise<ImageAssetView> => {
  await getImage(actor, id);

  if (contentItemId) {
    await assertContentItemOwned(actor, contentItemId);
  }

  const updated = await ImageAssetModel.findOneAndUpdate(
    ownedBy(actor, { _id: id }),
    { $set: { contentItem: toObjectIdOrNull(contentItemId) } },
    { returnDocument: 'after' },
  )
    .lean<ImageAssetDocument | null>()
    .exec();

  if (!updated) {
    throw ApiError.notFound('Image not found');
  }

  return toView(updated);
};

/**
 * Deletes an image and the file behind it.
 *
 * The row goes first: a row without its file is a broken thumbnail, while a
 * file without its row is an orphan nothing can reach and that the sweep below
 * can clear. Storage failing is logged rather than thrown, because the person
 * asked for the image to be gone and it is.
 */
export const deleteImage = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<{ deleted: number }> => {
  const asset = await ImageAssetModel.findOneAndDelete(ownedBy(actor, { _id: id }))
    .lean<ImageAssetDocument | null>()
    .exec();

  if (!asset) {
    throw ApiError.notFound('Image not found');
  }

  if (asset.storageKey) {
    try {
      await getStorageProvider().delete(asset.storageKey);
    } catch (error) {
      log.warn({ err: error, storageKey: asset.storageKey }, 'stored image could not be removed');
    }
  }

  return { deleted: 1 };
};

/** Images attached to one day, for the content views. */
export const listForContentItem = async (
  actor: AuthenticatedUser,
  contentItemId: string,
): Promise<ImageAssetView[]> => {
  const assets = await ImageAssetModel.find(
    ownedBy(actor, { contentItem: contentItemId, status: 'completed' }),
  )
    .sort({ createdAt: -1 })
    .lean<ImageAssetDocument[]>()
    .exec();

  return assets.map(toView);
};
