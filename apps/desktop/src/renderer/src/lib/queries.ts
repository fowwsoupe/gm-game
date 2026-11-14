import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/** All data hooks in one place so query keys stay consistent. */
export const keys = {
  teams: ['league', 'teams'] as const,
  standings: ['league', 'standings'] as const,
  steam: ['steam'] as const,
};

export const useTeams = () =>
  useQuery({ queryKey: keys.teams, queryFn: () => window.gm.league.listTeams() });
export const useStandings = () =>
  useQuery({ queryKey: keys.standings, queryFn: () => window.gm.league.standings() });
export const useSteam = () =>
  useQuery({ queryKey: keys.steam, queryFn: () => window.gm.steam.status() });

export function useNewLeague() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (seed: number) => window.gm.league.newLeague({ seed }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['league'] }),
  });
}

export function useSimDays() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (days: number) => window.gm.sim.simDays({ days }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['league'] }),
  });
}
