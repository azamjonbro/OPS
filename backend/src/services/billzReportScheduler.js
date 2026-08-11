const billzClientService = require('./billzClientService');
const telegramBusinessService = require('./telegramBusinessService');

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000; // Asia/Tashkent, UTC+5, no DST

/**
 * Three fixed digests to the owner's Telegram: daily at 23:00 (today's report), monthly on
 * the 1st (last month's report), weekly on Monday (last week's report) — each built with
 * the exact same `formatBillzSalesReport` used for an interactive chat answer (exposed by
 * aiEngine.js for this purpose), so a scheduled message is never a second, drifting
 * implementation of the same report.
 *
 * Deliberately NOT routed through the generic `Schedule` model — that model has no
 * execution engine at all today (its CRUD-only `scheduler_create_automation` AI tool saves
 * rows nobody ever reads back out and fires), and building a general wall-clock executor
 * for arbitrary owner-defined schedules is a much bigger undertaking than the three
 * specific, fixed reports actually asked for here. Follows the existing
 * billzSyncService.startDailyCronJob() / telegramUserbotService.startDailyCronJob() shape
 * (a service with start(), wired into server.js) but adds real wall-clock matching, since
 * that existing pattern only re-fires every N ms from process boot.
 *
 * Wall-clock time: the production host (prava-server) runs in Europe/Moscow (UTC+3), NOT
 * the shop's own Asia/Tashkent (UTC+5) — confirmed via the server's own `date`/
 * `timedatectl` output. Using the server's local `Date` methods here would fire this
 * scheduler two hours off from the owner's real "23:00". `tashkentNow()` below shifts by a
 * fixed +5h from UTC instead, independent of whatever timezone the host itself happens to
 * be set to.
 */
function tashkentNow() {
  return new Date(Date.now() + TASHKENT_OFFSET_MS);
}

/** `d` must already be a tashkentNow()-shifted Date — its UTC fields ARE Tashkent's wall-clock fields. */
function isoDate(d) {
  return d.toISOString().split('T')[0];
}

function previousMonthRange(nowTashkent) {
  const y = nowTashkent.getUTCFullYear();
  const m = nowTashkent.getUTCMonth();
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0)); // day 0 of this month = last day of previous month
  return { start: isoDate(first), end: isoDate(last) };
}

function previousWeekRange(nowTashkent) {
  // Fires on Monday, so "last week" is the 7 days ending yesterday (a Sunday).
  const lastSunday = new Date(nowTashkent.getTime() - 24 * 60 * 60 * 1000);
  const lastMonday = new Date(lastSunday.getTime() - 6 * 24 * 60 * 60 * 1000);
  return { start: isoDate(lastMonday), end: isoDate(lastSunday) };
}

class BillzReportScheduler {
  constructor() {
    this.tickInterval = null;
    this.lastDailyFired = '';
    this.lastMonthlyFired = '';
    this.lastWeeklyFired = '';
  }

  start() {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = setInterval(() => {
      this._tick().catch((err) => console.error('Billz report scheduler tick error:', err.message));
    }, 60 * 1000);
    console.log("⏰ Billz Report Scheduler ishga tushdi (kunlik 23:00, oyning 1-sanasida, dushanba kuni haftalik)");
  }

  async _tick() {
    const now = tashkentNow();
    if (now.getUTCHours() !== 23 || now.getUTCMinutes() !== 0) return;

    const dateKey = isoDate(now);

    if (this.lastDailyFired !== dateKey) {
      this.lastDailyFired = dateKey;
      await this._runDailyReport().catch((err) => console.error('Daily Billz report error:', err.message));
    }
    if (now.getUTCDate() === 1 && this.lastMonthlyFired !== dateKey) {
      this.lastMonthlyFired = dateKey;
      await this._runMonthlyReport().catch((err) => console.error('Monthly Billz report error:', err.message));
    }
    if (now.getUTCDay() === 1 && this.lastWeeklyFired !== dateKey) {
      this.lastWeeklyFired = dateKey;
      await this._runWeeklyReport().catch((err) => console.error('Weekly Billz report error:', err.message));
    }
  }

  async _sendReport(periodPhrase, headerLabel) {
    const aiEngine = require('../aiEngine');
    const res = await billzClientService.getConsolidatedReport({ date: periodPhrase });
    if (!res.success || !res.isRealData) {
      console.error(`Billz scheduled report (${headerLabel}) fetch failed:`, res.error || res.errorMessage);
      return;
    }
    const text = `${headerLabel}\n\n${aiEngine.formatBillzSalesReport(res.consolidatedData)}`;
    const sendRes = await telegramBusinessService.notifyOwner(text);
    if (!sendRes.success) {
      console.error(`Billz scheduled report (${headerLabel}) send failed:`, sendRes.error);
    }
  }

  async _runDailyReport() {
    await this._sendReport('bugun', '📅 **KUNLIK HISOBOT (avtomatik, 23:00)**');
  }

  async _runMonthlyReport() {
    const { start, end } = previousMonthRange(tashkentNow());
    await this._sendReport(`${start} - ${end}`, "📆 **OYLIK HISOBOT (avtomatik, o'tgan oy)**");
  }

  async _runWeeklyReport() {
    const { start, end } = previousWeekRange(tashkentNow());
    await this._sendReport(`${start} - ${end}`, "🗓️ **HAFTALIK HISOBOT (avtomatik, o'tgan hafta)**");
  }
}

module.exports = new BillzReportScheduler();
