import type { Product } from '@hadiya/shared';
import { computed, ref } from 'vue';

export interface CartLine {
  product: Product;
  quantity: number;
  /** Absolute discount on the line, in minor units. */
  discount: number;
}

/**
 * The till's basket.
 *
 * Every total here is a *preview*. The server reads prices from the product and
 * recomputes the sale, so what is shown while ringing up is an estimate for the
 * cashier's benefit and the receipt that comes back is the truth. Keeping that
 * distinction explicit is what stops a client-side rounding difference from
 * becoming a disputed total at the counter.
 *
 * Lines are keyed by product: scanning the same barcode twice increments a
 * quantity rather than adding a second row, which is what a person expects and
 * what keeps the basket readable.
 */
export const useCart = () => {
  const lines = ref<CartLine[]>([]);

  const add = (product: Product, quantity = 1): void => {
    const existing = lines.value.find((line) => line.product.id === product.id);

    if (existing) {
      existing.quantity += quantity;
      lines.value = [...lines.value];

      return;
    }

    lines.value = [...lines.value, { product, quantity, discount: 0 }];
  };

  const setQuantity = (productId: string, quantity: number): void => {
    if (quantity <= 0) {
      remove(productId);

      return;
    }

    lines.value = lines.value.map((line) =>
      line.product.id === productId ? { ...line, quantity } : line,
    );
  };

  const setDiscount = (productId: string, discount: number): void => {
    lines.value = lines.value.map((line) =>
      line.product.id === productId
        ? {
            ...line,
            // A discount larger than the line is meaningless, and the API would
            // refuse it; clamping keeps the preview honest.
            discount: Math.max(0, Math.min(discount, line.product.price * line.quantity)),
          }
        : line,
    );
  };

  const remove = (productId: string): void => {
    lines.value = lines.value.filter((line) => line.product.id !== productId);
  };

  const clear = (): void => {
    lines.value = [];
  };

  const subtotal = computed(() =>
    lines.value.reduce((total, line) => total + line.product.price * line.quantity, 0),
  );

  const discountTotal = computed(() =>
    lines.value.reduce((total, line) => total + line.discount, 0),
  );

  const grandTotal = computed(() => Math.max(0, subtotal.value - discountTotal.value));

  const itemCount = computed(() => lines.value.reduce((count, line) => count + line.quantity, 0));

  const isEmpty = computed(() => lines.value.length === 0);

  /** The shape the API accepts: quantities and discounts, never prices. */
  const toPayload = () =>
    lines.value.map((line) => ({
      productId: line.product.id,
      quantity: line.quantity,
      ...(line.discount > 0 ? { discount: line.discount } : {}),
    }));

  return {
    lines,
    add,
    setQuantity,
    setDiscount,
    remove,
    clear,
    subtotal,
    discountTotal,
    grandTotal,
    itemCount,
    isEmpty,
    toPayload,
  };
};
