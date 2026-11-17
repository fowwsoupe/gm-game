import { useState } from 'react';
import type { PlayerId } from '@gm/shared';
import { useDispatch, useDraftClass, useTeams } from '@/lib/queries';
import { useT, type MessageKey } from '@/i18n';
import { Button, Card, RangeBar, Td, Th } from '@/ui';

/**
 * Draft board: the class as the scouts see it (a potential range, not the truth) and your
 * ranked wish list. Your picks take the first player still on your list.
 */
export function Draft() {
  const t = useT();
  const { data: teams = [] } = useTeams();
  const mine = teams.find((x) => x.userControlled)?.id;
  const { data } = useDraftClass(mine);
  const dispatch = useDispatch();
  const [error, setError] = useState<string | null>(null);
  if (!mine) return <p className="text-muted">{t('trade.noTeam')}</p>;
  if (!data || data.prospects.length === 0) {
    return <p className="text-muted">{t('draft.empty')}</p>;
  }

  const board = data.board as PlayerId[];
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
                  {p.firstName} {p.lastName}
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
                  {board.includes(p.id) ? (
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
                    {p ? `${p.firstName} ${p.lastName} (${p.position})` : id}
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
    </div>
  );
}
