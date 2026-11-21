import { useEffect, useRef } from 'react';
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  CLOCK_COMMANDS,
  type Command,
  type GmApi,
  type Importance,
  type SessionResult,
  type SessionStatus,
  type TeamId,
  type TradeProposal,
} from '@gm/shared';
import { useUi } from '@/stores/ui';
import { useT } from '@/i18n';

/** All data hooks in one place so query keys stay consistent. */
const keys = {
  teams: ['league', 'teams'] as const,
  standings: ['league', 'standings'] as const,
  playoffs: ['league', 'playoffs'] as const,
  awards: ['league', 'awards'] as const,
  records: ['league', 'records'] as const,
  leaders: ['league', 'leaders'] as const,
  feed: ['league', 'feed'] as const,
  games: (teamId: TeamId | undefined) => ['league', 'games', teamId ?? 'all'] as const,
  capSheet: (teamId: TeamId) => ['league', 'capSheet', teamId] as const,
  roster: (teamId: TeamId) => ['league', 'roster', teamId] as const,
  resignOffers: (teamId: TeamId) => ['league', 'resignOffers', teamId] as const,
  steam: ['steam'] as const,
  session: ['session'] as const,
};

export const useTeams = () =>
  useQuery({ queryKey: keys.teams, queryFn: () => window.gm.league.listTeams() });
/**
 * The team "you" run: the hot-seat GM's human team, else this window's team in a hosted league,
 * else the first human team. A guest runs the team the host seated him on and no other.
 */
export function useMine() {
  const { data: teams = [] } = useTeams();
  const seat = useUi((s) => s.seat);
  const { guest, me } = useOnline();
  const humans = teams.filter((x) => x.userControlled);
  const own = humans.find((x) => x.id === me?.teamId);
  if (guest) return own;
  return humans.find((x) => x.id === seat) ?? own ?? humans[0];
}

/** Where this window stands online: no session, the host of one, or a guest in one. */
export const useSession = () =>
  useQuery({ queryKey: keys.session, queryFn: () => window.gm.session.status() });
/**
 * This window in a hosted league. `me`: its row in the lobby. `guest`: it reads the host's league
 * and runs one team. `open`: a session is open. `clock`: it may move the clock (the host, a guest
 * he granted it, and anyone outside a session).
 */
export function useOnline() {
  const { data: session } = useSession();
  const open = !!session && session.role !== 'none';
  const me = open ? session.peers[session.you] : undefined;
  const guest = session?.role === 'guest';
  return { session, me, guest, open, clock: !guest || !!me?.can.includes('advance') };
}
/** The seated GMs other than this window's who are not done: not ready, or away. */
export function notReady(session: SessionStatus | undefined): string[] {
  if (!session || session.role === 'none') return [];
  return session.peers
    .filter((p, i) => i !== session.you && p.teamId !== null && !(p.ready && p.connected))
    .map((p) => p.name);
}
/** The lobby and every league read again: the league may be another one, or another GM's command changed it. */
function refresh(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: keys.session });
  return qc.invalidateQueries({ queryKey: ['league'] });
}
/** Listens to main's push (what this window did not ask for) and refetches. Once, in `App`. */
export function usePush() {
  const qc = useQueryClient();
  useEffect(() => window.gm.session.onChanged(() => void refresh(qc)), [qc]);
  // Another league from here on (joined as a guest, or back from it): nothing of the last one
  // stays on screen, even where this machine has no league of its own to show instead.
  const guest = useSession().data?.role === 'guest';
  const was = useRef(guest);
  useEffect(() => {
    if (was.current === guest) return;
    was.current = guest;
    void qc.resetQueries({ queryKey: ['league'] });
  }, [guest, qc]);
}
/** A call on the hosted league, `call.mutate((s) => s.host({ name }))`: its answer is the mutation's data. */
export function useSessionCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (call: (session: GmApi['session']) => Promise<SessionResult>) =>
      call(window.gm.session),
    onSuccess: () => refresh(qc),
  });
}
/** How many things wait on each of these teams' GMs (the length of his Home "To do"), by team. */
export function useTodoCounts(teamIds: readonly TeamId[]) {
  const results = useQueries({
    queries: teamIds.map((teamId) => ({
      queryKey: ['league', 'dashboard', teamId] as const,
      queryFn: () => window.gm.league.dashboard({ teamId }),
    })),
  });
  return Object.fromEntries(
    teamIds.map((id, i) => {
      const home = results[i]?.data;
      return [id, home && home.todo.length + home.ownerCards.length];
    }),
  );
}
export const useStandings = () =>
  useQuery({ queryKey: keys.standings, queryFn: () => window.gm.league.standings() });
