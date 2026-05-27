// Root ESLint flat config. Consumes the shared @moxxy/eslint-config (imported
// by path to avoid adding a workspace devDep + lockfile churn). The shared
// config already ignores dist/node_modules/.turbo/coverage.
import base from './tooling/eslint-config/index.js';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.timestamp-*.mjs',
      // Other agents' isolated git worktrees — full repo copies; not ours to lint.
      '.claude/**',
      '**/.git/**',
    ],
  },
  ...base,
];
