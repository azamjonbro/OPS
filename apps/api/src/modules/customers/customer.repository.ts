import type { ClientSession } from 'mongoose';

import { BaseRepository } from '../../core/db/base-repository.js';
import { CustomerModel, type CustomerDocument } from './customer.model.js';

class CustomerRepository extends BaseRepository<CustomerDocument> {
  constructor() {
    super(CustomerModel);
  }

  async phoneExists(phone: string, excludeId?: string): Promise<boolean> {
    const filter: Record<string, unknown> = { phone: phone.trim() };

    if (excludeId) {
      filter._id = { $ne: excludeId };
    }

    return this.exists(filter);
  }

  /**
   * Applies a signed change to the outstanding debt. `$inc` keeps the update
   * atomic, so two concurrent sales cannot overwrite each other's balance.
   */
  async adjustDebt(id: string, delta: number, session?: ClientSession): Promise<void> {
    await CustomerModel.updateOne(
      { _id: id },
      { $inc: { debtBalance: delta } },
      { session },
    ).exec();
  }

  async findByIdInSession(id: string, session?: ClientSession): Promise<CustomerDocument | null> {
    return CustomerModel.findById(id)
      .session(session ?? null)
      .lean<CustomerDocument | null>()
      .exec();
  }
}

export const customerRepository = new CustomerRepository();
