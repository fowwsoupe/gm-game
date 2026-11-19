import { useEffect, useState } from 'react';
import { useUi } from '@/stores/ui';
import type { LeagueEvent, PlayerId, PlayerProfile, RosterPlayer, TeamId } from '@gm/shared';
import {
  useCareer,
  useFeed,
  useHistory,
  useDispatch,
  useOfferSheets,
  usePlayers,
  useProspects,
  useSigningInterest,
  useStatus,
  useTeams,
  useMine,
} from '@/lib/queries';
import { useT, type MessageKey } from '@/i18n';
import {
  Button,
  Card,
  Cutscene,
  Face,
  PercentileBar,
  PlayerCard,
  RangeBar,
  TeamSelect,
  Td,
  Th,
} from '@/ui';
import { fullName, leagueLineText, money, statValue, teamName } from '@/lib/format';

const FREE_AGENTS = 'fa';

/** A team's players (or the free agents) with stats; pick one to see his card. */
export function Roster({ freeAgents = false }: { freeAgents?: boolean }) {
  const t = useT();
  const { data: teams = [] } = useTeams();
  const mine = useMine()?.id;
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
    : ((picked && picked !== FREE_AGENTS ? picked : undefined) ?? mine ?? teams[0]?.id);
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
          <TeamSelect
            teams={teams}
            value={value}
            onChange={(id) => {
              setPicked(id);
              setSelected(undefined);
            }}
          />
        </label>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {freeAgents && <Room players={players} onSelect={setSelected} />}
          {players.length === 0 && <p className="text-sm text-muted">{t('roster.none')}</p>}
          {[...groups.values()].map((group) => (
            <PlayerTable
              key={group[0]!.id}
              players={group}
              selected={card?.id}
              onSelect={setSelected}
            />
          ))}
          {teamId && <Prospects teamId={teamId} mine={teamId === mine} />}
        </div>
        {freeAgents && <Sheets teamId={mine} />}
        {card && <Profile player={card} signFor={mine} />}
      </div>
    </div>
  );
}

/**
 * The free-agency room while the market is open: the free agents with offers on the table, best
 * first (his agent's word: who is bidding, the leading interest, days to his decision, where you
 * stand), and the day's signings and raises from its events.
 */
