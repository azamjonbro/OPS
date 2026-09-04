import { DEFAULT_CURRENCY, type AuthenticatedUser, type PaginatedResult } from '@hadiya/shared';

import { toObjectId } from '../../core/db/object-id.js';
import { ApiError } from '../../core/http/api-error.js';
import { assertRole } from '../../core/security/actor.js';
import { categoryRepository } from '../categories/category.repository.js';
import { productRepository } from './product.repository.js';
import type { ProductDocument, ProductImageSubdocument } from './product.model.js';
import type {
  CreateProductInput,
  ListProductsQuery,
  UpdateProductInput,
} from './product.validators.js';

/** The catalogue is organisation-wide, so editing it is a manager's job. */
const MANAGE_ROLE = 'manager' as const;

type ImageInput = NonNullable<CreateProductInput['images']>[number];

/**
 * Normalises the gallery: exactly one primary image (the one marked, or the
 * first), and a stable sort order. Leaving this to clients produces galleries
 * with two primaries or none.
 */
const normaliseImages = (images: ImageInput[] | undefined): ProductImageSubdocument[] => {
  if (!images || images.length === 0) {
    return [];
  }

  const primaryIndex = Math.max(
    images.findIndex((image) => image.isPrimary === true),
    0,
  );

  return images.map((image, index) => ({
    url: image.url,
    alt: image.alt ?? null,
    isPrimary: index === primaryIndex,
    sortOrder: image.sortOrder ?? index,
  }));
};

const assertCategoryUsable = async (categoryId: string): Promise<void> => {
  if (!(await categoryRepository.isActive(categoryId))) {
    throw ApiError.badRequest('The category does not exist or is not active');
  }
};

const assertIdentifiersFree = async (
  input: { sku?: string; barcode?: string | null },
  excludeId?: string,
): Promise<void> => {
  if (input.sku && (await productRepository.skuExists(input.sku, excludeId))) {
    throw ApiError.conflict(`SKU "${input.sku}" is already used by another product`);
  }

  if (input.barcode && (await productRepository.barcodeExists(input.barcode, excludeId))) {
    throw ApiError.conflict(`Barcode "${input.barcode}" is already used by another product`);
  }
};

export const createProduct = async (
  actor: AuthenticatedUser,
  input: CreateProductInput,
): Promise<ProductDocument> => {
  assertRole(actor, MANAGE_ROLE);
  await assertCategoryUsable(input.categoryId);
  await assertIdentifiersFree({ sku: input.sku, barcode: input.barcode ?? null });

  return productRepository.create({
    name: input.name,
    sku: input.sku,
    barcode: input.barcode ?? null,
    description: input.description ?? null,
    category: toObjectId(input.categoryId),
    price: input.price,
    costPrice: input.costPrice ?? 0,
    currency: input.currency ?? DEFAULT_CURRENCY,
    unit: input.unit ?? 'piece',
    trackInventory: input.trackInventory ?? true,
    reorderLevel: input.reorderLevel ?? 0,
    isActive: true,
    images: normaliseImages(input.images),
    externalRefs: (input.externalRefs ?? []).map((ref) => ({ ...ref, syncedAt: null })),
  });
};

export const getProduct = async (id: string): Promise<ProductDocument> => {
  const product = await productRepository.findById(id);

  if (!product) {
    throw ApiError.notFound('Product not found');
  }

  return product;
};

export const listProducts = async (
  query: ListProductsQuery,
): Promise<PaginatedResult<ProductDocument>> => {
  const filter: Record<string, unknown> = {};

  if (query.categoryId) {
    filter.category = query.categoryId;
  }

  if (query.isActive !== undefined) {
    filter.isActive = query.isActive;
  }

  if (query.sku) {
    filter.sku = query.sku;
  }

  if (query.barcode) {
    filter.barcode = query.barcode;
  }

  if (query.search) {
    filter.$or = [
      { name: { $regex: query.search, $options: 'i' } },
      { sku: { $regex: query.search, $options: 'i' } },
      { barcode: { $regex: query.search, $options: 'i' } },
    ];
  }

  return productRepository.list({ filter, pagination: query, sort: { name: 1 } });
};

export const updateProduct = async (
  actor: AuthenticatedUser,
  id: string,
  input: UpdateProductInput,
): Promise<ProductDocument> => {
  assertRole(actor, MANAGE_ROLE);
  await getProduct(id);

  if (input.categoryId) {
    await assertCategoryUsable(input.categoryId);
  }

  await assertIdentifiersFree({ barcode: input.barcode ?? null }, id);

  const update: Record<string, unknown> = {};
  const directFields = [
    'name',
    'barcode',
    'description',
    'price',
    'costPrice',
    'unit',
    'trackInventory',
    'reorderLevel',
    'isActive',
  ] as const;

  for (const field of directFields) {
    if (input[field] !== undefined) {
      update[field] = input[field];
    }
  }

  if (input.categoryId !== undefined) {
    update.category = toObjectId(input.categoryId);
  }

  if (input.images !== undefined) {
    update.images = normaliseImages(input.images);
  }

  if (input.externalRefs !== undefined) {
    update.externalRefs = input.externalRefs.map((ref) => ({ ...ref, syncedAt: null }));
  }

  const updated = await productRepository.updateById(id, update);

  if (!updated) {
    throw ApiError.notFound('Product not found');
  }

  return updated;
};

/**
 * The SKU is deliberately not updatable: it is printed on labels, referenced by
 * past sales and used as the match key by imports. Deactivation retires a
 * product without breaking any of those.
 */
export const deactivateProduct = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<ProductDocument> => updateProduct(actor, id, { isActive: false });
