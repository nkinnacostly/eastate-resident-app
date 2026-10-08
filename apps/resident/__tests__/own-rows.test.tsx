/**
 * "Mine" means mine — not "everything RLS lets me read".
 *
 * RLS is the security boundary, and it is deliberately WIDER than ownership:
 * an estate admin may read every code and membership in their estate, and a
 * platform admin every membership on the platform. A client that treated "the
 * rows I can see" as "my rows" showed a resident who was also an admin every
 * live gate code on the estate as their own — with share buttons — and a
 * 3-code cap counter that counted the neighbours' codes; a platform admin's
 * app loaded every estate's memberships and landed on an arbitrary one.
 *
 * So the fake database below returns what RLS returns FOR AN ADMIN, and applies
 * only the filters the app itself sends. What reaches the screen is then
 * exactly what the client's own query narrowed it to — which is the thing
 * under test.
 */
import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { listMyCodes } from '@/lib/api';
import { AuthProvider, useAuth } from '@/lib/auth';
import { CodesProvider, useCodes } from '@/lib/codes';

type Row = Record<string, unknown>;

/**
 * A supabase-js query stand-in over fixture rows. `eq` and `in` filter for
 * real; everything else is recorded and passed through.
 */
function mockTable(rows: Row[]) {
  let out = rows;
  const calls: unknown[][] = [];
  const q = {
    calls,
    select: (...a: unknown[]) => (calls.push(['select', ...a]), q),
    order: (...a: unknown[]) => (calls.push(['order', ...a]), q),
    eq: (col: string, value: unknown) => {
      calls.push(['eq', col, value]);
      out = out.filter((r) => r[col] === value);
      return q;
    },
    in: (col: string, values: readonly unknown[]) => {
      calls.push(['in', col, values]);
      out = out.filter((r) => values.includes(r[col]));
      return q;
    },
    then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
      Promise.resolve({ data: out, error: null }).then(ok, fail),
  };
  return q;
}

const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'me' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: async () => ({ error: null }),
    },
  },
}));

// Sign-out's token cleanup has its own file (sign-out.test.tsx); here it would
// only drag expo-notifications into a test about queries.
jest.mock('@/lib/push', () => ({ unregisterForPush: async () => {} }));

const membership = (over: Row): Row => ({
  role: 'resident',
  is_active: true,
  estates: { name: 'Demo Estate' },
  houses: { house_number: 'B12', house_code: 'LUX5' },
  ...over,
});

/**
 * What RLS hands back to "me", who lives at estate-1 AND administers it, and is
 * also a platform admin: my own rows, plus every neighbour's.
 */
const MEMBERSHIPS: Row[] = [
  // Visible only because I am a platform admin. FIRST on purpose: the app opens
  // on the first estate in the list, and an unfiltered list made it this one.
  membership({
    id: 'stranger',
    user_id: 'a-stranger',
    estate_id: 'estate-9',
    estates: { name: 'Somebody Else Court' },
  }),
  membership({ id: 'my-home', user_id: 'me', estate_id: 'estate-1' }),
  membership({ id: 'my-admin-seat', user_id: 'me', estate_id: 'estate-1', role: 'admin' }),
  // Visible only because I am an estate admin.
  membership({ id: 'neighbour', user_id: 'someone-else', estate_id: 'estate-1' }),
];

const live = (id: string, membershipId: string): Row => ({
  id,
  code: id,
  membership_id: membershipId,
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  used_at: null,
  revoked_reason: null,
  status: 'active',
  is_delivery: false,
  delivery_note: null,
});

/** Every live code in estate-1, as RLS shows it to that estate's admin. */
const CODES: Row[] = [
  live('MINE01', 'my-home'),
  live('NBR001', 'neighbour'),
  live('NBR002', 'neighbour'),
  live('NBR003', 'neighbour'),
];

let tables: Record<string, ReturnType<typeof mockTable>[]>;

beforeEach(() => {
  jest.clearAllMocks();
  tables = {};
  mockFrom.mockImplementation((table: string) => {
    const q = mockTable(table === 'memberships' ? MEMBERSHIPS : table === 'access_codes' ? CODES : []);
    (tables[table] ??= []).push(q);
    return q;
  });
});

let auth: ReturnType<typeof useAuth>;
let codes: ReturnType<typeof useCodes>;

function Probe() {
  auth = useAuth();
  codes = useCodes();
  return (
    <Text>{`estates:${auth.memberships.map((m) => m.estate_name).join('|')} live:${codes.live
      .map((c) => c.code)
      .join('|')}`}</Text>
  );
}

const renderApp = async () => {
  render(
    <AuthProvider>
      <CodesProvider>
        <Probe />
      </CodesProvider>
    </AuthProvider>,
  );
  await waitFor(() => expect(auth.membershipsLoaded).toBe(true));
  await waitFor(() => expect(tables.access_codes?.length).toBeGreaterThan(0));
};

describe('memberships', () => {
  it('asks for the signed-in user’s rows, not every row RLS would allow', async () => {
    await renderApp();
    expect(tables.memberships[0].calls).toContainEqual(['eq', 'user_id', 'me']);
  });

  it('loads only my resident memberships, even as an estate and platform admin', async () => {
    await renderApp();
    expect(auth.memberships.map((m) => m.id)).toEqual(['my-home']);
  });

  // The platform-admin symptom: the app landed on whichever estate sorted first.
  it('opens on my own estate, never one I can merely see', async () => {
    await renderApp();
    expect(auth.activeEstateId).toBe('estate-1');
    expect(screen.queryByText(/Somebody Else Court/)).toBeNull();
  });
});

describe('codes', () => {
  it('lists only codes minted under my own memberships', async () => {
    await renderApp();
    await waitFor(() => expect(screen.getByText(/live:MINE01$/)).toBeTruthy());
    expect(codes.codes.map((c) => c.code)).toEqual(['MINE01']);
  });

  // The cap counter reads `live`. Counting the neighbours' codes told a
  // resident with one live code that they had hit the limit of three.
  it('counts only my live codes against the 3-code cap', async () => {
    await renderApp();
    await waitFor(() => expect(codes.live).toHaveLength(1));
  });

  it('filters on membership ids rather than trusting RLS to mean "mine"', async () => {
    await renderApp();
    const last = tables.access_codes.at(-1)!;
    expect(last.calls).toContainEqual(['in', 'membership_id', ['my-home']]);
  });
});

describe('listMyCodes', () => {
  // No membership, no codes of one's own — and no request to find that out.
  it('asks the database nothing when there is no membership to ask about', async () => {
    await expect(listMyCodes([])).resolves.toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns exactly the codes of the memberships it is given', async () => {
    const rows = await listMyCodes(['neighbour']);
    expect(rows.map((r) => r.code)).toEqual(['NBR001', 'NBR002', 'NBR003']);
  });
});
