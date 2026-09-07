/**
 * How the API runs in production.
 *
 * PM2 rather than Docker or systemd, and one instance rather than a cluster.
 * Both are deliberate:
 *
 *  - **One instance.** Two things in this application are process-local: the
 *    rate limiters (`express-rate-limit`'s memory store) and the agent run
 *    registry that a reconnecting browser rejoins a stream through. A second
 *    worker would silently double every rate limit and would answer "no such
 *    run" for half of the reconnections. The scheduler is safe either way — it
 *    claims jobs by a database lease — but the other two are not, so cluster
 *    mode stays off until there is a shared store to make it honest.
 *
 *  - **Fork mode, explicitly.** `instances: 1` alone still leaves PM2 free to
 *    use cluster mode, which changes how signals and ports behave. Saying
 *    `fork` means the process is exactly the one `node dist/main.js` would
 *    start, and SIGTERM reaches the shutdown manager unmediated.
 *
 * CommonJS because the repository is `"type": "module"` and PM2 loads this file
 * with `require`.
 */
const path = require('node:path');

const repoRoot = __dirname;

/** Where the graceful-shutdown budget comes from, so the two cannot disagree. */
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10_000);

module.exports = {
  apps: [
    {
      name: 'hadiya-api',
      cwd: path.join(repoRoot, 'apps/api'),
      script: 'dist/main.js',
      // The built entrypoint, run by plain Node. No tsx, no ts-node, no
      // watcher: production must not depend on development tooling.
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,

      env: {
        NODE_ENV: 'production',
      },

      // The application reads the rest of its configuration from the repository
      // root `.env` through dotenv, which is the same path development takes.
      // Nothing secret is written here, so this file is safe to commit.

      autorestart: true,
      // A process that dies immediately and repeatedly is broken, not unlucky.
      // Backing off stops a crash loop from pinning a CPU, and `min_uptime`
      // is what tells the two apart.
      min_uptime: '30s',
      max_restarts: 10,
      exp_backoff_restart_delay: 1_000,

      /**
       * A ceiling, not an expectation.
       *
       * Document extraction reads a whole spreadsheet into memory and an agent
       * turn holds a context window, so the working set is lumpy by design.
       * This is set well above that: it exists to end a genuine leak before the
       * host starts swapping, not to trim a busy minute.
       */
      max_memory_restart: '900M',

      /**
       * Long enough for the application's own shutdown to finish.
       *
       * `main.ts` stops the scheduler, drains in-flight requests and closes
       * Mongo, and gives itself `SHUTDOWN_TIMEOUT_MS` to do it. PM2's own
       * deadline has to be longer than that, or it would SIGKILL the process
       * part-way through and the graceful shutdown would be decorative.
       */
      kill_timeout: SHUTDOWN_TIMEOUT_MS + 5_000,
      // PM2 sends SIGINT by default; the application handles both, and SIGTERM
      // is what every other supervisor sends, so it is what gets tested.
      shutdown_with_message: false,

      /**
       * Logs go to files, and `pm2-logrotate` is what stops them filling the
       * disk. It is a PM2 module rather than configuration, so it has to be
       * installed once per host — `docs/deployment.md` says how, and the
       * deployment script checks for it.
       */
      out_file: path.join(repoRoot, 'logs/api.out.log'),
      error_file: path.join(repoRoot, 'logs/api.err.log'),
      merge_logs: true,
      // The application already timestamps every line as JSON; a second
      // timestamp from PM2 would break the JSON a log collector parses.
      time: false,
    },
  ],
};
