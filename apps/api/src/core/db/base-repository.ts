import {
  buildPaginationMeta,
  resolvePagination,
  type PaginatedResult,
  type PaginationParams,
} from '@hadiya/shared';
import type { Model, ProjectionType, QueryFilter, SortOrder, UpdateQuery } from 'mongoose';

export interface ListQuery<TDocument> {
  filter?: QueryFilter<TDocument>;
  pagination?: Partial<PaginationParams>;
  sort?: Record<string, SortOrder>;
  projection?: ProjectionType<TDocument>;
}

/**
 * Data-access base class. Services depend on repositories, never on Mongoose
 * models directly, so a collection can gain caching or move to an aggregation
 * pipeline without touching business logic.
 *
 * Reads return plain objects (`lean`) — hydrated documents are only used where
 * document methods or validation hooks are actually needed.
 */
export abstract class BaseRepository<TDocument> {
  protected constructor(protected readonly model: Model<TDocument>) {}

  async create(data: Partial<TDocument>): Promise<TDocument> {
    const created = await this.model.create(data);

    return created.toObject<TDocument>();
  }

  async findById(id: string, projection?: ProjectionType<TDocument>): Promise<TDocument | null> {
    return this.model.findById(id, projection).lean<TDocument | null>().exec();
  }

  async findOne(
    filter: QueryFilter<TDocument>,
    projection?: ProjectionType<TDocument>,
  ): Promise<TDocument | null> {
    return this.model.findOne(filter, projection).lean<TDocument | null>().exec();
  }

  async exists(filter: QueryFilter<TDocument>): Promise<boolean> {
    return (await this.model.exists(filter).exec()) !== null;
  }

  async count(filter: QueryFilter<TDocument> = {}): Promise<number> {
    return this.model.countDocuments(filter).exec();
  }

  /** Bounded read: the page size is clamped by `resolvePagination`. */
  async list(query: ListQuery<TDocument> = {}): Promise<PaginatedResult<TDocument>> {
    const filter = query.filter ?? {};
    const { page, pageSize, skip, limit } = resolvePagination(query.pagination);

    const [items, total] = await Promise.all([
      this.model
        .find(filter, query.projection)
        .sort(query.sort ?? { createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<TDocument[]>()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { items, pagination: buildPaginationMeta({ page, pageSize }, total) };
  }

  async updateById(id: string, update: UpdateQuery<TDocument>): Promise<TDocument | null> {
    return this.model
      .findByIdAndUpdate(id, update, { returnDocument: 'after', runValidators: true })
      .lean<TDocument | null>()
      .exec();
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.model.findByIdAndDelete(id).lean<TDocument | null>().exec();

    return result !== null;
  }
}
