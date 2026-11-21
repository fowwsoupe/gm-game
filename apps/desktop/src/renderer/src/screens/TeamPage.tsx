import { useState } from 'react';
import { MARKET_SIZES, TICKET_STEPS, type Team } from '@gm/shared';
import {
  useCapSheet,
  useDispatch,
  useLines,
  useMine,
  useOnline,
  useOwner,
  useRoster,
  useTeams,
} from '@/lib/queries';
import { useUi } from '@/stores/ui';
import { useT, type MessageKey } from '@/i18n';
import { Button, Card, PersonFace, Td, Th } from '@/ui';
import { fullName, money, qualityKey, teamName } from '@/lib/format';
import { Summary } from '@/screens/Cap';

/** Any team's roster, cap sheet and depth chart, built from the existing queries. */
export function TeamPage() {
  const t = useT();
  const { teamId, setScreen } = useUi();
  const { data: teams = [] } = useTeams();
  const team = teams.find((x) => x.id === teamId);
  const { data: roster = [] } = useRoster(team?.id);
  const { data: sheet } = useCapSheet(team?.id);
  const { data: lines } = useLines(team?.id);
  const { data: owned } = useOwner(team?.id);
  const dispatch = useDispatch();
  const { guest } = useOnline();
  const mine = useMine();
  if (!team) return <p className="text-muted">{t('team.empty')}</p>;
  // What this window may change here: any human team's in its own league, a guest's own team only.
  const own = guest ? team.id === mine?.id : team.userControlled;
  const byId = new Map<string, (typeof roster)[number]>(roster.map((p) => [p.id, p]));
  const name = (id: string) => {
    const p = byId.get(id);
    return p ? fullName(p) : id;
  };

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center gap-3">
        <Button onClick={() => setScreen('standings')}>{t('team.back')}</Button>
        <h1 className="text-lg font-semibold">{teamName(teams, team.id)}</h1>
      </div>
      {(!guest || own) && <IdentityCard key={team.id} team={team} relocate={!guest} />}
      {owned && (
        <Card title={t('team.owner')}>
          <div className="grid gap-4 text-sm md:grid-cols-4">
            <div className="font-semibold">
              <PersonFace role="owner" name={owned.owner.name} size={22} />
              {owned.owner.name}
            </div>
            {(
              [
                ['team.owner.priority', `${Math.round(owned.owner.priority * 100)}%`],
                ['team.owner.patience', `${Math.round(owned.owner.patience * 100)}%`],
                ['team.owner.market', `×${owned.market.toFixed(2)}`],
              ] as const
            ).map(([key, value]) => (
              <div key={key}>
                <div className="text-muted">{t(key)}</div>
                <div className="tabular">{value}</div>
              </div>
            ))}
            <div className="font-semibold">
              <div className="font-normal text-muted">{t('team.coach')}</div>
              <PersonFace role="coach" name={owned.coach.name} size={22} />
              {owned.coach.name}
            </div>
            {(
              [
                ['team.coach.since', String(owned.coach.hired)],
                ['team.coach.salary', money(owned.coach.salary)],
              ] as const
            ).map(([key, value]) => (
              <div key={key}>
                <div className="text-muted">{t(key)}</div>
                <div className="tabular">{value}</div>
              </div>
            ))}
            {owned.gm && (
              <div className="font-semibold">
                <div className="font-normal text-muted">{t('team.gm')}</div>
                <PersonFace role="gm" name={owned.gm} size={22} />
                {owned.gm}
              </div>
            )}
          </div>
        </Card>
      )}
      {owned && (
        <Card title={t('team.staff')}>
          <div className="grid gap-4 text-sm md:grid-cols-5">
            {(
              [
                ['team.coach', owned.coach],
                ['team.staff.scouting', owned.staff.scouting],
                ['team.staff.development', owned.staff.development],
                ['team.staff.medical', owned.staff.medical],
                ['team.staff.analytics', owned.staff.analytics],
              ] as const
            ).map(([key, head]) => (
              <div key={key}>
                <div className="text-muted">{t(key)}</div>
                <div className="font-semibold">{head.name}</div>
                <div className="tabular">
                  {t(qualityKey(head.quality ?? 0.5))} · {money(head.salary)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {owned && (
        <Card title={t('team.arena')}>
          <div className="grid gap-4 text-sm md:grid-cols-4">
            {(
              [
                ['team.arena.capacity', owned.capacity.toLocaleString()],
                [
                  'team.arena.attendance',
                  owned.fans.attendance
                    ? `${owned.fans.attendance.toLocaleString()} (${Math.round((100 * owned.fans.attendance) / owned.capacity)}%)`
                    : '—',
                ],
                ['team.arena.interest', `${Math.round(owned.fans.interest)} / 100`],
              ] as const
            ).map(([key, value]) => (
              <div key={key}>
                <div className="text-muted">{t(key)}</div>
                <div className="tabular">{value}</div>
              </div>
            ))}
            <div>
              <div className="text-muted">{t('team.arena.price')}</div>
              {own ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {TICKET_STEPS.map((pct) => (
                    <Button
                      key={pct}
                      variant={pct === owned.ticketPct ? 'primary' : 'ghost'}
                      onClick={() =>
                        dispatch.mutate({ kind: 'finance.setTicketPrice', teamId: team.id, pct })
                      }
                    >
                      {signedPct(pct)}
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="tabular">{signedPct(owned.ticketPct)}</div>
              )}
            </div>
          </div>
        </Card>
      )}
      <Card title={t('team.depth')}>
        <div className="grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-4">
          {lines?.units.map((u) => (
            <div key={u.unit}>
              <div className="mb-1 text-muted">
                {t(`lines.unit.${u.unit[0]}` as MessageKey, { n: u.unit.slice(1) })}
              </div>
              <ul>
                {u.playerIds.map((id) => (
                  <li key={id}>{name(id)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>
      <Card title={t('team.roster')}>
        <table className="tabular w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <Th>{t('roster.player')}</Th>
              <Th>{t('roster.pos')}</Th>
              <Th>{t('roster.capHit')}</Th>
              <Th>{t('roster.through')}</Th>
            </tr>
          </thead>
          <tbody>
            {roster.map((p) => (
              <tr key={p.id} className="border-b border-line/50">
                <Td>{name(p.id)}</Td>
                <Td>{p.position}</Td>
                <Td>{p.contract ? money(p.contract.capHit) : ''}</Td>
                <Td>{p.contract?.expiresAfterSeason ?? ''}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {sheet && <Summary sheet={sheet} />}
    </div>
  );
}

const signedPct = (pct: number) => `${pct > 0 ? '+' : ''}${pct}%`;

/** The identity editor: a team's city, name and abbreviation, and (never for a guest) relocating it to a new market. The sim validates; an error shows beside Save. */
function IdentityCard({ team, relocate }: { team: Team; relocate: boolean }) {
  const t = useT();
  const dispatch = useDispatch();
  const [draft, setDraft] = useState({
    city: team.city,
    name: team.name,
    abbreviation: team.abbreviation,
  });
  const [size, setSize] = useState<number>(team.market ?? 1);
  const error = dispatch.data && !dispatch.data.ok ? dispatch.data.error.message : null;
  return (
    <Card title={t('team.identity')}>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <IdentityFields draft={draft} onChange={setDraft} />
        <Button
          variant="primary"
          disabled={dispatch.isPending}
          onClick={() => dispatch.mutate({ kind: 'team.rename', teamId: team.id, ...draft })}
        >
          {t('team.identity.save')}
        </Button>
        {relocate && (
          <>
            <MarketSelect value={size} onChange={setSize} />
            <Button
              disabled={dispatch.isPending}
              onClick={() =>
                dispatch.mutate({ kind: 'team.relocate', teamId: team.id, ...draft, market: size })
              }
            >
              {t('team.relocate')}
            </Button>
          </>
        )}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    </Card>
  );
}

type Identity = { city: string; name: string; abbreviation: string };

/** The city, name and abbreviation inputs of a team's identity (the editor and the expansion form). */
export function IdentityFields({
  draft,
  onChange,
}: {
  draft: Identity;
  onChange: (draft: Identity) => void;
}) {
  const t = useT();
  return (
    <>
      {(['city', 'name', 'abbreviation'] as const).map((f) => (
        <label key={f} className="flex flex-col gap-1">
          <span className="text-muted">{t(`team.identity.${f}`)}</span>
          <input
            value={draft[f]}
            maxLength={f === 'abbreviation' ? 4 : 24}
            onChange={(e) => onChange({ ...draft, [f]: e.target.value })}
            className="rounded-md border border-line bg-panel px-2 py-1"
          />
        </label>
      ))}
    </>
  );
}

/** A franchise's market size, picked from the ruleset's sizes. */
export function MarketSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  const t = useT();
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted">{t('team.relocate.market')}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-md border border-line bg-panel px-2 py-1"
      >
        {MARKET_SIZES.map((m) => (
          <option key={m} value={m}>
            {t(`team.relocate.market.${m}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
