export const CUSTOMER_STATUSES = ['active', 'blocked'] as const;

export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];
