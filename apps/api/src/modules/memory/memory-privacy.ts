/**
 * What must never be written to long-term memory.
 *
 * A remembered secret is worse than a forgotten one: it survives the
 * conversation, is replayed into later prompts, and ends up in a database that
 * was never meant to hold credentials. So the check runs before anything is
 * stored, refuses rather than redacts, and errs towards refusing.
 */
export const SENSITIVE_REASONS = [
  'password',
  'api_key',
  'token',
  'card_number',
  'bank_account',
  'government_id',
] as const;

export type SensitiveReason = (typeof SENSITIVE_REASONS)[number];

export interface SensitivityVerdict {
  sensitive: boolean;
  reason: SensitiveReason | null;
}

const SAFE: SensitivityVerdict = { sensitive: false, reason: null };

/** Digit runs, ignoring the spaces and dashes people type card numbers with. */
const digitsOnly = (value: string): string => value.replace(/[\s-]/g, '');

/**
 * Keyword matching runs against this rather than the raw text.
 *
 * Keys arrive as `wifi_password` and `company_iban`, where `_` is a word
 * character and so defeats a `\b` anchor — the very naming convention this
 * filter has to catch. Folding separators to spaces makes the boundary real.
 */
const searchable = (key: string, value: string): string =>
  `${key} ${value}`.toLowerCase().replace(/[_-]+/g, ' ');

interface SensitivePattern {
  reason: SensitiveReason;
  /** Matched against the folded `key value` text. */
  keywords?: RegExp;
  /** Matched against the raw value, for credentials with a recognisable shape. */
  shape?: (value: string) => boolean;
}

const PATTERNS: SensitivePattern[] = [
  { reason: 'password', keywords: /\b(password|parol|пароль|passcode|pin code)\b/ },
  {
    reason: 'api_key',
    keywords: /\b(api key|secret key|secret token|client secret|apikey)\b/,
    // Provider-shaped keys, which are recognisable on their own.
    shape: (value) =>
      /\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,})\b/.test(value),
  },
  {
    reason: 'token',
    keywords: /\b(bearer|access token|refresh token|jwt)\b/,
    // A JWT is three base64url segments separated by dots.
    shape: (value) => /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(value),
  },
  {
    reason: 'bank_account',
    keywords: /\b(iban|bank account|hisob raqam|swift)\b/,
  },
  {
    reason: 'card_number',
    keywords: /\b(card number|karta raqam|cvv|cvc)\b/,
    // A card number is 13–19 digits once the grouping spaces are removed.
    shape: (value) => /(?:^|\D)\d{13,19}(?:\D|$)/.test(digitsOnly(value)),
  },
  {
    reason: 'government_id',
    keywords: /\b(passport|pasport|jshshir|inn|tax id|social security|ssn)\b/,
  },
];

/**
 * Decides whether a candidate memory holds a credential or an identity
 * document. Both the key and the value are examined, because the giveaway is
 * often the label rather than the text.
 */
export const classifySensitivity = (key: string, value: string): SensitivityVerdict => {
  const haystack = searchable(key, value);

  for (const pattern of PATTERNS) {
    if (pattern.keywords?.test(haystack) === true || pattern.shape?.(value) === true) {
      return { sensitive: true, reason: pattern.reason };
    }
  }

  return SAFE;
};

/** Message shown when a memory is refused, phrased for the person, not the model. */
export const sensitivityMessage = (reason: SensitiveReason): string =>
  `This looks like a ${reason.replace(/_/g, ' ')}, which is never saved to memory.`;
