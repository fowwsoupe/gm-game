import type {
  GmProfile,
  GmStyle,
  Player,
  StaffProfile,
  Team,
  TeamId,
  TeamPlan,
  TeamPlanKind,
  TeamStatus,
} from '@gm/shared';
import { Rng } from '../core';
import { hash } from './personality';

const GM_STYLES: readonly GmStyle[] = ['winNow', 'balanced', 'builder'];

/** Each style's lean between now (1) and the future (-1), as the valuator reads it. */
export const GM_LEAN: Record<GmStyle, number> = { winNow: 1, balanced: 0, builder: -1 };

/** A new AI GM: any style, skill anywhere from poor to excellent. */
export function randomGm(rng: Rng): GmProfile {
  return { style: rng.pick(GM_STYLES), skill: Math.round(rng.next() * 100) / 100 };
}

/** A team's GM; teams from old saves and roster files get one derived from the team id. */
export const gmOf = (team: Team): GmProfile => team.gm ?? randomGm(new Rng(hash(`gm:${team.id}`)));

/** How far (SD, rating points) a GM's read of a player is off: the best GM 1, the worst 6. */
const READ_SD = { best: 1, worst: 6 };

/**
 * How many rating points this team's GM over- (positive) or underrates this player. Fixed per
 * GM, team and player, so a poor GM keeps falling for the same players and his successor has
 * blind spots of his own; nothing is stored and no draw comes from the league's random stream.
 */
export function misread(gm: GmProfile, teamId: TeamId, playerId: string): number {
  return readOff(`read:${teamId}:${gm.style}:${gm.skill}:${playerId}`, gm.skill);
}

/** A read `skill` (0-1) good, fixed by `key`: SD from READ_SD.worst down to READ_SD.best. */
const readOff = (key: string, skill: number) =>
  new Rng(hash(key)).normal(0, READ_SD.best + (1 - skill) * (READ_SD.worst - READ_SD.best));

const clamp = (n: number) => Math.max(1, Math.min(99, n));

/**
 * The player as this team's GM sees him: every rating and his potential shifted by his misread.
 * AI decisions (who to sign, keep, draft or trade for) look at this copy, never at the truth.
 */
export const seenBy = (team: Team, player: Player): Player =>
  shifted(player, misread(gmOf(team), team.id, player.id));

/**
 * The player as a human team's assistant GM sees him: off as far as an AI GM of the same skill,
 * fixed per assistant and player (docs/research/2026-11-assistant-gm.md).
 */
export const assistantSees = (head: StaffProfile, teamId: TeamId, player: Player): Player =>
  shifted(
    player,
    readOff(`assistant:${teamId}:${head.name}:${head.hired}:${player.id}`, head.quality),
  );

function shifted(player: Player, off: number): Player {
  if (off === 0) return player;
  const ratings: Record<string, number> = {};
  for (const [k, v] of Object.entries(player.ratings)) ratings[k] = clamp(v + off);
  return { ...player, ratings, potential: clamp(player.potential + off) };
}

/** Seasons a rebuild is given before the GM reconsiders (unless the kids arrive early)... */
const REBUILD_SEASONS = 2;
/** ...and the most it lasts: then the GM has to push (retool), however the kids look. */
export const REBUILD_MAX_SEASONS = 4;
/** A core younger than this on average is promise, not just weakness. */
const YOUNG_CORE = 26;
/** Age of the core above which the window starts closing, and how fast (per year, in SDs). */
const WINDOW_AGE = 29;
const AGE_COST = 0.25;

/**
 * The plan an AI GM sets in the summer. `coreZ`: his core (best players, as he sees them) in
 * standard deviations above the league's; `coreAge`: its average age. A good, young core opens a
 * window; an old or weak one closes it. Style tilts the call; a rebuild gets time; a contender
 * holds on a little longer than he would start.
 */
export function choosePlan(input: {
  coreZ: number;
  coreAge: number;
  style: GmStyle;
  current?: TeamPlan | undefined;
  season: number;
}): TeamPlanKind {
  const { coreZ, coreAge, style, current, season } = input;
  const score =
    coreZ +
    0.4 * GM_LEAN[style] -
    AGE_COST * Math.max(0, coreAge - WINDOW_AGE) +
    (coreAge < YOUNG_CORE ? 0.3 : 0);
  if (current?.kind === 'rebuild') {
    const years = season - current.since;
    if (years < REBUILD_SEASONS && coreZ < 1) return 'rebuild';
    if (years >= REBUILD_MAX_SEASONS) return score >= 0.5 ? 'contend' : 'retool';
  }
  if (score >= (current?.kind === 'contend' ? 0.2 : 0.6)) return 'contend';
  if (score <= -0.8) return 'rebuild';
  return 'retool';
}

/**
 * The situation an AI team acts on: its plan over today's standings. A rebuilding team sells and
 * plans for later even when it is winning; a contender buys through a slump.
 */
export function planStatus(team: Team, standings: TeamStatus): TeamStatus {
  if (team.userControlled || !team.plan) return standings;
  if (team.plan.kind === 'rebuild') return 'rebuilder';
  if (team.plan.kind === 'contend') return standings === 'contender' ? 'contender' : 'buyer';
  return standings;
}
