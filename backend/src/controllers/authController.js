const adminAuthService = require('../services/adminAuthService');
const asyncHandler = require('../utils/asyncHandler');

const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  const result = await adminAuthService.login(username, password);
  res.status(result.success ? 200 : 401).json(result);
}, 'Login failed');

module.exports = { login };
