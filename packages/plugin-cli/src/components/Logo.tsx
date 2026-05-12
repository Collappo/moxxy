import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

// Bold uppercase block-letter banner. Drawn with U+2588/2554-style box
// characters so it renders the same in every terminal that supports the
// box-drawing range (every modern one). Widths add up to ~52 columns —
// the < 60 column fallback below keeps narrower terms readable.
const LOGO_LINES: ReadonlyArray<string> = [
  '███╗   ███╗  ██████╗  ██╗  ██╗ ██╗  ██╗ ██╗   ██╗',
  '████╗ ████║ ██╔═══██╗ ╚██╗██╔╝ ╚██╗██╔╝ ╚██╗ ██╔╝',
  '██╔████╔██║ ██║   ██║  ╚███╔╝   ╚███╔╝   ╚████╔╝ ',
  '██║╚██╔╝██║ ██║   ██║  ██╔██╗   ██╔██╗    ╚██╔╝  ',
  '██║ ╚═╝ ██║ ╚██████╔╝ ██╔╝ ██╗ ██╔╝ ██╗    ██║   ',
  '╚═╝     ╚═╝  ╚═════╝  ╚═╝  ╚═╝ ╚═╝  ╚═╝    ╚═╝   ',
];

// Catalog of rotating slogans. Pick one at random per session — kept
// short so they sit under the banner without wrapping in narrow terms.
// New ones are welcome here; aim for ≤60 chars and a mild attitude.
const SLOGANS: ReadonlyArray<string> = [
  'block-by-block agentic loops',
  'every block swappable, every skill replicable',
  'skills that breed skills, plugins that hot-load',
  'the framework that builds itself',
  'loops. tools. skills. all yours.',
  'agents, assembled from interchangeable parts',
  'an event log, a loop, and a lot of plugins',
  'your agent stack, with the cover off',
  'self-improving by design, paranoid by default',
  'open-loop architecture for closed-loop agents',
];

function pickSlogan(): string {
  return SLOGANS[Math.floor(Math.random() * SLOGANS.length)]!;
}

/**
 * ASCII banner shown at the top of the TUI. Big block-letter `MOXXY`
 * with a rotating slogan + version line underneath. Falls back to
 * single-line forms when the terminal is too narrow.
 */
export const Logo: React.FC<{ subtitle?: string; version?: string }> = ({
  subtitle,
  version,
}) => {
  const width = process.stdout.columns ?? 80;
  // Memoize so a re-render of the parent doesn't shuffle the slogan on
  // every keystroke; we want one pick per session/mount.
  const slogan = useMemo(() => pickSlogan(), []);

  if (width < 40) {
    return (
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text bold color="white">MOXXY</Text>
          {version ? <Text dimColor> v{version}</Text> : null}
        </Box>
        <Text dimColor italic>{slogan}</Text>
        {subtitle ? <Text dimColor> — {subtitle}</Text> : null}
      </Box>
    );
  }
  if (width < 60) {
    // Mid-width: just bold MOXXY, slogan, and any subtitle. The full
    // block banner would visibly overflow at 50ish columns.
    return (
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text bold color="white">M O X X Y</Text>
          {version ? <Text dimColor> v{version}</Text> : null}
        </Box>
        <Text dimColor italic>{slogan}</Text>
        {subtitle ? <Text dimColor> {subtitle}</Text> : null}
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginBottom={1}>
      {LOGO_LINES.map((line, i) => (
        <Text key={i} bold color="white">
          {line}
        </Text>
      ))}
      <Box marginTop={1}>
        <Text dimColor italic>{slogan}</Text>
        {version ? <Text dimColor>{`  ·  v${version}`}</Text> : null}
      </Box>
      {subtitle ? (
        <Box>
          <Text dimColor> {subtitle}</Text>
        </Box>
      ) : null}
    </Box>
  );
};
