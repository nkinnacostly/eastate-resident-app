import { useEffect, useState } from 'react';

import { Avatar, Card, Chip, Empty, PageHead } from '../../components/ui';
import {
  listOperatorAdmins, listPlatformTeam,
  type OperatorAdmin, type PlatformMember,
} from '../../lib/operator';
import { ago } from '../../lib/operator-format';

// PERSON gets the most room: an email is the longest thing in the table and
// the one people actually read off it.
const COLS = 'grid grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_110px_130px] gap-4';

export function Admins() {
  const [admins, setAdmins] = useState<OperatorAdmin[]>([]);
  const [team, setTeam] = useState<PlatformMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [a, t] = await Promise.all([listOperatorAdmins(), listPlatformTeam()]);
        if (!live) return;
        setAdmins(a);
        setTeam(t);
        setError(null);
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <PageHead
        title="Admins"
        blurb="Who can administer which estate, and who can reach the platform itself. An estate admin is created when you onboard the estate — this is where you check the account was actually used."
      />

      {error ? (
        <div className="mt-5 rounded-[14px] bg-coral-soft px-4 py-3 text-[13px] font-semibold text-coral-ink">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-[1.5fr_1fr] gap-[26px]">
        <section className="min-w-0">
          <h2 className="text-[16.5px] font-extrabold tracking-tight">Estate admins</h2>
          <Card className="mt-3.5 py-4">
            <div className={`${COLS} px-[18px] pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
              <span>PERSON</span>
              <span>ESTATE</span>
              <span>LAST SIGN-IN</span>
              <span>STATE</span>
            </div>
            {loading ? (
              <Empty>Loading…</Empty>
            ) : admins.length === 0 ? (
              <Empty>No estate admins yet. Onboarding an estate creates one.</Empty>
            ) : (
              admins.map((a) => (
                <div
                  key={`${a.user_id}-${a.estate_id}`}
                  className={`${COLS} items-center border-t border-hair px-[18px] py-3.5`}
                >
                  <div className="flex min-w-0 items-center gap-[11px]">
                    <Avatar name={a.full_name ?? a.email} className="h-[30px] w-[30px] rounded-[10px]" />
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-bold">{a.full_name ?? '—'}</div>
                      <div className="mt-0.5 truncate text-[11px] text-muted">{a.email}</div>
                    </div>
                  </div>
                  <span className="truncate text-[12.5px] text-muted">{a.estate_name}</span>
                  <span className="text-[12.5px] text-muted">{ago(a.last_sign_in_at)}</span>
                  <div>
                    {/* "Never signed in" is the real onboarding-stalled signal:
                        the account exists, the password was handed over, and
                        nobody used it. */}
                    {!a.is_active ? (
                      <Chip>Revoked</Chip>
                    ) : a.last_sign_in_at === null ? (
                      <Chip tone="bad">Never signed in</Chip>
                    ) : (
                      <Chip tone="good">Active</Chip>
                    )}
                  </div>
                </div>
              ))
            )}
          </Card>

          <h2 className="mt-[26px] text-[16.5px] font-extrabold tracking-tight">Platform team</h2>
          <Card className="mt-3.5 px-5 py-1.5">
            {loading ? (
              <Empty>Loading…</Empty>
            ) : (
              team.map((m, i) => (
                <div
                  key={m.user_id}
                  className={`flex items-center gap-3 py-4 ${i < team.length - 1 ? 'border-b border-hair' : ''}`}
                >
                  <Avatar name={m.full_name ?? m.email} className="h-[34px] w-[34px] rounded-[11px]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-extrabold">{m.full_name ?? m.email}</div>
                    <div className="mt-0.5 truncate text-[11.5px] text-muted">
                      {m.email} · last seen {ago(m.last_sign_in_at).toLowerCase()}
                    </div>
                  </div>
                  <Chip tone="on">Owner</Chip>
                </div>
              ))
            )}
          </Card>
          <p className="mt-3 text-[11.5px] leading-[1.5] text-muted">
            Platform access is granted by inserting a row in <code>platform_admins</code>, which no
            client can write. There is deliberately no button here: a dashboard that can promote its
            own user is one careless policy away from letting anyone do it.
          </p>
        </section>

        <section className="min-w-0">
          <h2 className="text-[16.5px] font-extrabold tracking-tight">What an operator can reach</h2>
          <Card className="mt-3.5 px-5 py-1.5">
            {[
              ['Estates and their admins', 'Yes'],
              ['House and resident counts', 'Aggregate only'],
              ['Resident names and addresses', 'No'],
              ['Visitor codes', 'Never'],
              ['Verification records', 'Counts only'],
            ].map(([what, reach], i, all) => (
              <div
                key={what}
                className={`flex items-center justify-between gap-3 py-3.5 ${
                  i < all.length - 1 ? 'border-b border-hair' : ''
                }`}
              >
                <span className="text-[12.5px] text-muted">{what}</span>
                <span
                  className={`text-[12px] font-extrabold ${
                    reach === 'Never' || reach === 'No' ? 'text-coral-ink' : 'text-ink'
                  }`}
                >
                  {reach}
                </span>
              </div>
            ))}
          </Card>

          <Card className="mt-3.5 bg-ink p-5 text-canvas">
            <div className="text-[13px] font-extrabold">This is enforced, not promised</div>
            <div className="mt-1.5 text-[12px] leading-[1.55] text-muted-2">
              The operator screens read through functions that return counts and names of estates —
              there is no path from here to a resident&apos;s address or a live code, because no
              function exposes one. The boundary is in the database, not in this interface.
            </div>
          </Card>
        </section>
      </div>
    </>
  );
}
