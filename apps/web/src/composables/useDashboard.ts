import { formatMoney, type InventoryItem, type Product, type Sale } from '@hadiya/shared';
import { computed, ref } from 'vue';

import { toErrorMessage } from '@/services/api-error';
import { expenseService } from '@/services/expense.service';
import { inventoryService } from '@/services/inventory.service';
import { productService } from '@/services/catalogue.service';
import { saleService } from '@/services/sales.service';

/**
 * The dashboard's figures, assembled from endpoints that already exist.
 *
 * Everything here is computed from real records the API returned. Where a
 * number cannot be derived honestly it is not shown at all rather than
 * estimated: `profit` is the clearest case — the sale line carries the cost
 * price it was sold at, so gross margin on *sales* is real, but net profit would
 * need expenses attributed to the same period and branch, which the API does not
 * do, so it is reported as gross margin and named that way.
 *
 * There is no reporting endpoint yet, so this is a client-side aggregation over
 * one page of recent sales. That is a real limitation and the reason the range
 * is bounded to a day: it is honest for today's till, and it would quietly
 * under-report over a month, so no monthly figure is offered from it.
 */
const SALES_PAGE_SIZE = 100;
const LOW_STOCK_PAGE_SIZE = 50;

export interface DashboardMetrics {
  saleCount: number;
  revenue: number;
  collected: number;
  outstanding: number;
  grossMargin: number;
  expenses: number;
  itemsSold: number;
}

export interface TopProduct {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  revenue: number;
}

export interface DashboardData {
  metrics: DashboardMetrics;
  recentSales: Sale[];
  topProducts: TopProduct[];
  lowStock: Array<{ item: InventoryItem; product: Product | null }>;
  /** True when the day's sales exceeded one page and totals are a floor. */
  truncated: boolean;
}

const startOfDay = (date: Date): string => {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);

  return day.toISOString();
};

const endOfDay = (date: Date): string => {
  const day = new Date(date);
  day.setHours(23, 59, 59, 999);

  return day.toISOString();
};

export const useDashboard = (branchId?: () => string | undefined) => {
  const data = ref<DashboardData | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const load = async (): Promise<void> => {
    isLoading.value = true;
    error.value = null;

    const now = new Date();
    const scope = branchId?.();
    const range = {
      from: startOfDay(now),
      to: endOfDay(now),
      ...(scope ? { branchId: scope } : {}),
    };

    try {
      const [sales, expenses, lowStock] = await Promise.all([
        saleService.list({ ...range, status: 'completed', pageSize: SALES_PAGE_SIZE }),
        expenseService.list({ ...range, status: 'approved', pageSize: SALES_PAGE_SIZE }),
        // `maxQuantity` is the reorder view the inventory service already offers.
        inventoryService.stock({
          ...(scope ? { branchId: scope } : {}),
          maxQuantity: 5,
          pageSize: LOW_STOCK_PAGE_SIZE,
        }),
      ]);

      const metrics = sales.items.reduce<DashboardMetrics>(
        (running, sale) => ({
          saleCount: running.saleCount + 1,
          revenue: running.revenue + sale.totals.grandTotal,
          collected: running.collected + sale.totals.paidAmount,
          outstanding: running.outstanding + sale.totals.dueAmount,
          grossMargin:
            running.grossMargin +
            sale.items.reduce(
              (margin, line) => margin + (line.lineTotal - line.costPrice * line.quantity),
              0,
            ),
          expenses: 0,
          itemsSold:
            running.itemsSold + sale.items.reduce((count, line) => count + line.quantity, 0),
        }),
        {
          saleCount: 0,
          revenue: 0,
          collected: 0,
          outstanding: 0,
          grossMargin: 0,
          expenses: 0,
          itemsSold: 0,
        },
      );

      metrics.saleCount = sales.pagination.total;
      metrics.expenses = expenses.items.reduce((total, expense) => total + expense.amount, 0);

      const byProduct = new Map<string, TopProduct>();

      for (const sale of sales.items) {
        for (const line of sale.items) {
          const entry = byProduct.get(line.product) ?? {
            productId: line.product,
            name: line.name,
            sku: line.sku,
            quantity: 0,
            revenue: 0,
          };

          entry.quantity += line.quantity;
          entry.revenue += line.lineTotal;
          byProduct.set(line.product, entry);
        }
      }

      // The stock rows name a product id; the names come from one extra read
      // rather than a request per row.
      const productIds = [...new Set(lowStock.items.map((item) => item.product))];
      const products = new Map<string, Product>();

      if (productIds.length > 0) {
        const catalogue = await productService.list({ pageSize: 100 });

        for (const product of catalogue.items) {
          products.set(product.id, product);
        }
      }

      data.value = {
        metrics,
        recentSales: sales.items.slice(0, 6),
        topProducts: [...byProduct.values()]
          .sort((left, right) => right.revenue - left.revenue)
          .slice(0, 5),
        lowStock: lowStock.items
          .map((item) => ({ item, product: products.get(item.product) ?? null }))
          .slice(0, 8),
        truncated: sales.pagination.total > sales.items.length,
      };
    } catch (caught) {
      error.value = toErrorMessage(caught);
      data.value = null;
    } finally {
      isLoading.value = false;
    }
  };

  const hasData = computed(() => data.value !== null);

  return { data, hasData, isLoading, error, load, formatMoney };
};
