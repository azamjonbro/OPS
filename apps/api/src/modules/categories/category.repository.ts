import { BaseRepository } from '../../core/db/base-repository.js';
import { CategoryModel, type CategoryDocument } from './category.model.js';

class CategoryRepository extends BaseRepository<CategoryDocument> {
  constructor() {
    super(CategoryModel);
  }

  async nameExists(name: string, excludeId?: string): Promise<boolean> {
    const filter: Record<string, unknown> = { name: name.trim() };

    if (excludeId) {
      filter._id = { $ne: excludeId };
    }

    return this.exists(filter);
  }

  async hasChildren(id: string): Promise<boolean> {
    return this.exists({ parent: id });
  }

  async isActive(id: string): Promise<boolean> {
    return this.exists({ _id: id, isActive: true });
  }
}

export const categoryRepository = new CategoryRepository();
