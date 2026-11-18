import { useState } from 'react';
import type { CapIssue, CapSheet, ResignOffer, RosterPlayer, TeamId } from '@gm/shared';
import { useCapSheet, useDispatch, useResignOffers, useRoster, useTeams } from '@/lib/queries';
import { useT } from '@/i18n';
import { Button, Card, TeamSelect, Td, Th } from '@/ui';
import { fullName, money } from '@/lib/format';
const issueAmount = (i: CapIssue) => ('over' in i ? i.over : i.short);
const years = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

export function Cap() {
  const t = useT();
  const { data: teams = [] } = useTeams();
  const [picked, setPicked] = useState<TeamId>();
  const teamId = picked ?? (teams.find((x) => x.userControlled) ?? teams[0])?.id;
  const { data: sheet } = useCapSheet(teamId);
  const { data: roster = [] } = useRoster(teamId);
  const { data: offers = [] } = useResignOffers(teamId);
  if (!teamId || !sheet) return <p className="text-muted">{t('cap.empty')}</p>;

  return (
    <div className="max-w-5xl space-y-4">
      <label className="flex items-center gap-2 text-sm text-muted">
        {t('roster.team')}
        <TeamSelect teams={teams} value={teamId} onChange={(id) => setPicked(id as TeamId)} />
      </label>
      <Advisor sheet={sheet} />
      <Summary sheet={sheet} />
      <Contracts sheet={sheet} roster={roster} />
      {teams.find((x) => x.id === teamId)?.userControlled && (
        <Resign offers={offers} roster={roster} sheet={sheet} />
      )}
    </div>
  );
}

function useIssueText() {
  const t = useT();
  return (season: number, i: CapIssue) =>
    t(`cap.issue.${i.code}`, { season, amount: money(issueAmount(i)) });
}

function Advisor({ sheet }: { sheet: CapSheet }) {
  const t = useT();
  const text = useIssueText();
  const lines = sheet.seasons.flatMap((s) => s.issues.map((i) => text(s.season, i)));
  return (
    <Card title={t('cap.advisorTitle')}>
      {lines.length === 0 ? (
        <p className="text-sm text-good">{t('cap.advisorOk')}</p>
      ) : (
        <ul className="space-y-1 text-sm text-bad">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted">{t('cap.advisorNote')}</p>
    </Card>
  );
}

export function Summary({ sheet }: { sheet: CapSheet }) {
  const t = useT();
  return (
    <Card title={t('cap.summaryTitle')}>
      <table className="tabular w-full text-sm">
        <thead>
          <tr className="border-b border-line text-right text-muted">
            <Th left>{t('cap.season')}</Th>
            <Th>{t('cap.committed')}</Th>
            <Th>{t('cap.deadCap')}</Th>
            <Th>{t('cap.total')}</Th>
            <Th>{t('cap.limit')}</Th>
            <Th>{t('cap.space')}</Th>
          </tr>
        </thead>
        <tbody>
          {sheet.seasons.map((s) => (
            <tr key={s.season} className="border-b border-line/50 text-right">
              <Td left>{s.season}</Td>
              <Td>{money(s.committed)}</Td>
              <Td>{money(s.deadCap)}</Td>
              <Td>{money(s.total)}</Td>
              <Td>{money(s.upperLimit)}</Td>
              <Td className={s.space < 0 ? 'text-bad' : ''}>{money(s.space)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

const nameOf = (p: RosterPlayer | undefined, fallback: string) =>
  p ? `${fullName(p)} (${p.position})` : fallback;

function Contracts({ sheet, roster }: { sheet: CapSheet; roster: RosterPlayer[] }) {
  const t = useT();
  const byId = new Map(roster.map((p) => [p.id, p]));
  // Rows come from the first season's order, then anyone only on later books.
  const ids = [...new Set(sheet.seasons.flatMap((s) => s.contracts.map((c) => c.playerId)))];
  return (
    <Card title={t('cap.contractsTitle')}>
      <table className="tabular w-full text-sm">
        <thead>
          <tr className="border-b border-line text-right text-muted">
            <Th left>{t('roster.player')}</Th>
            {sheet.seasons.map((s) => (
              <Th key={s.season}>{s.season}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ids.map((id) => (
            <tr key={id} className="border-b border-line/50 text-right">
              <Td left>{nameOf(byId.get(id), id)}</Td>
              {sheet.seasons.map((s) => {
                const c = s.contracts.find((x) => x.playerId === id);
                return <Td key={s.season}>{c ? money(c.capHit) : ''}</Td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Resign({
  offers,
  roster,
  sheet,
}: {
  offers: ResignOffer[];
  roster: RosterPlayer[];
  sheet: CapSheet;
}) {
  const t = useT();
  const text = useIssueText();
  const dispatch = useDispatch();
  const [term, setTerm] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(roster.map((p) => [p.id, p]));
  // No offers until the season is over, so this card only shows in the re-sign window.
  if (offers.length === 0) return null;

  return (
    <Card title={t('resign.title')}>
      <table className="tabular w-full text-sm">
        <tbody>
          {offers.map((o) => {
            const n = term[o.playerId] ?? Math.min(3, o.maxYears);
            const warns = o.issues
              .slice(0, n)
              .flatMap((list, i) => list.map((x) => text(sheet.seasons[i]!.season, x)));
            return (
              <tr key={o.playerId} className="border-b border-line/50 align-top">
                <Td>
                  {nameOf(byId.get(o.playerId), o.playerId)}
                  {warns.length > 0 && (
                    <p className="text-xs text-bad">
                      {t('resign.warn', { issues: warns.join('; ') })}
                    </p>
                  )}
                </Td>
                <Td>
                  {t('resign.ask')} {money(o.ask)}
                </Td>
                <Td>
                  <select
                    aria-label={t('resign.years')}
                    value={n}
                    onChange={(e) => setTerm({ ...term, [o.playerId]: Number(e.target.value) })}
                    className="rounded border border-line bg-panel px-2 py-1"
                  >
                    {years(o.maxYears).map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </Td>
                <Td>
                  <Button
                    disabled={dispatch.isPending}
                    onClick={() =>
                      dispatch.mutate(
                        { kind: 'contract.resign', playerId: o.playerId, years: n },
                        {
                          onSuccess: (res) =>
                            setError(res.ok ? null : `${t('resign.failed')} ${res.error.message}`),
                        },
                      )
                    }
                  >
                    {t('resign.action')}
                  </Button>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </Card>
  );
}
