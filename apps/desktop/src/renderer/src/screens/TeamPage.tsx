import { useCapSheet, useLines, useRoster, useTeams } from '@/lib/queries';
import { useUi } from '@/stores/ui';
import { useT, type MessageKey } from '@/i18n';
import { Button, Card } from '@/ui';
import { money } from '@/lib/format';
import { Summary } from '@/screens/Cap';

/** Any team's roster, cap sheet and depth chart, built from the existing queries. */
export function TeamPage() {
  const t = useT();
  const { teamId, setScreen } = useUi();
  const { data: teams = [] } = useTeams();
  const team = teams.find((x) => x.id === teamId);
  const { data: roster = [] } = useRoster(team?.id);
  const { data: sheet } = useCapSheet(team?.id);
  const { data: lines } = useLines(team?.id);
  if (!team) return <p className="text-muted">{t('team.empty')}</p>;
  const byId = new Map<string, (typeof roster)[number]>(roster.map((p) => [p.id, p]));
  const name = (id: string) => {
    const p = byId.get(id);
    return p ? `${p.firstName} ${p.lastName}` : id;
  };

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center gap-3">
        <Button onClick={() => setScreen('standings')}>{t('team.back')}</Button>
        <h1 className="text-lg font-semibold">
          {team.city} {team.name}
        </h1>
      </div>
      <Card title={t('team.depth')}>
        <div className="grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-4">
          {lines?.units.map((u) => (
            <div key={u.unit}>
              <div className="mb-1 text-muted">
                {t(`lines.unit.${u.unit[0]}` as MessageKey, { n: u.unit.slice(1) })}
              </div>
              <ul>
                {u.playerIds.map((id) => (
                  <li key={id}>{name(id)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>
      <Card title={t('team.roster')}>
        <table className="tabular w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <th className="px-3 py-2 font-medium">{t('cap.player')}</th>
              <th className="px-3 py-2 font-medium">{t('team.pos')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('team.hit')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('team.thru')}</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((p) => (
              <tr key={p.id} className="border-b border-line/50">
                <td className="px-3 py-1.5">{name(p.id)}</td>
                <td className="px-3 py-1.5">{p.position}</td>
                <td className="px-3 py-1.5 text-right">
                  {p.contract ? money(p.contract.capHit) : ''}
                </td>
                <td className="px-3 py-1.5 text-right">{p.contract?.expiresAfterSeason ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {sheet && <Summary sheet={sheet} />}
    </div>
  );
}
