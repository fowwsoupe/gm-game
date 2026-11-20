import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Face } from './graphics';
import { flagOf, tierOf } from './profile';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { CAP, fmtM, type Player } from './mock';
import { F, Num, Rate, Roll, Segmented, useRowActions } from './parts';
import { useFacts, usePv } from './store';

const col = createColumnHelper<Player>();
const LEFT = new Set(['num', 'name', 'pos']);
const HIDE_SMALL = new Set(['xgf']);
const cls = (id: string) => `${LEFT.has(id) ? 'l' : ''} ${HIDE_SMALL.has(id) ? 'hide-s' : ''}`;
const LINE_ORDER = ['F1', 'F2', 'F3', 'F4', 'D1', 'D2', 'D3', 'G1', 'G2', 'X'];
const LINE_NAME: Record<string, string> = {
  F1: 'Line 1',
  F2: 'Line 2',
  F3: 'Line 3',
  F4: 'Line 4',
  D1: 'Pair 1',
  D2: 'Pair 2',
  D3: 'Pair 3',
  G1: 'Starter',
  G2: 'Backup',
  X: 'Scratch',
};

const columns = [
  col.accessor((p) => LINE_ORDER.indexOf(p.line), {
    id: 'line',
    header: 'Line',
    cell: (c) => <span className="lbl">{c.row.original.line}</span>,
  }),
  col.accessor('num', { header: '#', cell: (c) => <Num n={c.getValue()} /> }),
  col.accessor('name', {
    header: 'Player',
    cell: (c) => (
      <>
        {c.getValue()}
        {c.row.original.nmc && <span className="nmc">NMC</span>}
        {c.row.original.status !== 'OK' && (
          <span className={`st ${c.row.original.status}`}>{c.row.original.status}</span>
        )}
      </>
    ),
  }),
  col.accessor('pos', { header: 'Pos' }),
  col.accessor('age', { header: 'Age' }),
  col.accessor('ovr', { header: 'Rating', cell: (c) => <Rate p={c.row.original} /> }),
  col.accessor('xgf', {
    header: 'xGF%',
    cell: (c) => (c.row.original.pos === 'G' ? '—' : c.getValue().toFixed(1)),
  }),
  col.accessor('capHit', { header: 'Cap hit', cell: (c) => fmtM(c.getValue()) }),
  col.accessor('years', { header: 'Yrs' }),
];

