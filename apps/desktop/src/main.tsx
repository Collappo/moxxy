import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { QuickPrompt } from './quick-prompt/QuickPrompt';
import { currentWindowLabel } from './lib/window-context';
import '@moxxy/ui-tokens/tokens.css';
import '@moxxy/ui-tokens/motifs.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found — check index.html');

// One Vite bundle serves both the full app and the tray's tiny
// quick-prompt surface. Decide which root to mount based on the
// `?window=` query the Rust window-builder sets when it opens us.
const label = currentWindowLabel();
const Surface: React.FC = label === 'quick-prompt' ? QuickPrompt : App;

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Surface />
  </React.StrictMode>,
);
