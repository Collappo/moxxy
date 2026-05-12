import React from 'react';
import { Box, Text } from 'ink';

export interface SessionInfoProps {
  readonly loop: string;
  readonly toolCount: number;
  readonly skillCount: number;
  readonly pluginCount: number;
}

/**
 * Header table shown below the logo. Wrapped in a subtle rounded border
 * so it reads as one self-contained metadata block, separate from the
 * chat scrollback below. Two columns: dim label / value. The
 * provider+model pair lives in the status bar below the prompt — what
 * stays here is the structural session shape that doesn't change inside
 * a turn.
 */
export const SessionInfo: React.FC<SessionInfoProps> = ({
  loop,
  toolCount,
  skillCount,
  pluginCount,
}) => {
  const labelWidth = 10;
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      marginBottom={1}
    >
      <Row label="loop" labelWidth={labelWidth}>
        <Text color="cyan">{loop}</Text>
      </Row>
      <Row label="tools" labelWidth={labelWidth}>
        <Text>{String(toolCount)}</Text>
      </Row>
      <Row label="skills" labelWidth={labelWidth}>
        <Text>{String(skillCount)}</Text>
      </Row>
      <Row label="plugins" labelWidth={labelWidth}>
        <Text>{String(pluginCount)}</Text>
      </Row>
    </Box>
  );
};

const Row: React.FC<{ label: string; labelWidth: number; children?: React.ReactNode }> = ({
  label,
  labelWidth,
  children,
}) => (
  <Box>
    <Box width={labelWidth}>
      <Text dimColor>{label}</Text>
    </Box>
    {children}
  </Box>
);
