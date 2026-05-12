import React from 'react';
import { Box, Text } from 'ink';

export interface StatusBarProps {
  readonly provider: string;
  readonly model: string;
  readonly busy?: boolean;
}

/**
 * Row below the prompt input. Shows the active provider (as a colored
 * chip) and the model name. Lives here rather than in the SessionInfo
 * table because provider+model are what the user actively cares about
 * during a conversation — easier to glance at next to the prompt cursor
 * than five lines up next to the static session shape.
 */
export const StatusBar: React.FC<StatusBarProps> = ({ provider, model, busy }) => (
  <Box marginTop={1}>
    <Text dimColor>{busy ? '⏺  ' : '○  '}</Text>
    <Text backgroundColor="magenta" color="white" bold>{` ${provider} `}</Text>
    <Text dimColor>{`  ${model}`}</Text>
  </Box>
);
