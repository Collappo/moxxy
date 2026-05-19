/**
 * Standards-compliant device-authorization adapter per RFC 8628.
 *
 * Phases:
 *   1. POST `client_id` + `scope` to `deviceUrl` (form-encoded).
 *   2. Surface `user_code` + `verification_uri` to the user.
 *   3. Poll `tokenUrl` every `interval` with
 *      `grant_type=urn:ietf:params:oauth:grant-type:device_code` + `device_code`.
 *   4. Handle `authorization_pending` / `slow_down` / fatal codes per spec.
 */

import { parseTokenResponse } from '../oauth/token-exchange.js';
import type { TokenSet } from '../oauth/types.js';
import type {
  DeviceFlowAdapter,
  DeviceFlowInit,
  DeviceFlowStartArgs,
} from '../profile.js';
import type { PollOutcome, PollState } from '../oauth/poll-until.js';

export interface Rfc8628AdapterOpts {
  readonly deviceUrl: string;
  readonly tokenUrl: string;
}

interface Rfc8628State {
  readonly deviceCode: string;
}

export function rfc8628DeviceFlow(opts: Rfc8628AdapterOpts): DeviceFlowAdapter {
  return {
    async start(args: DeviceFlowStartArgs): Promise<DeviceFlowInit> {
      const body = new URLSearchParams();
      body.set('client_id', args.clientId);
      body.set('scope', args.scopes.join(' '));
      const res = await fetch(opts.deviceUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
        ...(args.signal ? { signal: args.signal } : {}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`device-code request failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
      }
      const json = (await res.json()) as Record<string, unknown>;
      const deviceCode = typeof json.device_code === 'string' ? json.device_code : null;
      const userCode = typeof json.user_code === 'string' ? json.user_code : null;
      const verificationUri =
        typeof json.verification_uri === 'string'
          ? json.verification_uri
          : typeof json.verification_url === 'string'
            ? json.verification_url
            : null;
      const verificationUriComplete =
        typeof json.verification_uri_complete === 'string'
          ? json.verification_uri_complete
          : undefined;
      const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 600;
      const interval = typeof json.interval === 'number' ? json.interval : 5;
      if (!deviceCode || !userCode || !verificationUri) {
        throw new Error(
          `device-code response missing required fields: ${JSON.stringify(json).slice(0, 200)}`,
        );
      }
      return {
        userCode,
        verificationUri,
        ...(verificationUriComplete ? { verificationUriComplete } : {}),
        intervalMs: interval * 1000,
        expiresInMs: expiresIn * 1000,
        providerData: { deviceCode } satisfies Rfc8628State,
      };
    },

    async poll(init: DeviceFlowInit, state: PollState): Promise<PollOutcome<TokenSet>> {
      const { deviceCode } = init.providerData as Rfc8628State;
      const body = new URLSearchParams();
      body.set('grant_type', 'urn:ietf:params:oauth:grant-type:device_code');
      body.set('device_code', deviceCode);
      const res = await fetch(opts.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok && typeof json.access_token === 'string') {
        return { done: parseTokenResponse(json) };
      }
      const err = typeof json.error === 'string' ? json.error : `HTTP ${res.status}`;
      if (err === 'authorization_pending') return { pending: true };
      if (err === 'slow_down') {
        state.intervalMs += 5000;
        return { pending: true };
      }
      if (err === 'access_denied') {
        throw new Error('OAuth device flow: user denied authorization');
      }
      if (err === 'expired_token') {
        throw new Error('OAuth device flow: device_code expired before approval');
      }
      const desc = typeof json.error_description === 'string' ? json.error_description : '';
      throw new Error(`OAuth device flow failed: ${err}${desc ? ` — ${desc}` : ''}`);
    },
  };
}
