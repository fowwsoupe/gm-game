import type { Department } from '@gm/shared';
import {
  useDepartmentReturns,
  useDispatch,
  useOwner,
  useStaffCandidates,
  useTeams,
} from '@/lib/queries';
import { money, qualityKey } from '@/lib/format';
import { useT } from '@/i18n';
import { Button, Card, Td, Th } from '@/ui';

const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
const DEPARTMENTS: readonly Department[] = [
  'scouting',
  'development',
  'medical',
  'analytics',
  'assistant',
];

/** Your front office: each department's head, and who you could hire in his place this season. */
export function FrontOffice() {
  const t = useT();
  const { data: teams = [] } = useTeams();
  const mine = teams.find((x) => x.userControlled);
  const { data: owned } = useOwner(mine?.id);
  const { data: candidates } = useStaffCandidates(mine?.id);
  const { data: returns } = useDepartmentReturns(mine?.id);
  const dispatch = useDispatch();
  if (!mine) return <p className="text-muted">{t('frontOffice.empty')}</p>;
  if (!owned || !candidates) return null;

  return (
    <div className="max-w-5xl space-y-4">
      <p className="text-sm text-muted">{t('frontOffice.intro')}</p>
      <Card title={t('team.coach')}>
        <div className="text-sm">
          <span className="font-semibold">{owned.coach.name}</span> ·{' '}
          {t(qualityKey(owned.coach.quality ?? 0.5))} · {money(owned.coach.salary)}
        </div>
      </Card>
      {DEPARTMENTS.map((d) => {
        const head = owned.staff[d];
        const open = candidates[d];
        if (!head || !open) return null;
        const hiredNow = open.locked;
        return (
          <Card key={d} title={t(`team.staff.${d}`)}>
            <div className="mb-3 text-sm">
              <span className="font-semibold">{head.name}</span> · {t(qualityKey(head.quality))} ·{' '}
              {money(head.salary)} · {t('frontOffice.since', { season: head.hired })}
            </div>
            {returns && d !== 'analytics' && (
              <p className="mb-3 text-xs text-muted">
                {d === 'assistant'
                  ? returns.assistant
                    ? t('frontOffice.return.assistant', {
                        n: returns.assistant.error.toFixed(1),
                        players: returns.assistant.players,
                      })
                    : t('frontOffice.return.none')
                  : d === 'scouting'
                    ? returns.scouting
                      ? t('frontOffice.return.scouting', {
                          n: returns.scouting.error.toFixed(1),
                          picks: returns.scouting.picks,
                          league: returns.scouting.league.toFixed(1),
                        })
                      : t('frontOffice.return.none')
                    : t(`frontOffice.return.${d}`, { n: signed(returns[d]) })}
              </p>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>{t('frontOffice.candidate')}</Th>
                  <Th>{t('frontOffice.quality')}</Th>
                  <Th>{t('team.coach.salary')}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {open.candidates.map((c, i) => (
                  <tr key={c.name + i}>
                    <Td>
                      {c.name}
                      {c.legend && ` (${t('frontOffice.legend')})`}
                    </Td>
                    <Td>{t(qualityKey(c.quality))}</Td>
                    <Td>{money(c.salary)}</Td>
                    <Td>
                      <Button
                        disabled={hiredNow}
                        onClick={() =>
                          dispatch.mutate({
                            kind: 'staff.hire',
                            teamId: mine.id,
                            department: d,
                            candidate: i,
                          })
                        }
                      >
                        {t('frontOffice.hire')}
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2">
              <Button
                disabled={hiredNow}
                onClick={() =>
                  dispatch.mutate({ kind: 'staff.fire', teamId: mine.id, department: d })
                }
              >
                {t('frontOffice.fire')}
              </Button>
            </div>
            {hiredNow && <p className="mt-2 text-xs text-muted">{t('frontOffice.hiredNow')}</p>}
          </Card>
        );
      })}
    </div>
  );
}
