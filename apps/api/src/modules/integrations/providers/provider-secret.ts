import { CREDENTIAL_PURPOSE, withSecret } from '../credential.service.js';

/**
 * `withSecret` for a call that may not need one.
 *
 * An MCP server with `authMethod: 'none'` has no stored credential, and asking
 * for one would fail. Written once here rather than as a branch in each
 * adapter, so the shape of "the plaintext exists only inside this callback"
 * survives the special case — the alternative is an `if` that resolves a token
 * into a variable above the call, which is exactly the pattern
 * `credential.service.ts` is built to prevent.
 */
export const withOptionalSecret = async <TResult>(
  params: { integrationId: string; userId: string; needsSecret: boolean },
  use: (secret: string | null) => Promise<TResult>,
): Promise<TResult> =>
  params.needsSecret
    ? withSecret(
        {
          integrationId: params.integrationId,
          userId: params.userId,
          purpose: CREDENTIAL_PURPOSE.token,
        },
        use,
      )
    : use(null);
