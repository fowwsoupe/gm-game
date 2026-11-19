import {
  formatMoney,
  GOALIE_RATINGS,
  isGoalie,
  parseRosterFile,
  ROSTER_FORMAT_VERSION,
  SKATER_RATINGS,
  type Player,
  type PlayerId,
  type RosterFile,
  type Team,
  type TeamId,
} from '@gm/shared';
import { validateContract, type ContractIssue, type Ruleset } from '../../cba';
import type { RosterImport } from '../sport';
import { ratingsFromStats } from './ratingsFromStats';
import { STATS_TO_RATINGS } from './ratingsFromStatsTable';
import type { GoalieTotals, SkaterTotals } from './stats';

const teamId = (abbreviation: string) => `t_${abbreviation}` as TeamId;

/** A readable line for a contract rule a roster file breaks. */
function describe(issue: ContractIssue): string {
  switch (issue.code) {
    case 'too_long':
      return `runs longer than the ${issue.max}-season maximum`;
    case 'below_minimum':
      return `cap hit is below the league minimum of ${formatMoney(issue.min)}`;
    case 'above_maximum':
      return `cap hit is above the maximum of ${formatMoney(issue.max)}`;
    default:
      return `breaks the contract rules (${issue.code})`;
  }
}

/**
 * Turns a community roster file into league teams and players. Files are untrusted:
 * everything goes through the zod schema first, then every contract is checked against the
 * league's rules, and errors come back as readable lines. Team payrolls are not checked: a
 * team over the cap is legal to load and the cap advisor flags it.
 * The first team in the file starts as the user's team.
 */
export function importHockeyRoster(json: unknown, rules: Ruleset): RosterImport {
  const parsed = parseRosterFile(json);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues
        .slice(0, 20)
        .map((i) => `${i.path.join('.') || 'file'}: ${i.message}`),
    };
  }
  const file = parsed.data;
  const teams: Team[] = file.teams.map((t, i) => ({
    id: teamId(t.abbreviation),
    city: t.city,
    name: t.name,
    abbreviation: t.abbreviation,
    ...(t.conference ? { conference: t.conference } : {}),
    ...(t.division ? { division: t.division } : {}),
    userControlled: i === 0,
  }));
  const players: Player[] = file.players.map((p) => ({
    id: `p_${p.id}` as PlayerId,
    firstName: p.firstName,
    lastName: p.lastName,
    birthYear: p.birthYear,
    teamId: p.team === null ? null : teamId(p.team),
    position: p.position,
    potential: p.potential,
    ratings: {
      ...(p.position === 'G' ? p.goalie : p.skater),
      ...((p.goalie ?? p.skater)
        ? {}
        : Object.fromEntries(
            Object.entries(
              ratingsFromStats(
                STATS_TO_RATINGS,
                p.position,
                p.stats as SkaterTotals | GoalieTotals,
                rules.season.gamesPerTeam,
              ),
            ).map(([k, e]) => [k, e.value]),
          )),
    },
    ...(p.contract ? { contract: { ...p.contract } } : {}),
  }));
  const contractErrors = file.players.flatMap((p, i) => {
    if (!p.contract) return [];
    const where = `players.${i}.contract`;
    const seasons = p.contract.expiresAfterSeason - file.season + 1;
    if (seasons < 1) return [`${where}: ended before the ${file.season} season`];
    // Only the seasons left are known, so check those as if just signed (with a re-sign's term).
    return validateContract(rules, {
      salaries: Array<number>(seasons).fill(p.contract.capHit),
      signingAge: file.season - p.birthYear,
      isResign: true,
    }).map((issue) => `${where}: ${describe(issue)}`);
  });
  if (contractErrors.length > 0) return { ok: false, errors: contractErrors.slice(0, 20) };
  const goalieless = teams.filter(
    (t) => !players.some((p) => p.teamId === t.id && isGoalie(p.position)),
  );
  if (goalieless.length > 0) {
    return {
      ok: false,
      errors: goalieless.map((t) => `teams.${t.abbreviation}: needs at least one goalie`),
    };
  }
  return { ok: true, season: file.season, name: file.name, teams, players };
}

/** Writes a league out in roster-file format: a template for community roster makers. */
export function exportHockeyRoster(
  league: { teams: readonly Team[]; players: readonly Player[] },
  meta: { season: number; name: string; author?: string },
): RosterFile {
  const abbrevById = new Map(league.teams.map((t) => [t.id, t.abbreviation]));
  const pick = (r: Record<string, number>, keys: readonly string[]) =>
    Object.fromEntries(keys.map((k) => [k, r[k] ?? 50]));
  return {
    formatVersion: ROSTER_FORMAT_VERSION,
    sport: 'nhl',
    season: meta.season,
    name: meta.name,
    ...(meta.author ? { author: meta.author } : {}),
    teams: league.teams.map((t) => ({
      abbreviation: t.abbreviation,
      city: t.city,
      name: t.name,
      ...(t.conference ? { conference: t.conference } : {}),
      ...(t.division ? { division: t.division } : {}),
    })),
    players: league.players.map((p) => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      birthYear: p.birthYear,
      team: p.teamId === null ? null : (abbrevById.get(p.teamId) ?? null),
      position: p.position as RosterFile['players'][number]['position'],
      potential: p.potential,
      ...(isGoalie(p.position)
        ? { goalie: pick(p.ratings, GOALIE_RATINGS) as never }
        : { skater: pick(p.ratings, SKATER_RATINGS) as never }),
      ...(p.contract ? { contract: { ...p.contract } } : {}),
    })),
  };
}
