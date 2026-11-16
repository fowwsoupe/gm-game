import type { AgingCurve, RulesDevelopmentConfig } from '../../players';

/**
 * Hockey aging, from docs/research/2026-11-sports-gm-research.md: forwards peak around 26-28,
 * defensemen 27-29, decline starts around 30; goalies change little with age and mostly bounce
 * around from year to year. Rough numbers, to be replaced by the trained development model (M4, Azmi; ADR 0005).
 */
const forward: AgingCurve = {
  peakAge: 26,
  declineAge: 30,
  declineStart: 0.8,
  declineStep: 0.4,
  noise: 1.2,
};
const defense: AgingCurve = {
  peakAge: 27,
  declineAge: 31,
  declineStart: 0.8,
  declineStep: 0.4,
  noise: 1.2,
};
const goalie: AgingCurve = {
  peakAge: 27,
  declineAge: 33,
  declineStart: 0.6,
  declineStep: 0.3,
  noise: 2.5,
};

export const HOCKEY_DEVELOPMENT: RulesDevelopmentConfig = {
  curves: { C: forward, LW: forward, RW: forward, D: defense, G: goalie },
  fallback: forward,
  retirement: {
    startAge: 33,
    perYear: 0.06,
    maxAge: 42,
    washoutRating: 50,
    washoutPerPoint: 0.01,
    unsignedExtra: 0.25,
  },
};
