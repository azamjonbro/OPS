const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

// iCloud's published endpoints. Both require an APP-SPECIFIC password (appleid.apple.com
// → Sign-In and Security → App-Specific Passwords); an ordinary Apple ID password is
// rejected on accounts with two-factor authentication, which is all of them today.
const ICLOUD_SMTP = { host: 'smtp.mail.me.com', port: 587, secure: false };
const ICLOUD_IMAP = { host: 'imap.mail.me.com', port: 993, secure: true };

class EmailService {
  constructor() {
    // ICLOUD / IPASS are what .env.dev carries; SMTP_* stay supported so an existing
    // deployment pointed at another provider keeps working.
    this.user = process.env.ICLOUD || process.env.SMTP_USER || '';
    this.pass = process.env.IPASS || process.env.SMTP_PASS || '';
    this.fromName = process.env.MAIL_FROM_NAME || 'Store Hadiya';

    this.smtpHost = process.env.SMTP_HOST || ICLOUD_SMTP.host;
    this.smtpPort = Number(process.env.SMTP_PORT || ICLOUD_SMTP.port);
    this.imapHost = process.env.IMAP_HOST || ICLOUD_IMAP.host;
    this.imapPort = Number(process.env.IMAP_PORT || ICLOUD_IMAP.port);

    this.transporter = null;
  }

  isConfigured() {
    return Boolean(this.user && this.pass);
  }

  missingConfigError() {
    return {
      success: false,
      error: 'MAIL_NOT_CONFIGURED',
      message: "Pochta ulanmagan: .env.dev faylida ICLOUD (email) va IPASS (app-specific parol) to'ldirilishi kerak.",
      recommendation: 'appleid.apple.com → Sign-In and Security → App-Specific Passwords orqali parol yarating.'
    };
  }

