import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { startUpdateWatcher } from './lib/appUpdate';

// Before render: an installed PWA has no reload button, so this is the only
// thing that gets a new build onto someone's phone.
startUpdateWatcher();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
