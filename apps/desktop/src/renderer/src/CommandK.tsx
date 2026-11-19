import { useAllPlayers, useTeams } from '@/lib/queries';
import { fullName } from '@/lib/format';
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
  const { setScreen, openRoster, openTeam } = useUi();
  const { data: teams = [] } = useTeams();
  const { data: players = [] } = useAllPlayers(teams.map((x) => x.id));

  const items: PaletteItem[] = [
    ...screens.map((s) => ({ id: `s:${s.id}`, label: t(s.label), hint: t('palette.screen') })),
    ...teams.map((x) => ({
      id: `t:${x.id}`,
      label: `${x.city} ${x.name} ${x.abbreviation}`,
      hint: t('palette.team'),
    })),
    ...players.map((p) => ({
      id: `p:${p.teamId ?? 'fa'}:${p.id}`,
      label: fullName(p),
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
        else if (kind === 't') openTeam(a!);
        else openRoster(a!, b);
        onClose();
      }}
    />
  );
}
