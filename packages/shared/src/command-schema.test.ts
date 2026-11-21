import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import type { Command } from './commands';
import type { GameId, PlayerId, TeamId } from './domain';
import { ID_MAX, commandSchema, isSafeText, parseCommand } from './command-schema';
import { parseRosterFile } from './roster-schema';
import { SKATER_RATINGS } from './sports/hockey';

const t = 't1' as TeamId;
const p = 'p12' as PlayerId;
const identity = { city: 'Québec', name: 'Fleuves', abbreviation: 'QBF' };
const proposal = {
  fromTeamId: t,
  toTeamId: 't_MTL' as TeamId,
  give: [p],
  get: [],
  retain: [{ playerId: p, pct: 25 }],
  givePicks: ['2028-1-t1'],
  getPicks: ['2027-2-t_MTL'],
  giveProspects: ['d2027_3' as PlayerId],
  getProspects: [],
  protectTop: 5,
};

/** One valid command of every kind: a new kind without an example fails the typecheck. */
const examples: { [K in Command['kind']]: Extract<Command, { kind: K }> } = {
  'sim.advance': { kind: 'sim.advance', days: 7, stopOn: ['league', 'offers'] },
  'team.setUserControlled': { kind: 'team.setUserControlled', teamId: t, userControlled: true },
  'team.rename': { kind: 'team.rename', teamId: t, ...identity },
  'team.relocate': { kind: 'team.relocate', teamId: t, ...identity, market: 1.75 },
  'league.expand': { kind: 'league.expand', ...identity, market: 0.7 },
  'commissioner.move': { kind: 'commissioner.move', playerId: p, teamId: null },
  'bench.order': {
    kind: 'bench.order',
    gameId: 'g1' as GameId,
    teamId: t,
    at: 1200,
    order: 'matchLine',
    value: 2,
  },
  'season.rollover': { kind: 'season.rollover' },
  'contract.buyout': { kind: 'contract.buyout', playerId: p },
  'contract.resign': {
    kind: 'contract.resign',
    playerId: p,
    salary: 5_500_000,
    years: 3,
    noTrade: true,
    bonusPct: 10,
  },
  'contract.askWaiveNoTrade': { kind: 'contract.askWaiveNoTrade', proposal },
  'trade.propose': { kind: 'trade.propose', proposal: { ...proposal, retain: [] } },
  'trade.respond': { kind: 'trade.respond', offerId: 'h2027_-12_t1_t2_0', accept: false },
  'tradeRequest.talk': { kind: 'tradeRequest.talk', playerId: p },
  'holdout.talk': { kind: 'holdout.talk', playerId: p },
  'dispute.talk': { kind: 'dispute.talk', playerId: p, answer: 'patience' },
  'offseason.openFreeAgency': { kind: 'offseason.openFreeAgency' },
  'lines.set': { kind: 'lines.set', teamId: t, order: [p, 'p_8478402' as PlayerId] },
  'units.set': { kind: 'units.set', teamId: t, unit: 'pp1', playerIds: [] },
  'training.set': { kind: 'training.set', teamId: t, playerId: p, focus: null },
  'delegate.set': { kind: 'delegate.set', teamId: t, offers: true },
  'trade.block': { kind: 'trade.block', teamId: t, playerId: p, onBlock: true },
  'career.takeJob': { kind: 'career.takeJob', teamId: t },
  'league.setCanBeFired': { kind: 'league.setCanBeFired', on: false },
  'league.setStopOn': { kind: 'league.setStopOn', stopOn: ['injuries'] },
  'owner.answerCard': { kind: 'owner.answerCard', cardId: 'press-test', option: 'honest' },
  'finance.setTicketPrice': { kind: 'finance.setTicketPrice', teamId: t, pct: -20 },
  'staff.hire': { kind: 'staff.hire', teamId: t, department: 'assistant', candidate: 2 },
  'staff.fire': { kind: 'staff.fire', teamId: t, department: 'medical' },
  'goalies.setRotation': { kind: 'goalies.setRotation', teamId: t, rotation: 'split' },
  'draft.setBoard': { kind: 'draft.setBoard', teamId: t, order: [p] },
  'offseason.startDraft': { kind: 'offseason.startDraft' },
  'draft.pick': { kind: 'draft.pick', teamId: t, playerId: p },
  'prospect.sign': { kind: 'prospect.sign', teamId: t, playerId: p },
  'player.assign': { kind: 'player.assign', teamId: t, playerId: p, down: true },
  'freeAgency.advanceDay': { kind: 'freeAgency.advanceDay' },
  'freeAgency.matchSheet': { kind: 'freeAgency.matchSheet', playerId: p, teamId: t },
  'freeAgency.declineSheet': { kind: 'freeAgency.declineSheet', playerId: p, teamId: t },
  'contract.sign': {
    kind: 'contract.sign',
    playerId: p,
    teamId: t,
    salary: 900_000,
    years: 1,
    promiseRole: true,
  },
};

const refused = (input: unknown) => {
  const res = parseCommand(input);
  return !res.ok && res.error.code === 'invalid';
};

