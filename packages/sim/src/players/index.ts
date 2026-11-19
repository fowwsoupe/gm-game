/**
 * Players engine (shared by all sports).
 * Owns: the overall rating, rating percentiles and the development model. Builds, role tags and
 * play traits are the sport's (sports/hockey); personality is the people engine's.
 * TODO(feature): skill-specific aging, injuries with lingering effects.
 */
export { percentileRank } from './percentile';
export {
  overall,
  byOverall,
  clampRating,
  rulesDevelopment,
  type AgingCurve,
  type DevelopmentModel,
  type RulesDevelopmentConfig,
} from './development';
