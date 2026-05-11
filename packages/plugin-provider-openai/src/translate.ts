import type { ContentBlock, ProviderMessage, ToolDef } from '@moxxy/sdk';

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

export interface OpenAIToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

export function toOpenAIMessages(messages: ReadonlyArray<ProviderMessage>): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = msg.content.find((c): c is { type: 'text'; text: string } => c.type === 'text')?.text ?? '';
      if (text) out.push({ role: 'system', content: text });
      continue;
    }
    if (msg.role === 'user') {
      const text = msg.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      out.push({ role: 'user', content: text });
      continue;
    }
    if (msg.role === 'assistant') {
      const text = msg.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text)
        .join('');
      const toolUses = msg.content.filter(
        (c): c is { type: 'tool_use'; id: string; name: string; input: unknown } =>
          c.type === 'tool_use',
      );
      const message: OpenAIChatMessage = { role: 'assistant', content: text || null };
      if (toolUses.length > 0) {
        message.tool_calls = toolUses.map((u) => ({
          id: u.id,
          type: 'function' as const,
          function: { name: u.name, arguments: JSON.stringify(u.input ?? {}) },
        }));
      }
      out.push(message);
      continue;
    }
    if (msg.role === 'tool_result') {
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          out.push({
            role: 'tool',
            tool_call_id: block.toolUseId,
            content: block.content,
          });
        }
      }
    }
  }
  return out;
}

export function toOpenAITools(tools: ReadonlyArray<ToolDef>): OpenAIToolDef[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: (t.inputJsonSchema ?? zodToJsonSchema(t.inputSchema)) as unknown,
    },
  }));
}

function zodToJsonSchema(schema: unknown): unknown {
  const s = schema as { _def?: { typeName?: string }; toJSON?: () => unknown };
  if (typeof s.toJSON === 'function') return s.toJSON();
  const def = s._def;
  const typeName = def?.typeName;
  if (typeName === 'ZodObject') {
    const shape = (def as unknown as { shape: () => Record<string, unknown> }).shape();
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      const inner = (value as { isOptional?: () => boolean }).isOptional?.();
      if (!inner) required.push(key);
    }
    return { type: 'object', properties, required };
  }
  if (typeName === 'ZodString') return { type: 'string' };
  if (typeName === 'ZodNumber') return { type: 'number' };
  if (typeName === 'ZodBoolean') return { type: 'boolean' };
  if (typeName === 'ZodArray') {
    return { type: 'array', items: zodToJsonSchema((def as unknown as { type: unknown }).type) };
  }
  return { type: 'object' };
}

void (null as unknown as ContentBlock);