describe('the command schema', () => {
  it('is the Command type: a kind or a field without a schema fails the typecheck', () => {
    expectTypeOf<z.infer<typeof commandSchema>>().toEqualTypeOf<Command>();
  });

  it.each(Object.values(examples))('passes a valid $kind unchanged', (command) => {
    // As it arrives: through JSON, never the sender's own object.
    const res = parseCommand(JSON.parse(JSON.stringify(command)));
    expect(res).toEqual({ ok: true, command });
  });

  it('covers every command kind', () => {
    expect(Object.keys(examples)).toHaveLength(39);
    expect(Object.entries(examples).every(([k, c]) => c.kind === k)).toBe(true);
  });

  it('refuses an id that names a property of Object.prototype', () => {
    for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'x__proto__y']) {
      expect(isSafeText(bad), bad).toBe(false);
      expect(refused({ kind: 'contract.buyout', playerId: bad }), bad).toBe(true);
      expect(refused({ ...examples['lines.set'], order: [p, bad] }), bad).toBe(true);
      expect(refused({ ...examples['team.rename'], city: bad }), bad).toBe(true);
      expect(refused({ ...examples['training.set'], focus: bad }), bad).toBe(true);
      // A pick id is split by the engine: its team part is an id too.
      const offer = { ...proposal, givePicks: [`2028-1-${bad}`] };
      expect(refused({ kind: 'trade.propose', proposal: offer }), bad).toBe(true);
    }
    expect(refused({ kind: 'trade.propose', proposal: { ...proposal, getPicks: ['first'] } })).toBe(
      true,
    );
  });

  it('refuses an empty or oversized string or list', () => {
    expect(refused({ kind: 'contract.buyout', playerId: '' })).toBe(true);
    expect(parseCommand({ kind: 'contract.buyout', playerId: 'x'.repeat(ID_MAX) }).ok).toBe(true);
    expect(refused({ kind: 'contract.buyout', playerId: 'x'.repeat(ID_MAX + 1) })).toBe(true);
    expect(refused({ ...examples['team.rename'], name: 'x'.repeat(65) })).toBe(true);
    const many = Array.from({ length: 1001 }, (_, i) => `p${i}`);
    expect(refused({ ...examples['draft.setBoard'], order: many })).toBe(true);
    expect(parseCommand({ ...examples['draft.setBoard'], order: many.slice(1) }).ok).toBe(true);
  });

  it('refuses an extra key, at any depth', () => {
    const actor = { id: 'local', controls: [] };
    expect(refused({ kind: 'season.rollover', actor })).toBe(true);
    expect(refused({ kind: 'trade.propose', proposal: { ...proposal, actor } })).toBe(true);
    const kept = [{ playerId: p, pct: 25, actor }];
    expect(refused({ kind: 'trade.propose', proposal: { ...proposal, retain: kept } })).toBe(true);
    // JSON.parse makes `__proto__` an ordinary own key: it is an extra key like any other.
    const sneaky: unknown = JSON.parse('{"kind":"season.rollover","__proto__":{"admin":true}}');
    expect(refused(sneaky)).toBe(true);
    expect(({} as { admin?: boolean }).admin).toBeUndefined();
    // A long fault is cut short: it quotes the sender's own text.
    const res = parseCommand({ kind: 'season.rollover', ['k'.repeat(5000)]: 1 });
    expect(!res.ok && res.error.message.length).toBeLessThanOrEqual(200);
  });

  it('refuses an unknown kind and anything that is not a command', () => {
    for (const bad of [{ kind: 'league.delete' }, {}, null, undefined, 'season.rollover', 7, []]) {
      expect(refused(bad), JSON.stringify(bad)).toBe(true);
    }
    expect(refused([{ kind: 'season.rollover' }])).toBe(true);
    expect(refused(new Map([['kind', 'season.rollover']]))).toBe(true);
  });

  it('refuses a number that is not finite, not whole where it counts, or far too big', () => {
    for (const days of [NaN, Infinity, -Infinity, 1.5, -1, 1e9, '3', null, [3]]) {
      expect(refused({ kind: 'sim.advance', days }), String(days)).toBe(true);
    }
    // The engine sizes a contract by its years.
    expect(refused({ ...examples['contract.sign'], years: 1e9 })).toBe(true);
    expect(refused({ ...examples['contract.sign'], salary: 1.5 })).toBe(true);
    expect(refused({ ...examples['contract.sign'], salary: Number.MAX_SAFE_INTEGER + 2 })).toBe(
      true,
    );
    expect(refused({ ...examples['finance.setTicketPrice'], pct: NaN })).toBe(true);
    expect(refused({ ...examples['team.relocate'], market: Infinity })).toBe(true);
  });

  it('refuses a wrong type or a value outside a fixed set', () => {
    expect(refused({ ...examples['trade.respond'], accept: 'yes' })).toBe(true);
    expect(refused({ ...examples['contract.sign'], noTrade: false })).toBe(true);
    expect(refused({ ...examples['units.set'], unit: 'pp9' })).toBe(true);
    expect(refused({ ...examples['staff.fire'], department: 'owner' })).toBe(true);
    expect(refused({ kind: 'sim.advance', days: 1, stopOn: ['league', 'everything'] })).toBe(true);
    expect(refused({ ...examples['lines.set'], order: 'p12' })).toBe(true);
    expect(refused({ ...examples['lines.set'], teamId: 7 })).toBe(true);
  });
});

describe('roster files', () => {
  const file = (id: string) => ({
    formatVersion: 2,
    sport: 'nhl',
    season: 2026,
    name: 'Test',
    teams: ['AAA', 'BBB'].map((abbreviation) => ({ abbreviation, city: 'City', name: 'Name' })),
    players: [
      {
        id,
        firstName: 'A',
        lastName: 'B',
        birthYear: 2000,
        team: 'AAA',
        position: 'C',
        potential: 70,
        skater: Object.fromEntries(SKATER_RATINGS.map((k) => [k, 60])),
      },
    ],
  });

  it('cannot bring in a player whose id every command would refuse', () => {
    expect(parseRosterFile(file('8478402')).success).toBe(true);
    // The league's id is `p_` + the file's.
    expect(parseRosterFile(file('_proto__')).success).toBe(false);
    expect(parseRosterFile(file('x'.repeat(65))).success).toBe(false);
  });
});
