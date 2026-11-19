/**
 * People engine.
 * Owns: personalities, morale, player priorities, AI GM and owner styles, chemistry inputs.
 * Personalities come from the player's id (`personalityOf`); free agency and re-signing weigh them.
 * AI GMs (`gmOf`) have a style and a skill; AI decisions look at players as their GM sees them (`seenBy`).
 * Chemistry v1 is time together and the locker room's leaders (`chemistry`), worth at most a
 * rating point in the game.
 * Morale v1 (`morale`) is how happy a player is; it opens role disputes and moves no-trade waivers.
 * TODO(feature): morale effects on play and re-signing; chemistry from linemates and builds.
 */
export {
  personalityOf,
  notableTraits,
  hometownOf,
  nationOf,
  hash,
  type Personality,
} from './personality';
export { morale, moraleOf, type MoraleInput } from './morale';
export { chemistry } from './chemistry';
export { talkedDown, tradeRequests, waivesNoTrade } from './requests';
export { disputesWeek, PROMISE_DAYS, roleGap } from './disputes';
export { startHoldouts, holdoutsWeek, talkedRound } from './holdouts';
export { campRead, campReport } from './camp';
export {
  capacityOf,
  coachOf,
  coachSeasonsLeft,
  DEPARTMENTS,
  departmentsOf,
  marketOf,
  hireCentre,
  hireQuality,
  newCoach,
  ownerOf,
  randomName,
  staffOf,
  staffSalary,
  ticketPctOf,
} from './owner';
export {
  GM_LEAN,
  assistantSees,
  choosePlan,
  gmOf,
  misread,
  planStatus,
  randomGm,
  seenBy,
} from './gm';
