import React from 'react';
import { Box, Text } from 'ink';
import type { Skill, SkillScope } from '@moxxy/sdk';

export interface SkillsPanelProps {
  readonly skills: ReadonlyArray<Skill>;
}

/**
 * Structured `/skills` output: one card per skill with name, scope tag,
 * description, and trigger list. Replaces the old yellow-blob systemNotice
 * rendering — colored + spaced so the user can scan the catalog quickly.
 *
 * Skills with no triggers show a dim hint reminding the user they can be
 * invoked by name (most user-authored skills omit the frontmatter
 * `triggers:` field; that's fine, but it's worth saying so).
 */
export const SkillsPanel: React.FC<SkillsPanelProps> = ({ skills }) => {
  if (skills.length === 0) {
    return (
      <Box marginTop={1} marginBottom={1}>
        <Text dimColor>(no skills discovered)</Text>
      </Box>
    );
  }
  // Group by scope so builtin / plugin / user / project are visually
  // separated — without this you can't tell at a glance which skills
  // you authored vs. which shipped with the framework.
  const grouped = groupByScope(skills);
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Skills
        </Text>
        <Text dimColor>
          {`  ·  ${skills.length} total`}
        </Text>
      </Box>
      {ORDER.map((scope) => {
        const group = grouped.get(scope);
        if (!group || group.length === 0) return null;
        return (
          <Box key={scope} flexDirection="column" marginBottom={1}>
            <Box>
              <Text dimColor>{`── ${scope} ${'─'.repeat(Math.max(0, 40 - scope.length))}`}</Text>
            </Box>
            {group.map((s) => (
              <SkillCard key={s.id} skill={s} />
            ))}
          </Box>
        );
      })}
    </Box>
  );
};

const ORDER: ReadonlyArray<SkillScope> = ['user', 'project', 'builtin', 'plugin'];

function groupByScope(skills: ReadonlyArray<Skill>): Map<SkillScope, Skill[]> {
  const out = new Map<SkillScope, Skill[]>();
  for (const s of skills) {
    const list = out.get(s.scope) ?? [];
    list.push(s);
    out.set(s.scope, list);
  }
  return out;
}

const SkillCard: React.FC<{ skill: Skill }> = ({ skill }) => {
  const fm = skill.frontmatter;
  const triggers = fm.triggers ?? [];
  return (
    <Box flexDirection="column" marginTop={1} marginLeft={2}>
      <Box>
        <Text color="green" bold>
          {fm.name}
        </Text>
        {fm.tags && fm.tags.length > 0 ? (
          <Text dimColor>{`  [${fm.tags.join(', ')}]`}</Text>
        ) : null}
      </Box>
      <Box marginLeft={2}>
        <Text>{fm.description}</Text>
      </Box>
      {triggers.length > 0 ? (
        <Box marginLeft={2}>
          <Text dimColor>triggers: </Text>
          {triggers.map((t, i) => (
            <Text key={i} color="yellow">
              {i === 0 ? `"${t}"` : `, "${t}"`}
            </Text>
          ))}
        </Box>
      ) : (
        <Box marginLeft={2}>
          <Text dimColor italic>
            no triggers — model will pick by name/description
          </Text>
        </Box>
      )}
    </Box>
  );
};