function Room({ players, onSelect }: { players: PlayerProfile[]; onSelect: (id: string) => void }) {
  const t = useT();
  const { data: status } = useStatus();
  const { data: teams = [] } = useTeams();
  const { data: feed } = useFeed(200, 'minor');
  if (!status?.market) return null;
  const abbr = (id: string) => teams.find((x) => x.id === id)?.abbreviation ?? '';
  const name = (id: string) => feed?.names[id] ?? '';
  const board = players
    .flatMap((p) => (p.bids ? [{ p, b: p.bids }] : []))
    .sort((x, y) => y.p.ask - x.p.ask);
  // The feed is newest first: today is everything since the day turned (or free agency opened).
  const events = feed?.events ?? [];
  const start = events.findIndex(
    (e) => e.kind === 'freeAgency.dayPassed' || e.kind === 'freeAgency.opened',
  );
  const today = events.slice(0, Math.max(0, start)).flatMap((e) =>
    e.kind === 'player.signed'
      ? [
          t('event.signed', {
            player: name(e.playerId),
            team: teamName(teams, e.teamId),
            amount: money(e.contract.capHit),
            season: e.contract.expiresAfterSeason,
          }),
        ]
      : e.kind === 'freeAgency.offered' && e.raise
        ? [
            t('room.raise', {
              team: teamName(teams, e.offer.teamId),
              player: name(e.offer.playerId),
            }),
          ]
        : [],
  );
  return (
    <Card title={t('room.title', { n: status.market.day })}>
      <p className="mb-2 text-xs text-muted">{t('room.note', { n: status.market.closing })}</p>
      {board.length === 0 ? (
        <p className="text-sm text-muted">{t('room.empty')}</p>
      ) : (
        <table className="tabular w-full text-sm">
          <thead>
            <tr className="border-b border-line text-right text-muted">
              <Th left>{t('roster.player')}</Th>
              <Th left>{t('roster.pos')}</Th>
              <Th>{t('resign.ask')}</Th>
              <Th left>{t('room.bidding')}</Th>
              <Th>{t('room.leading')}</Th>
              <Th>{t('room.days')}</Th>
              <Th>{t('room.you')}</Th>
            </tr>
          </thead>
          <tbody>
            {board.map(({ p, b }) => (
              <tr
                key={p.id}
                onClick={() => onSelect(p.id)}
                className="cursor-pointer border-b border-line/50 text-right hover:bg-panel-2"
              >
                <Td left>
                  <Face seed={p.id} age={p.age} size={22} />
                  {fullName(p)}
                </Td>
                <Td left>{p.position}</Td>
                <Td>{money(p.ask)}</Td>
                <Td left>{b.teams.map(abbr).join(', ')}</Td>
                <Td>{Math.max(b.best, b.mine?.interest ?? 0)}</Td>
                <Td>{b.days}</Td>
                <Td className={b.mine?.leads ? 'text-good' : 'text-bad'}>
                  {b.mine && t(b.mine.leads ? 'room.leads' : 'room.trails', { n: b.mine.interest })}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {today.length > 0 && (
        <div className="mt-3 space-y-0.5 border-t border-line pt-2 text-xs text-muted">
          <p className="font-medium text-ink">{t('room.today')}</p>
          {today.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
    </Card>
  );
}

/** A team's prospects: rights held, unsigned, off the roster. You sign yours to an entry deal. */
function Prospects({ teamId, mine }: { teamId: TeamId; mine: boolean }) {
  const t = useT();
  const { data: prospects = [] } = useProspects(teamId);
  const dispatch = useDispatch();
  const [message, setMessage] = useState<string | null>(null);
  if (prospects.length === 0) return null;
  return (
    <Card title={t('prospects.title')}>
      <p className="mb-2 text-xs text-muted">{t('prospects.note')}</p>
      <table className="tabular w-full text-sm">
        <thead>
          <tr className="border-b border-line text-right text-muted">
            <Th left>{t('roster.player')}</Th>
            <Th left>{t('roster.pos')}</Th>
            <Th>{t('roster.age')}</Th>
            <Th left>{t('prospects.league')}</Th>
            <Th className="w-1/4">{t('draft.range')}</Th>
            <Th left>{t('prospects.lastLine')}</Th>
            <Th>{t('prospects.rightsEnd')}</Th>
            {mine && <Th />}
          </tr>
        </thead>
        <tbody>
          {prospects.map((p) => (
            <tr key={p.id} className="border-b border-line/50 text-right">
              <Td left>
                <Face seed={p.id} age={p.age} size={22} />
                {fullName(p)}
              </Td>
              <Td left>{p.position}</Td>
              <Td>{p.age}</Td>
              <Td left>{t(`league.${p.league}` as MessageKey)}</Td>
              <Td>
                <RangeBar low={p.low} high={p.high} />
              </Td>
              <Td left className="text-xs text-muted">
                {p.line && `${p.line.season}: ${leagueLineText(p.line, (k) => t(k as MessageKey))}`}
              </Td>
              <Td>{p.rightsEnd}</Td>
              {mine && (
                <Td>
                  <Button
                    disabled={dispatch.isPending}
                    onClick={() =>
                      dispatch.mutate(
                        { kind: 'prospect.sign', teamId, playerId: p.id },
                        {
                          onSuccess: (res) =>
                            setMessage(res.ok ? t('sign.done') : res.error.message),
                        },
                      )
                    }
                  >
                    {t('prospects.sign')}
                  </Button>
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {message && <p className="mt-2 text-sm text-muted">{message}</p>}
    </Card>
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
                <Face seed={p.id} age={p.age} size={22} />
                {fullName(p)}
                {p.injuredUntil !== undefined && (
                  <span className="ml-2 text-xs text-bad">{t('roster.injuredShort')}</span>
                )}
                {p.league && (
                  <span className="ml-2 text-xs text-muted">
                    {t(`league.${p.league}` as MessageKey)}
                  </span>
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

export function Profile({
  player: p,
  signFor,
  standalone = false,
}: {
  player: PlayerProfile;
  signFor: TeamId | undefined;
  /** On the player's own page: no link to it. */
  standalone?: boolean;
}) {
  const t = useT();
  const [cut, setCut] = useState<string | null>(null);
  const strengths = [...p.percentiles].sort((a, b) => b.value - a.value).slice(0, 2);
  return (
    <div className="space-y-2">
      {cut && <Cutscene icon="✍️" text={cut} onDone={() => setCut(null)} />}
      <PlayerCard
        name={fullName(p)}
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
        {p.holdout && <HoldoutLine playerId={p.id} canTalk={p.teamId === signFor} />}
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
      {!standalone && <OpenProfile player={p} />}
      {p.teamId !== null && p.teamId === signFor && <BlockToggle player={p} teamId={signFor} />}
      {p.contract && p.teamId === signFor && <FarmToggle player={p} teamId={signFor} />}
      {p.training && p.teamId === signFor && (
        <TrainingPlan player={p} options={p.training.options} teamId={signFor} />
      )}
      {p.teamId === null && signFor && (
        <Offer key={p.id} player={p} teamId={signFor} onSigned={setCut} />
      )}
    </div>
  );
}

/**
 * Offer a free agent a contract, or with `resign` one of your players whose deal ends; his
 * interest meter moves as you type, and under his (hidden) line his agent answers with a counter.
 */
export function Offer({
  player,
  teamId,
  onSigned,
  resign,
}: {
  player: RosterPlayer & Pick<PlayerProfile, 'ask' | 'rightsTeamId' | 'bids'>;
  teamId: TeamId;
  onSigned?: (text: string) => void;
  resign?: boolean;
}) {
  const t = useT();
  const { data: teams = [] } = useTeams();
  // The box keeps what you type; the offer is that many millions, rounded to whole dollars.
  const [text, setText] = useState((player.ask / 1e6).toFixed(2));
  const salary = Math.round((Number(text) || 0) * 1e6);
  const [years, setYears] = useState(2);
  const [message, setMessage] = useState<string | null>(null);
  const [noTrade, setNoTrade] = useState(false);
  const [bonusPct, setBonusPct] = useState(0);
  const [promiseRole, setPromiseRole] = useState(false);
  const terms = {
    playerId: player.id,
    salary,
    years,
    ...(noTrade && { noTrade: true as const }),
    ...(bonusPct > 0 && { bonusPct }),
  };
  const pitch = !resign && promiseRole ? { promiseRole: true as const } : {};
  const { data: view } = useSigningInterest({
    ...terms,
    ...pitch,
    teamId,
    ...(resign && { resign: true as const }),
  });
  const dispatch = useDispatch();
  const reply = (ev: Extract<LeagueEvent, { kind: 'contract.countered' }>) =>
    ev.counter
      ? t('sign.counter', { amount: money(ev.counter) })
      : ev.holdsBack
        ? t(`sign.holdsBack.${ev.holdsBack}`)
        : t('sign.talksOff');
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
      {player.bids && (
        <div className="mb-2 space-y-0.5 text-sm">
          {player.bids.teams.length > 0 && (
            <p className="text-bad">
              {t('sign.bidding', {
                teams: player.bids.teams
                  .map((id) => teams.find((x) => x.id === id)?.abbreviation ?? '')
                  .join(', '),
                n: player.bids.best,
              })}
            </p>
          )}
          {player.bids.mine && (
            <p className={player.bids.mine.leads ? 'text-good' : 'text-bad'}>
              {t(player.bids.mine.leads ? 'sign.leading' : 'sign.trailing', {
                n: player.bids.mine.interest,
              })}
            </p>
          )}
          <p className="text-muted">{t('sign.decides', { n: player.bids.days })}</p>
        </div>
      )}
      {view?.sheet && (
        <p className={`mb-2 text-sm ${view.sheet.owned ? 'text-muted' : 'text-bad'}`}>
          {t(view.sheet.owned ? 'sign.sheetCost' : 'sign.sheetMissing', {
            picks: view.sheet.picks
              .map((id) => {
                const [season, round] = id.split('-');
                return t('sign.sheetPick', { season: season ?? '', round: round ?? '' });
              })
              .join(', '),
          })}
        </p>
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
          {t('sign.bonus')}
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            value={bonusPct}
            onChange={(e) => setBonusPct(Math.max(0, Math.round(Number(e.target.value) || 0)))}
            className="w-16 rounded border border-line bg-panel px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-1 text-muted">
          <input type="checkbox" checked={noTrade} onChange={(e) => setNoTrade(e.target.checked)} />
          {t('sign.noTrade')}
        </label>
        {!resign && (
          <label className="flex items-center gap-1 text-muted">
            <input
              type="checkbox"
              checked={promiseRole}
              onChange={(e) => setPromiseRole(e.target.checked)}
            />
            {t('sign.promise', { position: player.position })}
          </label>
        )}
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
          <p className={`text-xs ${view.talks > 0 ? 'text-muted' : 'text-bad'}`}>
            {view.talks > 0 ? t('sign.talks', { n: view.talks }) : t('sign.talksOff')}
          </p>
        </div>
      )}
      <div className="mt-3 flex items-center gap-3">
        <Button
          variant="primary"
          disabled={!view || view.talks === 0 || dispatch.isPending}
          onClick={() =>
            dispatch.mutate(
              resign
                ? { kind: 'contract.resign', ...terms }
                : { kind: 'contract.sign', teamId, ...terms, ...pitch },
              {
                onSuccess: (res) => {
                  const ev = res.ok ? res.events[0] : undefined;
                  if (res.ok && res.events.some((e) => e.kind === 'player.signed')) {
                    onSigned?.(
                      t('cutscene.signing', {
                        player: fullName(player),
                        team: teamName(teams, teamId),
                      }),
                    );
                  }
                  // His agent's counter goes in the box, ready to send back.
                  if (ev?.kind === 'contract.countered' && ev.counter) {
                    setText((ev.counter / 1e6).toFixed(2));
                  }
                  setMessage(
                    !res.ok
                      ? res.error.message
                      : ev?.kind === 'contract.countered'
                        ? reply(ev)
                        : ev?.kind === 'freeAgency.offered'
                          ? t('sign.pending')
                          : t('sign.done'),
                  );
                },
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

/** Finished regular seasons (a row per league: junior and Europe too), then this one so far. */
function Career({ player }: { player: PlayerProfile }) {
  const t = useT();
  const { data: past = [] } = useCareer(player.id);
  const { data: teams = [] } = useTeams();
  const { data: status } = useStatus();
  // Once a season is archived (playoffs over) its line is in `past`; "Now" would repeat it.
  const archived = past.some((l) => !l.league && l.season === status?.season);
  const rows = [
    ...past.map((l) => ({
      label: String(l.season),
      teamId: l.teamId,
      league: l.league,
      stats: l.stats,
    })),
    ...(Object.keys(player.stats).length && !archived
      ? [{ label: t('career.now'), teamId: player.teamId, league: undefined, stats: player.stats }]
      : []),
  ];
  if (rows.length === 0) return null;
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.stats)))];
  const abbr = (id: string | null) => teams.find((x) => x.id === id)?.abbreviation ?? '–';
  // Counting stats add up, main league only; a rate (save %) does not.
  const main = rows.filter((r) => !r.league);
  const totals: Record<string, number> = {};
  for (const k of keys.filter((k) => k !== 'savePct')) {
    totals[k] = main.reduce((sum, r) => sum + (r.stats[k] ?? 0), 0);
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
            <tr
              key={`${r.label}-${r.league ?? ''}`}
              className={`border-b border-line/50 text-right ${r.league ? 'text-muted' : ''}`}
            >
              <Td left>{r.label}</Td>
              <Td left>{r.league ? t(`league.${r.league}` as MessageKey) : abbr(r.teamId)}</Td>
              {keys.map((k) => (
                <Td key={k}>{r.stats[k] === undefined ? '' : statValue(k, r.stats[k])}</Td>
              ))}
            </tr>
          ))}
        </tbody>
        {main.length > 1 && (
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
                player: p ? fullName(p) : o.playerId,
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

/** Send one of your players down to a lower league (off the roster and the lineup) or call him up. */
function FarmToggle({ player, teamId }: { player: PlayerProfile; teamId: TeamId }) {
  const t = useT();
  const dispatch = useDispatch();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <Card>
      <div className="flex items-center gap-3">
        <Button
          disabled={dispatch.isPending}
          onClick={() =>
            dispatch.mutate(
              { kind: 'player.assign', teamId, playerId: player.id, down: !player.league },
              { onSuccess: (res) => setMessage(res.ok ? null : res.error.message) },
            )
          }
        >
          {t(player.league ? 'farm.up' : 'farm.down')}
        </Button>
        <span className="text-xs text-muted">{t('farm.note')}</span>
      </div>
      {message && <p className="mt-2 text-sm text-bad">{message}</p>}
    </Card>
  );
}

/** His summer training focus: reshapes his ratings at development, never past his ceiling. */
function TrainingPlan({
  player,
  options,
  teamId,
}: {
  player: PlayerProfile;
  options: string[];
  teamId: TeamId;
}) {
  const t = useT();
  const dispatch = useDispatch();
  return (
    <Card>
      <label className="flex items-center gap-2 text-sm">
        {t('training.label')}
        <select
          value={player.training?.focus ?? ''}
          disabled={dispatch.isPending}
          onChange={(e) =>
            dispatch.mutate({
              kind: 'training.set',
              teamId,
              playerId: player.id as PlayerId,
              focus: e.target.value || null,
            })
          }
          className="rounded border border-line bg-panel px-2 py-1 text-sm text-ink"
        >
          <option value="">{t('training.balanced')}</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {t(`training.${o}` as MessageKey)}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-1 text-xs text-muted">{t('training.note')}</p>
    </Card>
  );
}

/** He refuses to report: a talk (his own GM only) may bring him back, a new contract will. */
function HoldoutLine({ playerId, canTalk }: { playerId: PlayerId; canTalk: boolean }) {
  const t = useT();
  const dispatch = useDispatch();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <p className="mt-1 flex items-center gap-2 text-sm text-bad">
      {message ?? t('roster.holdout')}
      {canTalk && (
        <Button
          disabled={dispatch.isPending}
          onClick={() =>
            dispatch.mutate(
              { kind: 'holdout.talk', playerId },
              {
                onSuccess: (res) =>
                  setMessage(
                    !res.ok
                      ? res.error.message
                      : res.events.some((e) => e.kind === 'player.holdoutEnded')
                        ? t('roster.holdoutTalkWorked')
                        : t('roster.holdoutTalkFailed'),
                  ),
              },
            )
          }
        >
          {t('trade.talk')}
        </Button>
      )}
    </p>
  );
}

function OpenProfile({ player }: { player: PlayerProfile }) {
  const t = useT();
  const openPlayer = useUi((s) => s.openPlayer);
  return <Button onClick={() => openPlayer(player.teamId, player.id)}>{t('player.open')}</Button>;
}
