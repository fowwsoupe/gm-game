/**
 * People engine.
 * Owns: personalities, morale, player priorities, AI GM and owner styles, chemistry inputs.
 * Personalities come from the player's id (`personalityOf`); free agency and re-signing weigh them.
 * AI GMs (`gmOf`) have a style and a skill; AI decisions look at players as their GM sees them (`seenBy`).
 * Chemistry v1 is time together (`chemistry`), worth at most a rating point in the game.
 * Morale v1 (`morale`) is a display of how happy a player is.
 * TODO(feature): morale effects; chemistry from linemates, builds and leaders.
 */
export {
  randomPersonality,
  personalityOf,
  notableTraits,
  hometownOf,
  TRAITS,
  PRIORITIES,
  type Personality,
  type Trait,
  type Priorities,
  type Priority,
} from './personality';
export { morale, type MoraleInput } from './morale';
export { chemistry, CHEMISTRY_FULL_SEASONS } from './chemistry';
export { talkedDown, tradeRequests } from './requests';
export {
  GM_LEAN,
  GM_STYLES,
  REBUILD_SEASONS,
  choosePlan,
  gmOf,
  misread,
  planStatus,
  randomGm,
  seenBy,
} from './gm';
