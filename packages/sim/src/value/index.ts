/**
 * Value engine.
 * Owns: player surplus value, draft-pick value, market (contract) value, per-team worth.
 * Used by trades, free agency, the draft room, the cap advisor and every AI GM decision.
 */
export { naiveValuator, type PlayerValuator, type Valuation, type TeamContext } from './valuation';
export { marketSalary } from './market';
