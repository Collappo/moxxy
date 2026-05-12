import type { ToolCallRequestedEvent } from './events.js';

export type PermissionMode = 'allow' | 'allow_session' | 'allow_always' | 'deny';

export interface PermissionDecision {
  readonly mode: PermissionMode;
  readonly reason?: string;
}

export interface PermissionRule {
  readonly action: 'allow' | 'deny' | 'prompt';
  readonly pattern?: { name?: string | RegExp; inputMatches?: Record<string, string | RegExp> };
  readonly reason?: string;
}

export interface PendingToolCall {
  readonly callId: ToolCallRequestedEvent['callId'];
  readonly name: string;
  readonly input: unknown;
  /**
   * Sequence number of the `tool_call_requested` event in the EventLog.
   * Optional because permission resolvers may construct PendingToolCalls
   * for evaluations that aren't yet on the log (e.g., hook rewrites).
   */
  readonly requestedAtSeq?: number;
}

export interface PermissionContext {
  readonly toolDescription?: string;
  readonly skillContext?: string;
  readonly sessionId: string;
}

export interface PermissionResolver {
  readonly name: string;
  check(call: PendingToolCall, ctx: PermissionContext): Promise<PermissionDecision>;
}