export const usePlayoffs = () =>
  useQuery({ queryKey: keys.playoffs, queryFn: () => window.gm.league.playoffs() });
export const useAwards = () =>
  useQuery({ queryKey: keys.awards, queryFn: () => window.gm.league.awards() });
export const useHallOfFame = () =>
  useQuery({
    queryKey: ['league', 'hallOfFame'] as const,
    queryFn: () => window.gm.league.hallOfFame(),
  });
export const useInternational = () =>
  useQuery({
    queryKey: ['league', 'international'] as const,
    queryFn: () => window.gm.league.international(),
  });
export const useLeaders = () =>
  useQuery({ queryKey: keys.leaders, queryFn: () => window.gm.league.leaders() });
export const useRecords = () =>
  useQuery({ queryKey: keys.records, queryFn: () => window.gm.league.records() });
export const useCapSheet = (teamId: TeamId | undefined) =>
  useQuery({
    queryKey: keys.capSheet(teamId!),
    queryFn: () => window.gm.league.capSheet({ teamId: teamId! }),
    enabled: !!teamId,
  });
export const useRoster = (teamId: TeamId | undefined) =>
  useQuery({
    queryKey: keys.roster(teamId!),
    queryFn: () => window.gm.league.roster({ teamId: teamId! }),
    enabled: !!teamId,
  });
export const useResignOffers = (teamId: TeamId | undefined) =>
  useQuery({
    queryKey: keys.resignOffers(teamId!),
    queryFn: () => window.gm.league.resignOffers({ teamId: teamId! }),
    enabled: !!teamId,
  });
/** The other team's answer to a trade, refetched whenever the offer changes. */
export const useTradeEvaluation = (proposal: TradeProposal | undefined) =>
  useQuery({
    queryKey: ['league', 'tradeEvaluation', proposal] as const,
    queryFn: () => window.gm.league.evaluateTrade(proposal!),
    enabled:
      !!proposal &&
      [
        proposal.give,
        proposal.get,
        proposal.givePicks,
        proposal.getPicks,
        proposal.giveProspects,
        proposal.getProspects,
      ].some((ids) => ids?.length),
  });
export const useDraftClass = (teamId: TeamId | undefined) =>
  useQuery({
    queryKey: ['league', 'draftClass', teamId] as const,
    queryFn: () => window.gm.league.draftClass({ teamId: teamId! }),
    enabled: !!teamId,
  });
/** `teamId`'s prospects, read by `by`'s scouts (default: his own team's). */
export const useProspects = (teamId: TeamId | undefined, by?: TeamId) =>
  useQuery({
    queryKey: ['league', 'prospects', teamId, by] as const,
    queryFn: () => window.gm.league.prospects({ teamId: teamId!, ...(by && { by }) }),
    enabled: !!teamId,
  });
export const useDashboard = (teamId: TeamId | undefined) =>
  useQuery({
    queryKey: ['league', 'dashboard', teamId] as const,
    queryFn: () => window.gm.league.dashboard({ teamId: teamId! }),
    enabled: !!teamId,
  });
export const usePulse = () =>
  useQuery({ queryKey: ['league', 'pulse'] as const, queryFn: () => window.gm.league.pulse() });
export const useTradeRequests = (teamId: TeamId | undefined) =>
  useQuery({
    queryKey: ['league', 'tradeRequests', teamId] as const,
    queryFn: () => window.gm.league.tradeRequests({ teamId: teamId! }),
    enabled: !!teamId,
  });
export const useOwner = (teamId: TeamId | undefined) =>
  useQuery({
    queryKey: ['league', 'owner', teamId] as const,
    queryFn: () => window.gm.league.owner({ teamId: teamId! }),
    enabled: !!teamId,
  });
export const useStaffCandidates = (teamId: TeamId | undefined) =>
  useQuery({
    queryKey: ['league', 'staffCandidates', teamId] as const,
    queryFn: () => window.gm.league.staffCandidates({ teamId: teamId! }),
    enabled: !!teamId,
  });
export const useDepartmentReturns = (teamId: TeamId | undefined) =>
  useQuery({
    queryKey: ['league', 'departmentReturns', teamId] as const,
    queryFn: () => window.gm.league.departmentReturns({ teamId: teamId! }),
    enabled: !!teamId,
  });
