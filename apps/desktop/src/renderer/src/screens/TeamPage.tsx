import { useCapSheet, useLines, useOwner, useRoster, useTeams } from '@/lib/queries';
import { useUi } from '@/stores/ui';
import { useT, type MessageKey } from '@/i18n';
import { Button, Card, Td, Th } from '@/ui';
import { fullName, money, teamName } from '@/lib/format';
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
  const { data: owned } = useOwner(team?.id);
  if (!team) return <p className="text-muted">{t('team.empty')}</p>;
  const byId = new Map<string, (typeof roster)[number]>(roster.map((p) => [p.id, p]));
  const name = (id: string) => {
    const p = byId.get(id);
    return p ? fullName(p) : id;
  };

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center gap-3">
        <Button onClick={() => setScreen('standings')}>{t('team.back')}</Button>
        <h1 className="text-lg font-semibold">{teamName(teams, team.id)}</h1>
      </div>
      {owned && (
        <Card title={t('team.owner')}>
          <div className="grid gap-4 text-sm md:grid-cols-4">
            <div className="font-semibold">{owned.owner.name}</div>
            {(
              [
                ['team.owner.priority', `${Math.round(owned.owner.priority * 100)}%`],
                ['team.owner.patience', `${Math.round(owned.owner.patience * 100)}%`],
                ['team.owner.market', `×${owned.market.toFixed(2)}`],
              ] as const
            ).map(([key, value]) => (
              <div key={key}>
                <div className="text-muted">{t(key)}</div>
                <div className="tabular">{value}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
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
              <Th>{t('roster.player')}</Th>
              <Th>{t('roster.pos')}</Th>
              <Th>{t('roster.capHit')}</Th>
              <Th>{t('roster.through')}</Th>
            </tr>
          </thead>
          <tbody>
            {roster.map((p) => (
              <tr key={p.id} className="border-b border-line/50">
                <Td>{name(p.id)}</Td>
                <Td>{p.position}</Td>
                <Td>{p.contract ? money(p.contract.capHit) : ''}</Td>
                <Td>{p.contract?.expiresAfterSeason ?? ''}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {sheet && <Summary sheet={sheet} />}
    </div>
  );
}
