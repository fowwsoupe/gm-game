/**
 * People engine.
 * Owns: personalities, morale, player priorities, AI GM and owner styles, chemistry inputs.
 * Personalities come from the player's id (`personalityOf`); free agency weighs them.
 * TODO(feature): morale, chemistry (visible, capped).
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
