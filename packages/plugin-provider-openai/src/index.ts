import { defineProvider, definePlugin } from '@moxxy/sdk';
import { OpenAIProvider, openAIModels, type OpenAIProviderConfig } from './provider.js';

export { OpenAIProvider, openAIModels };
export type { OpenAIProviderConfig };
export { toOpenAIMessages, toOpenAITools } from './translate.js';
export { validateKey, type ValidateKeyDeps, type ValidationResult } from './validate.js';

import { validateKey as validateOpenAIKey } from './validate.js';

export const openaiProviderDef = defineProvider({
  name: 'openai',
  models: [...openAIModels],
  createClient: (config) => new OpenAIProvider(config as OpenAIProviderConfig),
  validateKey: (key) => validateOpenAIKey(key),
});

export const openaiPlugin = definePlugin({
  name: '@moxxy/plugin-provider-openai',
  version: '0.0.0',
  providers: [openaiProviderDef],
});

export default openaiPlugin;
