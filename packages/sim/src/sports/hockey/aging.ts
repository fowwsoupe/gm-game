import type { AgingCurve, RulesDevelopmentConfig } from '../../players';

/**
 * Hockey aging, fitted in the balance lab to the "Skater points/60 a year" targets (ml/src/aging.py,
 * NHL 2022-25: +3.6% a year to 24, -1.4% at 25-29, -4.0% at 30-34). Skaters close most of the gap
 * to their potential by 20-21, so regulars gain little after 22; they hold to 24 (forwards) or 25
 * (defensemen) and lose a little more each year from then on. Goalies keep the research curve
 * (docs/research/2026-11-sports-gm-research.md: peak 27, decline from 33, mostly year-to-year
 * bounce): they have no target yet. To be replaced by the trained development model (ADR 0005).
 */
const forward: AgingCurve = {
  growth: 0.7,
  peakAge: 24,
  declineAge: 25,
  declineStart: 0.3,
  declineStep: 0.2,
  noise: 1.2,
};
const defense: AgingCurve = {
  growth: 0.7,
  peakAge: 25,
  declineAge: 26,
  declineStart: 0.3,
  declineStep: 0.2,
  noise: 1.2,
};
const goalie: AgingCurve = {
  growth: 0,
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
