import { BaseRepository } from '../../core/db/base-repository.js';
import { ExpenseModel, type ExpenseDocument } from './expense.model.js';

class ExpenseRepository extends BaseRepository<ExpenseDocument> {
  constructor() {
    super(ExpenseModel);
  }
}

export const expenseRepository = new ExpenseRepository();
