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
  /**
   * Receipts settled with more than one method. Their money *is* in `rows`,
   * split per method; this only says how many receipts were split, which is a
   * question about how people pay rather than an admission of missing data.
   */
  mixedReceiptCount: number;
  /** The full value of those receipts, already counted across `rows`. */
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

  /**
   * How a period's takings split across payment methods.
   *
   * Read from each receipt's own payment rows, which carry `paid_amount` per
   * method. That matters twice over. A receipt settled with cash *and* card is
   * split exactly rather than being set aside as unsplittable — the earlier
   * implementation believed Billz did not report the split, and it does. And
   * the whole thing is now one request: the previous version asked Billz once
   * per payment method to find out which receipts each had touched, which was
   * a query per method per report and still could not say how much.
   *
   * A receipt with no payment rows went out on credit, and is reported as such
   * rather than being dropped or counted against a method it never used.
   */
  async paymentBreakdown(
    query: Omit<SalesQuery, 'paymentTypeIds'>,
  ): Promise<BillzPaymentBreakdown> {
    const [{ items: receipts }, { items: paymentTypes }] = await Promise.all([
      this.sales.listSales(query),
      this.directory.listPaymentTypes(),
    ]);

    const typesById = new Map(paymentTypes.map((type) => [type.externalId, type]));
    const rows = new Map<string, BillzPaymentBreakdownRow>();
    let mixedReceiptCount = 0;
    let mixedTotal = 0;
    let creditReceiptCount = 0;
    let creditTotal = 0;

    for (const receipt of receipts) {
      const paid = receipt.payments.filter((payment) => payment.paidAmount !== 0);

      if (paid.length === 0) {
        // Only a *sale* with nothing paid against it is credit. A return also
        // has no payment rows, and counting it here would report a refund as
        // money somebody owes — with a negative total, which quietly cancels
        // out real debt in the same period.
        if (receipt.type === 'sale') {
          creditReceiptCount += 1;
          creditTotal += receipt.total;
        }

        continue;
      }

      // Still counted, because "how many receipts took more than one method" is
      // a real question. It no longer withholds the money, though: each part is
      // attributed to the method that actually covered it.
      if (paid.length > 1) {
        mixedReceiptCount += 1;
        mixedTotal += receipt.total;
      }

      for (const payment of paid) {
        const type = typesById.get(payment.paymentTypeExternalId);
        const id = payment.paymentTypeExternalId || 'unknown';

        const row = rows.get(id) ?? {
          paymentTypeId: id,
          // The receipt names the method too, so one Billz has since renamed or
          // removed still reports as something a person recognises.
          paymentTypeName: type?.name ?? payment.paymentTypeName ?? 'Unknown method',
          isCash: type?.isCash ?? false,
          receiptCount: 0,
          total: 0,
        };

        row.receiptCount += 1;
        row.total += payment.paidAmount - payment.returnedAmount;
        rows.set(id, row);
      }
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
