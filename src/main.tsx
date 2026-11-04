import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { runMigrations } from './lib/storage';

// Stamp/upgrade the local data schema (additive only) before the app reads any data.
runMigrations();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
