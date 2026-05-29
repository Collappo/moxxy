import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found — check index.html');

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

/**
 * Wrap the whole tree in a ClerkProvider so any component can read
 * the signed-in user (profile pill, future sync features, etc.).
 * When no publishable key is set, fall back to a bare app — pages
 * gated by Clerk will degrade to "Guest"-only behaviour.
 */
const TreeWithAuth = CLERK_KEY ? (
  <ClerkProvider publishableKey={CLERK_KEY}>
    <App />
  </ClerkProvider>
) : (
  <App />
);

ReactDOM.createRoot(root).render(
  <React.StrictMode>{TreeWithAuth}</React.StrictMode>,
);
