import { useEffect, useState } from 'react';
import { useUi } from '@/stores/ui';
import type { PlayerId, PlayerProfile, TeamId } from '@gm/shared';
import {
  useCareer,
  useHistory,
  useDispatch,
  useOfferSheets,
  usePlayers,
  useSigningInterest,
  useStatus,
  useTeams,
} from '@/lib/queries';
import { useT, type MessageKey } from '@/i18n';
import { Button, Card, Face, PercentileBar, PlayerCard, Td, Th } from '@/ui';
import { money, statValue } from '@/lib/format';

const FREE_AGENTS = 'fa';

/** A team's players (or the free agents) with stats; pick one to see his card. */
export function Roster({ freeAgents = false }: { freeAgents?: boolean }) {
  const t = useT();
  const { data: teams = [] } = useTeams();
  const focus = useUi((s) => s.focus);
  const [picked, setPicked] = useState<string | undefined>(focus?.teamId);
  const [selected, setSelected] = useState<string | undefined>(focus?.playerId);
  useEffect(() => {
    if (!focus) return;
    setPicked(focus.teamId);
    setSelected(focus.playerId);
  }, [focus]);
  const value = freeAgents
    ? FREE_AGENTS
    : ((picked && picked !== FREE_AGENTS ? picked : undefined) ??
      (teams.find((x) => x.userControlled) ?? teams[0])?.id);
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
      {freeAgents && <h1 className="text-lg font-semibold">{t('roster.freeAgents')}</h1>}
      {!freeAgents && (
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
          </select>
        </label>
      )}
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
        {freeAgents && <Sheets teamId={teams.find((x) => x.userControlled)?.id} />}
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
            <Th left>{t('roster.player')}</Th>
            <Th left>{t('roster.pos')}</Th>
            <Th>{t('roster.age')}</Th>
            <Th>{t('roster.capHit')}</Th>
            <Th>{t('roster.through')}</Th>
            {statKeys.map((k) => (
              <Th key={k}>{t(`stat.${k}` as MessageKey)}</Th>
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
              <Td left>
                {p.firstName} {p.lastName}
                {p.injuredUntil !== undefined && (
                  <span className="ml-2 text-xs text-bad">{t('roster.injuredShort')}</span>
                )}
              </Td>
              <Td left>{p.position}</Td>
              <Td>{p.age}</Td>
              <Td>{p.contract ? money(p.contract.capHit) : ''}</Td>
              <Td>{p.contract?.expiresAfterSeason ?? ''}</Td>
              {statKeys.map((k) => (
                <Td key={k}>{p.stats[k] === undefined ? '' : statValue(k, p.stats[k])}</Td>
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
        face={<Face seed={p.id} age={p.age} />}
        subtitle={`${t('roster.subtitle', { position: p.position, age: p.age })} · ${t(`build.${p.build}` as MessageKey)}`}
        bars={[
          ...p.percentiles.map((x) => ({
            label: t(`rating.${x.key}` as MessageKey),
            value: x.value,
          })),
          ...(p.morale ? [{ label: t('morale.label'), value: p.morale.value }] : []),
        ]}
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
        {p.tags.length + p.traits.length > 0 && (
          <p className="mt-2 flex flex-wrap gap-1">
            {p.tags.map((tag) => (
              <span key={tag} className="rounded-full border border-line px-2 py-0.5 text-xs">
                {t(`tag.${tag}` as MessageKey)}
              </span>
            ))}
            {p.traits.map((trait) => (
              <span
                key={trait}
                className="rounded-full border border-line px-2 py-0.5 text-xs text-muted"
              >
                {t(`trait.${trait}` as MessageKey)}
              </span>
            ))}
          </p>
        )}
        {p.morale && (
          <p className="mt-1 text-xs text-muted">
            {p.morale.factors
              .map((f) => `${t(`morale.${f.key}` as MessageKey)} ${f.score}`)
              .join(' · ')}
          </p>
        )}
        {p.injuredUntil !== undefined && (
          <p className="mt-1 text-sm text-bad">{t('roster.injured', { day: p.injuredUntil })}</p>
        )}
        {p.injuryHistory && (
          <p className="mt-1 text-xs text-muted">
            {t('roster.injuryHistory', {
              count: p.injuryHistory.count,
              days: p.injuryHistory.days,
            })}
          </p>
        )}
      </Card>
      <Career player={p} />
      {p.teamId !== null && p.teamId === signFor && <BlockToggle player={p} teamId={signFor} />}
      {p.teamId === null && signFor && <Offer key={p.id} player={p} teamId={signFor} />}
    </div>
  );
}

/** Offer a free agent a contract; his interest meter answers before you send it. */
function Offer({ player, teamId }: { player: PlayerProfile; teamId: TeamId }) {
  const t = useT();
  const { data: teams = [] } = useTeams();
  // The box keeps what you type; the offer is that many millions, rounded to whole dollars.
  const [text, setText] = useState((player.ask / 1e6).toFixed(2));
  const salary = Math.round((Number(text) || 0) * 1e6);
  const [years, setYears] = useState(2);
  const [message, setMessage] = useState<string | null>(null);
  const [noTrade, setNoTrade] = useState(false);
  const { data: view } = useSigningInterest({
    playerId: player.id,
    teamId,
    salary,
    years,
    ...(noTrade && { noTrade: true as const }),
  });
  const dispatch = useDispatch();
  return (
    <Card title={t('sign.title')}>
      <p className="mb-2 text-sm text-muted">{t('sign.ask', { amount: money(player.ask) })}</p>
      {player.rightsTeamId && (
        <p className="mb-2 text-sm text-muted">
          {t('sign.rights', {
            team: teams.find((x) => x.id === player.rightsTeamId)?.abbreviation ?? '',
          })}
        </p>
      )}
      {player.rivalOffers > 0 && (
        <p className="mb-2 text-sm text-bad">{t('sign.rivals', { n: player.rivalOffers })}</p>
      )}
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
        <label className="flex items-center gap-1 text-muted">
          <input type="checkbox" checked={noTrade} onChange={(e) => setNoTrade(e.target.checked)} />
          {t('sign.noTrade')}
        </label>
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
              {
                kind: 'contract.sign',
                playerId: player.id,
                teamId,
                salary,
                years,
                ...(noTrade && { noTrade: true as const }),
              },
              {
                onSuccess: (res) =>
                  setMessage(
                    !res.ok
                      ? res.error.message
                      : res.events[0]?.kind === 'freeAgency.offered'
                        ? t('sign.pending')
                        : t('sign.done'),
                  ),
              },
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
  const { data: status } = useStatus();
  // Once a season is archived (playoffs over) its line is in `past`; "Now" would repeat it.
  const archived = past.some((l) => l.season === status?.season);
  const rows = [
    ...past.map((l) => ({ label: String(l.season), teamId: l.teamId, stats: l.stats })),
    ...(Object.keys(player.stats).length && !archived
      ? [{ label: t('career.now'), teamId: player.teamId, stats: player.stats }]
      : []),
  ];
  if (rows.length === 0) return null;
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.stats)))];
  const abbr = (id: string | null) => teams.find((x) => x.id === id)?.abbreviation ?? '–';
  // Counting stats add up; a rate (save %) does not.
  const totals: Record<string, number> = {};
  for (const k of keys.filter((k) => k !== 'savePct')) {
    totals[k] = rows.reduce((sum, r) => sum + (r.stats[k] ?? 0), 0);
  }
  return (
    <Card title={t('career.title')}>
      <table className="tabular w-full text-xs">
        <thead>
          <tr className="border-b border-line text-right text-muted">
            <Th left>{t('career.season')}</Th>
            <Th left>{t('roster.team')}</Th>
            {keys.map((k) => (
              <Th key={k}>{t(`stat.${k}` as MessageKey)}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-line/50 text-right">
              <Td left>{r.label}</Td>
              <Td left>{abbr(r.teamId)}</Td>
              {keys.map((k) => (
                <Td key={k}>{r.stats[k] === undefined ? '' : statValue(k, r.stats[k])}</Td>
              ))}
            </tr>
          ))}
        </tbody>
        {rows.length > 1 && (
          <tfoot>
            <tr className="border-t border-line text-right font-medium">
              <Td left>{t('career.totals')}</Td>
              <Td />
              {keys.map((k) => (
                <Td key={k}>{totals[k] === undefined ? '' : statValue(k, totals[k])}</Td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      <History playerId={player.id} abbr={abbr} />
    </Card>
  );
}

/** Awards and moves (drafted, signed, traded...) from his story so far. */
function History({ playerId, abbr }: { playerId: string; abbr: (id: string | null) => string }) {
  const t = useT();
  const { data } = useHistory(playerId);
  if (!data || data.awards.length + data.moves.length === 0) return null;
  return (
    <div className="mt-3 space-y-1 border-t border-line pt-2 text-xs">
      {data.awards.length > 0 && (
        <p>
          {data.awards.map((a) => `${a.season} ${t(`award.${a.award}` as MessageKey)}`).join(' · ')}
        </p>
      )}
      {data.moves.map((m, i) => (
        <p key={i} className="text-muted">
          {t(`move.${m.kind}` as MessageKey, {
            season: m.season,
            team: abbr(m.teamId),
            amount: m.capHit === undefined ? '' : money(m.capHit),
          })}
        </p>
      ))}
    </div>
  );
}

/** Offer sheets other teams gave your restricted free agents: match them or let him go. */
function Sheets({ teamId }: { teamId: TeamId | undefined }) {
  const t = useT();
  const { data: sheets = [] } = useOfferSheets(teamId);
  const { data: teams = [] } = useTeams();
  const { data: players = [] } = usePlayers(null);
  const dispatch = useDispatch();
  if (!teamId || sheets.length === 0) return null;
  return (
    <Card title={t('sheet.title')} className="lg:col-span-2">
      <p className="mb-2 text-sm text-muted">{t('sheet.hint')}</p>
      {sheets.map((o) => {
        const p = players.find((x) => x.id === o.playerId);
        const from = teams.find((x) => x.id === o.teamId);
        return (
          <div key={o.playerId} className="flex items-center gap-3 py-1 text-sm">
            <span className="flex-1">
              {t('sheet.line', {
                team: from?.abbreviation ?? '',
                player: p ? `${p.firstName} ${p.lastName}` : o.playerId,
                amount: money(o.salary),
                years: o.years,
              })}
            </span>
            <Button
              variant="primary"
              disabled={dispatch.isPending}
              onClick={() =>
                dispatch.mutate({ kind: 'freeAgency.matchSheet', playerId: o.playerId, teamId })
              }
            >
              {t('sheet.match')}
            </Button>
            <Button
              disabled={dispatch.isPending}
              onClick={() =>
                dispatch.mutate({ kind: 'freeAgency.declineSheet', playerId: o.playerId, teamId })
              }
            >
              {t('sheet.decline')}
            </Button>
          </div>
        );
      })}
    </Card>
  );
}

/** List a player as available: AI GMs then call about him more often. */
function BlockToggle({ player, teamId }: { player: PlayerProfile; teamId: TeamId }) {
  const t = useT();
  const dispatch = useDispatch();
  return (
    <Card>
      <div className="flex items-center gap-3">
        <Button
          disabled={dispatch.isPending}
          onClick={() =>
            dispatch.mutate({
              kind: 'trade.block',
              teamId,
              playerId: player.id as PlayerId,
              onBlock: !player.onBlock,
            })
          }
        >
          {t(player.onBlock ? 'block.remove' : 'block.add')}
        </Button>
        <span className="text-xs text-muted">{t('block.note')}</span>
      </div>
    </Card>
  );
}
