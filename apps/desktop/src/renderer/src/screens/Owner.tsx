import type { OwnerObjective } from '@gm/shared';
import { useDispatch, useOwnerReport, useStatus, useMine } from '@/lib/queries';
import { money } from '@/lib/format';
import { useT, type MessageKey } from '@/i18n';
import { BarLineChart, Button, Card, StatRow, Td, Th } from '@/ui';

/** Your owner: what he thinks of you, where the money goes, and every meeting so far. */
export function Owner() {
  const t = useT();
  const { data: league } = useStatus();
  const dispatch = useDispatch();
  const mine = useMine();
  const { data: report } = useOwnerReport(mine?.id);
  if (!mine) return <p className="text-muted">{t('owner.empty')}</p>;
  if (!report) return null;
  const { standing } = report;
  const objective = (o: OwnerObjective) =>
    t(`owner.objective.${o.kind}` as MessageKey, {
      n: o.target,
      pct: o.target.toFixed(3).replace(/^0/, ''),
      amount: money(o.target),
    });
  const status = (o: OwnerObjective) =>
    o.met === undefined ? t('owner.open') : o.met ? t('owner.met') : t('owner.missed');
  const labels = report.money.flatMap((m, i) =>
    i === 0 || report.money[i - 1]!.season !== m.season ? [{ at: i, text: String(m.season) }] : [],
  );

  return (
    <div className="max-w-5xl space-y-4">
      <Card title={report.owner.name}>
        <div className="grid grid-cols-3 gap-4">
          <StatRow
            label={t('owner.confidence')}
            value={`${Math.round(standing.confidence)} / 100`}
          />
          <StatRow label={t('owner.cash')} value={money(report.cash)} />
          <StatRow label={t('owner.budget')} value={money(standing.payrollBudget)} />
        </div>
        {league && (
          <div className="mt-3 flex items-center gap-3 text-sm text-muted">
            <span>{t('owner.canBeFired')}</span>
            <Button
              variant={league.canBeFired ? 'primary' : 'ghost'}
              onClick={() =>
                dispatch.mutate({ kind: 'league.setCanBeFired', on: !league.canBeFired })
              }
            >
              {t(league.canBeFired ? 'owner.canBeFired.on' : 'owner.canBeFired.off')}
            </Button>
          </div>
        )}
      </Card>
      <Card title={t('owner.chart')}>
        {report.money.length ? (
          <>
            <BarLineChart
              bars={report.money.map((m) => m.revenue - m.costs)}
              line={report.money.map((m) => m.cash)}
              labels={labels}
            />
            <p className="mt-2 text-xs text-muted">{t('owner.chartNote')}</p>
          </>
        ) : (
          <p className="text-sm text-muted">{t('owner.noMoney')}</p>
        )}
      </Card>
      <Card title={t('owner.objectives', { season: standing.season })}>
        <ul className="space-y-1 text-sm">
          {standing.objectives.map((o) => (
            <li key={o.kind} className="flex justify-between gap-4">
              <span>{objective(o)}</span>
              <span className={o.met === false ? 'text-bad' : o.met ? 'text-good' : 'text-muted'}>
                {status(o)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t('owner.history')}>
        <table className="tabular w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <Th>{t('owner.season')}</Th>
              <Th>{t('owner.meeting')}</Th>
              <Th>{t('owner.confidence')}</Th>
              <Th>{t('owner.objectivesShort')}</Th>
            </tr>
          </thead>
          <tbody>
            {[...report.meetings].reverse().map((m, i) => (
              <tr key={i} className="border-b border-line/50">
                <Td>{m.season}</Td>
                <Td>{t(`owner.meeting.${m.meeting}` as MessageKey)}</Td>
                <Td>{Math.round(m.confidence)}</Td>
                <Td>{m.objectives.map((o) => `${objective(o)}: ${status(o)}`).join(' · ')}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
