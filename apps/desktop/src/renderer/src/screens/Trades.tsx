import { useState } from 'react';
import type { PlayerId, PlayerProfile, TeamId, TradeReason } from '@gm/shared';
import { useDispatch, usePlayers, useTeams, useTradeEvaluation } from '@/lib/queries';
import { useT, type MessageKey } from '@/i18n';
import { Button, Card } from '@/ui';
import { money, statValue } from '@/lib/format';

/** Build a trade with another team; its GM answers live, with reasons, before you send it. */
export function Trades() {
  const t = useT();
  const { data: teams = [] } = useTeams();
  const mine = teams.find((x) => x.userControlled);
  const others = teams.filter((x) => x.id !== mine?.id);
  const [partnerPick, setPartner] = useState<TeamId>();
  const partner = partnerPick ?? others[0]?.id;
  const [give, setGive] = useState<PlayerId[]>([]);
  const [get, setGet] = useState<PlayerId[]>([]);
  /** Share of each given player's cap hit you keep paying (0 = none). */
  const [retain, setRetain] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<string | null>(null);
  const { data: myPlayers = [] } = usePlayers(mine?.id);
  const { data: theirPlayers = [] } = usePlayers(partner);
  const kept = give
    .filter((id) => (retain[id] ?? 0) > 0)
    .map((id) => ({ playerId: id, pct: retain[id]! }));
  const proposal =
    mine && partner
      ? { fromTeamId: mine.id, toTeamId: partner, give, get, ...(kept.length && { retain: kept }) }
      : undefined;
  const { data: verdict } = useTradeEvaluation(proposal);
  const dispatch = useDispatch();
  const reasonText = useReasonText();

  if (!mine || !partner) return <p className="text-muted">{t('trade.noTeam')}</p>;
  const toggle = (list: PlayerId[], set: (l: PlayerId[]) => void, id: PlayerId) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div className="max-w-6xl space-y-4">
      <label className="flex items-center gap-2 text-sm text-muted">
        {t('trade.partner')}
        <select
          value={partner}
          onChange={(e) => {
            setPartner(e.target.value as TeamId);
            setGet([]);
          }}
          className="rounded border border-line bg-panel px-2 py-1 text-ink"
        >
          {others.map((x) => (
            <option key={x.id} value={x.id}>
              {x.city} {x.name}
            </option>
          ))}
        </select>
      </label>
      <Card title={t('trade.answerTitle')}>
        {!verdict || give.length + get.length === 0 ? (
          <p className="text-sm text-muted">{t('trade.pickPlayers')}</p>
        ) : (
          <>
            <p className={`font-semibold ${verdict.accepted ? 'text-good' : 'text-bad'}`}>
              {verdict.accepted ? t('trade.yes') : t('trade.no')}
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {verdict.reasons.map((r, i) => (
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
                {
                  onSuccess: (res) => {
                    setMessage(res.ok ? t('trade.done') : res.error.message);
                    if (res.ok) {
                      setGive([]);
                      setGet([]);
                      setRetain({});
                    }
                  },
                },
              )
            }
          >
            {t('trade.propose')}
          </Button>
          {message && <span className="text-sm text-muted">{message}</span>}
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Side
          title={t('trade.youGive')}
          players={myPlayers}
          picked={give}
          onToggle={(id) => toggle(give, setGive, id)}
          retain={retain}
          onRetain={(id, pct) => setRetain({ ...retain, [id]: pct })}
        />
        <Side
          title={t('trade.youGet')}
          players={theirPlayers}
          picked={get}
          onToggle={(id) => toggle(get, setGet, id)}
        />
      </div>
    </div>
  );
}

function useReasonText() {
  const t = useT();
  return (r: TradeReason) => {
    const params = { ...r.params };
    if (typeof params.amount === 'number') params.amount = money(params.amount);
    return t(`trade.reason.${r.code}` as MessageKey, params);
  };
}

/** Retention choices; the ruleset's limit is checked by the sim. */
const RETAIN_STEPS = [0, 10, 20, 30, 40, 50];

function Side({
  title,
  players,
  picked,
  onToggle,
  retain,
  onRetain,
}: {
  title: string;
  players: PlayerProfile[];
  picked: PlayerId[];
  onToggle: (id: PlayerId) => void;
  /** Only on your side: how much of a given player's cap hit you keep. */
  retain?: Record<string, number>;
  onRetain?: (id: PlayerId, pct: number) => void;
}) {
  const t = useT();
  return (
    <Card title={title}>
      <table className="tabular w-full text-sm">
        <thead>
          <tr className="border-b border-line text-right text-muted">
            <th className="px-2 py-1 text-left font-medium">{t('roster.player')}</th>
            <th className="px-2 py-1 text-left font-medium">{t('roster.pos')}</th>
            <th className="px-2 py-1 font-medium">{t('roster.age')}</th>
            <th className="px-2 py-1 font-medium">{t('roster.capHit')}</th>
            <th className="px-2 py-1 font-medium">{t('roster.through')}</th>
            <th className="px-2 py-1 font-medium">{t('trade.stat')}</th>
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
                <td className="px-2 py-1 text-left">
                  <input
                    type="checkbox"
                    readOnly
                    checked={picked.includes(p.id)}
                    className="mr-2"
                  />
                  {p.firstName} {p.lastName}
                </td>
                <td className="px-2 py-1 text-left">{p.position}</td>
                <td className="px-2 py-1">{p.age}</td>
                <td className="px-2 py-1">
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
                </td>
                <td className="px-2 py-1">{p.contract?.expiresAfterSeason ?? ''}</td>
                <td className="px-2 py-1">
                  {p.stats[key] === undefined ? '' : statValue(key, p.stats[key])}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
