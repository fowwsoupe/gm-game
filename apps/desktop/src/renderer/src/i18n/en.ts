/**
 * English strings: the source of truth for keys. Every user-facing word in the UI comes
 * from here, never hard-coded in components. Other languages must provide the same keys
 * (TypeScript enforces it in fr.ts).
 */
export const en = {
  'app.name': 'GM Game',
  'nav.home': 'Home',
  'nav.standings': 'Standings',
  'nav.roster': 'Roster',
  'actions.newLeague': 'New league',
  'actions.loadRoster': 'Load roster file…',
  'actions.simDay': 'Sim day',
  'actions.simWeek': 'Sim week',
  'actions.simToNext': 'Sim to next event',
  'home.empty': 'Start a new league to begin.',
  'home.teamsLoaded': '{count} teams loaded.',
  'home.simmed': 'Simmed {days} day(s): {games} games played.',
  'home.feedTitle': 'League news',
  'home.feedEmpty': 'Nothing yet. Sim a few days.',
  'roster.loadFailed': 'Could not load roster:',
  'roster.placeholder': 'Roster screen: first UI task.',
  'steam.on': 'Steam: {name}',
  'steam.off': 'Steam: off',
  'event.statusChanged': '{team} is now a {status}',
  'event.phaseChanged': 'The {phase} has begun',
  'status.contender': 'contender',
  'status.buyer': 'buyer',
  'status.bubble': 'bubble team',
  'status.seller': 'seller',
  'status.rebuilder': 'rebuilding team',
  'status.crisis': 'team in crisis',
  'phase.preseason': 'preseason',
  'phase.regular': 'regular season',
  'phase.playoffs': 'playoffs',
  'phase.offseason': 'offseason',
  'stats.team': 'Team',
} as const;

export type MessageKey = keyof typeof en;
