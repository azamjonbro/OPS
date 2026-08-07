const connectorRegistry = require('../connectors/registry');

// Local date key — toISOString() would roll back a day for any local time before 05:00
// in UTC+5, pre-warming "today" under yesterday's date.
function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Keeps the mail cache (registry.js READ_TOOL_TTL_MS) warm so the owner's question is
 * usually answered from cache instead of paying IMAP's 5-15s round-trip live. Mirrors
 * billzSyncService's cron pattern, but on a much shorter interval since unread mail and
 * "today" both shift constantly.
 */
class MailSyncService {
  constructor() {
    this.interval = null;
  }

  async prewarmCache() {
    try {
      const key = todayKey();
      await Promise.all([
        connectorRegistry.executeTool('mail_read_unread', {}),
        connectorRegistry.executeTool('mail_read_by_date', { startDate: key, endDate: key })
      ]);
      console.log(`📬 Mail cache pre-warmed (${key})`);
    } catch (err) {
      console.error('Mail pre-warm sync error:', err.message);
    }
  }

  startBackgroundSync() {
    setTimeout(() => {
      this.prewarmCache();
    }, 5000);

    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => {
      this.prewarmCache();
    }, 5 * 60 * 1000);

    console.log('⏰ Mail Cache Pre-Warm Sync Scheduled (Every 5 Minutes)');
  }
}

module.exports = new MailSyncService();
