import { useEffect, useState } from 'react';

import { Card, Chip, PageHead } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { getPortfolio, type Portfolio } from '../../lib/operator';
import { count } from '../../lib/operator-format';

/**
 * Platform rules — read-only, on purpose.
 *
 * The design draws these as editable chips (code lifetime, codes per resident,
 * retention). They are not editable here, because they are not settings: they
 * are enforced inside SECURITY DEFINER functions and constraints, and the only
 * way to change one is a migration that changes it everywhere at once.
 *
 * Rendering them as chips that do nothing would be worse than showing them as
 * what they are. The alternative — a settings table every RPC consults — would
 * mean the cap and the expiry could be relaxed at runtime by whoever can write
 * that table, which is precisely what the locked design avoids.
 */
const RULES: { name: string; value: string; why: string }[] = [
  {
    name: 'Code lifetime',
    value: '6 hours',
    why: 'Set on the code when it is minted. Expiry is derived from expires_at at read time, never stored as a status, so a code cannot be "un-expired" by an update going astray.',
  },
  {
    name: 'Live codes per resident',
    value: '3',
    why: 'Enforced by mint_access_code under an advisory lock taken before the count. A plain insert-with-count check would let two simultaneous requests both pass.',
  },
  {
    name: 'Code alphabet',
    value: '32 glyphs',
    why: 'A–Z and 2–9 with O, 0, I, 1 and L removed, so a code survives being read aloud at a gate. 256 is an exact multiple of 32, which is what keeps the random draw unbiased.',
  },
  {
    name: 'Single use',
    value: 'Always',
    why: 'The burn is one conditional UPDATE in one function. Online verification and offline replay are the same code path with a different source, so there is no second place for the rule to drift.',
  },
  {
    name: 'Offline verification',
    value: 'Admit and flag',
    why: 'A guard with a stale pool still admits, and the entry is flagged for the estate admin. Refusing on stale data would turn a network outage into a gate outage.',
  },
  {
    name: 'Revocation at an offline gate',
    value: 'Not instant',
    why: 'Bounded by the guard app’s pull interval and by the code’s own 6-hour expiry. This is a deliberate consequence of verifying without a connection, not a gap.',
  },
];

export function Settings() {
  const { session } = useAuth();
  const [stats, setStats] = useState<Portfolio | null>(null);

  useEffect(() => {
    let live = true;
    void getPortfolio()
      .then((s) => live && setStats(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <PageHead
        title="Settings"
        blurb="What the platform guarantees, and where each guarantee is enforced. These are not toggles — every one of them lives in a database function or constraint, so changing one is a migration, not a click."
      />

      <div className="mt-6 grid grid-cols-[1.2fr_1fr] gap-[26px]">
        <section className="min-w-0">
          <h2 className="text-[16.5px] font-extrabold tracking-tight">Platform rules</h2>
          <Card className="mt-3.5 px-5 py-1.5">
            {RULES.map((r, i) => (
              <div
                key={r.name}
                className={`flex items-start gap-[18px] py-[18px] ${
                  i < RULES.length - 1 ? 'border-b border-hair' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-extrabold">{r.name}</div>
                  <div className="mt-1 text-[12px] leading-[1.5] text-muted">{r.why}</div>
                </div>
                <Chip tone="on" className="mt-0.5 flex-none">
                  {r.value}
                </Chip>
              </div>
            ))}
          </Card>
        </section>

        <section className="min-w-0">
          <h2 className="text-[16.5px] font-extrabold tracking-tight">This account</h2>
          <Card className="mt-3.5 px-5 py-1.5">
            <div className="flex items-center justify-between gap-3 border-b border-hair py-3.5">
              <span className="text-[12.5px] text-muted">Signed in as</span>
              <span className="truncate text-[12.5px] font-bold">{session?.user.email}</span>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-hair py-3.5">
              <span className="text-[12.5px] text-muted">Estates on the platform</span>
              <span className="text-[12.5px] font-bold">{count(stats?.estates_total)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-hair py-3.5">
              <span className="text-[12.5px] text-muted">Houses</span>
              <span className="text-[12.5px] font-bold">{count(stats?.houses_total)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 py-3.5">
              <span className="text-[12.5px] text-muted">People with an account</span>
              <span className="text-[12.5px] font-bold">
                {count(
                  stats
                    ? stats.residents_total + stats.guards_total + stats.admins_total
                    : undefined,
                )}
              </span>
            </div>
          </Card>

          <Card className="mt-3.5 bg-ink p-5 text-canvas">
            <div className="text-[11px] font-extrabold tracking-[0.1em] text-lime">
              WHAT IS NOT BUILT YET
            </div>
            <div className="mt-2.5 text-[12px] leading-[1.55] text-muted-2">
              Billing, plans and invoices appear in the design but nothing in this platform models a
              subscription or a payment, so there is no Billing screen rather than one showing
              invented figures. The same goes for gates, incident tracking and guard app version
              rollout — each needs a schema that does not exist yet.
            </div>
          </Card>
        </section>
      </div>
    </>
  );
}
