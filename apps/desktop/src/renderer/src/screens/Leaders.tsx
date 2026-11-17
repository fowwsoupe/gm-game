import { useLeaders, useTeams } from '@/lib/queries';
import { useT, type MessageKey } from '@/i18n';
import { useUi } from '@/stores/ui';
import { Card } from '@/ui';

/** Stat leaders of the season so far. */
export function Leaders() {
  const t = useT();
  const { data: boards = [] } = useLeaders();
  const { data: teams = [] } = useTeams();
  const openPlayer = useUi((s) => s.openPlayer);
  const abbreviation = (id: string | null) => teams.find((x) => x.id === id)?.abbreviation ?? '';
  if (boards.every((b) => b.rows.length === 0)) {
    return <p className="text-muted">{t('leaders.empty')}</p>;
  }
  return (
    <div className="grid max-w-5xl gap-4 md:grid-cols-2">
      {boards.map((board) => (
        <Card key={board.key} title={t(`leaders.${board.key}` as MessageKey)}>
          <ol className="space-y-1 text-sm">
            {board.rows.map((r, i) => (
              <li key={r.playerId} className="flex justify-between gap-4">
                <span>
                  <span className="mr-2 text-muted">{i + 1}</span>
                  <button
                    className="hover:underline"
                    onClick={() => openPlayer(r.teamId, r.playerId)}
                  >
                    {r.name}
                  </button>{' '}
                  <span className="text-muted">{abbreviation(r.teamId)}</span>
                </span>
                <span>
                  {board.key === 'savePct' ? r.value.toFixed(3).slice(1) : r.value}
                  <span className="ml-2 text-muted">{t('leaders.gp', { gp: r.gp })}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      ))}
    </div>
  );
}
