import { useState } from 'react';
import type { PlayerId } from '@gm/shared';
import { useDispatch, useDraftClass, useTeams, useTradeOffers } from '@/lib/queries';
import { useT, type MessageKey } from '@/i18n';
import { Button, Card, Face, RangeBar, Td, Th } from '@/ui';
import { fullName, pickParams, teamName } from '@/lib/format';
import { useUi } from '@/stores/ui';

/**
 * Draft board: the class as the scouts see it (a potential range, not the truth) and your
 * ranked wish list. Your picks take the first player still on your list.
 */
export function Draft() {
  const t = useT();
  const { data: teams = [] } = useTeams();
  const mine = teams.find((x) => x.userControlled)?.id;
  const { data } = useDraftClass(mine);
  const { data: offers = [] } = useTradeOffers(mine);
  const dispatch = useDispatch();
  const openTrade = useUi((s) => s.openTrade);
  const [error, setError] = useState<string | null>(null);
  if (!mine) return <p className="text-muted">{t('common.noTeam')}</p>;
  if (!data || data.prospects.length === 0) {
    return <p className="text-muted">{t('draft.empty')}</p>;
  }

  const clock = data.order[0];
  const myTurn = clock?.teamId === mine;
  const board = data.board as PlayerId[];
  // An AI team's call to trade up, open while your pick is on the clock.
  const call =
    myTurn && clock ? offers.find((o) => o.proposal.getPicks?.includes(clock.id)) : undefined;
  const pickName = (id: string) => {
    const o = data.order.find((x) => x.id === id);
    return o ? t('draft.pickNumber', { pick: o.pick }) : t('trade.pick', pickParams(teams, id));
  };
  const respond = (offerId: string, accept: boolean) =>
    dispatch.mutate(
      { kind: 'trade.respond', offerId, accept },
      { onSuccess: (res) => setError(res.ok ? null : res.error.message) },
    );
  const byId = new Map(data.prospects.map((p) => [p.id as string, p]));
  const save = (order: PlayerId[]) =>
    dispatch.mutate(
      { kind: 'draft.setBoard', teamId: mine, order },
      { onSuccess: (res) => setError(res.ok ? null : res.error.message) },
    );
  const move = (i: number, by: number) => {
    const next = [...board];
    const [id] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + by)), 0, id!);
    save(next);
  };

  return (
    <div className="grid max-w-6xl gap-4 lg:grid-cols-[1fr_22rem]">
      <Card title={t('draft.classTitle')}>
        {clock && (
          <p className={`mb-2 text-sm ${myTurn ? 'text-ink' : 'text-muted'}`}>
            {t(myTurn ? 'draft.yourPick' : 'draft.onClock', {
              pick: clock.pick,
              round: clock.round,
              team: teamName(teams, clock.teamId),
            })}
          </p>
        )}
        {call && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {t('draft.call', {
                team: teamName(teams, call.proposal.fromTeamId),
                give: (call.proposal.givePicks ?? []).map(pickName).join(', '),
              })}
            </span>
            <span className="flex gap-2">
              <Button
                variant="primary"
                disabled={dispatch.isPending}
                onClick={() => respond(call.id, true)}
              >
                {t('trade.accept')}
              </Button>
              <Button disabled={dispatch.isPending} onClick={() => respond(call.id, false)}>
                {t('trade.decline')}
              </Button>
            </span>
          </div>
        )}
        <p className="mb-2 text-xs text-muted">{t('draft.scoutNote')}</p>
        <table className="tabular w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <Th>#</Th>
              <Th>{t('roster.player')}</Th>
              <Th>{t('roster.pos')}</Th>
              <Th>{t('roster.age')}</Th>
              <Th className="w-1/4">{t('draft.range')}</Th>
              <Th left>{t('draft.report')}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.prospects.map((p, i) => (
              <tr key={p.id} className="border-b border-line/50">
                <Td className="text-muted">{i + 1}</Td>
                <Td>
                  <Face seed={p.id} age={p.age} size={22} />
                  {fullName(p)}
                </Td>
                <Td>{p.position}</Td>
                <Td>{p.age}</Td>
                <Td>
                  <RangeBar low={p.low} high={p.high} />
                </Td>
                <Td left className="text-xs text-muted">
                  {t('draft.reportLine', {
                    strengths: p.report.strengths
                      .map((k) => t(`rating.${k}` as MessageKey))
                      .join(', '),
                    weakness: t(`rating.${p.report.weakness}` as MessageKey),
                    ready: t(p.report.ready ? 'draft.ready' : 'draft.raw'),
                  })}
                </Td>
                <Td>
                  {myTurn ? (
                    <Button
                      variant="primary"
                      disabled={dispatch.isPending}
                      onClick={() =>
                        dispatch.mutate(
                          { kind: 'draft.pick', teamId: mine, playerId: p.id },
                          { onSuccess: (res) => setError(res.ok ? null : res.error.message) },
                        )
                      }
                    >
                      {t('draft.pick')}
                    </Button>
                  ) : board.includes(p.id) ? (
                    <span className="text-xs text-muted">{t('draft.onBoard')}</span>
                  ) : (
                    <Button disabled={dispatch.isPending} onClick={() => save([...board, p.id])}>
                      {t('draft.add')}
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="space-y-4">
        <Card title={t('draft.boardTitle')}>
          {board.length === 0 ? (
            <p className="text-sm text-muted">{t('draft.boardEmpty')}</p>
          ) : (
            <ol className="space-y-1 text-sm">
              {board.map((id, i) => {
                const p = byId.get(id);
                return (
                  <li key={id} className="flex items-center justify-between gap-2">
                    <span>
                      <span className="mr-2 text-muted">{i + 1}</span>
                      {p ? `${fullName(p)} (${p.position})` : id}
                    </span>
                    <span className="flex gap-1">
                      <Button disabled={i === 0 || dispatch.isPending} onClick={() => move(i, -1)}>
                        ↑
                      </Button>
                      <Button
                        disabled={i === board.length - 1 || dispatch.isPending}
                        onClick={() => move(i, 1)}
                      >
                        ↓
                      </Button>
                      <Button
                        disabled={dispatch.isPending}
                        onClick={() => save(board.filter((x) => x !== id))}
                      >
                        {t('draft.remove')}
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="mt-3 text-xs text-muted">{t('draft.boardNote')}</p>
          {error && <p className="mt-2 text-sm text-bad">{error}</p>}
        </Card>
        {clock && (
          <Card title={t('draft.orderTitle')}>
            <p className="mb-2 text-xs text-muted">{t('draft.orderNote')}</p>
            <ol className="max-h-96 space-y-1 overflow-y-auto text-sm">
              {data.order.map((o) => (
                <li
                  key={o.id}
                  className={`flex items-center justify-between gap-2 ${o.teamId === mine ? 'text-accent' : ''}`}
                >
                  <span>
                    {t('draft.orderLine', {
                      pick: o.pick,
                      round: o.round,
                      team: teamName(teams, o.teamId),
                    })}
                  </span>
                  {o.teamId !== mine && (
                    <Button onClick={() => openTrade(o.teamId, o.id)}>{t('draft.tradeFor')}</Button>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>
    </div>
  );
}
