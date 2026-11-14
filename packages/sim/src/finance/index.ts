/**
 * Owner & finance engine (post-launch feature, structure only for now).
 * Owns: revenue, budgets, facilities, staff spending, owner objectives.
 * Rule: every dollar spent must map to a measurable effect elsewhere (medical → injury
 * recovery, development staff → growth rate), with diminishing returns.
 */
import type { Dollars } from '../core';

export interface TeamFinances {
  cash: Dollars;
  /** Budgets the owner allows, per department. */
  budgets: Record<'scouting' | 'analytics' | 'medical' | 'coaching' | 'development', Dollars>;
}

export const emptyFinances = (): TeamFinances => ({
  cash: 0,
  budgets: { scouting: 0, analytics: 0, medical: 0, coaching: 0, development: 0 },
});
