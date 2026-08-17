import {
  CODE_LENGTH,
  CODE_TTL_HOURS,
  MAX_ACTIVE_CODES_PER_RESIDENT,
  CODE_CHARSET,
} from '@estate/core';
import { useState } from 'react';

import { HeadActions, Button, Card, Chip, PageHead } from '../components/ui';
import { rotateJoinCode } from '../lib/api';
import { useAuth } from '../lib/auth';

function Row({ title, blurb, right }: { title: string; blurb: string; right: React.ReactNode }) {
  return (
    <div className="flex items-center gap-5 border-b border-hair py-4 last:border-0">
      <div className="flex-1">
        <div className="text-[13.5px] font-extrabold">{title}</div>
        <div className="mt-1 text-[12px] text-muted">{blurb}</div>
      </div>
      <div className="flex-none">{right}</div>
    </div>
  );
}

export function Settings() {
  const { activeEstate, activeEstateId, refreshEstates } = useAuth();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const rotate = async () => {
    if (!activeEstateId) return;
    if (
      !window.confirm(
        'Rotate the estate code? Anyone holding the old code can no longer request access. Existing residents are unaffected.',
      )
    )
      return;
    setBusy(true);
    try {
      const next = await rotateJoinCode(activeEstateId);
      await refreshEstates();
      setNote(`New code: ${next}`);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title="Settings"
        blurb="How this estate is joined, and the rules every code follows."
        right={<HeadActions estate={activeEstate?.estate_name ?? '—'} />}
      />

      <h2 className="mt-7 text-[16.5px] font-extrabold">Joining this estate</h2>
      <Card className="mt-3.5 p-5">
        <div className="flex items-center gap-5">
          <div className="flex-1">
            <div className="text-[13.5px] font-extrabold">Estate code</div>
            <div className="mt-1 max-w-[52ch] text-[12px] leading-[18px] text-muted">
              Residents type this when they sign up, which routes their request to you. Hand it out
              on a noticeboard or welcome pack — it is a routing token, not a password, and it never
              admits anyone on its own.
            </div>
          </div>
          <div className="flex flex-none items-center gap-3">
            <div className="rounded-[14px] bg-field px-4 py-2.5 text-[19px] font-extrabold tracking-code">
              {activeEstate?.join_code ?? '—'}
            </div>
            <Button variant="quiet" onClick={() => void rotate()} disabled={busy}>
              {busy ? 'Rotating…' : 'Rotate'}
            </Button>
          </div>
        </div>
        {note ? <div className="mt-3 text-[12.5px] font-semibold text-muted">{note}</div> : null}
      </Card>

      <h2 className="mt-8 text-[16.5px] font-extrabold">Code rules</h2>
      <Card className="mt-3.5 px-5">
        {/* These are platform-wide constants, not per-estate settings. Showing
            them as editable toggles would promise control that does not exist —
            the cap and lifetime are enforced inside the database. */}
        <Row
          title="Code lifetime"
          blurb="How long a code stays valid after it is made."
          right={<Chip tone="on">{CODE_TTL_HOURS} hours</Chip>}
        />
        <Row
          title="Live codes per resident"
          blurb="The cap that stops one unit issuing codes in bulk. Enforced in the database, not the app."
          right={<Chip tone="on">{MAX_ACTIVE_CODES_PER_RESIDENT}</Chip>}
        />
        <Row
          title="Character set"
          blurb={`${CODE_CHARSET.length} glyphs, ${CODE_LENGTH} per code. 0 O 1 I L are excluded so nothing is misread at the gate.`}
          right={<Chip>Locked</Chip>}
        />
        <Row
          title="Offline admit-and-flag"
          blurb="A guard with no signal can admit an unmatched code. It is recorded with their name and appears in the audit log for you."
          right={<Chip tone="good">On</Chip>}
        />
      </Card>

      <Card className="mt-4 p-4">
        <p className="text-[12.5px] leading-[19px] text-muted">
          These rules are the same for every estate on the platform and are enforced inside the
          database, so they are shown here rather than made editable. Making them per-estate would
          mean moving the cap and expiry out of the code that guarantees them.
        </p>
      </Card>
    </>
  );
}