  getTransporter() {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.smtpHost,
        port: this.smtpPort,
        secure: this.smtpPort === 465,
        requireTLS: this.smtpPort === 587,
        auth: { user: this.user, pass: this.pass }
      });
    }
    return this.transporter;
  }

  /**
   * Authenticates against SMTP and IMAP without sending anything — used by the health
   * endpoint so a broken password surfaces before someone relies on a "sent" report.
   */
  async healthCheck() {
    if (!this.isConfigured()) return { ...this.missingConfigError(), connected: false };

    const result = {
      connected: false,
      account: this.user,
      smtp: { host: this.smtpHost, port: this.smtpPort, ok: false },
      imap: { host: this.imapHost, port: this.imapPort, ok: false },
      checkedAt: new Date().toISOString()
    };

    try {
      await this.getTransporter().verify();
      result.smtp.ok = true;
    } catch (err) {
      result.smtp.error = err.message;
    }

    let client;
    try {
      client = await this.openImap();
      const mailbox = await client.status('INBOX', { messages: true, unseen: true });
      result.imap.ok = true;
      result.imap.totalMessages = mailbox.messages;
      result.imap.unseen = mailbox.unseen;
    } catch (err) {
      result.imap.error = err.message;
    } finally {
      if (client) await client.logout().catch(() => {});
    }

    result.connected = result.smtp.ok && result.imap.ok;
    return result;
  }

  async openImap() {
    const client = new ImapFlow({
      host: this.imapHost,
      port: this.imapPort,
      secure: this.imapPort === 993,
      auth: { user: this.user, pass: this.pass },
      logger: false
    });
    await client.connect();
    return client;
  }

  async sendEmail({ to, subject, body, html, attachments = [] }) {
    if (!to || !subject) {
      return { success: false, error: 'Recipient email (to) and subject are required' };
    }
    if (!this.isConfigured()) return this.missingConfigError();

    try {
      const info = await this.getTransporter().sendMail({
        from: `"${this.fromName}" <${this.user}>`,
        to,
        subject,
        text: body || '',
        html: html || undefined,
        attachments
      });

      console.log(`✉️  Email sent to [${to}] | ${subject} | id=${info.messageId}`);
      return {
        success: true,
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        to,
        subject,
        sentAt: new Date().toISOString()
      };
    } catch (err) {
      console.error('✉️  Email send failed:', err.message);
      return { success: false, error: err.message, to, subject };
    }
  }

  /**
   * Every message of a given day (or range), read and unread alike, across the inbox,
   * archive and sent folders.
   *
   * IMAP SINCE is inclusive and BEFORE is exclusive, and both compare whole dates, so
   * one day means since=that day, before=the next.
   */
  async readEmailsByDate(startDate, endDate = startDate, { limit = 200 } = {}) {
    if (!this.isConfigured()) return this.missingConfigError();

    const since = new Date(`${startDate}T00:00:00Z`);
    const beforeDay = new Date(`${endDate}T00:00:00Z`);
    beforeDay.setUTCDate(beforeDay.getUTCDate() + 1);

    if (Number.isNaN(since.getTime()) || Number.isNaN(beforeDay.getTime())) {
      return { success: false, error: 'BAD_DATE', message: `Sana tushunarsiz: ${startDate}` };
    }

    const SOURCES = [
      { mailbox: 'INBOX', direction: 'incoming' },
      { mailbox: 'Archive', direction: 'incoming' },
      { mailbox: 'Sent Messages', direction: 'outgoing' }
    ];

    let client;
    const messages = [];

    try {
      client = await this.openImap();

      for (const source of SOURCES) {
        let lock;
        try {
          lock = await client.getMailboxLock(source.mailbox);
        } catch (err) {
          continue;
        }

        try {
          if (!client.mailbox.exists) continue;
          const hits = await client.search({ since, before: beforeDay });
          if (!hits || !hits.length) continue;

          for await (const msg of client.fetch(hits.slice(-limit), { envelope: true, source: true, flags: true })) {
            const env = msg.envelope || {};
            const when = env.date ? new Date(env.date) : null;
            // SINCE/BEFORE filter by the server's internal date; re-check the real header
            // so a message that landed either side of midnight is not misfiled.
            if (when && (when < since || when >= beforeDay)) continue;

            const parsed = await simpleParser(msg.source).catch(() => null);
            const fromAddr = env.from && env.from.length ? env.from[0] : null;

            messages.push({
              id: `${source.mailbox}:${msg.uid}`,
              mailbox: source.mailbox,
              direction: source.direction,
              from: fromAddr ? `${fromAddr.name || ''} <${fromAddr.address}>`.trim() : '',
              to: (env.to || []).map((a) => `${a.name || ''} <${a.address}>`.trim()).join(', '),
              subject: env.subject || '(mavzusiz)',
              date: when ? when.toISOString() : null,
              unread: !(msg.flags && msg.flags.has('\\Seen')),
              snippet: parsed && parsed.text ? parsed.text.replace(/\s+/g, ' ').trim().slice(0, 400) : '',
              attachments: parsed ? (parsed.attachments || []).map((a) => ({ filename: a.filename, size: a.size })) : []
            });
          }
        } finally {
          if (lock) lock.release();
        }
      }
    } catch (err) {
      console.error('✉️  Date search failed:', err.message);
      return { success: false, error: err.message, startDate, endDate };
    } finally {
      if (client) await client.logout().catch(() => {});
    }

    messages.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    return {
      success: true,
      startDate,
      endDate,
      total: messages.length,
      readCount: messages.filter((m) => !m.unread).length,
      unreadCount: messages.filter((m) => m.unread).length,
      incomingCount: messages.filter((m) => m.direction === 'incoming').length,
      outgoingCount: messages.filter((m) => m.direction === 'outgoing').length,
      messages
    };
  }

  /**
   * Every message exchanged with one person, in both directions.
   *
   * `person` may be a name ("Jason Varghese") or an address — IMAP SEARCH matches a
   * substring of the raw header either way, so the display name works even when the
   * address is unknown. Incoming mail is matched on FROM, outgoing on TO/CC, which is
   * why the two mailbox groups are searched with different criteria instead of one
   * blanket query.
   */
  async searchCorrespondence(person, { limit = 60 } = {}) {
    if (!this.isConfigured()) return this.missingConfigError();

    const needle = String(person || '').trim();
    if (!needle) return { success: false, error: 'PERSON_REQUIRED', message: "Kimni qidirishni ayting (ism yoki email)." };

    const SOURCES = [
      { mailbox: 'INBOX', direction: 'incoming', criteria: { from: needle } },
      { mailbox: 'Archive', direction: 'incoming', criteria: { from: needle } },
      { mailbox: 'Sent Messages', direction: 'outgoing', criteria: { or: [{ to: needle }, { cc: needle }] } }
    ];

    let client;
    const messages = [];

    try {
      client = await this.openImap();

      for (const source of SOURCES) {
        let lock;
        try {
          lock = await client.getMailboxLock(source.mailbox);
        } catch (err) {
          continue; // Mailbox absent on this account — not an error worth failing over.
        }

        try {
          if (!client.mailbox.exists) continue;
          const hits = await client.search(source.criteria);
          if (!hits || !hits.length) continue;

          for await (const msg of client.fetch(hits.slice(-limit), { envelope: true, source: true, flags: true })) {
            const parsed = await simpleParser(msg.source).catch(() => null);
            const env = msg.envelope || {};
            const fromAddr = env.from && env.from.length ? env.from[0] : null;

            messages.push({
              id: `${source.mailbox}:${msg.uid}`,
              mailbox: source.mailbox,
              direction: source.direction,
              fromName: fromAddr ? (fromAddr.name || '') : '',
              fromAddress: fromAddr ? fromAddr.address : '',
              to: (env.to || []).map((a) => `${a.name || ''} <${a.address}>`.trim()).join(', '),
              subject: env.subject || '(mavzusiz)',
              date: env.date ? new Date(env.date).toISOString() : null,
              unread: !(msg.flags && msg.flags.has('\\Seen')),
              text: parsed && parsed.text ? parsed.text.replace(/\s+/g, ' ').trim() : '',
              attachments: parsed ? (parsed.attachments || []).map((a) => ({ filename: a.filename, size: a.size })) : []
            });
          }
        } finally {
          if (lock) lock.release();
        }
      }
    } catch (err) {
      console.error('✉️  Correspondence search failed:', err.message);
      return { success: false, error: err.message, person: needle };
    } finally {
      if (client) await client.logout().catch(() => {});
    }

    messages.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

    // The counterpart's real address, taken from whichever incoming message carries it.
    const counterpart = messages.find((m) => m.direction === 'incoming' && m.fromAddress);
    const incoming = messages.filter((m) => m.direction === 'incoming');
    const outgoing = messages.filter((m) => m.direction === 'outgoing');

    return {
      success: true,
      person: needle,
      matchedName: counterpart ? counterpart.fromName || needle : needle,
      matchedAddress: counterpart ? counterpart.fromAddress : '',
      total: messages.length,
      incomingCount: incoming.length,
      outgoingCount: outgoing.length,
      unreadCount: messages.filter((m) => m.unread).length,
      firstDate: messages.length ? messages[0].date : null,
      lastDate: messages.length ? messages[messages.length - 1].date : null,
      lastDirection: messages.length ? messages[messages.length - 1].direction : null,
      subjects: [...new Set(messages.map((m) => m.subject))],
      attachmentsCount: messages.reduce((n, m) => n + m.attachments.length, 0),
      messages
    };
  }

  /**
   * Newest `limit` messages from a mailbox, newest first.
   * `unreadOnly` asks the server for unseen messages instead of the tail of the mailbox.
   */
  async readEmails(limit = 10, mailbox = 'INBOX', { unreadOnly = false } = {}) {
    if (!this.isConfigured()) return this.missingConfigError();

    let client;
    try {
      client = await this.openImap();
      const lock = await client.getMailboxLock(mailbox);

      try {
        const total = client.mailbox.exists;
        if (!total) return { success: true, mailbox, count: 0, emails: [] };

        let range;
        if (unreadOnly) {
          const unseen = await client.search({ seen: false });
          if (!unseen || !unseen.length) return { success: true, mailbox, unreadOnly, count: 0, emails: [] };
          range = unseen.slice(-limit);
        } else {
          // IMAP sequence numbers are 1-based and ascending, so the newest `limit`
          // messages are the tail of the range.
          range = `${Math.max(1, total - limit + 1)}:${total}`;
        }

        const emails = [];

        for await (const msg of client.fetch(range, { envelope: true, source: true, flags: true })) {
          const parsed = await simpleParser(msg.source).catch(() => null);
          const env = msg.envelope || {};

          emails.push({
            id: String(msg.uid),
            seq: msg.seq,
            from: env.from && env.from.length ? `${env.from[0].name || ''} <${env.from[0].address}>`.trim() : '',
            to: (env.to || []).map((a) => a.address).join(', '),
            subject: env.subject || '(mavzusiz)',
            date: env.date ? new Date(env.date).toISOString() : null,
            unread: !(msg.flags && msg.flags.has('\\Seen')),
            snippet: parsed && parsed.text ? parsed.text.replace(/\s+/g, ' ').trim().slice(0, 300) : '',
            attachments: parsed ? (parsed.attachments || []).map((a) => ({ filename: a.filename, size: a.size })) : []
          });
        }

        emails.reverse();
        return { success: true, mailbox, unreadOnly, count: emails.length, emails };
      } finally {
        lock.release();
      }
    } catch (err) {
      console.error('✉️  Email read failed:', err.message);
      return { success: false, error: err.message, mailbox };
    } finally {
      if (client) await client.logout().catch(() => {});
    }
  }
}

module.exports = new EmailService();
