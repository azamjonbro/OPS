import { describe, expect, it } from 'vitest';

import { classifySensitivity } from './memory-privacy.js';

describe('sensitive data filtering', () => {
  it.each([
    ['password', 'login_password', 'my password is hunter2'],
    ['api_key', 'openai', 'sk-abcdefghijklmnopqrstuvwxyz012345'],
    ['token', 'session', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij'],
    ['card_number', 'card', '8600 1234 5678 9012'],
    ['bank_account', 'company_iban', 'UZ12 3456 7890'],
    ['government_id', 'passport', 'AA1234567'],
  ])('refuses to remember a %s', (reason, key, value) => {
    expect(classifySensitivity(key, value)).toEqual({ sensitive: true, reason });
  });

  it('catches a credential named only in the key', () => {
    expect(classifySensitivity('wifi_password', 'chilonzor-2026').sensitive).toBe(true);
  });

  it('allows ordinary preferences through', () => {
    expect(classifySensitivity('content_language', 'uzbek')).toEqual({
      sensitive: false,
      reason: null,
    });
    expect(classifySensitivity('response_style', 'concise').sensitive).toBe(false);
    expect(classifySensitivity('favourite_supplier', 'Anhor Logistics').sensitive).toBe(false);
  });

  it('does not mistake an ordinary number for a card', () => {
    expect(classifySensitivity('daily_target', '5000000').sensitive).toBe(false);
  });
});
