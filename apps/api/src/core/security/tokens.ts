import type { AuthenticatedUser, UserRole } from '@hadiya/shared';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';

import { config } from '../../config/index.js';
import { ApiError } from '../http/api-error.js';

export const TOKEN_TYPES = ['access', 'refresh'] as const;

export type TokenType = (typeof TOKEN_TYPES)[number];

const ALGORITHM = 'HS256';
const ISSUER = 'hadiya-api';

export interface AccessTokenClaims {
  sub: string;
  username: string;
  fullName: string;
  role: UserRole;
  branchId: string | null;
}

const encoder = new TextEncoder();

/**
 * Secrets are optional in development so the foundation boots without them, but
 * a token operation cannot proceed without one. Production start-up already
 * rejects a missing secret (`config/env.ts`), so this only guards local misuse.
 */
const secretFor = (type: TokenType): Uint8Array => {
  const secret = type === 'access' ? config.auth.accessSecret : config.auth.refreshSecret;

  if (!secret) {
    throw ApiError.internal(
      `Cannot issue or verify a ${type} token: the matching JWT secret is not configured`,
    );
  }

  return encoder.encode(secret);
};

const ttlFor = (type: TokenType): string =>
  type === 'access' ? config.auth.accessTtl : config.auth.refreshTtl;

export const signAccessToken = async (user: AuthenticatedUser): Promise<string> =>
  new SignJWT({
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    branchId: user.branchId,
    typ: 'access',
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(ttlFor('access'))
    .sign(secretFor('access'));

export const signRefreshToken = async (userId: string): Promise<string> =>
  new SignJWT({ typ: 'refresh' })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(ttlFor('refresh'))
    .sign(secretFor('refresh'));

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/**
 * Verifies a token and returns its subject. Any failure — bad signature,
 * expiry, wrong token type — surfaces as the same 401, so a caller cannot probe
 * for which part was wrong.
 */
export const verifyToken = async (
  token: string,
  type: TokenType,
): Promise<{ subject: string; claims: Record<string, unknown> }> => {
  try {
    const { payload } = await jwtVerify(token, secretFor(type), {
      issuer: ISSUER,
      algorithms: [ALGORITHM],
    });

    if (payload.typ !== type) {
      throw ApiError.unauthenticated('Invalid token');
    }

    const subject = asString(payload.sub);

    if (!subject) {
      throw ApiError.unauthenticated('Invalid token');
    }

    return { subject, claims: payload };
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) {
      throw ApiError.unauthenticated('Token has expired');
    }

    if (error instanceof joseErrors.JOSEError) {
      throw ApiError.unauthenticated('Invalid token');
    }

    throw error;
  }
};

/** Seconds until an access token expires, for the client to schedule a refresh. */
export const accessTokenLifetimeSeconds = (): number => {
  const ttl = config.auth.accessTtl;
  const match = /^(\d+)([smhd])$/.exec(ttl);

  if (!match) {
    return 0;
  }

  const amount = Number(match[1]);
  const unitSeconds: Record<string, number> = { s: 1, m: 60, h: 3_600, d: 86_400 };

  return amount * (unitSeconds[match[2] ?? 's'] ?? 1);
};
