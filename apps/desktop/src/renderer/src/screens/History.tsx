import { useAwards, useRecords, useTeams } from '@/lib/queries';
import { useT, type MessageKey } from '@/i18n';
import { Card } from '@/ui';

/** Champions and award winners, one card per season, newest first. */
export function History() {
  const t = useT();
  const { data: awards = [] } = useAwards();
  const { data: teams = [] } = useTeams();
  const { data: records = [] } = useRecords();
  const teamName = (id: string) => {
    const team = teams.find((x) => x.id === id);
    return team ? `${team.city} ${team.name}` : id;
  };
  if (awards.length === 0) return <p className="text-muted">{t('history.empty')}</p>;

  const seasons = [...new Set(awards.map((a) => a.season))];
  return (
    <div className="grid max-w-4xl gap-4 md:grid-cols-2">
      <Card title={t('history.records')}>
        <ul className="space-y-1 text-sm">
          {records.map((r) => (
            <li key={r.key} className="flex justify-between gap-4">
              <span className="text-muted">{t(`record.${r.key}` as MessageKey)}</span>
              <span>
                {r.key === 'playerSavePct' ? r.value.toFixed(3) : r.value} ·{' '}
                {r.playerName ?? teamName(r.teamId!)}
                {r.season ? ` (${r.season})` : ''}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      {seasons.map((season) => (
        <Card key={season} title={t('history.season', { season })}>
          <ul className="space-y-1 text-sm">
            {awards
              .filter((a) => a.season === season)
              .map((a) => (
                <li key={a.award} className="flex justify-between gap-4">
                  <span className="text-muted">{t(`award.${a.award}` as MessageKey)}</span>
                  <span>
                    {a.playerName ? `${a.playerName} (${teamName(a.teamId)})` : teamName(a.teamId)}
                  </span>
                </li>
              ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
