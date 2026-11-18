import type { Player, Team } from '@gm/shared';

/** "City Name", as news and headlines show a team. */
export const teamName = (t: Pick<Team, 'city' | 'name'>) => `${t.city} ${t.name}`;

/** "First Last". */
export const playerName = (p: Pick<Player, 'firstName' | 'lastName'>) =>
  `${p.firstName} ${p.lastName}`;
