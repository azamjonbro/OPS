/** Account states. Only an `active` employee may authenticate. */
export const USER_STATUSES = ['active', 'suspended'] as const;

export type UserStatus = (typeof USER_STATUSES)[number];
