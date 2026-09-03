/**
 * Money is stored and transported in minor units (tiyin for UZS, cents for USD)
 * as integers. Floating-point sums of prices are never persisted.
 */
export const DEFAULT_CURRENCY = 'UZS';

const DEFAULT_FRACTION_DIGITS = 2;

export const toMinorUnits = (amount: number, fractionDigits = DEFAULT_FRACTION_DIGITS): number => {
  if (!Number.isFinite(amount)) {
    throw new TypeError(`Cannot convert a non-finite amount to minor units: ${amount}`);
  }

  return Math.round(amount * 10 ** fractionDigits);
};

export const fromMinorUnits = (minor: number, fractionDigits = DEFAULT_FRACTION_DIGITS): number =>
  minor / 10 ** fractionDigits;

export interface FormatMoneyOptions {
  currency?: string;
  locale?: string;
  fractionDigits?: number;
}

export const formatMoney = (minor: number, options: FormatMoneyOptions = {}): string => {
  const {
    currency = DEFAULT_CURRENCY,
    locale = 'uz-UZ',
    fractionDigits = DEFAULT_FRACTION_DIGITS,
  } = options;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(fromMinorUnits(minor, fractionDigits));
};
