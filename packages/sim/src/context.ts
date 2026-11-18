import type { Sport } from '@gm/shared';
import type { Ruleset } from './cba';
import { defaultModels, type Models } from './models';
import { hockeySport, NHL_2026, FICTIONAL_2026, type GoalModel, type SportModule } from './sports';

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
/** Plug-in models the app loads from files (see docs/MODEL_CONTRACTS.md). */
export interface ModelOverrides {
  /** Hockey: a shot-quality model in place of `rulesGoalModel`. */
  goalModel?: GoalModel;
  /** Replaces any of the shared `Models`. */
  models?: Partial<Models>;
}

const SPORTS: Partial<Record<Sport, (o: ModelOverrides) => SportModule>> = {
  nhl: (o) => hockeySport(o.goalModel),
};

/** Every shipped ruleset, by id. */
const RULESETS: Record<string, Ruleset> = {
  [NHL_2026.id]: NHL_2026,
  [FICTIONAL_2026.id]: FICTIONAL_2026,
};

export function defaultContext(
  rulesetId = FICTIONAL_2026.id,
  overrides: ModelOverrides = {},
): SimContext {
  const ruleset = RULESETS[rulesetId];
  if (!ruleset) throw new Error(`Unknown ruleset ${rulesetId}`);
  const makeSport = SPORTS[ruleset.sport];
  if (!makeSport) throw new Error(`Sport ${ruleset.sport} is not available yet`);
  return {
    sport: makeSport(overrides),
    ruleset,
    models: { ...defaultModels, ...overrides.models },
  };
}
