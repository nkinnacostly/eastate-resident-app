import { Navigate, Route, Routes } from 'react-router-dom';

import { AgencyShell } from './components/agency-shell';
import { OperatorShell } from './components/operator-shell';
import { Shell } from './components/shell';
import { useAuth } from './lib/auth-context';
import { AgencyCoverage } from './pages/agency/coverage';
import { AgencyEstate } from './pages/agency/estate';
import { AgencyMonthlyReturn } from './pages/agency/monthly-return';
import { AgencyOfficer } from './pages/agency/officer';
import { AgencyOfficers } from './pages/agency/officers';
import { Audit } from './pages/audit';
import { ChangePassword } from './pages/change-password';
import { Codes } from './pages/codes';
import { Dues } from './pages/dues';
import { DuesPayments } from './pages/dues-payments';
import { Flagged } from './pages/flagged';
import { GuardProfile } from './pages/guard-profile';
import { Guards } from './pages/guards';
import { HouseProfile } from './pages/house-profile';
import { Houses } from './pages/houses';
import { LandlordShell } from './components/landlord-shell';
import { LandlordDashboard } from './pages/landlord/dashboard';
import { LandlordHouse } from './pages/landlord/house';
import { LandlordSignUp } from './pages/landlord/sign-up';
import { LoadFailed } from './pages/load-failed';
import { NoAccess } from './pages/no-access';
import { Admins } from './pages/operator/admins';
import { EstateDetail } from './pages/operator/estate-detail';
import { Estates } from './pages/operator/estates';
import { Health } from './pages/operator/health';
import { Payments } from './pages/operator/payments';
import { Person } from './pages/operator/person';
import { Portfolio } from './pages/operator/portfolio';
import { Settings as OperatorSettings } from './pages/operator/settings';
import { Overview } from './pages/overview';
import { ResidentProfile } from './pages/resident-profile';
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
        <Route path="houses/:houseId" element={<HouseProfile />} />
        <Route path="residents" element={<Residents />} />
        <Route path="residents/:membershipId" element={<ResidentProfile />} />
        <Route path="flagged" element={<Flagged />} />
        <Route path="guards" element={<Guards />} />
        <Route path="guards/:membershipId" element={<GuardProfile />} />
        <Route path="codes" element={<Codes />} />
        <Route path="dues" element={<Dues />} />
        <Route path="payments" element={<DuesPayments />} />
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
        <Route path="estates/:estateId" element={<EstateDetail />} />
        <Route path="admins" element={<Admins />} />
        <Route path="people/:userId" element={<Person />} />
        <Route path="payments" element={<Payments />} />
        <Route path="health" element={<Health />} />
        <Route path="settings" element={<OperatorSettings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/**
 * The landlord's portal: their own properties, across whatever estates they
 * happen to own in.
 *
 * One destination, so the shell carries no nav. A landlord is not a membership
 * — they are linked to a house by the email the estate recorded on it — which
 * is why this tree sits beside the others rather than inside EstateRoutes.
 */
function LandlordRoutes() {
  return (
    <Routes>
      <Route element={<LandlordShell />}>
        <Route index element={<LandlordDashboard />} />
        <Route path="houses/:houseId" element={<LandlordHouse />} />
        <Route path="*" element={<Navigate to="/landlord" replace />} />
      </Route>
    </Routes>
  );
}

/** The security agency's portal: across its own estates, never inside one. */
function AgencyRoutes() {
  return (
    <Routes>
      {/* Pathless layout route with RELATIVE children, matching EstateRoutes.
          A nested <Routes> resolves against the path its parent matched, so an
          absolute "/agency" here would be looking for /agency/agency. The
          shell's NavLinks stay absolute, which is the opposite rule and the
          reason this is easy to get backwards. */}
      <Route element={<AgencyShell />}>
        <Route index element={<AgencyCoverage />} />
        <Route path="officers" element={<AgencyOfficers />} />
        <Route path="officers/:agencyMembershipId" element={<AgencyOfficer />} />
        <Route path="estates/:estateId" element={<AgencyEstate />} />
        <Route path="return" element={<AgencyMonthlyReturn />} />
        <Route path="*" element={<Navigate to="/agency" replace />} />
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
export function App() {
  const {
    session, loading, estates, estatesLoaded, estatesError, isPlatformAdmin, isLandlord,
    rolesLoaded, mustChangePassword, agencies, agenciesLoaded,
  } = useAuth();

  if (loading) return <div className="min-h-screen bg-ink" />;

  // Signed out. Sign-up is a REAL ROUTE rather than a flag on the sign-in
  // screen, so the link in a dues reminder can point straight at it and
  // survive a reload. It is the only self-service sign-up here: every other
  // account on this dashboard arrives by invitation, and a landlord has
  // nobody to invite them.
  if (!session) {
    return (
      <Routes>
        <Route path="/landlord/signup" element={<LandlordSignUp />} />
        <Route path="*" element={<SignIn />} />
      </Routes>
    );
  }

  // Before anything else. An account still on its handover password should not
  // be looking at estate data, let alone the platform's.
  if (mustChangePassword) return <ChangePassword />;

  // BOTH flags, not just estatesLoaded. isPlatformAdmin starts false, so an
  // owner arriving directly at /estate would briefly render the estate routes,
  // whose catch-all rewrites the URL to "/" — and by the time the ownership
  // answer landed, the path they asked for was already gone.
  // agenciesLoaded joins the other two for the same reason: the agency list
  // starts empty, so an agency-only admin would be shown NoAccess for the
  // moment before the answer lands — a dead end for a legitimate user.
  // A permanent failure must not look like a slow one. estatesLoaded stays
  // false on error by design -- a blip should not boot someone to "no access"
  // -- but without this the app sits on the blank screen below forever, which
  // is exactly what a PostgREST embed ambiguity did to every user of every
  // surface. Give them the reason, a retry and a way out.
  if (estatesError && !estatesLoaded) return <LoadFailed detail={estatesError} />;

  if (!estatesLoaded || !rolesLoaded || !agenciesLoaded) {
    return <div className="min-h-screen bg-ink" />;
  }
  // isLandlord joins the others: someone who owns property but administers
  // nothing is a legitimate user with somewhere to be, and NoAccess would turn
  // them away from the dashboard built for them.
  if (!isPlatformAdmin && estates.length === 0 && agencies.length === 0 && !isLandlord) {
    return <NoAccess />;
  }

  if (isPlatformAdmin) {
    return (
      <Routes>
        {/* Only mounted for an owner who holds the role too — each shell hides
            its link otherwise, and a link to a dashboard you cannot enter is a
            dead end. */}
        {estates.length > 0 ? <Route path="/estate/*" element={<EstateRoutes base="/estate" />} /> : null}
        {agencies.length > 0 ? <Route path="/agency/*" element={<AgencyRoutes />} /> : null}
        {isLandlord ? <Route path="/landlord/*" element={<LandlordRoutes />} /> : null}
        <Route path="*" element={<OperatorRoutes />} />
      </Routes>
    );
  }

  // An estate admin who ALSO administers an agency lands on the estate
  // dashboard and crosses over by link. Estate work is the daily job; the
  // agency portal is something you visit monthly to file a return.
  if (estates.length > 0) {
    return (
      <Routes>
        {agencies.length > 0 ? <Route path="/agency/*" element={<AgencyRoutes />} /> : null}
        {/* An estate admin can own property in someone ELSE's estate. The two
            are unrelated roles and the landlord view must not be reachable
            from inside an estate they administer, or the hats blur. */}
        {isLandlord ? <Route path="/landlord/*" element={<LandlordRoutes />} /> : null}
        <Route path="*" element={<EstateRoutes />} />
      </Routes>
    );
  }

  if (agencies.length > 0) {
    // Agency: /agency is home, and anything else redirects there rather than
    // 404ing someone who has exactly one place to be.
    return (
      <Routes>
        <Route path="/agency/*" element={<AgencyRoutes />} />
        {isLandlord ? <Route path="/landlord/*" element={<LandlordRoutes />} /> : null}
        <Route path="*" element={<Navigate to="/agency" replace />} />
      </Routes>
    );
  }

  // Landlord only, which is the common case: they administer nothing, own one
  // or more houses, and have exactly one page to be on.
  return (
    <Routes>
      <Route path="/landlord/*" element={<LandlordRoutes />} />
      <Route path="*" element={<Navigate to="/landlord" replace />} />
    </Routes>
  );
}
