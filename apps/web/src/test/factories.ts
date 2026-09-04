import type {
  Category,
  Customer,
  Expense,
  InventoryItem,
  PaginatedResult,
  Product,
  Reminder,
  Sale,
  User,
} from '@hadiya/shared';

/**
 * Fixtures shaped exactly like the API's own responses.
 *
 * They exist so a test states only what it cares about — a name, a price — and
 * the rest is a valid record. Getting these shapes wrong is the usual way a
 * frontend suite passes while the real thing breaks, so each mirrors the shared
 * type rather than a convenient subset of it.
 */
let sequence = 0;

/** A 24-character hex id, because the API's validators insist on one. */
export const objectId = (): string => {
  sequence += 1;

  return sequence.toString(16).padStart(24, 'a');
};

const timestamps = () => ({
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
});

export const paginated = <TItem>(
  items: TItem[],
  overrides: Partial<PaginatedResult<TItem>['pagination']> = {},
): PaginatedResult<TItem> => {
  const pageSize = overrides.pageSize ?? 20;
  const total = overrides.total ?? items.length;

  return {
    items,
    pagination: {
      page: overrides.page ?? 1,
      pageSize,
      total,
      totalPages: overrides.totalPages ?? Math.ceil(total / pageSize),
      hasPrevious: overrides.hasPrevious ?? (overrides.page ?? 1) > 1,
      hasNext: overrides.hasNext ?? (overrides.page ?? 1) * pageSize < total,
    },
  };
};

export const makeUser = (overrides: Partial<User> = {}): User => ({
  id: objectId(),
  username: 'manager',
  fullName: 'Test Manager',
  role: 'manager',
  status: 'active',
  phone: null,
  branch: null,
  timezone: 'Asia/Tashkent',
  lastLoginAt: null,
  ...timestamps(),
  ...overrides,
});

export const makeProduct = (overrides: Partial<Product> = {}): Product => ({
  id: objectId(),
  name: 'Cola 1L',
  sku: 'COLA1L',
  barcode: '4780000000001',
  description: null,
  category: objectId(),
  price: 1_200_000,
  costPrice: 900_000,
  currency: 'UZS',
  unit: 'piece',
  trackInventory: true,
  reorderLevel: 5,
  isActive: true,
  images: [],
  externalRefs: [],
  ...timestamps(),
  ...overrides,
});

export const makeCategory = (overrides: Partial<Category> = {}): Category => ({
  id: objectId(),
  name: 'Drinks',
  description: null,
  parent: null,
  isActive: true,
  ...timestamps(),
  ...overrides,
});

export const makeCustomer = (overrides: Partial<Customer> = {}): Customer => ({
  id: objectId(),
  fullName: 'Aziz Karimov',
  phone: '+998901234567',
  notes: null,
  status: 'active',
  branch: null,
  debtBalance: 0,
  ...timestamps(),
  ...overrides,
});

export const makeSale = (overrides: Partial<Sale> = {}): Sale => ({
  id: objectId(),
  number: 'S-0001',
  branch: objectId(),
  employee: objectId(),
  customer: null,
  items: [
    {
      product: objectId(),
      name: 'Cola 1L',
      sku: 'COLA1L',
      unitPrice: 1_200_000,
      costPrice: 900_000,
      quantity: 2,
      discount: 0,
      lineTotal: 2_400_000,
    },
  ],
  totals: {
    subtotal: 2_400_000,
    discountTotal: 0,
    grandTotal: 2_400_000,
    paidAmount: 2_400_000,
    dueAmount: 0,
  },
  status: 'completed',
  paymentStatus: 'paid',
  note: null,
  soldAt: '2026-09-05T09:00:00.000Z',
  cancelledAt: null,
  ...overrides,
});

export const makeExpense = (overrides: Partial<Expense> = {}): Expense => ({
  id: objectId(),
  branch: objectId(),
  category: 'rent',
  amount: 5_000_000,
  description: 'September rent',
  date: '2026-09-01T00:00:00.000Z',
  status: 'pending',
  createdBy: objectId(),
  reviewedBy: null,
  ...timestamps(),
  ...overrides,
});

export const makeStockItem = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  id: objectId(),
  product: objectId(),
  branch: objectId(),
  quantity: 12,
  ...timestamps(),
  ...overrides,
});

export const makeReminder = (overrides: Partial<Reminder> = {}): Reminder => ({
  id: objectId(),
  user: objectId(),
  title: 'Check Billz debts',
  description: null,
  scheduledAt: '2026-09-06T05:00:00.000Z',
  timezone: 'Asia/Tashkent',
  status: 'scheduled',
  recurrenceRule: null,
  channels: ['in_app'],
  conversation: null,
  metadata: {},
  lastSentAt: null,
  occurrenceCount: 0,
  failureReason: null,
  cancelledAt: null,
  ...timestamps(),
  ...overrides,
});
