import React from 'react';
import { Box, Text } from 'ink';
import type { ToolDef } from '@moxxy/sdk';

export interface ToolsPanelProps {
  readonly tools: ReadonlyArray<ToolDef>;
}

/**
 * Structured `/tools` output: one row per tool with a colored name,
 * permission badge (prompt/allow/deny based on the tool's declared
 * permission rule), and description. Replaces the old yellow-blob
 * systemNotice path so the catalog is scannable.
 */
export const ToolsPanel: React.FC<ToolsPanelProps> = ({ tools }) => {
  if (tools.length === 0) {
    return (
      <Box marginTop={1} marginBottom={1}>
        <Text dimColor>(no tools registered)</Text>
      </Box>
    );
  }
  // Sort alphabetically — most tool catalogs are 20-40 items and a
  // stable order is easier to scan than registration order.
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  // Column-align the tool name so descriptions line up cleanly. Padded
  // to the longest name in the catalog (capped at 22 to avoid pushing
  // descriptions off-screen on narrow terms).
  const nameColWidth = Math.min(22, sorted.reduce((m, t) => Math.max(m, t.name.length), 0)) + 2;
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Tools
        </Text>
        <Text dimColor>{`  ·  ${tools.length} total`}</Text>
      </Box>
      {sorted.map((t) => (
        <ToolRow key={t.name} tool={t} nameColWidth={nameColWidth} />
      ))}
    </Box>
  );
};

const ToolRow: React.FC<{ tool: ToolDef; nameColWidth: number }> = ({ tool, nameColWidth }) => {
  const perm = tool.permission?.action ?? 'allow';
  return (
    <Box marginLeft={2}>
      <Box width={nameColWidth}>
        <Text color="green" bold>
          {tool.name}
        </Text>
      </Box>
      <Box width={9}>
        <PermissionBadge action={perm} />
      </Box>
      <Box flexGrow={1}>
        <Text dimColor>{tool.description}</Text>
      </Box>
    </Box>
  );
};

const PermissionBadge: React.FC<{ action: 'allow' | 'deny' | 'prompt' }> = ({ action }) => {
  if (action === 'allow') return <Text color="green">[auto] </Text>;
  if (action === 'deny') return <Text color="red">[deny] </Text>;
  return <Text color="yellow">[prompt]</Text>;
};
