import { writeFileSync } from 'node:fs';
import { rulesGoalModel, xgTableFromModel } from '@gm/sim';

/**
 * Writes ml/models/xg-rules-template.json: the rules-based shot model as a table, the shape a
 * trained model must export. Run: pnpm xg:template
 */
const table = xgTableFromModel(rulesGoalModel);
const out = new URL('../../../ml/models/xg-rules-template.json', import.meta.url);
writeFileSync(out, JSON.stringify(table) + '\n');
console.log(`Wrote a ${table.goal.length} x ${table.goal[0]!.length} table to ${out.pathname}`);
