import type { EventLogReader } from '@moxxy/sdk';

export interface SessionFact {
  readonly turnId: string;
  readonly seq: number;
  readonly source: 'user' | 'assistant';
  readonly text: string;
}

/**
 * Short-term memory helpers. STM is the event log itself — these selectors
 * just project a useful view over it.
 */

export function recentExchanges(log: EventLogReader, n = 5): ReadonlyArray<SessionFact> {
  const out: SessionFact[] = [];
  for (const e of log.slice()) {
    if (e.type === 'user_prompt') {
      out.push({ turnId: e.turnId, seq: e.seq, source: 'user', text: e.text });
    } else if (e.type === 'assistant_message') {
      out.push({ turnId: e.turnId, seq: e.seq, source: 'assistant', text: e.content });
    }
  }
  return out.slice(-n);
}

export function summarizeSession(log: EventLogReader): {
  turns: number;
  toolCalls: number;
  errors: number;
  skillsCreated: number;
  pluginsLoaded: number;
} {
  const seenTurns = new Set<string>();
  let toolCalls = 0;
  let errors = 0;
  let skillsCreated = 0;
  let pluginsLoaded = 0;
  for (const e of log.slice()) {
    seenTurns.add(e.turnId);
    if (e.type === 'tool_call_requested') toolCalls += 1;
    if (e.type === 'error') errors += 1;
    if (e.type === 'skill_created') skillsCreated += 1;
    if (e.type === 'plugin_registered') pluginsLoaded += 1;
    if (e.type === 'plugin_unregistered') pluginsLoaded -= 1;
  }
  return { turns: seenTurns.size, toolCalls, errors, skillsCreated, pluginsLoaded };
}
