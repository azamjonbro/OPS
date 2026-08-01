/**
 * Wraps an async route handler so a thrown/rejected error becomes a JSON
 * error response instead of an unhandled rejection. Removes the repeated
 * try/catch -> res.status(500).json({ error }) boilerplate from controllers.
 *
 * @param {Function} fn - async (req, res) => void
 * @param {string} [fallbackMessage] - message returned on unexpected error
 */
function asyncHandler(fn, fallbackMessage = 'Server error') {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(`${req.method} ${req.originalUrl} error:`, err.message);
      res.status(500).json({ error: fallbackMessage });
    }
  };
}

module.exports = asyncHandler;
