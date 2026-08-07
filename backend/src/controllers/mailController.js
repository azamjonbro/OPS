const emailService = require('../services/emailService');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/mail/health — authenticates against SMTP and IMAP without sending anything.
const getHealth = asyncHandler(async (req, res) => {
  const health = await emailService.healthCheck();
  res.status(health.connected ? 200 : 503).json(health);
}, 'Failed to check mail connection');

// GET /api/mail/inbox?limit=10&mailbox=INBOX
const getInbox = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
  const result = await emailService.readEmails(limit, req.query.mailbox || 'INBOX');
  res.status(result.success ? 200 : 502).json(result);
}, 'Failed to read mailbox');

// POST /api/mail/send  { to, subject, body }
const sendMail = asyncHandler(async (req, res) => {
  const { to, subject, body, html } = req.body || {};

  if (!to || !subject) {
    return res.status(400).json({ success: false, error: "'to' va 'subject' maydonlari majburiy" });
  }

  const result = await emailService.sendEmail({ to, subject, body, html });
  res.status(result.success ? 200 : 502).json(result);
}, 'Failed to send mail');

module.exports = { getHealth, getInbox, sendMail };
