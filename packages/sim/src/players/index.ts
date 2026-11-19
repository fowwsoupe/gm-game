/**
 * Players engine.
 * Owns: hidden ratings, percentiles, builds, role tags, traits, development, injuries.
 * TODO(feature): builds via clustering, skill-specific aging, injuries with lingering effects.
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
