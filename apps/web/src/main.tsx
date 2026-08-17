import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { OperatorShell } from './components/operator-shell';
import { Shell } from './components/shell';
import './index.css';
import { AuthProvider, useAuth } from './lib/auth';
import { Audit } from './pages/audit';
import { ChangePassword } from './pages/change-password';
import { Codes } from './pages/codes';
import { Flagged } from './pages/flagged';
import { Guards } from './pages/guards';
import { Houses } from './pages/houses';
import { NoAccess } from './pages/no-access';
import { Admins } from './pages/operator/admins';
import { Estates } from './pages/operator/estates';
import { Health } from './pages/operator/health';
import { Portfolio } from './pages/operator/portfolio';
import { Settings as OperatorSettings } from './pages/operator/settings';
import { Overview } from './pages/overview';
import { Residents } from './pages/residents';
import { Settings } from './pages/settings';
import { SignIn } from './pages/sign-in';

/**
 * The estate-admin dashboard: one estate at a time, drilled into.
 *
 * `base` is passed rather than inferred because the shell's nav has to build
 * absolute hrefs — react-router relative links resolve against the current
 * location, so they compound a level on every click inside a nested mount.
 */
function EstateRoutes({ base = '' }: { base?: string }) {
  return (
    <Routes>
      <Route element={<Shell base={base} />}>
        <Route index element={<Overview />} />
        <Route path="houses" element={<Houses />} />
        <Route path="residents" element={<Residents />} />
        <Route path="flagged" element={<Flagged />} />
        <Route path="guards" element={<Guards />} />
        <Route path="codes" element={<Codes />} />
        <Route path="audit" element={<Audit />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to={base || '/'} replace />} />
      </Route>
    </Routes>
  );
}

/** The platform-owner dashboard: across estates, never inside one. */
function OperatorRoutes() {
  return (
    <Routes>
      <Route element={<OperatorShell />}>
        <Route index element={<Portfolio />} />
        <Route path="estates" element={<Estates />} />
        <Route path="admins" element={<Admins />} />
        <Route path="health" element={<Health />} />
        <Route path="settings" element={<OperatorSettings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/**
 * One gate, not a guard per route.
 *
 * `estatesLoaded` is what separates "not an admin" from "haven't looked yet" —
 * routing on an empty list would flash the no-access screen at every admin on
 * every reload.
 *
 * A platform owner lands on the operator dashboard. Someone who is BOTH an
 * owner and an estate admin can reach the estate one at /estate, which is why
 * that path is a real route rather than a state flag: it survives a reload and
 * can be linked to.
 */
function App() {
  const { session, loading, estates, estatesLoaded, isPlatformAdmin, rolesLoaded, mustChangePassword } =
    useAuth();

  if (loading) return <div className="min-h-screen bg-ink" />;
  if (!session) return <SignIn />;

  // Before anything else. An account still on its handover password should not
  // be looking at estate data, let alone the platform's.
  if (mustChangePassword) return <ChangePassword />;

  // BOTH flags, not just estatesLoaded. isPlatformAdmin starts false, so an
  // owner arriving directly at /estate would briefly render the estate routes,
  // whose catch-all rewrites the URL to "/" — and by the time the ownership
  // answer landed, the path they asked for was already gone.
  if (!estatesLoaded || !rolesLoaded) return <div className="min-h-screen bg-ink" />;
  if (!isPlatformAdmin && estates.length === 0) return <NoAccess />;

  if (isPlatformAdmin) {
    return (
      <Routes>
        {/* Only mounted for an owner who also administers an estate — the
            operator shell hides the link otherwise. */}
        {estates.length > 0 ? <Route path="/estate/*" element={<EstateRoutes base="/estate" />} /> : null}
        <Route path="*" element={<OperatorRoutes />} />
      </Routes>
    );
  }

  return <EstateRoutes />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
