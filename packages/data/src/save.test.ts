import { describe, expect, it } from 'vitest';
import type { Player, Team, TeamId } from '@gm/shared';
import { openSave } from './index';

const teams: Team[] = [
  {
    id: 'a' as Team['id'],
    city: 'Aurora',
    name: 'Wolves',
    abbreviation: 'AUR',
    userControlled: true,
  },
  {
    id: 'b' as Team['id'],
    city: 'Bayview',
    name: 'Comets',
    abbreviation: 'BAY',
    userControlled: false,
  },
];
const players: Player[] = [
  {
    id: 'p1' as Player['id'],
    teamId: teams[0]!.id,
    firstName: 'Test',
    lastName: 'Goalie',
    birthYear: 2000,
    position: 'G',
    potential: 80,
    goalie: { reflexes: 70, positioning: 70, reboundControl: 70, consistency: 70 },
  },
];

describe('SaveFile', () => {
  it('migrates, stores and reads back a league', () => {
    const save = openSave(':memory:');
    save.insertLeague(teams, players);
    expect(save.listTeams().map((t) => t.abbreviation)).toEqual(['AUR', 'BAY']);
    expect(save.listPlayers()[0]!.goalie?.reflexes).toBe(70);
    save.close();
  });

  it('tracks unplayed games and records results', () => {
    const save = openSave(':memory:');
    save.insertLeague(teams, []);
    save.insertSchedule(2027, [
      { id: 'g0', day: 0, homeTeamId: 'a' as TeamId, awayTeamId: 'b' as TeamId },
      { id: 'g1', day: 1, homeTeamId: 'b' as TeamId, awayTeamId: 'a' as TeamId },
    ]);
    const today = save.nextUnplayed(2027, 1);
    expect(today.map((g) => g.id)).toEqual(['g0']);
    save.recordResults([
      {
        id: 'g0' as never,
        homeTeamId: 'a' as TeamId,
        awayTeamId: 'b' as TeamId,
        homeGoals: 3,
        awayGoals: 2,
        overtime: false,
        shootout: false,
        homeShots: 30,
        awayShots: 25,
      },
    ]);
    expect(save.nextUnplayed(2027, 1).map((g) => g.id)).toEqual(['g1']);
    save.close();
  });
});
