import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface ListPickerOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly group?: string;
  readonly current?: boolean;
  /**
   * When set, renders as a small colored tag after the label
   * (e.g. "not connected"). Use `badgeColor` to override the default.
   */
  readonly badge?: string;
  readonly badgeColor?: 'red' | 'yellow' | 'green' | 'gray' | 'cyan';
}

export interface ListPickerProps {
  readonly title: string;
  readonly options: ReadonlyArray<ListPickerOption>;
  readonly onSelect: (id: string) => void;
  readonly onCancel: () => void;
}

/**
 * Generic up/down + enter picker. Used by /model and /loop to let the
 * user swap a session-level setting from inside the TUI. Options can
 * declare a `group` and a `current` flag so the picker can visually
 * cluster related items (e.g., models grouped by provider) and tag the
 * one that's already active.
 */
export const ListPicker: React.FC<ListPickerProps> = ({ title, options, onSelect, onCancel }) => {
  const initial = Math.max(0, options.findIndex((o) => o.current));
  const [cursor, setCursor] = useState(initial);

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(options.length - 1, c + 1));
      return;
    }
    if (key.return) {
      const picked = options[cursor];
      if (picked) onSelect(picked.id);
    }
  });

  let lastGroup: string | undefined = undefined;
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      borderDimColor
      paddingX={1}
    >
      <Text bold color="cyan">{title}</Text>
      <Text dimColor>↑↓ navigate · enter to select · esc to cancel</Text>
      <Box marginTop={1} flexDirection="column">
        {options.map((opt, i) => {
          const groupHeader =
            opt.group && opt.group !== lastGroup ? (
              <Box key={`g-${i}`} marginTop={i === 0 ? 0 : 1}>
                <Text dimColor>{opt.group}</Text>
              </Box>
            ) : null;
          lastGroup = opt.group;
          const focused = i === cursor;
          return (
            <React.Fragment key={opt.id}>
              {groupHeader}
              <Box>
                <Text color={focused ? 'cyan' : undefined}>{focused ? '› ' : '  '}</Text>
                <Text color={focused ? 'cyan' : undefined}>{opt.label}</Text>
                {opt.current ? <Text color="green">{' (current)'}</Text> : null}
                {opt.badge ? (
                  <Text color={opt.badgeColor ?? 'red'}>{`  [${opt.badge}]`}</Text>
                ) : null}
                {opt.description ? (
                  <Text dimColor>{`  — ${opt.description}`}</Text>
                ) : null}
              </Box>
            </React.Fragment>
          );
        })}
      </Box>
    </Box>
  );
};
