import type { HockeyPosition, Player, PlayerId, Team, TeamId } from '@gm/shared';
import type { Rng } from '../core';

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
      userControlled: t === 0,
    });

    const quality = rng.int(-8, 8);
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
        potential: clamp(base + rng.int(0, 15)),
        contract: { capHit: rng.int(8, 100) * 100_000, expiresAfterSeason: 2027 + rng.int(0, 5) },
      };
      if (position === 'G') {
        p.goalie = { reflexes: r(), positioning: r(), reboundControl: r(), consistency: r() };
      } else {
        p.skater = {
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
  }
  return { teams, players };
}
