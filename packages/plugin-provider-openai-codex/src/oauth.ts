/**
 * Codex-specific OAuth pieces: constants, JWT-claim extraction, and thin
 * wrappers that adapt `@moxxy/plugin-oauth`'s generic helpers into the
 * `CodexTokens` shape the provider class consumes. The actual flow
 * orchestration lives in `profile.ts` + `login.ts`.
 */

import { Buffer } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import {
  buildAuthUrl,
  exchangeCodeForToken as oauthExchangeCodeForToken,
  refreshAccessToken,
  type TokenSet,
} from '@moxxy/plugin-oauth';
import type { CodexTokens, PkceCodes } from './types.js';

/**
 * Public OAuth client id baked into the first-party Codex / OpenCode clients.
 * Same value used by codex-rs (`codex-rs/login/src/auth/manager.rs`) and
 * opencode (`packages/opencode/src/plugin/codex.ts`) — using it lets a moxxy
 * login interoperate with credentials produced by either tool.
 */
export const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const ISSUER = 'https://auth.openai.com';
export const AUTHORIZE_URL = `${ISSUER}/oauth/authorize`;
export const TOKEN_URL = `${ISSUER}/oauth/token`;
export const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
export const DEFAULT_CALLBACK_PORT = 1455;
export const DEFAULT_REDIRECT_PATH = '/auth/callback';
export const DEFAULT_REDIRECT_URI = `http://localhost:${DEFAULT_CALLBACK_PORT}${DEFAULT_REDIRECT_PATH}`;
export const SCOPES = 'openid profile email offline_access';
export const ORIGINATOR = 'moxxy';

const PKCE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
const PKCE_VERIFIER_LEN = 64;

function base64UrlEncode(buf: ArrayBuffer | Uint8Array): string {
  const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Buffer.from(view).toString('base64url');
}

function randomString(length: number, charset: string): string {
  const bytes = webcrypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (let i = 0; i < length; i++) out += charset[bytes[i]! % charset.length];
  return out;
}

export async function generatePKCE(): Promise<PkceCodes> {
  const verifier = randomString(PKCE_VERIFIER_LEN, PKCE_CHARSET);
  const hash = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64UrlEncode(hash) };
}

export function generateState(): string {
  return base64UrlEncode(webcrypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Thin wrapper over `@moxxy/plugin-oauth`'s generic `buildAuthUrl` that
 * stamps in the Codex-specific extras. Exported because tests + downstream
 * consumers may want to build URLs without running the full flow.
 */
export function buildAuthorizeUrl(redirectUri: string, pkce: PkceCodes, state: string): string {
  return buildAuthUrl({
    authUrl: AUTHORIZE_URL,
    clientId: CLIENT_ID,
    redirectUri,
    scopes: SCOPES.split(' '),
    codeChallenge: pkce.challenge,
    state,
    extraAuthParams: {
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: ORIGINATOR,
    },
  });
}

/**
 * JWT-claim extraction — header.payload.signature with base64url-encoded
 * segments. We never verify the signature: the access_token is only ever
 * sent back to the issuer (or its API gateway), so trust is rooted in the
 * fact that we received the token over TLS from the token endpoint. The
 * only thing we use these claims for is plucking the chatgpt_account_id
 * for the per-request header.
 */
export function parseJwtClaims(jwt: string): Record<string, unknown> | undefined {
  const parts = jwt.split('.');
  if (parts.length !== 3) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

interface AccountIdSource {
  readonly access_token?: string;
  readonly id_token?: string;
}

/**
 * Account-id priority order matches opencode's `extractAccountIdFromClaims`:
 * the explicit top-level claim → the namespaced auth-bag claim → first
 * organization id. Returning undefined is fine — the API just won't
 * receive the optional ChatGPT-Account-Id header.
 */
export function extractAccountId(tokens: AccountIdSource): string | undefined {
  for (const candidate of [tokens.id_token, tokens.access_token]) {
    if (!candidate) continue;
    const claims = parseJwtClaims(candidate);
    if (!claims) continue;
    const direct = claims['chatgpt_account_id'];
    if (typeof direct === 'string' && direct) return direct;
    const authBag = claims['https://api.openai.com/auth'];
    if (authBag && typeof authBag === 'object') {
      const fromBag = (authBag as Record<string, unknown>)['chatgpt_account_id'];
      if (typeof fromBag === 'string' && fromBag) return fromBag;
    }
    const orgs = claims['organizations'];
    if (Array.isArray(orgs) && orgs.length > 0) {
      const first = orgs[0] as { id?: unknown };
      if (first && typeof first.id === 'string' && first.id) return first.id;
    }
  }
  return undefined;
}

function toCodexTokens(set: TokenSet): CodexTokens {
  if (!set.refreshToken) {
    throw new Error('OAuth token response missing refresh_token');
  }
  const accountId = extractAccountId({
    ...(set.idToken ? { id_token: set.idToken } : {}),
    access_token: set.accessToken,
  });
  return {
    access: set.accessToken,
    refresh: set.refreshToken,
    expires: set.expiresAt ?? Date.now() + 3600_000,
    ...(accountId ? { accountId } : {}),
  };
}

/**
 * Wrapper around plugin-oauth's `exchangeCodeForToken` that returns the
 * `CodexTokens` shape (with `accountId` plucked from the id_token JWT).
 * Tests + downstream callers use it directly; the live login path goes
 * through `runOauthLogin(codexOauthProfile, ...)`.
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  pkce: PkceCodes,
  fetchImpl: typeof fetch = fetch,
): Promise<CodexTokens> {
  const set = await oauthExchangeCodeForToken(
    {
      tokenUrl: TOKEN_URL,
      code,
      redirectUri,
      clientId: CLIENT_ID,
      codeVerifier: pkce.verifier,
    },
    fetchImpl,
  );
  return toCodexTokens(set);
}

/**
 * Refresh both the access AND refresh tokens. The OAuth server issues a
 * fresh refresh_token on every refresh and INVALIDATES the previous one —
 * callers must persist the returned tokens BEFORE issuing any API call
 * that might fail mid-flight, otherwise a crash will lock the user out.
 */
export async function refreshTokens(
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CodexTokens> {
  const set = await refreshAccessToken(
    { tokenUrl: TOKEN_URL, clientId: CLIENT_ID, refreshToken },
    fetchImpl,
  );
  return toCodexTokens(
    set.refreshToken ? set : { ...set, refreshToken },
  );
}
