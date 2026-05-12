import React from 'react';
import { Box, Text } from 'ink';

const LOGO_LINES: ReadonlyArray<string> = [
  '  _ __ ___   _____  ___  ___ _   _ ',
  " | '_ ` _ \\ / _ \\ \\/ / |/ / | | |",
  ' | | | | | | (_) >  <|   <| |_| |',
  ' |_| |_| |_|\\___/_/\\_\\_|\\_\\\\__, |',
  '                              |___/ ',
];

/**
 * ASCII banner shown at the top of the TUI. Falls back to a single-line
 * compact form when the terminal is narrower than the banner.
 */
export const Logo: React.FC<{ subtitle?: string }> = ({ subtitle }) => {
  const width = process.stdout.columns ?? 80;
  if (width < 40) {
    return (
      <Box marginBottom={1}>
        <Text color="cyan">moxxy</Text>
        {subtitle ? <Text dimColor> — {subtitle}</Text> : null}
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginBottom={1}>
      {LOGO_LINES.map((line, i) => (
        <Text key={i} color="cyan">{line}</Text>
      ))}
      {subtitle ? (
        <Box marginTop={1}>
          <Text dimColor> {subtitle}</Text>
        </Box>
      ) : null}
    </Box>
  );
};
