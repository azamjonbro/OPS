import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { createTestBranch, signInAs } from '../../test/factories.js';
import { createToolRegistry } from '../ai/tools/index.js';
import { ExpenseModel, type ExpenseDocument } from './expense.model.js';

/**
 * The assistant's route to the ledger, through the same registry the agent
 * uses: real validation, the real service, the real database.
 *
 * The thing most worth protecting here is the unit. A person says "3 million";
 * the model writes 3000000; the database must hold 300000000 tiyin, and the
 * summary read back must say three million again.
 */

const app = createApp();
const CONVERSATION = '68b8f0000000000000000001';

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);

const signIn = async () => {
  const branch = await createTestBranch();

  return signInAs(app, 'manager', String(branch._id));
};

describe('the tool registry', () => {
  it('advertises every expense tool to the model', () => {
    const names = createToolRegistry()
      .definitions()
      .map((definition) => definition.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'expenses_record',
        'expenses_list',
        'expenses_get_summary',
        'expenses_update',
        'expenses_delete',
      ]),
    );
  });

  it('asks before removing and never before recording', () => {
    const registry = createToolRegistry();

    expect(registry.get('expenses_record')?.mutates).toBe(true);
    expect(registry.get('expenses_record')?.requiresConfirmation).toBeUndefined();
    expect(registry.get('expenses_delete')?.requiresConfirmation).toBe(true);
    expect(registry.get('expenses_get_summary')?.mutates).toBe(false);
  });
});

describe('expenses_record', () => {
  it("stores whole so'm as tiyin and keeps the conversation as provenance", async () => {
    const { actor } = await signIn();

    const outcome = await createToolRegistry().execute(
      'expenses_record',
      { category: 'rent', amount: 3_000_000, vendor: 'Ali aka' },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('succeeded');
    expect(outcome.result.summary).toContain('Ijara');

    const stored = await ExpenseModel.findOne().lean<ExpenseDocument | null>().exec();
    expect(stored).toMatchObject({
      category: 'rent',
      amount: 300_000_000,
      paymentMethod: 'cash',
      vendor: 'Ali aka',
    });
    expect(String(stored?.conversation)).toBe(CONVERSATION);
  });

  it('refuses an amount stated in tiyin by mistake', async () => {
    const { actor } = await signIn();

    const outcome = await createToolRegistry().execute(
      'expenses_record',
      // A hundred times the ceiling: the sort of number that appears when the
      // model multiplies where the tool already does.
      { category: 'goods', amount: 100_000_000_000 },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).not.toBe('succeeded');
    expect(await ExpenseModel.countDocuments().exec()).toBe(0);
  });
});

describe('expenses_get_summary', () => {
  it('reads the total back in the same money it was written in', async () => {
    const { actor } = await signIn();
    const registry = createToolRegistry();
    const context = { actor, conversationId: CONVERSATION };

    await registry.execute('expenses_record', { category: 'rent', amount: 3_000_000 }, context);
    await registry.execute('expenses_record', { category: 'goods', amount: 1_000_000 }, context);

    const outcome = await registry.execute('expenses_get_summary', { period: 'today' }, context);

    expect(outcome.status).toBe('succeeded');
    const data = outcome.result.data as { total: number; count: number };
    expect(data.total).toBe(400_000_000);
    expect(data.count).toBe(2);
    expect(outcome.result.summary).toContain('Ijara');
    // Rent is 75% of the spend, and the model is told so.
    expect(outcome.result.summary).toContain('75%');
  });
});

describe('expenses_delete', () => {
  it('describes what would go and removes nothing until confirmed', async () => {
    const { actor } = await signIn();
    const registry = createToolRegistry();
    const context = { actor, conversationId: CONVERSATION };

    const recorded = await registry.execute(
      'expenses_record',
      { category: 'salary', amount: 2_500_000, vendor: 'Dilnoza' },
      context,
    );
    const { id } = recorded.result.data as { id: string };

    const proposed = await registry.execute('expenses_delete', { expenseId: id }, context);
    expect(proposed.status).toBe('needs_confirmation');
    expect(await ExpenseModel.countDocuments({ deletedAt: null }).exec()).toBe(1);

    const confirmed = await registry.execute(
      'expenses_delete',
      { expenseId: id, confirm: true },
      context,
    );
    expect(confirmed.status).toBe('succeeded');
    expect(await ExpenseModel.countDocuments({ deletedAt: null }).exec()).toBe(0);
  });
});
