/**
 * People engine.
 * Owns: personalities, morale, player priorities, AI GM and owner styles, chemistry inputs.
 * Personalities come from the player's id (`personalityOf`); free agency weighs them.
 * AI GMs (`gmOf`) have a style and a skill; AI decisions look at players as their GM sees them (`seenBy`).
 * Chemistry v1 is time together (`chemistry`), worth at most a rating point in the game.
 * TODO(feature): morale; chemistry from linemates, builds and leaders.
 */
export {
  randomPersonality,
  personalityOf,
  notableTraits,
  TRAITS,
  PRIORITIES,
  type Personality,
  type Trait,
  type Priorities,
  type Priority,
} from './personality';
export { chemistry, CHEMISTRY_FULL_SEASONS } from './chemistry';
export { talkedDown, tradeRequests } from './requests';
export { GM_LEAN, GM_STYLES, gmOf, misread, randomGm, seenBy } from './gm';
