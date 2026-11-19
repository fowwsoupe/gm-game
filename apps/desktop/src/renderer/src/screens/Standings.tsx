import { useMemo, useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import type { PulseRow, StandingsRow, Team } from '@gm/shared';
import { usePulse, useStandings, useTeams } from '@/lib/queries';
import { useT, type MessageKey } from '@/i18n';
import { Button, Card, TeamLink, Td, Th } from '@/ui';
import { pct, teamName } from '@/lib/format';

type Row = StandingsRow & { team: Team | undefined; pulse: PulseRow | undefined; power: number };
const col = createColumnHelper<Row>();

function useColumns() {
  const t = useT();
  const { data: teams = [] } = useTeams();
  return [
    col.accessor((r) => teamName(teams, r.teamId), {
      id: 'team',
      header: t('standings.team'),
      cell: (c) => <TeamLink teamId={c.row.original.teamId}>{c.getValue()}</TeamLink>,
    }),
    col.accessor('gp', { header: t('standings.gp') }),
    col.accessor('w', { header: t('standings.w') }),
    col.accessor('l', { header: t('standings.l') }),
    col.accessor('otl', { header: t('standings.otl') }),
    col.accessor('pts', { header: t('standings.pts') }),
    col.accessor('gf', { header: t('standings.gf') }),
    col.accessor('ga', { header: t('standings.ga') }),
    col.accessor((r) => r.gf - r.ga, { id: 'diff', header: t('standings.diff') }),
    col.accessor((r) => r.pulse?.playoffOdds ?? 0, {
      id: 'odds',
      header: t('standings.odds'),
      cell: (c) => pct(c.getValue()),
    }),
    col.accessor('power', { header: t('standings.power') }),
    col.accessor((r) => r.pulse?.status ?? 'bubble', {
      id: 'status',
      header: t('standings.status'),
      cell: (c) => t(`status.${c.getValue()}` as MessageKey),
    }),
  ];
}

export function Standings() {
  const { data: rows = [] } = useStandings();
  const { data: teams = [] } = useTeams();
  const { data: pulse = [] } = usePulse();
  const t = useT();
  const [view, setView] = useState<'league' | 'conference' | 'division'>('league');

  const data = useMemo<Row[]>(() => {
    const byId = new Map(teams.map((t) => [t.id, t]));
    const pulseById = new Map(pulse.map((p) => [p.teamId, p]));
    // Power rank: 1 = highest rating.
    const order = [...pulse].sort((a, b) => b.rating - a.rating).map((p) => p.teamId);
    return rows.map((r) => ({
      ...r,
      team: byId.get(r.teamId),
      pulse: pulseById.get(r.teamId),
      power: order.indexOf(r.teamId) + 1,
    }));
  }, [rows, teams, pulse]);

  // Rows keep the standings order inside each group.
  const groups = new Map<string, Row[]>();
  for (const r of data) {
    const key = view === 'league' ? '' : (r.team?.[view] ?? '');
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const hasStructure = teams.some((x) => x.division || x.conference);

  return (
    <div className="space-y-4">
      {hasStructure && (
        <div className="flex gap-2">
          {(['league', 'conference', 'division'] as const).map((v) => (
            <Button key={v} variant={view === v ? 'primary' : 'ghost'} onClick={() => setView(v)}>
              {t(`standings.view.${v}`)}
            </Button>
          ))}
        </div>
      )}
      {[...groups].map(([name, rowsIn]) => (
        <Card key={name || 'league'} {...(name && { title: name })}>
          <StandingsTable data={rowsIn} />
        </Card>
      ))}
    </div>
  );
}

function StandingsTable({ data }: { data: Row[] }) {
  const columns = useColumns();
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <table className="tabular w-full text-sm">
      <thead>
        {table.getHeaderGroups().map((hg) => (
          <tr key={hg.id} className="border-b border-line text-left text-muted">
            {hg.headers.map((h) => (
              <Th
                key={h.id}
                left
                onClick={h.column.getToggleSortingHandler()}
                className="cursor-pointer hover:text-ink"
              >
                {flexRender(h.column.columnDef.header, h.getContext())}
                {{ asc: ' ▲', desc: ' ▼' }[h.column.getIsSorted() as string] ?? ''}
              </Th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr
            key={row.id}
            className={`border-b border-line/50 ${row.original.team?.userControlled ? 'text-accent' : ''}`}
          >
            {row.getVisibleCells().map((cell) => (
              <Td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</Td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