export function Roster() {
  const f = useFacts();
  const { open, setMenu, view, setView, lineOf, swapLines, moveLine, say, calm } = usePv();
  const data = useMemo(
    () => f.players.map((p) => (lineOf[p.id] ? { ...p, line: lineOf[p.id]! } : p)),
    [f.players, lineOf],
  );
  const issues = [
    ...data
      .filter((p) => p.status !== 'OK')
      .map((p) => ({ id: p.id, t: `${p.name} is ${p.status === 'IR' ? 'on IR' : 'day to day'}` })),
    ...data
      .filter((p) => p.years === 1 && p.ovr >= 75)
      .map((p) => ({ id: p.id, t: `${p.name} expires in June` })),
    ...data
      .filter((p) => p.capHit >= 6_000_000 && p.ovr <= 78 && !p.nmc)
      .map((p) => ({ id: p.id, t: `${p.name}: ${fmtM(p.capHit)} for a ${p.ovr}` })),
  ];
  const [sorting, setSorting] = useState<SortingState>([{ id: 'line', desc: false }]);
  const [sel, setSel] = useState(0);
  const t = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const rows = t.getRowModel().rows;
  const byLine = sorting[0]?.id === 'line' && !sorting[0].desc;

  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus({ preventScroll: true }), [view]);
  const grp = (p: Player) => (p.pos === 'D' ? 'D' : p.pos === 'G' ? 'G' : 'F');
  const onKey = (e: React.KeyboardEvent) => {
    if (usePv.getState().drawer || view !== 'table') return;
    const cur = rows[sel]?.original;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && cur) {
      e.preventDefault();
      const to = LINE_ORDER.filter((l) => l[0] === grp(cur))[
        LINE_ORDER.filter((l) => l[0] === grp(cur)).indexOf(cur.line) +
          (e.key === 'ArrowUp' ? -1 : 1)
      ];
      if (to) moveLine(cur.id, to);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      setSel((n) => Math.min(rows.length - 1, n + 1));
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      setSel((n) => Math.max(0, n - 1));
    } else if (!cur) return;
    else if (e.key === 'Enter') open(cur.id);
    else if (e.key === 't') open(cur.id, 'trade');
    else if (e.key === 'e') open(cur.id, 'extend');
    else if (e.key === 'ContextMenu') {
      const r = (e.currentTarget as HTMLElement)
        .querySelector('[aria-selected="true"]')
        ?.getBoundingClientRect();
      setMenu({ id: cur.id, x: (r?.left ?? 200) + 200, y: (r?.bottom ?? 200) - 10 });
    }
  };

  /** Valid when each player fits the other's line. Scratches take anyone. */
  const canSwap = (a: Player, b: Player) => {
    const ok = (p: Player, line: string) => line === 'X' || line[0] === grp(p);
    return ok(a, b.line) && ok(b, a.line);
  };
  const drop = (id: string, x: number, y: number) => {
    const hit = document
      .elementsFromPoint(x, y)
      .map((el) => (el as HTMLElement).closest<HTMLElement>('[data-pid]')?.dataset.pid)
      .find((v) => v && v !== id);
    const a = data.find((p) => p.id === id);
    const b = data.find((p) => p.id === hit);
    if (!a || !b) return;
    if (canSwap(a, b)) {
      swapLines(a.id, b.id);
      say(`${a.name.split(' ')[1]} and ${b.name.split(' ')[1]} swapped`);
    } else say(`${a.name.split(' ')[1]} can’t play there`);
  };

  return (
    <div onKeyDown={onKey} tabIndex={0} style={{ outline: 0 }} ref={box}>
      <div className="ro-head">
        <div>
          <span className="lbl">
            Montréal · 2026–27 ·{' '}
            <F k="roster" v={f.roster}>
              {f.roster} players
            </F>
          </span>
          <h1>Roster</h1>
        </div>
        <Segmented
          id="roview"
          value={view}
          onChange={setView}
          options={[
            { id: 'lines', label: 'Lines' },
            { id: 'table', label: 'Table' },
          ]}
        />
        <div className="stat">
          <div>
            <div className="big acc">
              <F k="cap" v={f.cap}>
                <Roll v={f.cap} fmt={fmtM} />
              </F>
            </div>
            <span className="lbl">Cap space</span>
          </div>
          <div>
            <div className="big">
              <Roll v={CAP - f.cap} fmt={fmtM} />
            </div>
            <span className="lbl">Payroll of {fmtM(CAP)}</span>
          </div>
        </div>
      </div>
      {issues.length > 0 && (
        <div className="attn">
          <span className="lbl">Needs attention · {issues.length}</span>
          {issues.map((i) => (
            <button key={i.t} className="nm" onClick={() => open(i.id)}>
              {i.t}
            </button>
          ))}
        </div>
      )}
      {view === 'lines' ? (
        <Lines
          data={data}
          drop={drop}
          move={(id, dir) => {
            const p = data.find((x) => x.id === id);
            if (!p) return;
            const order = LINE_ORDER.filter((l) => l[0] === grp(p));
            const to = order[order.indexOf(p.line) + dir];
            const mate =
              data.find((x) => x.line === to && x.pos === p.pos) ?? data.find((x) => x.line === to);
            if (to && mate && canSwap(p, mate)) swapLines(p.id, mate.id);
          }}
          calm={calm}
        />
      ) : (
        <>
          <table className="ro" aria-label="Roster">
            <thead>
              {t.getHeaderGroups().map((g) => (
                <tr key={g.id}>
                  {g.headers.map((h) => (
                    <th
                      key={h.id}
                      className={cls(h.column.id)}
                      onClick={h.column.getToggleSortingHandler()}
                      aria-sort={
                        h.column.getIsSorted() === 'asc'
                          ? 'ascending'
                          : h.column.getIsSorted() === 'desc'
                            ? 'descending'
                            : 'none'
                      }
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getIsSorted() === 'asc'
                        ? ' ↑'
                        : h.column.getIsSorted() === 'desc'
                          ? ' ↓'
                          : ''}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const first = byLine && (i === 0 || rows[i - 1]?.original.line !== r.original.line);
                return (
                  <Row key={r.id} p={r.original} selected={i === sel} first={first}>
                    {r.getVisibleCells().map((c) => (
                      <td key={c.id} className={cls(c.column.id)}>
                        {c.column.id === 'line' && first ? (
                          <span className="lbl">{LINE_NAME[r.original.line]}</span>
                        ) : c.column.id === 'line' ? null : (
                          flexRender(c.column.columnDef.cell, c.getContext())
                        )}
                      </td>
                    ))}
                  </Row>
                );
              })}
            </tbody>
          </table>
          <div className="ro-foot">
            <span>↑ ↓ move</span>
            <span>Enter open</span>
            <span>T trade</span>
            <span>E extend</span>
            <span>Alt ↑ ↓ move line</span>
            <span>Click a header to sort</span>
          </div>
        </>
      )}
    </div>
  );
}

const POSN: Record<string, number> = { LW: 0, C: 1, RW: 2, D: 0, G: 0 };
const BLOCKS: { title: string; lines: string[] }[][] = [
  [{ title: 'Forwards', lines: ['F1', 'F2', 'F3', 'F4'] }],
  [
    { title: 'Defence', lines: ['D1', 'D2', 'D3'] },
    { title: 'Goalies', lines: ['G1', 'G2'] },
  ],
];
/** The lines board: portrait tiles, drag one onto another to swap. Invalid drops snap back. */
function Lines({
  data,
  drop,
  move,
  calm,
}: {
  data: Player[];
  drop: (id: string, x: number, y: number) => void;
  move: (id: string, dir: number) => void;
  calm: boolean;
}) {
  const { open, team, ovr } = usePv();
  const ab = team;
  const dragged = useRef(false);
  const tile = (p: Player, slot: string) => {
    const flag = flagOf(p);
    return (
      <motion.button
        key={p.id}
        layout={!calm}
        data-pid={p.id}
        className="lt"
        drag={!calm}
        dragSnapToOrigin
        dragElastic={0.35}
        dragMomentum={false}
        whileDrag={{ scale: 1.06, zIndex: 30, boxShadow: '0 24px 40px -12px #000c' }}
        whileHover={calm ? {} : { y: -2 }}
        whileTap={calm ? {} : { scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 520, damping: 38 }}
        onDragEnd={(e) => {
          const ev = e as PointerEvent;
          drop(p.id, ev.clientX, ev.clientY);
        }}
        onPointerDown={() => (dragged.current = false)}
        onDragStart={() => (dragged.current = true)}
        onClick={() => !dragged.current && open(p.id)}
        onKeyDown={(e) => {
          if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            move(p.id, e.key === 'ArrowUp' ? -1 : 1);
          }
        }}
        aria-label={`${p.name}, ${p.pos}, ${slot}, ${tierOf(p)}`}
      >
        <motion.span layoutId={`ph-${p.id}`} className="lt-face">
          <Face id={p.id} team={ab} num={p.num} />
        </motion.span>
        <span className="lt-txt">
          <span className="lt-name">
            <b className="lt-num">{p.num}</b>
            {p.name}
          </span>
          <span className="lbl">{tierOf(p)}</span>
          <span className="lt-r3">
            {!ovr && <Rate p={p} />}
            {flag && <span className={`lt-flag ${flag.tone}`}>{flag.text}</span>}
          </span>
        </span>
        {ovr && <Rate p={p} />}
      </motion.button>
    );
  };
  const inLine = (l: string) =>
    data.filter((p) => p.line === l).sort((a, b) => (POSN[a.pos] ?? 0) - (POSN[b.pos] ?? 0));
  const rate = (l: string) => {
    const ps = inLine(l);
    return ps.length ? ps.reduce((n, p) => n + p.ovr, 0) / ps.length : 0;
  };
  const scratch = inLine('X');
  return (
    <div className="lb">
      {BLOCKS.map((col, i) => (
        <div className="lb-col" key={i}>
          {col.map((sec) => (
            <section key={sec.title}>
              <div className="lbl lb-t">{sec.title}</div>
              {sec.lines.map((l) => (
                <div className="lb-row" key={l}>
                  <div className="lb-h">
                    <span className="lbl">{LINE_NAME[l]}</span>
                    <b className="d">
                      <Roll v={rate(l)} />
                    </b>
                  </div>
                  <div className="lb-tiles" data-n={inLine(l).length}>
                    {inLine(l).map((p) => tile(p, LINE_NAME[l]!))}
                  </div>
                </div>
              ))}
            </section>
          ))}
          {i === 1 && (
            <section>
              <div className="lbl lb-t">Scratches · {scratch.length}</div>
              <div className="lb-tiles" data-n={2}>
                {scratch.map((p) => tile(p, 'Scratch'))}
              </div>
            </section>
          )}
        </div>
      ))}
    </div>
  );
}

function Row({
  p,
  selected,
  first,
  children,
}: {
  p: Player;
  selected: boolean;
  first: boolean;
  children: React.ReactNode;
}) {
  const a = useRowActions(p.id);
  return (
    <tr
      className={first ? 'grp' : ''}
      aria-selected={selected}
      {...a}
      ref={(el) => {
        if (selected) el?.scrollIntoView({ block: 'nearest' });
      }}
    >
      {children}
    </tr>
  );
}
