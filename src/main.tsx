import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import Root from './Root';
import './index.css';
import { applyTheme } from './lib/theme';

applyTheme();
try {
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
} catch {
  /* ignore */
}

// Old browser-only data (resal_* localStorage keys) is intentionally ignored: it is neither read
// nor deleted. All school data now lives in the protected cloud schema.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
