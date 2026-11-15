import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Command } from '@gm/shared';

/** All data hooks in one place so query keys stay consistent. */
export const keys = {
  teams: ['league', 'teams'] as const,
  standings: ['league', 'standings'] as const,
  playoffs: ['league', 'playoffs'] as const,
  feed: ['league', 'feed'] as const,
  steam: ['steam'] as const,
};

export const useTeams = () =>
  useQuery({ queryKey: keys.teams, queryFn: () => window.gm.league.listTeams() });
export const useStandings = () =>
  useQuery({ queryKey: keys.standings, queryFn: () => window.gm.league.standings() });
export const usePlayoffs = () =>
  useQuery({ queryKey: keys.playoffs, queryFn: () => window.gm.league.playoffs() });
export const useSteam = () =>
  useQuery({ queryKey: keys.steam, queryFn: () => window.gm.steam.status() });

export function useNewLeague() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (seed: number) => window.gm.league.newLeague({ seed }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['league'] }),
  });
}

export function useNewLeagueFromRoster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (seed: number) => window.gm.league.newLeagueFromRoster({ seed }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['league'] }),
  });
}

export const useFeed = (limit = 20) =>
  useQuery({
    queryKey: [...keys.feed, limit],
    queryFn: () => window.gm.feed.list({ limit, minImportance: 'notable' }),
  });

/**
 * The one way the UI changes game state: send a Command. Errors come back as data, not throws.
 * After any command, everything under the 'league' key is refetched.
 */
export function useDispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (command: Command) => window.gm.commands.dispatch(command),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['league'] }),
  });
}
