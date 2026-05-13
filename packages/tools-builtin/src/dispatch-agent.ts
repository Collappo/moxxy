import { defineTool, z } from '@moxxy/sdk';

const agentSpecSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .describe('The task the sub-agent should perform. Phrase as a focused request.'),
  label: z
    .string()
    .max(60)
    .optional()
    .describe('Short label used in progress events (e.g. "research-deps", "lint-fix-A").'),
  systemPrompt: z
    .string()
    .optional()
    .describe(
      'System prompt for the child. Use to set persona, constraints, or hand off ' +
        'upstream artifacts the child needs as context.',
    ),
  model: z
    .string()
    .optional()
    .describe('Model id override; defaults to the parent loop\'s model.'),
  loopStrategy: z
    .string()
    .optional()
    .describe('Loop strategy name (default: tool-use).'),
  maxIterations: z
    .number()
    .int()
    .positive()
    .max(200)
    .optional()
    .describe('Per-child iteration cap (default 50).'),
  allowedTools: z
    .array(z.string())
    .optional()
    .describe('Restrict the child to these tool names. Omit for full inheritance.'),
});

/**
 * `dispatch_agent` — spawn one or more sub-agents in parallel.
 *
 * Each entry in `agents` runs as an isolated child loop with its own
 * event log, sharing the parent's tools / skills / providers. Children
 * stream their progress back to the parent as `subagent_*` plugin_events
 * so the TUI shows live output for every running agent. Returns one
 * result per input agent, in input order.
 *
 * Use when work naturally fans out: parallel research, per-file
 * refactors, multi-perspective review (security/perf/style/correctness),
 * etc. Each child sees ONLY the prompt + systemPrompt you give it — they
 * do NOT inherit the parent's conversation, so include any context the
 * child needs explicitly.
 */
export const dispatchAgentTool = defineTool({
  name: 'dispatch_agent',
  description:
    'Spawn one or more focused sub-agents in parallel. Each runs its own tool-use ' +
    'loop with the given prompt and returns its final message. Use this when a ' +
    'task fans out into independent subtasks. Children stream their progress so ' +
    'you see what each one is doing in real time.',
  inputSchema: z.object({
    agents: z
      .array(agentSpecSchema)
      .min(1)
      .max(8)
      .describe('Specs for the agents to spawn. Run in parallel; results returned in order.'),
  }),
  handler: async (input, ctx) => {
    if (!ctx.subagents) {
      throw new Error(
        'dispatch_agent: no subagent spawner available — this tool must be invoked from a run-turn loop.',
      );
    }
    const results = await ctx.subagents.spawnAll(input.agents);
    return {
      results: results.map((r) => ({
        label: r.label,
        childSessionId: String(r.childSessionId),
        text: r.text,
        stopReason: r.stopReason,
        ...(r.error ? { error: r.error.message } : {}),
      })),
    };
  },
});
