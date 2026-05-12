import { z } from 'zod';
import { defineTool, type ToolDef } from '@moxxy/sdk';
import {
  defaultToolNamePrefix,
  type McpClientLike,
  type McpContentBlock,
  type McpServerConfig,
  type McpToolDescriptor,
} from './types.js';

export interface WrapOptions {
  readonly server: McpServerConfig;
  readonly client: McpClientLike;
  readonly toolNamePrefix?: (serverName: string, toolName: string) => string;
}

export async function wrapMcpServerTools(opts: WrapOptions): Promise<ToolDef[]> {
  const prefix = opts.toolNamePrefix ?? defaultToolNamePrefix;
  const list = await opts.client.listTools();
  return list.tools.map((descriptor) => wrapOneTool(descriptor, opts.server.name, opts.client, prefix));
}

/**
 * Build ToolDefs from CACHED descriptors without an open client. The
 * provided `getClient` factory is invoked the first time any tool runs;
 * the promise is cached so subsequent calls reuse the same connection.
 * Enables instant TUI boot — connections only happen when the model
 * actually invokes a tool from a given MCP server.
 */
export interface WrapLazyOptions {
  readonly server: McpServerConfig;
  readonly descriptors: ReadonlyArray<McpToolDescriptor>;
  readonly getClient: () => Promise<McpClientLike>;
  readonly toolNamePrefix?: (serverName: string, toolName: string) => string;
}

export function wrapMcpServerToolsLazy(opts: WrapLazyOptions): ToolDef[] {
  const prefix = opts.toolNamePrefix ?? defaultToolNamePrefix;
  return opts.descriptors.map((descriptor) =>
    wrapOneLazyTool(descriptor, opts.server.name, opts.getClient, prefix),
  );
}

function wrapOneLazyTool(
  descriptor: McpToolDescriptor,
  serverName: string,
  getClient: () => Promise<McpClientLike>,
  prefix: (s: string, t: string) => string,
): ToolDef {
  const wrappedName = prefix(serverName, descriptor.name);
  return defineTool({
    name: wrappedName,
    description: descriptor.description ?? `MCP tool ${descriptor.name} on server ${serverName}`,
    inputSchema: z.record(z.string(), z.unknown()),
    inputJsonSchema: descriptor.inputSchema ?? { type: 'object' },
    permission: { action: 'prompt' },
    handler: async (input, ctx) => {
      if (ctx.signal.aborted) throw new Error('aborted');
      // Lazy connection — pays the network/spawn cost only on first
      // call. Subsequent calls reuse the cached client.
      const client = await getClient();
      if (ctx.signal.aborted) throw new Error('aborted');
      const result = await client.callTool({ name: descriptor.name, arguments: input });
      return renderResult(result.content, result.isError);
    },
  });
}

function wrapOneTool(
  descriptor: McpToolDescriptor,
  serverName: string,
  client: McpClientLike,
  prefix: (s: string, t: string) => string,
): ToolDef {
  const wrappedName = prefix(serverName, descriptor.name);
  return defineTool({
    name: wrappedName,
    description: descriptor.description ?? `MCP tool ${descriptor.name} on server ${serverName}`,
    inputSchema: z.record(z.string(), z.unknown()),
    inputJsonSchema: descriptor.inputSchema ?? { type: 'object' },
    permission: { action: 'prompt' },
    handler: async (input, ctx) => {
      if (ctx.signal.aborted) throw new Error('aborted');
      const result = await client.callTool({ name: descriptor.name, arguments: input });
      return renderResult(result.content, result.isError);
    },
  });
}

function renderResult(content: ReadonlyArray<McpContentBlock> | undefined, isError?: boolean): string {
  const parts: string[] = [];
  for (const block of content ?? []) {
    if (block.type === 'text') parts.push(block.text);
    else if (block.type === 'image') parts.push(`[image:${block.mimeType}]`);
    else if (block.type === 'resource') parts.push(`[resource]`);
  }
  const text = parts.join('\n');
  return isError ? `[error] ${text}` : text;
}
