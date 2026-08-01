export const MONTH_NAMES = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'
];

export const WEEKDAY_NAMES = [
  'Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'
];

/**
 * Local YYYY-MM-DD key.
 * toISOString() converts to UTC first, which shifts the date by a day for any local
 * time before 05:00 in UTC+5 — so it must never be used for calendar keys.
 */
export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** `new Date('2026-08-01')` parses as UTC midnight; splitting the parts keeps it local. */
export function parseDateKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function todayKey() {
  return toDateKey(new Date());
}

export function addDays(key, delta) {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + delta);
  return toDateKey(d);
}

/** Monday-based start of the week containing `key`. */
export function startOfWeek(key) {
  const d = parseDateKey(key);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toDateKey(d);
}

/** "1-Avgust 2026, Shanba" */
export function formatLongDate(key) {
  const d = parseDateKey(key);
  return `${d.getDate()}-${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}, ${WEEKDAY_NAMES[d.getDay()]}`;
}

/** "1-Avg" */
export function formatShortDate(key) {
  const d = parseDateKey(key);
  return `${d.getDate()}-${MONTH_NAMES[d.getMonth()].slice(0, 3)}`;
}

export function errorText(err) {
  return (err && err.response && err.response.data && err.response.data.error) ||
    (err && err.message) ||
    'Noma\'lum xatolik';
}
