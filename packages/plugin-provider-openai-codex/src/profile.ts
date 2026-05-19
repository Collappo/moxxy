/**
 * `OAuthProviderProfile` for the OpenAI Codex (ChatGPT Pro/Plus) provider.
 * Drives both `runOauthLogin` (interactive) and `ensureFreshTokens`
 * (pre-request refresh) from `@moxxy/plugin-oauth`. Codex-specific
 * concerns:
 *   - the non-standard OpenAI device-flow dialect (via `openaiDeviceFlow`)
 *   - `chatgpt_account_id` extraction from id_token / access_token JWTs
 *   - the bundled-CLI auth flags (`id_token_add_organizations`, etc.)
 */

import { openaiDeviceFlow, type OAuthProviderProfile, type TokenSet } from '@moxxy/plugin-oauth';
import {
  AUTHORIZE_URL,
  CLIENT_ID,
  DEFAULT_CALLBACK_PORT,
  DEFAULT_REDIRECT_PATH,
  ISSUER,
  ORIGINATOR,
  SCOPES,
  TOKEN_URL,
  extractAccountId,
} from './oauth.js';

export const CODEX_PROVIDER_ID = 'openai-codex';

export const codexOauthProfile: OAuthProviderProfile = {
  id: CODEX_PROVIDER_ID,
  displayName: 'ChatGPT Pro/Plus',
  authUrl: AUTHORIZE_URL,
  tokenUrl: TOKEN_URL,
  clientId: CLIENT_ID,
  scopes: SCOPES.split(' '),
  // These flags are what codex-rs / opencode pass; without them the
  // returned id_token won't carry the chatgpt_account_id / organizations
  // claims we need to populate the ChatGPT-Account-Id header.
  extraAuthParams: {
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: ORIGINATOR,
  },
  redirect: { port: DEFAULT_CALLBACK_PORT, path: DEFAULT_REDIRECT_PATH },
  deviceFlow: openaiDeviceFlow({
    issuer: ISSUER,
    tokenUrl: TOKEN_URL,
    verificationUri: `${ISSUER}/codex/device`,
  }),
  extractAccountId: (tokens: TokenSet) =>
    extractAccountId({
      ...(tokens.idToken ? { id_token: tokens.idToken } : {}),
      access_token: tokens.accessToken,
    }),
};
