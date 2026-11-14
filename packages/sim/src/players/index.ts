/**
 * Players engine.
 * Owns: hidden ratings, percentiles, builds, role tags, traits, development, injuries.
 * TODO(feature): builds via clustering, skill-specific aging, injuries with lingering effects.
 */
export { percentileRank } from './percentile';
export { noDevelopment, type DevelopmentModel, type CareerShape } from './development';
