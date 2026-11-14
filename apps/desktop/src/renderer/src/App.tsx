import { useNewLeague, useSimDays, useSteam, useTeams } from '@/lib/queries';
import { useUi, type Screen } from '@/stores/ui';
import { Standings } from '@/screens/Standings';

const NAV: { id: Screen; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'standings', label: 'Standings' },
  { id: 'roster', label: 'Roster' },
];

export function App() {
  const { screen, setScreen } = useUi();
  const { data: steam } = useSteam();
  const { data: teams = [], isError } = useTeams();
  const newLeague = useNewLeague();
  const simDays = useSimDays();
  const hasLeague = !isError && teams.length > 0;

  return (
    <div className="flex h-full">
      <aside className="flex w-56 flex-col gap-1 border-r border-line bg-panel p-3">
        <div className="mb-4 px-2 text-lg font-semibold">GM Game</div>
        {NAV.map((n) => (
          <button
            key={n.id}
            onClick={() => setScreen(n.id)}
            className={`rounded px-2 py-1.5 text-left text-sm ${screen === n.id ? 'bg-line text-ink' : 'text-muted hover:text-ink'}`}
          >
            {n.label}
          </button>
        ))}
        <div className="mt-auto px-2 text-xs text-muted">
          Steam: {steam?.enabled ? `connected (${steam.playerName})` : 'off'}
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-6">
        <div className="mb-6 flex gap-2">
          <button
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-bg"
            onClick={() => newLeague.mutate(Math.floor(Math.random() * 1e9))}
          >
            New league
          </button>
          <button
            disabled={!hasLeague || simDays.isPending}
            className="rounded border border-line px-3 py-1.5 text-sm disabled:opacity-40"
            onClick={() => simDays.mutate(1)}
          >
            Sim day
          </button>
          <button
            disabled={!hasLeague || simDays.isPending}
            className="rounded border border-line px-3 py-1.5 text-sm disabled:opacity-40"
            onClick={() => simDays.mutate(7)}
          >
            Sim week
          </button>
        </div>

        {screen === 'home' && (
          <p className="text-muted">
            {hasLeague
              ? `${teams.length} teams loaded. Open Standings and sim some days.`
              : 'Start a new league to begin.'}
          </p>
        )}
        {screen === 'standings' && <Standings />}
        {screen === 'roster' && (
          <p className="text-muted">Roster screen: first task for whoever owns the UI.</p>
        )}
      </main>
    </div>
  );
}
