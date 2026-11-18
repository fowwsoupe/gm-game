import { useState } from 'react';
import {
  GOALIE_ROTATIONS,
  SPECIAL_UNITS,
  type GoalieRotation,
  SPECIAL_UNIT_SIZE,
  type PlayerId,
  type PlayerProfile,
  type SpecialUnit,
} from '@gm/shared';
import { useDispatch, useLines, usePlayers, useTeams } from '@/lib/queries';
import { useT, type MessageKey } from '@/i18n';
import { Button, Card } from '@/ui';
import { fullName } from '@/lib/format';

/**
 * Your lines: the lineup the game dresses tonight. Drag a player onto another of his position to swap them (the arrow buttons do the same from the
 * keyboard) and change who plays where; the order is saved as your depth chart and used every game.
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
  if (!mine) return <p className="text-muted">{t('common.noTeam')}</p>;

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

  // Drag one player onto another of the same position to swap them.
  const swap = (a: string, b: string) => {
    const position = byId.get(a)?.position;
    if (!position || a === b || byId.get(b)?.position !== position) return;
    const list = orderOf(position);
    const i = list.indexOf(a);
    const j = list.indexOf(b);
    [list[i], list[j]] = [list[j]!, list[i]!];
    save(positions.flatMap((pos) => (pos === position ? list : orderOf(pos))));
  };

  // Power-play and penalty-kill units: pick who fills each slot from the skaters in tonight's lineup.
  const special = data?.special ?? {};
  const forwards = dressed.filter((id) => !['D', 'G'].includes(byId.get(id)?.position ?? ''));
  const defence = dressed.filter((id) => byId.get(id)?.position === 'D');
  const saveUnit = (unit: SpecialUnit, playerIds: string[]) =>
    dispatch.mutate(
      { kind: 'units.set', teamId: mine, unit, playerIds: playerIds as PlayerId[] },
      { onSuccess: (res) => setError(res.ok ? null : res.error.message) },
    );
  const swapIn = (unit: SpecialUnit, ids: string[], slot: number, id: string) =>
    saveUnit(
      unit,
      ids.map((x, i) => (i === slot ? id : x)),
    );

  const Row = ({ p }: { p: PlayerProfile }) => (
    <li
      draggable={!dispatch.isPending}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', p.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        swap(e.dataTransfer.getData('text/plain'), p.id);
      }}
      className="flex cursor-grab items-center justify-between gap-2"
    >
      <span>
        <span className="mr-2 text-xs text-muted">{p.position}</span>
        {fullName(p)}
        {p.injuredUntil !== undefined && (
          <span className="ml-2 text-xs text-bad">{t('roster.injuredShort')}</span>
        )}
      </span>
      <span className="flex gap-1">
        <Button
          aria-label={t('lines.moveUp')}
          disabled={dispatch.isPending}
          onClick={() => move(p.id, -1)}
        >
          ↑
        </Button>
        <Button
          aria-label={t('lines.moveDown')}
          disabled={dispatch.isPending}
          onClick={() => move(p.id, 1)}
        >
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
          <span className="ml-auto text-sm text-muted">
            {t('lines.fit', {
              forwards: Math.round(data.fit.forwards * 100),
              defense: Math.round(data.fit.defense * 100),
            })}
          </span>
        )}
        {data && (
          <span className="text-sm text-muted">
            {t('lines.together', {
              forwards: Math.round(data.together.forwards * 100),
              defense: Math.round(data.together.defense * 100),
            })}
          </span>
        )}
        {data && (
          <span className="text-sm">
            {t('lines.chemistry', {
              value: Math.round(data.chemistry.value * 100),
              seasons: data.chemistry.seasons.toFixed(1),
              leaders: data.chemistry.leaders,
            })}
          </span>
        )}
        {data && (
          <label className="flex items-center gap-2 text-sm text-muted">
            {t('lines.rotation')}
            <select
              value={data.rotation}
              disabled={dispatch.isPending}
              onChange={(e) =>
                dispatch.mutate({
                  kind: 'goalies.setRotation',
                  teamId: mine,
                  rotation: e.target.value as GoalieRotation,
                })
              }
              className="rounded border border-line bg-panel px-2 py-1 text-ink"
            >
              {GOALIE_ROTATIONS.map((r) => (
                <option key={r} value={r}>
                  {t(`lines.rotation.${r}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && <span className="text-sm text-bad">{error}</span>}
      </div>
      {data && data.disputes.length > 0 && (
        <Card title={t('lines.disputes')}>
          <ul className="space-y-2 text-sm">
            {data.disputes.map((d) => {
              const p = byId.get(d.playerId);
              const player = p ? fullName(p) : d.playerId;
              return (
                <li key={d.playerId} className="flex flex-wrap items-center justify-between gap-2">
                  {d.until === undefined ? (
                    <>
                      <span>{t('lines.disputeLine', { player })}</span>
                      <span className="flex gap-1">
                        {(['promise', 'patience', 'block'] as const).map((answer) => (
                          <Button
                            key={answer}
                            disabled={dispatch.isPending}
                            onClick={() =>
                              dispatch.mutate({
                                kind: 'dispute.talk',
                                playerId: d.playerId as PlayerId,
                                answer,
                              })
                            }
                          >
                            {t(`lines.dispute.${answer}`)}
                          </Button>
                        ))}
                      </span>
                    </>
                  ) : (
                    <span>{t('lines.disputePromised', { player, day: d.until })}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
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
        {SPECIAL_UNITS.map((unit) => {
          const u = special[unit];
          if (!u) return null;
          const isPp = unit.startsWith('pp');
          return (
            <Card key={unit} title={t(`lines.special.${unit}` as MessageKey)}>
              <ul className="space-y-1 text-sm">
                {u.playerIds.map((id, slot) => (
                  <li key={slot}>
                    <select
                      aria-label={t(`lines.special.${unit}` as MessageKey)}
                      value={id}
                      disabled={dispatch.isPending}
                      onChange={(e) => swapIn(unit, u.playerIds, slot, e.target.value)}
                      className="w-full rounded border border-line bg-panel px-1 py-0.5"
                    >
                      {(isPp
                        ? [...forwards, ...defence]
                        : slot < SPECIAL_UNIT_SIZE.pk.f
                          ? forwards
                          : defence
                      )
                        .filter((x) => x === id || !u.playerIds.includes(x))
                        .map((x) => {
                          const p = byId.get(x);
                          return (
                            <option key={x} value={x}>
                              {p ? `${p.position} ${fullName(p)}` : x}
                            </option>
                          );
                        })}
                    </select>
                  </li>
                ))}
              </ul>
              {u.custom && (
                <Button disabled={dispatch.isPending} onClick={() => saveUnit(unit, [])}>
                  {t('lines.special.auto')}
                </Button>
              )}
            </Card>
          );
        })}
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
