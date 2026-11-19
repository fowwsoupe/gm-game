import { HOCKEY_TUNING, type GoalModel } from './tuning';

/**
 * A shot-quality model as plain data, so the sim stays pure (no ONNX runtime, no files) and a
 * model trained in /ml drops in as a JSON file. `goal[i][j]` is the chance a shot is a goal for a
 * shooter rated `shooting.reference` at even strength, from the cell `i` cells out from the goal
 * line (x) and `j` cells out from the middle of the ice (|y|), each `cellFeet` wide. Shots beyond
 * the table use its last row and column. A better shooter scales it by
 * `(shooting / reference) ** exponent`, a power play by `powerPlay`.
 * See docs/MODEL_CONTRACTS.md.
 */
export interface XgTable {
  format: 'gm-xg-table';
  version: 1;
  /** Where the numbers came from (data, model, date). Shown in the lab. */
  source: string;
  cellFeet: number;
  goal: number[][];
  shooting: { reference: number; exponent: number };
  powerPlay: number;
}

const MAX_CELLS = 200;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export type XgTableResult =
  { ok: true; model: GoalModel; table: XgTable } | { ok: false; errors: string[] };

/** Checks an untrusted file and builds the model. Never throws: errors come back readable. */
export function parseXgTable(json: unknown): XgTableResult {
  const errors: string[] = [];
  const t = (json ?? {}) as Partial<XgTable>;
  if (t.format !== 'gm-xg-table') errors.push('format: must be "gm-xg-table"');
  if (t.version !== 1) errors.push('version: only version 1 is supported');
  if (typeof t.source !== 'string' || !t.source)
    errors.push('source: say where the numbers come from');
  if (!isNum(t.cellFeet) || t.cellFeet <= 0 || t.cellFeet > 60) {
    errors.push('cellFeet: a number of feet between 0 and 60');
  }
  const grid = t.goal;
  if (!Array.isArray(grid) || grid.length === 0 || grid.length > MAX_CELLS) {
    errors.push(`goal: a table of 1 to ${MAX_CELLS} rows`);
  } else {
    const width = Array.isArray(grid[0]) ? grid[0].length : 0;
    if (width === 0 || width > MAX_CELLS) errors.push(`goal: rows of 1 to ${MAX_CELLS} numbers`);
    grid.forEach((row, i) => {
      if (!Array.isArray(row) || row.length !== width) {
        errors.push(`goal.${i}: every row needs ${width} numbers`);
      } else if (row.some((v) => !isNum(v) || v < 0 || v > 1)) {
        errors.push(`goal.${i}: every value is a probability from 0 to 1`);
      }
    });
  }
  if (!isNum(t.shooting?.reference) || t.shooting.reference <= 0) {
    errors.push('shooting.reference: a rating above 0');
  }
  if (!isNum(t.shooting?.exponent) || t.shooting.exponent < 0 || t.shooting.exponent > 3) {
    errors.push('shooting.exponent: a number from 0 to 3');
  }
  if (!isNum(t.powerPlay) || t.powerPlay <= 0 || t.powerPlay > 5) {
    errors.push('powerPlay: a multiplier above 0 and at most 5');
  }
  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 10) };

  const table = t as XgTable;
  const rows = table.goal.length;
  const cols = table.goal[0]!.length;
  const model: GoalModel = {
    shotXg({ x, y, shooting, power }) {
      const i = Math.min(rows - 1, Math.max(0, Math.floor(x / table.cellFeet)));
      const j = Math.min(cols - 1, Math.floor(Math.abs(y) / table.cellFeet));
      return (
        table.goal[i]![j]! *
        (shooting / table.shooting.reference) ** table.shooting.exponent *
        (power ? table.powerPlay : 1)
      );
    },
  };
  return { ok: true, model, table };
}

/**
 * Writes any model as a table, sampled at each cell's centre (a shooter at the reference
 * rating, even strength). Gives the modeller a template with the right shape, and lets a
 * test prove the table path matches the rules model.
 */
export function xgTableFromModel(
  model: GoalModel,
  opts: { cellFeet?: number; xMax?: number; yMax?: number; source?: string } = {},
): XgTable {
  const cellFeet = opts.cellFeet ?? 5;
  const reference = HOCKEY_TUNING.shootingReference;
  const rows = Math.ceil((opts.xMax ?? 70) / cellFeet);
  const cols = Math.ceil((opts.yMax ?? 45) / cellFeet);
  const round = (v: number) => Math.round(v * 1e5) / 1e5;
  return {
    format: 'gm-xg-table',
    version: 1,
    source: opts.source ?? 'export of the rules-based shot model (template)',
    cellFeet,
    goal: Array.from({ length: rows }, (_, i) =>
      Array.from({ length: cols }, (_, j) =>
        round(
          model.shotXg({
            x: (i + 0.5) * cellFeet,
            y: (j + 0.5) * cellFeet,
            shooting: reference,
            power: false,
          }),
        ),
      ),
    ),
    shooting: { reference, exponent: HOCKEY_TUNING.shootingExponent },
    powerPlay: HOCKEY_TUNING.powerPlayQuality,
  };
}
