import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { SessionPeer, SessionStatus, Team, TeamId } from '@gm/shared';
import { notReady } from '@/lib/queries';
import { OnlineView } from './Online';

const team = (id: string, city: string, abbreviation: string) =>
  ({ id, city, name: 'Club', abbreviation, userControlled: false }) as Team;
const teams = [
  team('t1', 'Boston', 'BOS'),
  team('t2', 'Laval', 'LAV'),
  team('t3', 'Gander', 'GAN'),
];
const peer = (
  name: string,
  teamId: string | null,
  more: Partial<SessionPeer> = {},
): SessionPeer => ({
  name,
  teamId: teamId as TeamId | null,
  wish: null,
  connected: true,
  ready: false,
  can: [],
  ...more,
});
const host = peer('Minh', 't1', { can: ['advance'] });

/** The screen as static markup: what it shows in a state, without a window. */
const show = (status: SessionStatus, more: { teams?: Team[]; error?: string } = {}) =>
  renderToStaticMarkup(
    <OnlineView
      status={status}
      teams={more.teams ?? teams}
      todo={{ t1: 3, t2: 0 }}
      defaultName="Steam name"
      busy={false}
      error={more.error ?? null}
      act={() => {}}
    />,
  );
/** A button's attributes, by its label: absent when the screen has no such button. */
const button = (html: string, label: string) =>
  new RegExp(`<button([^>]*)>${label}</button>`).exec(html)?.[1];
/** The lobby as text: each GM's name, team, status and to-do count. */
const lobby = (html: string) =>
  [...html.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)]
    .map((row) => [...row[1]!.matchAll(/<td[^>]*>(.*?)<\/td>/g)])
    .filter((cells) => cells.length > 0)
    .map((cells) => cells.slice(0, 4).map((cell) => cell[1]!.replace(/<[^>]+>/g, '')));

it('no session: host or join, and nothing to host without a league', () => {
  const html = show({ role: 'none' });
  expect(html).toContain('placeholder="Steam name"');
  expect(button(html, 'Host')).not.toContain(' disabled=""');
  // Nothing typed yet: there is no address to join.
  expect(button(html, 'Join')).toContain(' disabled=""');
  expect(html).toContain('not encrypted');
  expect(html).not.toContain('text-bad');

  const empty = show({ role: 'none' }, { teams: [] });
  expect(button(empty, 'Host')).toContain(' disabled=""');
  expect(empty).toContain('Start a new league to begin.');
});

it('no session: why the last one ended, and why a call failed', () => {
  expect(show({ role: 'none', ended: 'kicked' })).toContain('The host removed you');
  expect(show({ role: 'none', ended: 'closed' })).toContain('The host closed the league.');
  expect(show({ role: 'none', ended: 'error' })).toContain('stopped on an error');
  expect(show({ role: 'none' }, { error: 'refused: joinCode' })).toContain('Wrong code');
  expect(show({ role: 'none' }, { error: 'refused: appVersion' })).toContain('another version');
  // A reason we have no words for is shown as it came.
  const raw = 'connect ECONNREFUSED 127.0.0.1:5000';
  expect(show({ role: 'none' }, { error: raw })).toContain(`That did not work: ${raw}`);
});

it('the host: what a friend types, the lobby, and his tools on each guest', () => {
  const html = show({
    role: 'host',
    you: 0,
    direct: { addresses: ['192.168.1.20', '10.0.0.5'], port: 51234, joinCode: 'K7M2QX' },
    peers: [
      host,
      peer('Asker', null, { key: '1', wish: 't2' as TeamId }),
      peer('Done', 't2', { key: '2', ready: true, can: ['advance'] }),
      peer('Gone', 't3', { key: '3', connected: false, ready: true }),
    ],
  });
  expect(html).toContain('192.168.1.20, 10.0.0.5');
  expect(html).toContain('51234');
  expect(html).toContain('K7M2QX');
  expect(button(html, 'Stop hosting')).toBeDefined();
  // Who is done and who is away; to do: the count for a seated team (zero included), a dash for
  // no team or no answer yet.
  expect(lobby(html)).toEqual([
    ['Minh (you)', 'Boston Club', 'Not ready · can advance', '3'],
    ['Asker', 'Asked for Laval Club', 'Not ready', '–'],
    ['Done', 'Laval Club', 'Ready · can advance', '0'],
    ['Gone', 'Gander Club', 'Disconnected', '–'],
  ]);
  // A wish for a team another GM holds cannot be given.
  expect(button(html, 'Give LAV')).toBeUndefined();
  // One set of tools for each guest, none for the host's own row.
  expect(html.match(/>Kick<\/button>/g)).toHaveLength(3);
  expect(html.match(/>Let advance<\/button>/g)).toHaveLength(2);
  expect(html.match(/>Take back advance<\/button>/g)).toHaveLength(1);

  const free = show({
    role: 'host',
    you: 0,
    direct: { addresses: [], port: 5000, joinCode: 'ABCDEF' },
    peers: [host, peer('Asker', null, { key: '1', wish: 't2' as TeamId })],
  });
  expect(button(free, 'Give LAV')).toBeDefined();
  expect(free).toContain('127.0.0.1'); // no network: this machine can still join itself
});

it('a guest: asks for a team, sees the lobby, and has none of the host tools', () => {
  const waiting = show({
    role: 'guest',
    you: 1,
    reconnecting: false,
    peers: [host, peer('Guy', null)],
  });
  expect(waiting).toContain('You are a guest');
  expect(waiting).toContain('<option value="" selected="">Ask for a team</option>');
  // Only a team nobody holds can be asked for.
  expect(waiting).not.toContain('<option value="t1">');
  expect(waiting).toContain('<option value="t2">Laval Club</option>');
  expect(lobby(waiting)).toEqual([
    ['Minh', 'Boston Club', 'Not ready · can advance', '3'],
    ['Guy (you)', 'No team', 'Not ready', '–'],
  ]);
  expect(button(waiting, 'Leave')).toBeDefined();
  for (const tool of ['Kick', 'Let advance', 'Stop hosting'])
    expect(button(waiting, tool)).toBeUndefined();
  expect(waiting).not.toContain('Reconnecting');

  const seated = show({
    role: 'guest',
    you: 1,
    reconnecting: true,
    peers: [host, peer('Guy', 't2', { ready: true })],
  });
  expect(seated).not.toContain('Ask for a team');
  expect(lobby(seated)[1]).toEqual(['Guy (you)', 'Laval Club', 'Ready', '0']);
  expect(seated).toContain('Connection lost. Reconnecting…');
});

it('who is not ready: the seated GMs other than this one who are not done, or away', () => {
  expect(notReady(undefined)).toEqual([]);
  expect(notReady({ role: 'none' })).toEqual([]);
  const peers = [
    host, // not ready, but he is the one advancing
    peer('Done', 't2', { ready: true }),
    peer('Busy', 't3'),
    peer('Gone', 't4', { ready: true, connected: false }),
    peer('Watching', null),
  ];
  const direct = { addresses: [], port: 1, joinCode: '' };
  expect(notReady({ role: 'host', you: 0, peers, direct })).toEqual(['Busy', 'Gone']);
  // A granted guest advancing: the host counts like anyone else.
  expect(notReady({ role: 'guest', you: 1, peers, reconnecting: false })).toEqual([
    'Minh',
    'Busy',
    'Gone',
  ]);
});
