import { useMemo, useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import type { StandingsRow, Team } from '@gm/shared';
import { useStandings, useTeams } from '@/lib/queries';

type Row = StandingsRow & { team: Team | undefined };
const col = createColumnHelper<Row>();

const columns = [
  col.accessor((r) => (r.team ? `${r.team.city} ${r.team.name}` : r.teamId), {
    id: 'team',
    header: 'Team',
  }),
  col.accessor('gp', { header: 'GP' }),
  col.accessor('w', { header: 'W' }),
  col.accessor('l', { header: 'L' }),
  col.accessor('otl', { header: 'OTL' }),
  col.accessor('pts', { header: 'PTS' }),
  col.accessor('gf', { header: 'GF' }),
  col.accessor('ga', { header: 'GA' }),
  col.accessor((r) => r.gf - r.ga, { id: 'diff', header: 'DIFF' }),
];

export function Standings() {
  const { data: rows = [] } = useStandings();
  const { data: teams = [] } = useTeams();
  const [sorting, setSorting] = useState<SortingState>([]);

  const data = useMemo<Row[]>(() => {
    const byId = new Map(teams.map((t) => [t.id, t]));
    return rows.map((r) => ({ ...r, team: byId.get(r.teamId) }));
  }, [rows, teams]);

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
              <th
                key={h.id}
                onClick={h.column.getToggleSortingHandler()}
                className="cursor-pointer px-3 py-2 font-medium hover:text-ink"
              >
                {flexRender(h.column.columnDef.header, h.getContext())}
                {{ asc: ' ▲', desc: ' ▼' }[h.column.getIsSorted() as string] ?? ''}
              </th>
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
              <td key={cell.id} className="px-3 py-1.5">
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
