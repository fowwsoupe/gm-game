import { useState } from 'react';
import type {
  CommandResult,
  DraftPick,
  PlayerId,
  PlayerProfile,
  ProspectEntry,
  TeamId,
  TradeOffer,
  TradeReason,
} from '@gm/shared';
import {
  useDispatch,
  usePicks,
  usePlayers,
  useProspects,
  useTeams,
  useTradeEvaluation,
  useTradeOffers,
  useTradeRequests,
  useMine,
} from '@/lib/queries';
import { useT, type MessageKey } from '@/i18n';
import { Button, Card, Face, RangeBar, TeamLink, TeamSelect, Td, Th } from '@/ui';
import { useUi } from '@/stores/ui';
import {
  fullName,
  money,
  moneyParams,
  pickParams,
  statValue,
  teamAbbr,
  teamName,
} from '@/lib/format';

/**
 * Build a trade with another team; its GM answers live, with reasons, before you send it. A
 * human GM's team (hot-seat) gets the trade as an offer he answers when he has the seat.
 */
export function Trades() {
  const t = useT();
  const { data: teams = [] } = useTeams();
  const mine = useMine();
  const others = teams.filter((x) => x.id !== mine?.id);
  const ask = useUi((s) => s.tradeAsk);
  const [partnerPick, setPartner] = useState(ask?.teamId as TeamId | undefined);
  const partner = partnerPick ?? others[0]?.id;
  const [give, setGive] = useState<PlayerId[]>([]);
  const [get, setGet] = useState<PlayerId[]>([]);
  /** Share of each given player's cap hit you keep paying (0 = none). */
  const [retain, setRetain] = useState<Record<string, number>>({});
  const [givePicks, setGivePicks] = useState<string[]>([]);
  const [getPicks, setGetPicks] = useState<string[]>(ask ? [ask.pickId] : []);
  /** Top-N protection on the first-round picks you give (0 = none). */
  const [protectTop, setProtectTop] = useState(0);
  const [giveProspects, setGiveProspects] = useState<PlayerId[]>([]);
  const [getProspects, setGetProspects] = useState<PlayerId[]>([]);
  const { data: myPicks = [] } = usePicks(mine?.id);
  const { data: theirPicks = [] } = usePicks(partner);
  const [message, setMessage] = useState<string | null>(null);
  const { data: myPlayers = [] } = usePlayers(mine?.id);
  const { data: theirPlayers = [] } = usePlayers(partner);
  const { data: myProspects = [] } = useProspects(mine?.id);
  // Their prospects as your scouts read them.
  const { data: theirProspects = [] } = useProspects(partner, mine?.id);
  const kept = give
    .filter((id) => (retain[id] ?? 0) > 0)
    .map((id) => ({ playerId: id, pct: retain[id]! }));
  const proposal =
    mine && partner
      ? {
          fromTeamId: mine.id,
          toTeamId: partner,
          give,
          get,
          ...(kept.length && { retain: kept }),
          ...(givePicks.length && { givePicks }),
          ...(getPicks.length && { getPicks }),
          ...(giveProspects.length && { giveProspects }),
          ...(getProspects.length && { getProspects }),
          ...(protectTop && givePicks.length && { protectTop }),
        }
      : undefined;
  const asked = [give, get, givePicks, getPicks, giveProspects, getProspects].some((l) => l.length);
  const { data: verdict } = useTradeEvaluation(proposal);
  const dispatch = useDispatch();
  const reasonText = useReasonText();
  const human = teams.find((x) => x.id === partner)?.userControlled;
  const clear = () => {
    setGive([]);
    setGet([]);
    setRetain({});
    setGivePicks([]);
    setGetPicks([]);
    setGiveProspects([]);
    setGetProspects([]);
  };
  /** The trade went through, or (human partner) went to his GM as an offer, or `refused`. */
  const outcome = (res: CommandResult, refused: string) => {
    if (!res.ok) return setMessage(res.error.message);
    const sent = res.events.some((e) => e.kind === 'trade.offered');
    if (!sent && !res.events.some((e) => e.kind === 'trade.completed')) return setMessage(refused);
    setMessage(sent ? t('trade.sent', { team: teamName(teams, partner!) }) : t('trade.done'));
    clear();
  };

  if (!mine || !partner) return <p className="text-muted">{t('trade.noTeam')}</p>;
  const toggle = (list: PlayerId[], set: (l: PlayerId[]) => void, id: PlayerId) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div className="max-w-6xl space-y-4">
      <label className="flex items-center gap-2 text-sm text-muted">
        {t('trade.partner')}
        <TeamSelect
          teams={others}
          value={partner}
          onChange={(id) => {
            setPartner(id as TeamId);
            setGet([]);
            setGetPicks([]);
            setGetProspects([]);
          }}
        />
        <TeamLink teamId={partner}>{t('team.view')}</TeamLink>
      </label>
      <Requests teamId={mine.id} />
      <Offers teamId={mine.id} />
      <Card title={t('trade.answerTitle')}>
        {!verdict || !asked ? (
          <p className="text-sm text-muted">{t('trade.pickPlayers')}</p>
        ) : (
          <>
            <p className={`font-semibold ${verdict.accepted ? 'text-good' : 'text-bad'}`}>
              {verdict.accepted ? t(human ? 'trade.theirCall' : 'trade.yes') : t('trade.no')}
            </p>
            {verdict.assistantGuess !== undefined && (
              <p className="mt-1 text-sm text-muted">
                {verdict.assistantGuess ? t('trade.guessYes') : t('trade.guessNo')}
              </p>
            )}
            <ul className="mt-2 space-y-1 text-sm">
              {verdict.reasons
                .filter((r) => !human || r.code !== 'accepted')
                .map((r, i) => (
                  <li key={i}>{reasonText(r)}</li>
                ))}
            </ul>
          </>
        )}
        <div className="mt-3 flex items-center gap-3">
          <Button
            variant="primary"
            disabled={!verdict?.accepted || dispatch.isPending}
            onClick={() =>
              proposal &&
              dispatch.mutate(
                { kind: 'trade.propose', proposal },
                { onSuccess: (res) => outcome(res, t('trade.done')) },
              )
            }
          >
            {t(human ? 'trade.send' : 'trade.propose')}
          </Button>
          {proposal && myPlayers.some((p) => give.includes(p.id) && p.contract?.noTrade) && (
            <Button
              disabled={dispatch.isPending}
              onClick={() =>
                dispatch.mutate(
                  { kind: 'contract.askWaiveNoTrade', proposal },
                  { onSuccess: (res) => outcome(res, t('trade.waiveNo')) },
                )
              }
            >
              {t('trade.askWaive')}
            </Button>
          )}
          {message && <span className="text-sm text-muted">{message}</span>}
        </div>
      </Card>
      {givePicks.length > 0 && (
        <label className="flex items-center gap-2 text-sm text-muted">
          {t('trade.protect')}
          <select
            value={protectTop}
            onChange={(e) => setProtectTop(Number(e.target.value))}
            className="rounded border border-line bg-panel px-2 py-1 text-ink"
          >
            {[0, 3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? t('trade.protectNone') : t('trade.protectTop', { n })}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Side
          title={t('trade.youGive')}
          players={myPlayers}
          picked={give}
          onToggle={(id) => toggle(give, setGive, id)}
          retain={retain}
          onRetain={(id, pct) => setRetain({ ...retain, [id]: pct })}
          picks={myPicks}
          pickedPicks={givePicks}
          onTogglePick={(id) => setGivePicks(togglePick(givePicks, id))}
          prospects={myProspects}
          pickedProspects={giveProspects}
          onToggleProspect={(id) => toggle(giveProspects, setGiveProspects, id)}
        />
        <Side
          title={t('trade.youGet')}
          players={theirPlayers}
          picked={get}
          onToggle={(id) => toggle(get, setGet, id)}
          picks={theirPicks}
          pickedPicks={getPicks}
          onTogglePick={(id) => setGetPicks(togglePick(getPicks, id))}
          prospects={theirProspects}
          pickedProspects={getProspects}
          onToggleProspect={(id) => toggle(getProspects, setGetProspects, id)}
        />
      </div>
    </div>
  );
}

function useReasonText() {
  const t = useT();
  return (r: TradeReason) => t(`trade.reason.${r.code}` as MessageKey, moneyParams(r.params));
}

const togglePick = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

/** Retention choices; the ruleset's limit is checked by the sim. */
const RETAIN_STEPS = [0, 10, 20, 30, 40, 50];

function Side({
  title,
  players,
  picked,
  onToggle,
  retain,
  onRetain,
  picks,
  pickedPicks,
  onTogglePick,
  prospects,
  pickedProspects,
  onToggleProspect,
}: {
  title: string;
  players: PlayerProfile[];
  picked: PlayerId[];
  onToggle: (id: PlayerId) => void;
  /** Only on your side: how much of a given player's cap hit you keep. */
  retain?: Record<string, number>;
  onRetain?: (id: PlayerId, pct: number) => void;
  picks: DraftPick[];
  pickedPicks: string[];
  onTogglePick: (id: string) => void;
  prospects: ProspectEntry[];
  pickedProspects: PlayerId[];
  onToggleProspect: (id: PlayerId) => void;
}) {
  const t = useT();
  const { data: teams = [] } = useTeams();
  return (
    <Card title={title}>
      <table className="tabular w-full text-sm">
        <thead>
          <tr className="border-b border-line text-right text-muted">
            <Th left>{t('roster.player')}</Th>
            <Th left>{t('roster.pos')}</Th>
            <Th>{t('roster.age')}</Th>
            <Th>{t('roster.capHit')}</Th>
            <Th>{t('roster.through')}</Th>
            <Th>{t('trade.stat')}</Th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            // Points for skaters, save % for goalies: whichever headline stat the line has.
            const key = 'points' in p.stats ? 'points' : 'savePct';
            return (
              <tr
                key={p.id}
                onClick={() => onToggle(p.id)}
                className={`cursor-pointer border-b border-line/50 text-right hover:bg-panel-2 ${picked.includes(p.id) ? 'bg-panel-2 text-accent' : ''}`}
              >
                <Td left>
                  <input
                    type="checkbox"
                    readOnly
                    checked={picked.includes(p.id)}
                    className="mr-2"
                  />
                  <Face seed={p.id} age={p.age} size={22} />
                  {fullName(p)}
                </Td>
                <Td left>{p.position}</Td>
                <Td>{p.age}</Td>
                <Td>
                  {p.contract ? money(p.contract.capHit) : ''}
                  {onRetain && picked.includes(p.id) && (
                    <select
                      aria-label={t('trade.retain')}
                      value={retain?.[p.id] ?? 0}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onRetain(p.id, Number(e.target.value))}
                      className="ml-2 rounded border border-line bg-panel px-1 text-xs"
                    >
                      {RETAIN_STEPS.map((s) => (
                        <option key={s} value={s}>
                          {t('trade.retainOption', { pct: s })}
                        </option>
                      ))}
                    </select>
                  )}
                </Td>
                <Td>{p.contract?.expiresAfterSeason ?? ''}</Td>
                <Td>{p.stats[key] === undefined ? '' : statValue(key, p.stats[key])}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {prospects.length > 0 && (
        <table className="tabular mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-line text-right text-muted">
              <Th left>{t('prospects.title')}</Th>
              <Th left>{t('roster.pos')}</Th>
              <Th>{t('roster.age')}</Th>
              <Th left>{t('prospects.league')}</Th>
              <Th className="w-1/4">{t('draft.range')}</Th>
            </tr>
          </thead>
          <tbody>
            {prospects.map((p) => (
              <tr
                key={p.id}
                onClick={() => onToggleProspect(p.id)}
                className={`cursor-pointer border-b border-line/50 text-right hover:bg-panel-2 ${pickedProspects.includes(p.id) ? 'bg-panel-2 text-accent' : ''}`}
              >
                <Td left>
                  <input
                    type="checkbox"
                    readOnly
                    checked={pickedProspects.includes(p.id)}
                    className="mr-2"
                  />
                  <Face seed={p.id} age={p.age} size={22} />
                  {fullName(p)}
                </Td>
                <Td left>{p.position}</Td>
                <Td>{p.age}</Td>
                <Td left>{t(`league.${p.league}` as MessageKey)}</Td>
                <Td>
                  <RangeBar low={p.low} high={p.high} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {picks.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <span className="text-muted">{t('trade.picks')}</span>
          {picks.map((pk) => (
            <label key={pk.id} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={pickedPicks.includes(pk.id)}
                onChange={() => onTogglePick(pk.id)}
              />
              {t('trade.pick', {
                season: pk.season,
                round: pk.round,
                team: teamAbbr(teams, pk.originalTeamId, pk.originalTeamId),
              })}
            </label>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Offers waiting for you (AI GMs, or hot-seat human GMs): what they send, what they want. */
function Offers({ teamId }: { teamId: TeamId }) {
  const t = useT();
  const { data: offers = [] } = useTradeOffers(teamId);
  const dispatch = useDispatch();
  const [message, setMessage] = useState<string | null>(null);
  if (offers.length === 0) return null;
  const respond = (offerId: string, accept: boolean) =>
    dispatch.mutate(
      { kind: 'trade.respond', offerId, accept },
      { onSuccess: (res) => setMessage(res.ok ? null : res.error.message) },
    );
  return (
    <Card title={t('trade.offersTitle')}>
      <ul className="space-y-2 text-sm">
        {offers.map((o) => (
          <OfferLine
            key={o.id}
            offer={o}
            teamId={teamId}
            busy={dispatch.isPending}
            onRespond={(accept) => respond(o.id, accept)}
          />
        ))}
      </ul>
      {message && <p className="mt-2 text-sm text-bad">{message}</p>}
    </Card>
  );
}

function OfferLine({
  offer: o,
  teamId,
  busy,
  onRespond,
}: {
  offer: TradeOffer;
  teamId: TeamId;
  busy: boolean;
  onRespond: (accept: boolean) => void;
}) {
  const t = useT();
  const { data: teams = [] } = useTeams();
  const { data: theirs = [] } = usePlayers(o.proposal.fromTeamId);
  const { data: ours = [] } = usePlayers(teamId);
  const { data: theirProspects = [] } = useProspects(o.proposal.fromTeamId, teamId);
  const { data: ourProspects = [] } = useProspects(teamId);
  const name = (list: (PlayerProfile | ProspectEntry)[], id: string) => {
    const p = list.find((x) => x.id === id);
    return p ? `${fullName(p)} (${p.position}, ${p.age})` : id;
  };
  const pick = (id: string) => t('trade.pick', pickParams(teams, id));
  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <span>
        <TeamLink teamId={o.proposal.fromTeamId}>{teamAbbr(teams, o.proposal.fromTeamId)}</TeamLink>{' '}
        {t('trade.offerLine', {
          team: teamName(teams, o.proposal.fromTeamId),
          give: [
            ...o.proposal.give.map((id) => name(theirs, id)),
            ...(o.proposal.giveProspects ?? []).map((id) => name(theirProspects, id)),
            ...(o.proposal.givePicks ?? []).map(pick),
          ].join(', '),
          get: [
            ...o.proposal.get.map((id) => name(ours, id)),
            ...(o.proposal.getProspects ?? []).map((id) => name(ourProspects, id)),
            ...(o.proposal.getPicks ?? []).map(pick),
          ].join(', '),
          day: o.expiresDay,
        })}
      </span>
      <span className="flex gap-2">
        <Button variant="primary" disabled={busy} onClick={() => onRespond(true)}>
          {t('trade.accept')}
        </Button>
        <Button disabled={busy} onClick={() => onRespond(false)}>
          {t('trade.decline')}
        </Button>
      </span>
    </li>
  );
}

/** Players who asked out: talk to them (it works on loyal, professional players) or trade them. */
function Requests({ teamId }: { teamId: TeamId }) {
  const t = useT();
  const { data: ids = [] } = useTradeRequests(teamId);
  const { data: players = [] } = usePlayers(teamId);
  const dispatch = useDispatch();
  const [message, setMessage] = useState<string | null>(null);
  if (ids.length === 0) return null;
  return (
    <Card title={t('trade.requestsTitle')}>
      <ul className="space-y-2 text-sm">
        {ids.map((id) => {
          const p = players.find((x) => x.id === id);
          return (
            <li key={id} className="flex flex-wrap items-center justify-between gap-2">
              <span>{t('trade.requestLine', { player: p ? fullName(p) : id })}</span>
              <Button
                disabled={dispatch.isPending}
                onClick={() =>
                  dispatch.mutate(
                    { kind: 'tradeRequest.talk', playerId: id as PlayerId },
                    {
                      onSuccess: (res) =>
                        setMessage(
                          res.ok
                            ? res.events.some((e) => e.kind === 'player.tradeRequestEnded')
                              ? t('trade.talkWorked')
                              : t('trade.talkFailed')
                            : res.error.message,
                        ),
                    },
                  )
                }
              >
                {t('trade.talk')}
              </Button>
            </li>
          );
        })}
      </ul>
      {message && <p className="mt-2 text-sm text-muted">{message}</p>}
    </Card>
  );
}
