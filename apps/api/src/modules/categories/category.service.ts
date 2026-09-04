import type { AuthenticatedUser, PaginatedResult } from '@hadiya/shared';

import { toObjectIdOrNull } from '../../core/db/object-id.js';
import { ApiError } from '../../core/http/api-error.js';
import { assertRole } from '../../core/security/actor.js';
import { categoryRepository } from './category.repository.js';
import type { CategoryDocument } from './category.model.js';
import type {
  CreateCategoryInput,
  ListCategoriesQuery,
  UpdateCategoryInput,
} from './category.validators.js';

/** The catalogue is shared by every branch, so only managers upwards edit it. */
const MANAGE_ROLE = 'manager' as const;

const assertParentUsable = async (parentId: string, selfId?: string): Promise<void> => {
  if (selfId && parentId === selfId) {
    throw ApiError.badRequest('A category cannot be its own parent');
  }

  const parent = await categoryRepository.findById(parentId);

  if (!parent) {
    throw ApiError.badRequest('The parent category does not exist');
  }

  // One level of nesting keeps the tree navigable and rules out cycles.
  if (parent.parent) {
    throw ApiError.badRequest('Categories can only be nested one level deep');
  }
};

export const createCategory = async (
  actor: AuthenticatedUser,
  input: CreateCategoryInput,
): Promise<CategoryDocument> => {
  assertRole(actor, MANAGE_ROLE);

  if (await categoryRepository.nameExists(input.name)) {
    throw ApiError.conflict(`Category "${input.name}" already exists`);
  }

  if (input.parentId) {
    await assertParentUsable(input.parentId);
  }

  return categoryRepository.create({
    name: input.name,
    description: input.description ?? null,
    parent: toObjectIdOrNull(input.parentId),
    isActive: true,
  });
};

export const getCategory = async (id: string): Promise<CategoryDocument> => {
  const category = await categoryRepository.findById(id);

  if (!category) {
    throw ApiError.notFound('Category not found');
  }

  return category;
};

export const listCategories = async (
  query: ListCategoriesQuery,
): Promise<PaginatedResult<CategoryDocument>> => {
  const filter: Record<string, unknown> = {};

  if (query.parentId) {
    filter.parent = query.parentId;
  }

  if (query.isActive !== undefined) {
    filter.isActive = query.isActive;
  }

  if (query.search) {
    filter.name = { $regex: query.search, $options: 'i' };
  }

  return categoryRepository.list({ filter, pagination: query, sort: { name: 1 } });
};

export const updateCategory = async (
  actor: AuthenticatedUser,
  id: string,
  input: UpdateCategoryInput,
): Promise<CategoryDocument> => {
  assertRole(actor, MANAGE_ROLE);
  await getCategory(id);

  if (input.name && (await categoryRepository.nameExists(input.name, id))) {
    throw ApiError.conflict(`Category "${input.name}" already exists`);
  }

  if (input.parentId) {
    await assertParentUsable(input.parentId, id);
  }

  const update: Record<string, unknown> = {};

  if (input.name !== undefined) {
    update.name = input.name;
  }

  if (input.description !== undefined) {
    update.description = input.description;
  }

  if (input.isActive !== undefined) {
    update.isActive = input.isActive;
  }

  if (input.parentId !== undefined) {
    update.parent = toObjectIdOrNull(input.parentId);
  }

  const updated = await categoryRepository.updateById(id, update);

  if (!updated) {
    throw ApiError.notFound('Category not found');
  }

  return updated;
};

/**
 * A category with children is still in use by the tree, so it is deactivated
 * rather than removed — products that reference it keep resolving.
 */
export const deactivateCategory = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<CategoryDocument> => updateCategory(actor, id, { isActive: false });
