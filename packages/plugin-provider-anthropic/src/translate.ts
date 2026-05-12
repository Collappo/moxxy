import type { ContentBlock, ProviderMessage, ToolDef } from '@moxxy/sdk';
import { zodToJsonSchema } from '@moxxy/sdk';

export interface AnthropicMessageInput {
  role: 'user' | 'assistant';
  content: Array<AnthropicContentBlock>;
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: unknown;
}

export function toAnthropicMessages(messages: ReadonlyArray<ProviderMessage>): {
  system: string | undefined;
  messages: AnthropicMessageInput[];
} {
  let system: string | undefined;
  const out: AnthropicMessageInput[] = [];
  let pendingUserBlocks: AnthropicContentBlock[] | null = null;
  const flushUser = (): void => {
    if (pendingUserBlocks) {
      out.push({ role: 'user', content: pendingUserBlocks });
      pendingUserBlocks = null;
    }
  };

  for (const msg of messages) {
    if (msg.role === 'system') {
      const textBlock = msg.content.find((c) => c.type === 'text');
      if (textBlock && textBlock.type === 'text') {
        system = system ? `${system}\n\n${textBlock.text}` : textBlock.text;
      }
      continue;
    }

    if (msg.role === 'user') {
      flushUser();
      out.push({ role: 'user', content: msg.content.map(toAnthropicBlock) });
      continue;
    }

    if (msg.role === 'assistant') {
      flushUser();
      out.push({ role: 'assistant', content: msg.content.map(toAnthropicBlock) });
      continue;
    }

    if (msg.role === 'tool_result') {
      // Tool results are merged into a user message with tool_result content blocks
      pendingUserBlocks ??= [];
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          pendingUserBlocks.push({
            type: 'tool_result',
            tool_use_id: block.toolUseId,
            content: block.content,
            is_error: block.isError,
          });
        }
      }
    }
  }
  flushUser();
  return { system, messages: out };
}

function toAnthropicBlock(block: ContentBlock): AnthropicContentBlock {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content: block.content,
        is_error: block.isError,
      };
    case 'image':
      return {
        type: 'image',
        source: { type: 'base64', media_type: block.mediaType, data: block.data },
      };
  }
}

export function toAnthropicTools(tools: ReadonlyArray<ToolDef>): AnthropicToolDef[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputJsonSchema ?? zodToJsonSchema(t.inputSchema),
  }));
}

