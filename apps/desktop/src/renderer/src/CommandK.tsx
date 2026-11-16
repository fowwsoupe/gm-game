import { useQuery } from '@tanstack/react-query';
import { useTeams } from '@/lib/queries';
import { useUi, type Screen } from '@/stores/ui';
import { useT, type MessageKey } from '@/i18n';
import { Palette, type PaletteItem } from '@/ui';

/** Cmd/Ctrl+K: jump to a player, team or screen. */
export function CommandK({
  screens,
  onClose,
}: {
  screens: { id: Screen; label: MessageKey }[];
  onClose: () => void;
}) {
  const t = useT();
  const { setScreen, openRoster } = useUi();
  const { data: teams = [] } = useTeams();
  // Every player in the league: one cached read per team, plus free agents.
  const { data: players = [] } = useQuery({
    queryKey: ['league', 'allPlayers', teams.map((x) => x.id).join()],
    queryFn: async () =>
      (
        await Promise.all(
          [...teams.map((x) => x.id), null].map((teamId) => window.gm.league.players({ teamId })),
        )
      ).flat(),
    enabled: teams.length > 0,
  });

  const items: PaletteItem[] = [
    ...screens.map((s) => ({ id: `s:${s.id}`, label: t(s.label), hint: t('palette.screen') })),
    ...teams.map((x) => ({
      id: `t:${x.id}`,
      label: `${x.city} ${x.name} ${x.abbreviation}`,
      hint: t('palette.team'),
    })),
    ...players.map((p) => ({
      id: `p:${p.teamId ?? 'fa'}:${p.id}`,
      label: `${p.firstName} ${p.lastName}`,
      hint: t('palette.player'),
    })),
  ];

  return (
    <Palette
      items={items}
      placeholder={t('palette.placeholder')}
      empty={t('palette.empty')}
      onClose={onClose}
      onPick={(id) => {
        const [kind, a, b] = id.split(':');
        if (kind === 's') setScreen(a as Screen);
        // TODO(#58): open the team page here once it exists; the roster is the closest screen.
        else if (kind === 't') openRoster(a!);
        else openRoster(a!, b);
        onClose();
      }}
    />
  );
}
