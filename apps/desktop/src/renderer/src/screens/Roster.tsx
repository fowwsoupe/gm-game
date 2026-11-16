import { useState } from 'react';
import type { PlayerProfile, TeamId } from '@gm/shared';
import { useCareer, useDispatch, usePlayers, useSigningInterest, useTeams } from '@/lib/queries';
import { useT, type MessageKey } from '@/i18n';
import { Button, Card, PercentileBar, PlayerCard } from '@/ui';
import { money, statValue } from '@/lib/format';

const FREE_AGENTS = 'fa';

/** A team's players (or the free agents) with stats; pick one to see his card. */
export function Roster() {
  const t = useT();
  const { data: teams = [] } = useTeams();
  const [picked, setPicked] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const value = picked ?? (teams.find((x) => x.userControlled) ?? teams[0])?.id;
  const teamId = value === FREE_AGENTS ? null : (value as TeamId | undefined);
  const { data: players = [] } = usePlayers(value === undefined ? undefined : teamId);
  if (value === undefined) return <p className="text-muted">{t('roster.empty')}</p>;

  // One table per rating group (hockey: skaters, goalies), so each gets its own stat columns.
  const groups = new Map<string, PlayerProfile[]>();
  for (const p of players) {
    const key = p.percentiles.map((x) => x.key).join();
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const card = players.find((p) => p.id === selected) ?? players[0];

  return (
    <div className="flex max-w-6xl flex-col gap-4">
      <label className="flex items-center gap-2 text-sm text-muted">
        {t('roster.team')}
        <select
          value={value}
          onChange={(e) => {
            setPicked(e.target.value);
            setSelected(undefined);
          }}
          className="rounded border border-line bg-panel px-2 py-1 text-ink"
        >
          {teams.map((x) => (
            <option key={x.id} value={x.id}>
              {x.city} {x.name}
            </option>
          ))}
          <option value={FREE_AGENTS}>{t('roster.freeAgents')}</option>
        </select>
      </label>
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {players.length === 0 && <p className="text-sm text-muted">{t('roster.none')}</p>}
          {[...groups.values()].map((group) => (
            <PlayerTable
              key={group[0]!.id}
              players={group}
              selected={card?.id}
              onSelect={setSelected}
            />
          ))}
        </div>
        {card && <Profile player={card} signFor={teams.find((x) => x.userControlled)?.id} />}
      </div>
    </div>
  );
}

function PlayerTable({
  players,
  selected,
  onSelect,
}: {
  players: PlayerProfile[];
  selected: string | undefined;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const statKeys = [...new Set(players.flatMap((p) => Object.keys(p.stats)))];
  return (
    <Card>
      <table className="tabular w-full text-sm">
        <thead>
          <tr className="border-b border-line text-right text-muted">
            <th className="px-2 py-2 text-left font-medium">{t('roster.player')}</th>
            <th className="px-2 py-2 text-left font-medium">{t('roster.pos')}</th>
            <th className="px-2 py-2 font-medium">{t('roster.age')}</th>
            <th className="px-2 py-2 font-medium">{t('roster.capHit')}</th>
            <th className="px-2 py-2 font-medium">{t('roster.through')}</th>
            {statKeys.map((k) => (
              <th key={k} className="px-2 py-2 font-medium">
                {t(`stat.${k}` as MessageKey)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={`cursor-pointer border-b border-line/50 text-right hover:bg-panel-2 ${p.id === selected ? 'bg-panel-2' : ''}`}
            >
              <td className="px-2 py-1.5 text-left">
                {p.firstName} {p.lastName}
                {p.injuredUntil !== undefined && (
                  <span className="ml-2 text-xs text-bad">{t('roster.injuredShort')}</span>
                )}
              </td>
              <td className="px-2 py-1.5 text-left">{p.position}</td>
              <td className="px-2 py-1.5">{p.age}</td>
              <td className="px-2 py-1.5">{p.contract ? money(p.contract.capHit) : ''}</td>
              <td className="px-2 py-1.5">{p.contract?.expiresAfterSeason ?? ''}</td>
              {statKeys.map((k) => (
                <td key={k} className="px-2 py-1.5">
                  {p.stats[k] === undefined ? '' : statValue(k, p.stats[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Profile({ player: p, signFor }: { player: PlayerProfile; signFor: TeamId | undefined }) {
  const t = useT();
  const strengths = [...p.percentiles].sort((a, b) => b.value - a.value).slice(0, 2);
  return (
    <div className="space-y-2">
      <PlayerCard
        name={`${p.firstName} ${p.lastName}`}
        subtitle={t('roster.subtitle', { position: p.position, age: p.age })}
        bars={p.percentiles.map((x) => ({
          label: t(`rating.${x.key}` as MessageKey),
          value: x.value,
        }))}
      />
      <Card>
        <p className="text-sm">
          {p.contract
            ? t('roster.contract', {
                amount: money(p.contract.capHit),
                season: p.contract.expiresAfterSeason,
              })
            : t('roster.noContract')}
        </p>
        <p className="mt-1 text-sm text-muted">
          {t('roster.strengths', {
            list: strengths.map((x) => t(`rating.${x.key}` as MessageKey)).join(', '),
          })}
        </p>
        {p.injuredUntil !== undefined && (
          <p className="mt-1 text-sm text-bad">{t('roster.injured', { day: p.injuredUntil })}</p>
        )}
      </Card>
      <Career player={p} />
      {p.teamId === null && signFor && <Offer key={p.id} player={p} teamId={signFor} />}
    </div>
  );
}

/** Offer a free agent a contract; his interest meter answers before you send it. */
function Offer({ player, teamId }: { player: PlayerProfile; teamId: TeamId }) {
  const t = useT();
  // The box keeps what you type; the offer is that many millions, rounded to whole dollars.
  const [text, setText] = useState((player.ask / 1e6).toFixed(2));
  const salary = Math.round((Number(text) || 0) * 1e6);
  const [years, setYears] = useState(2);
  const [message, setMessage] = useState<string | null>(null);
  const { data: view } = useSigningInterest({ playerId: player.id, teamId, salary, years });
  const dispatch = useDispatch();
  return (
    <Card title={t('sign.title')}>
      <p className="mb-2 text-sm text-muted">{t('sign.ask', { amount: money(player.ask) })}</p>
      <div className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="number"
          min={0}
          step={0.1}
          aria-label={t('sign.salary')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-24 rounded border border-line bg-panel px-2 py-1"
        />
        <span className="text-muted">{t('sign.perYear')}</span>
        <select
          aria-label={t('resign.years')}
          value={years}
          onChange={(e) => setYears(Number(e.target.value))}
          className="rounded border border-line bg-panel px-2 py-1"
        >
          {Array.from({ length: view?.maxYears ?? 1 }, (_, i) => i + 1).map((y) => (
            <option key={y} value={y}>
              {t('sign.years', { n: y })}
            </option>
          ))}
        </select>
      </div>
      {view && (
        <div className="space-y-1.5">
          <PercentileBar label={t('sign.interest')} value={view.interest} />
          {view.factors.map((f) => (
            <PercentileBar
              key={f.key}
              label={t('sign.factor', {
                factor: t(`sign.factor.${f.key}` as MessageKey),
                weight: Math.round(f.weight * 100),
              })}
              value={f.score}
            />
          ))}
          <p className="text-xs text-muted">{t('sign.threshold', { n: view.threshold })}</p>
        </div>
      )}
      <div className="mt-3 flex items-center gap-3">
        <Button
          variant="primary"
          disabled={!view || view.interest < view.threshold || dispatch.isPending}
          onClick={() =>
            dispatch.mutate(
              { kind: 'contract.sign', playerId: player.id, teamId, salary, years },
              { onSuccess: (res) => setMessage(res.ok ? t('sign.done') : res.error.message) },
            )
          }
        >
          {t('sign.action')}
        </Button>
        {message && <span className="text-sm text-muted">{message}</span>}
      </div>
    </Card>
  );
}

/** Finished regular seasons, then this one so far. */
function Career({ player }: { player: PlayerProfile }) {
  const t = useT();
  const { data: past = [] } = useCareer(player.id);
  const { data: teams = [] } = useTeams();
  const rows = [
    ...past.map((l) => ({ label: String(l.season), teamId: l.teamId, stats: l.stats })),
    ...(Object.keys(player.stats).length
      ? [{ label: t('career.now'), teamId: player.teamId, stats: player.stats }]
      : []),
  ];
  if (rows.length === 0) return null;
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.stats)))];
  const abbr = (id: string | null) => teams.find((x) => x.id === id)?.abbreviation ?? '–';
  return (
    <Card title={t('career.title')}>
      <table className="tabular w-full text-xs">
        <thead>
          <tr className="border-b border-line text-right text-muted">
            <th className="py-1 text-left font-medium">{t('career.season')}</th>
            <th className="py-1 text-left font-medium">{t('roster.team')}</th>
            {keys.map((k) => (
              <th key={k} className="py-1 font-medium">
                {t(`stat.${k}` as MessageKey)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-line/50 text-right">
              <td className="py-1 text-left">{r.label}</td>
              <td className="py-1 text-left">{abbr(r.teamId)}</td>
              {keys.map((k) => (
                <td key={k} className="py-1">
                  {r.stats[k] === undefined ? '' : statValue(k, r.stats[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
