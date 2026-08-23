import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import { startUpdateWatcher } from './lib/appUpdate';

// Before render: an installed PWA has no reload button, so this is the only
// thing that gets a new build onto someone's phone.
startUpdateWatcher();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Outside App, so a crash in any screen still leaves a way out. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
