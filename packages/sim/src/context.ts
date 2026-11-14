import { NHL_2026, type Ruleset } from './cba';
import { defaultModels, type Models } from './models';

/**
 * Everything a sim call needs besides the league state: the rules and the models.
 * Passed explicitly (no globals), so tests and the balance lab can swap any part.
 */
export interface SimContext {
  ruleset: Ruleset;
  models: Models;
}

export const RULESETS: Record<string, Ruleset> = { [NHL_2026.id]: NHL_2026 };

export function defaultContext(rulesetId = NHL_2026.id): SimContext {
  const ruleset = RULESETS[rulesetId];
  if (!ruleset) throw new Error(`Unknown ruleset ${rulesetId}`);
  return { ruleset, models: defaultModels };
}
