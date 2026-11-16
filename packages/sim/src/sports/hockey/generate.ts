import type { HockeyPosition, Player, PlayerId, Team, TeamId } from '@gm/shared';
import { pct, type Rng } from '../../core';
import { NHL_2026 } from './ruleset-nhl-2026';

const FIRST = [
  'Alex',
  'Ben',
  'Carter',
  'Dylan',
  'Ethan',
  'Felix',
  'Gabe',
  'Henri',
  'Isaac',
  'Jonas',
  'Kai',
  'Liam',
  'Marc',
  'Noah',
  'Owen',
  'Pierre',
  'Quinn',
  'Ryan',
  'Sami',
  'Theo',
];
const LAST = [
  'Anders',
  'Bouchard',
  'Carlsson',
  'Dumont',
  'Eriksen',
  'Fischer',
  'Gagnon',
  'Hall',
  'Ivanov',
  'Jensen',
  'Korhonen',
  'Lindqvist',
  'Moreau',
  'Novak',
  'Olsen',
  'Pelletier',
  'Roy',
  'Sato',
  'Tremblay',
  'Virtanen',
];
const CITIES = [
  'Aurora',
  'Bayview',
  'Cedar Falls',
  'Dunmore',
  'Eastport',
  'Fairhaven',
  'Glenrock',
  'Harbor City',
  'Ironwood',
  'Juniper',
  'Kingsbridge',
  'Lakeshore',
  'Maple Ridge',
  'Northgate',
  'Oakmont',
  'Pinecrest',
];
const NAMES = [
  'Wolves',
  'Comets',
  'Blizzard',
  'Lumberjacks',
  'Admirals',
  'Foxes',
  'Thunder',
  'Ravens',
  'Miners',
  'Sentinels',
  'Stallions',
  'Pilots',
  'Grizzlies',
  'Owls',
  'Storm',
  'Knights',
];

const ROSTER: HockeyPosition[] = [
  ...Array<HockeyPosition>(5).fill('C'),
  ...Array<HockeyPosition>(5).fill('LW'),
  ...Array<HockeyPosition>(5).fill('RW'),
  ...Array<HockeyPosition>(8).fill('D'),
  'G',
  'G',
];

/** Draft class mix: about 10% goalies, 30% defensemen. */
const DRAFT_POSITIONS: HockeyPosition[] = [
  'C',
  'C',
  'C',
  'LW',
  'LW',
  'RW',
  'RW',
  'D',
  'D',
  'D',
  'G',
];
/** Prospect tuning: potential = base + two dice of 0-15; today's rating is potential minus a gap. */
const PROSPECT = { potentialBase: 53, gap: [12, 26] as const };

const clamp = (n: number) => Math.max(1, Math.min(99, Math.round(n)));

/**
 * Fictional league for development and for players who don't load a community roster.
 * Real rosters come from roster JSON files (see @gm/shared roster-schema).
 */
export function generateFictionalLeague(
  rng: Rng,
  teamCount = 16,
): { teams: Team[]; players: Player[] } {
  const teams: Team[] = [];
  const players: Player[] = [];
  for (let t = 0; t < teamCount; t++) {
    const name = `${CITIES[t % CITIES.length]!}|${NAMES[t % NAMES.length]!}`;
    const [city, nick] = name.split('|') as [string, string];
    const id = `t${t}` as TeamId;
    teams.push({
      id,
      city,
      name: nick,
      abbreviation: city.slice(0, 3).toUpperCase(),
      // Two conferences, each split into divisions of four.
      conference: t % 2 === 0 ? 'East' : 'West',
      division: `${t % 2 === 0 ? 'East' : 'West'} ${Math.floor(t / 2 / 4) % 2 === 0 ? 'A' : 'B'}`,
      userControlled: t === 0,
    });

    const quality = rng.int(-8, 8);
    const teamStart = players.length;
    for (const position of ROSTER) {
      const base = 62 + quality + rng.int(-10, 12);
      const r = () => clamp(base + rng.int(-8, 8));
      const p: Player = {
        id: `p${players.length}` as PlayerId,
        firstName: rng.pick(FIRST),
        lastName: rng.pick(LAST),
        birthYear: rng.int(1990, 2007),
        teamId: id,
        position,
        ratings: {},
        potential: clamp(base + rng.int(0, 15)),
        contract: { capHit: rng.int(8, 100) * 100_000, expiresAfterSeason: 2027 + rng.int(0, 5) },
      };
      if (position === 'G') {
        p.ratings = { reflexes: r(), positioning: r(), reboundControl: r(), consistency: r() };
      } else {
        p.ratings = {
          skating: r(),
          shooting: r(),
          passing: r(),
          puckHandling: r(),
          defense: r(),
          physical: r(),
          hockeyIq: r(),
        };
      }
      players.push(p);
    }
    fitPayroll(players.slice(teamStart), rng.fork(`payroll${t}`));
  }
  return { teams, players };
}

/**
 * Scales a team's random cap hits so the payroll is a legal 80-92% of the cap
 * (with every salary at or above the league minimum), instead of whatever the dice gave.
 */
function fitPayroll(roster: Player[], rng: Rng) {
  const { upperLimit, minSalary } = NHL_2026.cap;
  const target = pct(upperLimit, rng.int(80, 92));
  const total = roster.reduce((s, p) => s + p.contract!.capHit, 0);
  for (const p of roster) {
    const scaled = Math.round((p.contract!.capHit * target) / total / 100_000) * 100_000;
    p.contract!.capHit = Math.max(minSalary, scaled);
  }
}

/**
 * A new, teamless 18-19 year old: the draft class and undrafted free agents.
 * Rated well below his potential; development closes the gap by his mid-twenties.
 * TODO(M4): position-specific rating profiles, junior/Europe origins.
 */
export function generateProspect(
  rng: Rng,
  opts: { id: string; season: number; position?: string },
): Player {
  const position = (opts.position ?? rng.pick(DRAFT_POSITIONS)) as HockeyPosition;
  const potential = clamp(PROSPECT.potentialBase + rng.int(0, 15) + rng.int(0, 15));
  const base = potential - rng.int(PROSPECT.gap[0], PROSPECT.gap[1]);
  const r = () => clamp(base + rng.int(-8, 8));
  return {
    id: opts.id as PlayerId,
    firstName: rng.pick(FIRST),
    lastName: rng.pick(LAST),
    birthYear: opts.season - rng.int(18, 19),
    teamId: null,
    position,
    potential,
    ratings:
      position === 'G'
        ? { reflexes: r(), positioning: r(), reboundControl: r(), consistency: r() }
        : {
            skating: r(),
            shooting: r(),
            passing: r(),
            puckHandling: r(),
            defense: r(),
            physical: r(),
            hockeyIq: r(),
          },
  };
}
