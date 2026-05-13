import { definePlugin, type ToolDef } from '@moxxy/sdk';
import { bashTool } from './bash.js';
import { dispatchAgentTool } from './dispatch-agent.js';
import { editTool } from './edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { readTool } from './read.js';
import { writeTool } from './write.js';

export { bashTool, dispatchAgentTool, editTool, globTool, grepTool, readTool, writeTool };

export const builtinTools: ReadonlyArray<ToolDef> = [
  readTool,
  writeTool,
  editTool,
  bashTool,
  grepTool,
  globTool,
  dispatchAgentTool,
];

export const builtinToolsPlugin = definePlugin({
  name: '@moxxy/tools-builtin',
  version: '0.0.0',
  tools: [...builtinTools],
});

export default builtinToolsPlugin;
