import { isIP } from 'node:net';

import { config } from '../../../config/index.js';
import { ApiError } from '../../../core/http/api-error.js';

/**
 * What a user is allowed to point Hadiya at.
 *
 * A server URL is not an ordinary form field. Hadiya makes the request, from
 * inside the deployment's network, with whatever that network can reach — so an
 * unchecked URL is a request forgery primitive handed to anyone with an
 * account. `http://169.254.169.254/` reads the cloud metadata service;
 * `http://127.0.0.1:27017/` is the database; `http://internal-admin:8080/` is
 * whatever else shares the subnet.
 *
 * So the rule is an allow-list, not a block-list: https only, a hostname that
 * is not a literal private address, no credentials in the URL, no fragment.
 * Private and loopback hosts are permitted only when the deployment says so —
 * which local development needs and `env.ts` refuses to accept in production.
 *
 * This is not complete protection on its own. A public hostname can resolve to
 * a private address (a DNS rebind), and this check happens before the socket is
 * opened. Closing that fully means pinning the resolved address at connect
 * time, which the SDK's fetch-based transports do not expose; what is here
 * removes the trivial attack, and the deployment's egress rules are the layer
 * that removes the rest.
 */

/** Ranges that are inside somebody's network rather than out on the internet. */
const isPrivateIpv4 = (address: string): boolean => {
  const octets = address.split('.').map(Number);

  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
    return true; // Unparseable: treat as unsafe rather than as public.
  }

  const [a = 0, b = 0] = octets;

  return (
    a === 0 || // "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, which is where cloud metadata lives
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
};

const isPrivateIpv6 = (address: string): boolean => {
  const normalised = address.toLowerCase().replace(/^\[|\]$/g, '');

  return (
    normalised === '::1' ||
    normalised === '::' ||
    normalised.startsWith('fc') || // unique local
    normalised.startsWith('fd') ||
    normalised.startsWith('fe80') || // link-local
    // An IPv4-mapped address is an IPv4 address wearing a hat; judge the hat's
    // contents rather than the notation.
    (normalised.startsWith('::ffff:') && isPrivateIpv4(normalised.slice(7)))
  );
};

/** Hostnames that mean "this machine" without looking like an address. */
const LOOPBACK_NAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost']);

const isPrivateHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase();

  if (LOOPBACK_NAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return true;
  }

  const version = isIP(host.replace(/^\[|\]$/g, ''));

  if (version === 4) {
    return isPrivateIpv4(host);
  }

  if (version === 6) {
    return isPrivateIpv6(host);
  }

  return false;
};

/**
 * Validates a server URL and returns it normalised.
 *
 * Throws an `ApiError`, so a bad URL is a 400 on the form the person is looking
 * at rather than a connection failure minutes later.
 */
export const parseMcpServerUrl = (value: string): URL => {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw ApiError.badRequest('The server address is not a valid URL.');
  }

  const allowPrivate = config.mcp.allowPrivateHosts;

  // Plain HTTP would send the bearer token in the clear. Allowed only under the
  // same flag that allows a loopback host, because that is the one case where
  // it is a developer's own machine and there is no network to sniff.
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) {
    throw ApiError.badRequest('An MCP server address must start with https://');
  }

  if (url.username || url.password) {
    // Credentials in a URL end up in logs, in referrers and in this very
    // database. A token belongs in the credential store.
    throw ApiError.badRequest(
      'Remove the username and password from the address; a token is configured separately.',
    );
  }

  if (!allowPrivate && isPrivateHost(url.hostname)) {
    throw ApiError.badRequest(
      'That address points inside a private network, which Hadiya will not connect to.',
    );
  }

  // The fragment is never sent and only confuses comparison of two URLs.
  url.hash = '';

  return url;
};

/** The safe half of a URL, for a log line or an audit row. */
export const describeServerUrl = (value: string): string => {
  try {
    const url = new URL(value);

    return `${url.protocol}//${url.host}`;
  } catch {
    return 'invalid-url';
  }
};
