import { BaseRepository } from '../../core/db/base-repository.js';
import { BranchModel, type BranchDocument } from './branch.model.js';

class BranchRepository extends BaseRepository<BranchDocument> {
  constructor() {
    super(BranchModel);
  }

  async codeExists(code: string, excludeId?: string): Promise<boolean> {
    const filter: Record<string, unknown> = { code: code.trim().toUpperCase() };

    if (excludeId) {
      filter._id = { $ne: excludeId };
    }

    return this.exists(filter);
  }

  /** True when the branch exists and is open for business. */
  async isActive(id: string): Promise<boolean> {
    return this.exists({ _id: id, isActive: true });
  }
}

export const branchRepository = new BranchRepository();
