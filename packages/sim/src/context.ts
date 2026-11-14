import type { Sport } from '@gm/shared';
import type { Ruleset } from './cba';
import { defaultModels, type Models } from './models';
import { hockeySport, NHL_2026, type SportModule } from './sports';

/**
 * Everything a sim call needs besides the league state: the sport, its rules and the
 * models. Passed explicitly (no globals), so tests and the balance lab can swap any part.
 */
export interface SimContext {
  sport: SportModule;
  ruleset: Ruleset;
  models: Models;
}

/** Available sports. NBA and NFL get added here when their modules exist. */
export const SPORTS: Partial<Record<Sport, () => SportModule>> = {
  nhl: () => hockeySport(),
};

/** Every shipped ruleset, by id. */
export const RULESETS: Record<string, Ruleset> = { [NHL_2026.id]: NHL_2026 };

export function defaultContext(rulesetId = NHL_2026.id): SimContext {
  const ruleset = RULESETS[rulesetId];
  if (!ruleset) throw new Error(`Unknown ruleset ${rulesetId}`);
  const makeSport = SPORTS[ruleset.sport];
  if (!makeSport) throw new Error(`Sport ${ruleset.sport} is not available yet`);
  return { sport: makeSport(), ruleset, models: defaultModels };
}
