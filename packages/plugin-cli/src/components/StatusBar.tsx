import React from 'react';
import { Box, Text } from 'ink';

export interface StatusBarProps {
  readonly model: string;
  readonly provider: string;
  readonly busy?: boolean;
}

/**
 * Minimal status row below the prompt input: provider and model only,
 * both dimmed so they stay in the user's peripheral vision and the
 * focus stays on the prompt itself. The busy indicator mirrors the
 * spinner state.
 */
export const StatusBar: React.FC<StatusBarProps> = ({ model, provider, busy }) => (
  <Box marginTop={1} flexDirection="row">
    <Text dimColor>{busy ? '⏺  ' : '○  '}</Text>
    <Text dimColor>{provider}:{model}</Text>
  </Box>
);
