import { defaultContext, parseXgTable } from '@gm/sim';

/** The sim context for a ruleset, with the user's shot model (the JSON of models/xg.json) when it is valid. */
export function contextWithXg(rulesetId: string, xgJson: unknown) {
  const xg = xgJson === undefined ? undefined : parseXgTable(xgJson);
  return defaultContext(rulesetId, xg?.ok ? { goalModel: xg.model } : {});
}
