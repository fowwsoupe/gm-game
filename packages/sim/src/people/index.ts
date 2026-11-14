/**
 * People engine.
 * Owns: personalities, morale, player priorities, AI GM and owner styles, chemistry inputs.
 * TODO(feature): morale, chemistry (visible, capped), FA priority weights by age.
 */
export {
  randomPersonality,
  TRAITS,
  PRIORITIES,
  type Personality,
  type Trait,
  type Priorities,
  type Priority,
} from './personality';
