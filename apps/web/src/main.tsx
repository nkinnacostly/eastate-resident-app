import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './app';
import './index.css';
import { AuthProvider } from './lib/auth';

/**
 * Bootstrap only — no components live here.
 *
 * They used to. React Fast Refresh works per module and cannot hot-swap a file
 * with no exports, so every edit to the routing gate in <App> forced a full
 * page reload and signed you back to the top of the dashboard. An entry file
 * legitimately exports nothing, so the components moved out rather than the
 * rule being silenced.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
