const SECONDS_IN_MINUTE = 60;
const SECONDS_IN_HOUR = 3_600;
const SECONDS_IN_DAY = 86_400;

/** Compact uptime, e.g. `3d 4h`, `12m 30s`. */
export const formatDuration = (totalSeconds: number): string => {
  const seconds = Math.max(0, Math.floor(totalSeconds));

  if (seconds < SECONDS_IN_MINUTE) {
    return `${seconds}s`;
  }

  if (seconds < SECONDS_IN_HOUR) {
    return `${Math.floor(seconds / SECONDS_IN_MINUTE)}m ${seconds % SECONDS_IN_MINUTE}s`;
  }

  if (seconds < SECONDS_IN_DAY) {
    const hours = Math.floor(seconds / SECONDS_IN_HOUR);

    return `${hours}h ${Math.floor((seconds - hours * SECONDS_IN_HOUR) / SECONDS_IN_MINUTE)}m`;
  }

  const days = Math.floor(seconds / SECONDS_IN_DAY);

  return `${days}d ${Math.floor((seconds - days * SECONDS_IN_DAY) / SECONDS_IN_HOUR)}h`;
};

export const formatDateTime = (value: string | Date): string => {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

/** Date only, for a column where the time of day is noise. */
export const formatDate = (value: string | Date): string => {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(date);
};

/** A count with its noun, pluralised: `1 sale`, `3 sales`. */
export const pluralise = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`;
