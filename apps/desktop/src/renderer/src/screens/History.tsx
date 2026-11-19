import { useAwards, useHallOfFame, useInternational, useRecords, useTeams } from '@/lib/queries';
import { statValue, teamName as nameOf } from '@/lib/format';
import { useT, type MessageKey } from '@/i18n';
import { Card } from '@/ui';

/** Champions and award winners, one card per season, newest first. */
export function History() {
  const t = useT();
  const { data: awards = [] } = useAwards();
  const { data: teams = [] } = useTeams();
  const { data: records = [] } = useRecords();
  const { data: legends = [] } = useHallOfFame();
  const { data: tournaments = [] } = useInternational();
  const nation = (n: string) => t(`nation.${n}` as MessageKey);
  const teamName = (id: string) => nameOf(teams, id);
  if (awards.length === 0) return <p className="text-muted">{t('history.empty')}</p>;

  const seasons = [...new Set(awards.map((a) => a.season))];
  return (
    <div className="grid max-w-4xl gap-4 md:grid-cols-2">
      {legends.length > 0 && (
        <Card title={t('history.hallOfFame')} className="md:col-span-2">
          <ul className="space-y-1 text-sm">
            {legends.map((h) => {
              const key = 'points' in h.totals ? 'points' : 'gp';
              const won = [...new Set(h.awards)].map((a) => {
                const n = h.awards.filter((x) => x === a).length;
                return `${t(`award.${a}` as MessageKey)}${n > 1 ? ` ×${n}` : ''}`;
              });
              return (
                <li key={h.playerId} className="flex justify-between gap-4">
                  <span>
                    {h.name} <span className="text-muted">({h.position})</span>
                  </span>
                  <span className="text-muted">
                    {t('history.hofLine', {
                      stat: `${t(`stat.${key}` as MessageKey)} ${statValue(key, h.totals[key] ?? 0)}`,
                      seasons: h.seasons,
                      retired: h.retiredSeason,
                    })}
                    {won.length > 0 && ` · ${won.join(', ')}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {tournaments.length > 0 && (
        <Card title={t('history.international')} className="md:col-span-2">
          <ul className="space-y-1 text-sm">
            {tournaments.map((x) => {
              const final = x.games[x.games.length - 1]!;
              const homeWon = final.home === x.champion;
              return (
                <li key={x.season} className="flex justify-between gap-4">
                  <span className="text-muted">{x.season}</span>
                  <span>
                    {t('history.internationalFinal', {
                      champion: nation(x.champion),
                      runnerUp: nation(homeWon ? final.away : final.home),
                      score: `${Math.max(final.homeScore, final.awayScore)}-${Math.min(final.homeScore, final.awayScore)}${final.overtime ? ` ${t('games.ot')}` : ''}`,
                    })}
                    {x.best &&
                      ` · ${t('history.internationalBest', {
                        player: x.best.name,
                        nation: nation(x.best.nation),
                        stat: `${x.best.value} ${t(`stat.${x.best.key}` as MessageKey)}`,
                      })}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <Card title={t('history.records')}>
        <ul className="space-y-1 text-sm">
          {records.map((r) => (
            <li key={r.key} className="flex justify-between gap-4">
              <span className="text-muted">{t(`record.${r.key}` as MessageKey)}</span>
              <span>
                {r.key === 'playerSavePct' ? statValue('savePct', r.value) : r.value} ·{' '}
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
                  <span className="text-muted">
                    {a.trophy
                      ? t('award.legendTrophy', { name: a.trophy })
                      : t(`award.${a.award}` as MessageKey)}
                  </span>
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
