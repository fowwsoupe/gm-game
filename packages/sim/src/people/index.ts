/**
 * People engine.
 * Owns: personalities, morale, player priorities, AI GM and owner styles, chemistry inputs.
 * Personalities come from the player's id (`personalityOf`); free agency weighs them.
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
