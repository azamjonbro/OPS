import { BillzError } from '../client/billz-error.js';
import type { BillzSale } from '../billz.types.js';
import type { BillzDirectoryService } from './billz-directory.service.js';
import type { BillzSalesService, SalesQuery } from './billz-sales.service.js';

export interface BillzPaymentBreakdownRow {
  paymentTypeId: string;
  paymentTypeName: string;
  isCash: boolean;
  receiptCount: number;
  /** Minor units across the receipts settled with this method. */
  total: number;
}

export interface BillzPaymentBreakdown {
  rows: BillzPaymentBreakdownRow[];
  /** Receipts settled with more than one method; Billz gives no per-method split. */
  mixedReceiptCount: number;
  mixedTotal: number;
  /** Receipts that matched no payment method at all — sold on credit. */
  creditReceiptCount: number;
  creditTotal: number;
}

export interface BillzDebtRow {
  saleExternalId: string;
  customerExternalId: string | null;
  customerName: string | null;
  amount: number;
  soldAt: string | null;
}

/**
 * The money side: how a period's takings split across payment methods, and what
 * is still owed.
 *
 * Billz's own reporting endpoints (`/v2/sales-report`, `/v1/cheque`) refuse an
 * API-key role, and its expense ledger (`/v1/gl-transaction`) accepts only an
 * interactive user session. Everything here is therefore built from the receipt
 * log, which that credential can read — and where Billz gives no answer, this
 * service reports the gap instead of inventing a number.
 */
export class BillzFinanceService {
  constructor(
    private readonly sales: BillzSalesService,
    private readonly directory: BillzDirectoryService,
  ) {}

  async paymentBreakdown(
    query: Omit<SalesQuery, 'paymentTypeIds'>,
  ): Promise<BillzPaymentBreakdown> {
    const [{ items: receipts }, { items: paymentTypes }] = await Promise.all([
      this.sales.listSales(query),
      this.directory.listPaymentTypes(),
    ]);

    const idsByType = new Map<string, Set<string>>();

    for (const paymentType of paymentTypes) {
      idsByType.set(
        paymentType.externalId,
        await this.sales.listSaleIdsByPaymentType(query, paymentType.externalId),
      );
    }

    const rows = new Map<string, BillzPaymentBreakdownRow>();
    let mixedReceiptCount = 0;
    let mixedTotal = 0;
    let creditReceiptCount = 0;
    let creditTotal = 0;

    for (const receipt of receipts) {
      const methods = paymentTypes.filter((type) =>
        idsByType.get(type.externalId)?.has(receipt.externalId),
      );

      if (methods.length === 0) {
        creditReceiptCount += 1;
        creditTotal += receipt.total;
        continue;
      }

      if (methods.length > 1) {
        // Billz records which methods settled a receipt, never how much each
        // one covered, so a split receipt is reported as split rather than
        // divided by a guess.
        mixedReceiptCount += 1;
        mixedTotal += receipt.total;
        continue;
      }

      const [method] = methods;

      if (!method) {
        continue;
      }

      const row = rows.get(method.externalId) ?? {
        paymentTypeId: method.externalId,
        paymentTypeName: method.name,
        isCash: method.isCash,
        receiptCount: 0,
        total: 0,
      };

      row.receiptCount += 1;
      row.total += receipt.total;
      rows.set(method.externalId, row);
    }

    return {
      rows: [...rows.values()].sort((left, right) => right.total - left.total),
      mixedReceiptCount,
      mixedTotal,
      creditReceiptCount,
      creditTotal,
    };
  }

  /** Receipts left on credit in a period, with what is still owed on each. */
  async listDebts(query: Omit<SalesQuery, 'paymentTypeIds'>): Promise<BillzDebtRow[]> {
    const { items } = await this.sales.listSales(query);

    return items
      .filter((sale): sale is BillzSale & { debtAmount: number } =>
        typeof sale.debtAmount === 'number' ? sale.debtAmount > 0 : false,
      )
      .map((sale) => ({
        saleExternalId: sale.externalId,
        customerExternalId: sale.customerExternalId,
        customerName: sale.customerName,
        amount: sale.debtAmount,
        soldAt: sale.soldAt,
      }))
      .sort((left, right) => right.amount - left.amount);
  }

  /**
   * Expenses live in Billz's general ledger, which rejects the API secret token
   * and accepts only an interactive user session — verified against the real
   * account. Rather than return an empty list that would read as "no expenses",
   * this says plainly that the data is out of reach.
   */
  listExpenses(): never {
    throw new BillzError(
      'forbidden',
      'Billz exposes expenses only through /v1/gl-transaction, which requires an interactive user session rather than an API key. Record expenses in Hadiya instead.',
    );
  }
}
