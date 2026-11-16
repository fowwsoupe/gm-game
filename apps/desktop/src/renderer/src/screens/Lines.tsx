import { useState } from 'react';
import type { PlayerId, PlayerProfile } from '@gm/shared';
import { useDispatch, useLines, usePlayers, useTeams } from '@/lib/queries';
import { useT, type MessageKey } from '@/i18n';
import { Button, Card } from '@/ui';

/**
 * Your lines: the lineup the game dresses tonight. Move a player up or down among his position
 * to change who plays where; the order is saved as your depth chart and used every game.
 */
export function Lines() {
  const t = useT();
  const { data: teams = [] } = useTeams();
  const mine = teams.find((x) => x.userControlled)?.id;
  const { data } = useLines(mine);
  const units = data?.units ?? [];
  const { data: players = [] } = usePlayers(mine);
  const dispatch = useDispatch();
  const [error, setError] = useState<string | null>(null);
  if (!mine) return <p className="text-muted">{t('trade.noTeam')}</p>;

  const byId = new Map(players.map((p) => [p.id as string, p]));
  const dressed = units.flatMap((u) => u.playerIds);
  const scratches = players.filter((p) => !dressed.includes(p.id));
  // Each position's order: as dressed, then healthy scratches, then the injured.
  const positions = [...new Set(players.map((p) => p.position))];
  const orderOf = (position: string) => [
    ...dressed.filter((id) => byId.get(id)?.position === position),
    ...scratches
      .filter((p) => p.position === position)
      .sort((a, b) => Number(a.injuredUntil !== undefined) - Number(b.injuredUntil !== undefined))
      .map((p) => p.id as string),
  ];
  const save = (order: string[]) =>
    dispatch.mutate(
      { kind: 'lines.set', teamId: mine, order: order as PlayerId[] },
      { onSuccess: (res) => setError(res.ok ? null : res.error.message) },
    );
  const move = (id: string, by: -1 | 1) => {
    const position = byId.get(id)?.position;
    if (!position) return;
    const list = orderOf(position);
    const i = list.indexOf(id);
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    save(positions.flatMap((pos) => (pos === position ? list : orderOf(pos))));
  };

  const Row = ({ p }: { p: PlayerProfile }) => (
    <li className="flex items-center justify-between gap-2">
      <span>
        <span className="mr-2 text-xs text-muted">{p.position}</span>
        {p.firstName} {p.lastName}
        {p.injuredUntil !== undefined && (
          <span className="ml-2 text-xs text-bad">{t('roster.injuredShort')}</span>
        )}
      </span>
      <span className="flex gap-1">
        <Button disabled={dispatch.isPending} onClick={() => move(p.id, -1)}>
          ↑
        </Button>
        <Button disabled={dispatch.isPending} onClick={() => move(p.id, 1)}>
          ↓
        </Button>
      </span>
    </li>
  );

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex items-center gap-3">
        <Button disabled={dispatch.isPending} onClick={() => save([])}>
          {t('lines.auto')}
        </Button>
        <span className="text-sm text-muted">{t('lines.note')}</span>
        {data && (
          <span className="ml-auto text-sm">
            {t('lines.chemistry', {
              value: Math.round(data.chemistry.value * 100),
              seasons: data.chemistry.seasons.toFixed(1),
            })}
          </span>
        )}
        {error && <span className="text-sm text-bad">{error}</span>}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {units.map((u) => (
          <Card
            key={u.unit}
            title={t(`lines.unit.${u.unit[0]}` as MessageKey, { n: u.unit.slice(1) })}
          >
            <ul className="space-y-1 text-sm">
              {u.playerIds.map((id) => {
                const p = byId.get(id);
                return p ? <Row key={id} p={p} /> : null;
              })}
            </ul>
          </Card>
        ))}
        {scratches.length > 0 && (
          <Card title={t('lines.scratches')}>
            <ul className="space-y-1 text-sm">
              {scratches.map((p) => (
                <Row key={p.id} p={p} />
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
