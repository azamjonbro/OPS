/**
 * Reads a deployment's configuration the way production will, and says what is
 * wrong with it — before the deploy rather than after.
 *
 *   npm run check:production -w @hadiya/api
 *   npm run check:production -w @hadiya/api -- --env-file /etc/hadiya/api.env
 *
 * Two kinds of finding, and the distinction matters. **Errors** are things the
 * API itself will refuse to start with, or that make a deployment unsafe; they
 * exit non-zero and should stop a release. **Warnings** are things that will
 * boot and run but are probably not what anybody intended — a missing model
 * key, dictation left unconfigured — and are for a person to weigh.
 *
 * No value is ever printed. Every finding names the variable and says what is
 * wrong with it, which is all anybody needs and the most that can be shown
 * safely: this output goes into deploy logs and terminal scrollback.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parseEnv } from '../config/env.js';
import { REPO_ROOT } from '../config/paths.js';

interface Finding {
  level: 'error' | 'warning';
  variable: string;
  message: string;
}

const readFlag = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);

  return index === -1 ? undefined : process.argv[index + 1];
};

/**
 * Parses a `.env` file well enough to check one.
 *
 * Deliberately not dotenv: this must read a file the running process is *not*
 * using, and `dotenv.config()` mutates `process.env`, which would mean checking
 * a production file could change how this very process behaves.
 */
const readEnvFile = (file: string): Record<string, string> => {
  const values: Record<string, string> = {};

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();

    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');

    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    // Strip one layer of matching quotes, as dotenv does.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
};

const isLoopback = (host: string): boolean =>
  ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(host);

/**
 * Checks the schema will not refuse the file outright.
 *
 * This is the same validation the API runs at start-up, so anything reported
 * here is a deployment that would have failed to boot. The messages come from
 * the schema itself and never carry a value.
 */
const schemaFindings = (values: Record<string, string>): Finding[] => {
  try {
    parseEnv({ ...values, NODE_ENV: 'production' });

    return [];
  } catch {
    // `parseEnv` prints its own per-variable report to stderr before throwing.
    return [
      {
        level: 'error',
        variable: '(schema)',
        message: 'the API would refuse to start with this configuration; see the report above',
      },
    ];
  }
};

/**
 * Everything the schema cannot know.
 *
 * A schema can say a variable is well-formed. It cannot say that a value which
 * is perfectly valid is nonetheless wrong for *this* deployment — an API that
 * says it is behind a proxy but is not, a storage path that will not survive a
 * container restart, a frontend pointed at a developer's laptop.
 */
const operationalFindings = (values: Record<string, string>): Finding[] => {
  const findings: Finding[] = [];
  const get = (key: string): string => (values[key] ?? '').trim();
  const add = (level: Finding['level'], variable: string, message: string): void => {
    findings.push({ level, variable, message });
  };

  if (get('NODE_ENV') !== 'production') {
    add('error', 'NODE_ENV', 'must be "production" in a production deployment');
  }

  if (get('TRUST_PROXY') !== 'true') {
    add(
      'warning',
      'TRUST_PROXY',
      'is off: behind a reverse proxy every client appears to come from the proxy, so rate limits and logs will all name one address. Turn it on when Nginx terminates TLS.',
    );
  }

  const apiHost = get('API_HOST');

  if (apiHost && !isLoopback(apiHost) && get('TRUST_PROXY') !== 'true') {
    add(
      'warning',
      'API_HOST',
      'binds a public interface without TRUST_PROXY: the API is reachable directly, bypassing the proxy that terminates TLS',
    );
  }

  const frontendUrl = get('VITE_API_BASE_URL');

  if (frontendUrl.startsWith('http://')) {
    add(
      'error',
      'VITE_API_BASE_URL',
      'is plain http: the browser would send its access token in the clear',
    );
  }

  if (/localhost|127\.0\.0\.1/.test(frontendUrl)) {
    add(
      'error',
      'VITE_API_BASE_URL',
      'points at localhost, which is the developer’s machine rather than the deployment',
    );
  }

  const storage = get('STORAGE_LOCAL_DIR');

  if (get('STORAGE_DRIVER') === 'local' || storage) {
    if (!storage) {
      add(
        'warning',
        'STORAGE_LOCAL_DIR',
        'is unset, so uploads and generated images go to a path relative to the API package. Point it at a directory that survives a redeploy.',
      );
    } else if (!path.isAbsolute(storage)) {
      add(
        'warning',
        'STORAGE_LOCAL_DIR',
        'is a relative path. A redeploy that replaces the application directory takes every stored document and image with it.',
      );
    } else if (storage.startsWith('/tmp') || storage.startsWith('/var/tmp')) {
      add(
        'error',
        'STORAGE_LOCAL_DIR',
        'is a temporary directory: uploads there are deleted by the operating system',
      );
    }
  }

  if (!get('OPENAI_API_KEY') && !get('ANTHROPIC_API_KEY')) {
    add(
      'warning',
      'OPENAI_API_KEY',
      'no model credential is configured, so the assistant will answer 503. Everything else works.',
    );
  }

  if (!get('BILLZ_API_TOKEN')) {
    add(
      'warning',
      'BILLZ_API_TOKEN',
      'is unset, so every Billz reading is unavailable and the assistant cannot answer questions about the shop',
    );
  }

  if (!get('STT_API_KEY') && !get('OPENAI_API_KEY')) {
    add(
      'warning',
      'STT_API_KEY',
      'no transcription credential, so voice input will not be offered',
    );
  }

  if (get('LOG_PRETTY') === 'true') {
    add(
      'warning',
      'LOG_PRETTY',
      'is on, which writes colourised human output instead of the JSON lines a log collector can read',
    );
  }

  if (get('LOG_LEVEL') === 'debug' || get('LOG_LEVEL') === 'trace') {
    add(
      'warning',
      'LOG_LEVEL',
      'is very verbose for production: it will fill a disk faster than rotation expects',
    );
  }

  return findings;
};

const run = (): void => {
  const file = readFlag('env-file') ?? path.join(REPO_ROOT, '.env');
  let values: Record<string, string>;

  try {
    values = readEnvFile(file);
  } catch {
    console.error(`Could not read ${file}`);
    process.exitCode = 1;

    return;
  }

  console.log(`Checking ${file} as a production configuration.\n`);

  const findings = [...schemaFindings(values), ...operationalFindings(values)];
  const errors = findings.filter((finding) => finding.level === 'error');
  const warnings = findings.filter((finding) => finding.level === 'warning');

  for (const finding of [...errors, ...warnings]) {
    const label = finding.level === 'error' ? 'ERROR  ' : 'WARNING';

    console.log(`${label} ${finding.variable}: ${finding.message}`);
  }

  if (findings.length === 0) {
    console.log('No problems found.');
  }

  console.log(`\n${errors.length} error(s), ${warnings.length} warning(s).`);

  if (errors.length > 0) {
    console.log('Refusing to call this configuration production-ready.');
    process.exitCode = 1;
  }
};

run();
