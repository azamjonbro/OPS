const adminAuthService = require('../services/adminAuthService');

/** Protects every /api/admin/* route — this is where Billz/Notion/Telegram credentials get saved. */
module.exports = function requireAdmin(req, res, next) {
  const header = req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token && adminAuthService.verifyToken(token);

  if (!payload || payload.role !== 'SUPERADMIN') {
    return res.status(401).json({ success: false, error: 'Avtorizatsiyadan o\'tilmagan' });
  }

  req.admin = payload;
  next();
};
