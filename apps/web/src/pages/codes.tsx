import { useCallback, useEffect, useState } from 'react';

import { HeadActions, Card, Chip, Empty, PageHead, Button } from '../components/ui';
import { listCodes, revokeCode, type CodeRow } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dayTime, timeLeft } from '../lib/format';

const COLS = 'grid grid-cols-[110px_1.2fr_1fr_120px_140px] gap-4';

export function Codes() {
  const { activeEstateId, activeEstate } = useAuth();
  const [rows, setRows] = useState<CodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeEstateId) return;
    setLoading(true);
    try {
      setRows(await listCodes(activeEstateId));
    } finally {
      setLoading(false);
    }
  }, [activeEstateId]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (id: string) => {
    setBusy(id);
    setNote(null);
    try {
      const res = await revokeCode(id);
      // Results, not exceptions — the RPC returns a status so a lost race
      // reads as information rather than a crash.
      if (res === 'already_used') setNote('That code was already used at the gate.');
      else if (res === 'already_revoked') setNote('That code was already revoked.');
      else if (res === 'not_found') setNote('That code no longer exists.');
      await load();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const live = rows.filter((r) => r.status === 'live');

  return (
    <>
      <PageHead
        title="Codes"
        blurb="Codes issued at this estate. Revoking one stops it working at the gate — guards pick the change up on their next sync, which is why revocation is not instant at an offline gate."
        right={<HeadActions estate={activeEstate?.estate_name ?? '—'} />}
      />

      {note ? (
        <div className="mt-5 rounded-[14px] bg-field px-4 py-3 text-[13px] font-semibold text-muted">
          {note}
        </div>
      ) : null}

      <div className="mt-6 text-[13px] font-bold text-muted">
        {live.length} live now · {rows.length} shown
      </div>

      <Card className="mt-3.5 py-4">
        <div className={`${COLS} px-4 pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
          <span>CODE</span>
          <span>RESIDENT</span>
          <span>MADE</span>
          <span>STATUS</span>
          <span></span>
        </div>
        {loading ? (
          <Empty>Loading…</Empty>
        ) : rows.length === 0 ? (
          <Empty>No codes issued yet.</Empty>
        ) : (
          rows.map((c) => (
            <div key={c.id} className={`${COLS} items-center border-t border-hair px-4 py-3`}>
              <div className="text-[13px] font-extrabold tracking-code">{c.code}</div>
              <div className="truncate text-[12.5px]">
                {c.owner_name}
                {c.owner_unit ? <span className="text-muted"> · {c.owner_unit}</span> : null}
              </div>
              <div className="text-[12.5px] text-muted">{dayTime(c.created_at)}</div>
              <div>
                {c.status === 'live' ? (
                  <Chip tone="good">Live · {timeLeft(c.expires_at)}</Chip>
                ) : c.status === 'used' ? (
                  <Chip>Used</Chip>
                ) : c.status === 'revoked' ? (
                  <Chip tone="bad">Revoked</Chip>
                ) : (
                  <Chip>Expired</Chip>
                )}
              </div>
              <div>
                {/* Only a live code can be revoked. Offering the button on a
                    used one would promise something the server refuses. */}
                {c.status === 'live' ? (
                  <Button
                    variant="quiet"
                    disabled={busy === c.id}
                    onClick={() => void revoke(c.id)}
                  >
                    {busy === c.id ? 'Revoking…' : 'Revoke'}
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </Card>
    </>
  );
}
