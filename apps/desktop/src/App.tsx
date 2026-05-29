import { useState } from 'react';
import { useConnection, isConnected } from './lib/useConnection';
import { ConnectionScreen } from './connection/ConnectionScreen';
import { OnboardingWizard } from './onboarding/OnboardingWizard';
import { ChatSurface } from './chat/ChatSurface';

/**
 * Phase 1 skeleton. The single source of truth for what to render is
 * the supervisor's `phase`:
 *
 *   - anything other than `connected`     → ConnectionScreen
 *   - `connected`                         → ChatSurface (TBD in Phase 3)
 *
 * The onboarding wizard + chat surface land in subsequent phases so
 * each one can be focused and individually verified.
 */
export function App(): JSX.Element {
  const { snapshot, retry } = useConnection();
  const phase = snapshot?.phase;
  const [forceWizard, setForceWizard] = useState(false);

  const cliMissing = phase?.phase === 'cli-missing';
  const connectedWithoutProvider =
    phase?.phase === 'connected' && phase.activeProvider === null;

  // Onboarding takes over when the CLI isn't installed yet, or when
  // we connected but no provider is configured. The wizard auto-
  // closes when the underlying state changes (provider configured /
  // CLI install completed → supervisor reconnects → we land in
  // `connected` with a provider).
  if (forceWizard || cliMissing || connectedWithoutProvider) {
    return (
      <OnboardingWizard phase={phase} onComplete={() => setForceWizard(false)} />
    );
  }

  if (!isConnected(phase)) {
    return <ConnectionScreen snapshot={snapshot} onRetry={() => void retry()} />;
  }

  return <ChatSurface phase={phase!} />;
}