export const useOwnerReport = (teamId: TeamId | undefined) =>
  useQuery({
    queryKey: ['league', 'ownerReport', teamId] as const,
    queryFn: () => window.gm.league.ownerReport({ teamId: teamId! }),
    enabled: !!teamId,
  });
export const useOfferSheets = (teamId: TeamId | undefined) =>
  useQuery({
    queryKey: ['league', 'offerSheets', teamId] as const,
    queryFn: () => window.gm.league.offerSheets({ teamId: teamId! }),
    enabled: !!teamId,
  });
export const useTradeOffers = (teamId: TeamId | undefined) =>
  useQuery({
    queryKey: ['league', 'tradeOffers', teamId] as const,
    queryFn: () => window.gm.league.tradeOffers({ teamId: teamId! }),
    enabled: !!teamId,
  });
export const usePicks = (teamId: TeamId | undefined) =>
  useQuery({
    queryKey: ['league', 'picks', teamId] as const,
    queryFn: () => window.gm.league.picks({ teamId: teamId! }),
    enabled: !!teamId,
  });
export const useLines = (teamId: TeamId | undefined) =>
  useQuery({
    queryKey: ['league', 'lines', teamId] as const,
    queryFn: () => window.gm.league.lines({ teamId: teamId! }),
    enabled: !!teamId,
  });
export const useCareer = (playerId: string | undefined) =>
  useQuery({
    queryKey: ['league', 'career', playerId] as const,
    queryFn: () => window.gm.league.career({ playerId: playerId! }),
    enabled: !!playerId,
  });
export const useHistory = (playerId: string | undefined) =>
  useQuery({
    queryKey: ['league', 'history', playerId] as const,
    queryFn: () => window.gm.league.history({ playerId: playerId! }),
    enabled: !!playerId,
  });
export const useStatus = () =>
  useQuery({ queryKey: ['league', 'status'] as const, queryFn: () => window.gm.league.status() });
export const useSigningInterest = (
  input: Parameters<GmApi['league']['signingInterest']>[0] | undefined,
) =>
  useQuery({
    queryKey: ['league', 'signingInterest', input] as const,
    queryFn: () => window.gm.league.signingInterest(input!),
    enabled: !!input,
  });
/** `null` = free agents. Seen through the analytics department of the GM at the controls. */
export function usePlayers(teamId: TeamId | null | undefined) {
  const viewer = useMine()?.id;
  return useQuery({
    queryKey: ['league', 'players', teamId ?? 'fa', viewer] as const,
    queryFn: () => window.gm.league.players({ teamId: teamId ?? null, ...(viewer && { viewer }) }),
    enabled: teamId !== undefined,
  });
}
/** Every player in the league: one read per team, plus free agents. */
export const useAllPlayers = (teamIds: readonly TeamId[]) =>
  useQuery({
    queryKey: ['league', 'allPlayers', teamIds.join()] as const,
    queryFn: async () =>
      (
        await Promise.all([...teamIds, null].map((teamId) => window.gm.league.players({ teamId })))
      ).flat(),
    enabled: teamIds.length > 0,
  });
export const useGames = (teamId: TeamId | undefined, limit = 30) =>
  useQuery({
    queryKey: [...keys.games(teamId), limit],
    queryFn: () => window.gm.league.games({ ...(teamId ? { teamId } : {}), limit }),
  });

/** One-shot reads that are not cached: open a played game, or play an exhibition. */
export const useOpenGame = () =>
  useMutation({ mutationFn: (id: string) => window.gm.league.game({ id }) });
export const useExhibition = () =>
  useMutation({
    mutationFn: (input: { homeTeamId: TeamId; awayTeamId: TeamId; seed: number }) =>
      window.gm.league.exhibition(input),
  });
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

export const useFeed = (limit = 20, minImportance: Importance = 'notable') =>
  useQuery({
    queryKey: [...keys.feed, limit, minImportance],
    queryFn: () => window.gm.feed.list({ limit, minImportance }),
  });

/**
 * The one way the UI changes game state: send a Command. Errors come back as data, not throws.
 * After any command, everything under the 'league' key is refetched.
 * In a hosted league, whoever moves the clock past a GM who is not ready confirms it first.
 */
export function useDispatch() {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: (command: Command) => {
      const waiting = CLOCK_COMMANDS.has(command.kind)
        ? notReady(qc.getQueryData<SessionStatus>(keys.session))
        : [];
      if (
        waiting.length > 0 &&
        !window.confirm(t('online.confirmAdvance', { names: waiting.join(', ') }))
      )
        return Promise.reject(new Error('not advanced'));
      return window.gm.commands.dispatch(command);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['league'] }),
  });
}
