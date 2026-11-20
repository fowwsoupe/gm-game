# Multiplayer step 2, hosted online league: design brief (2026-11)

The Phase 2 headline "Multiplayer step 2: hosted online league over Steam" (ROADMAP; the Queue
line "Multiplayer step 2, hosted online") and row 2 of the spec's Multiplayer table: one
player's game hosts, friends join over Steam, no servers of ours; every action is a command,
the host validates and sims, 1 to 32 humans per league. Step 1 (hot-seat) put several human GMs
in one save on one machine. This brief says how that save is played from several machines,
settles each open question with a default the owner can overrule (one table, near the end), and
splits the work into seven jobs. Step 3 (our servers, accounts, anti-cheat) is not part of it.

## What exists today

| Piece                         | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commands, events, one reducer | `handleCommand` validates and returns events; `applyEvent` is the only place state changes. `LeagueService.runCommand` is already a host and a mirror in one process: the handler runs in the sim worker on a copy, main applies the returned events to its own state and persists them. `sim.test.ts`: "a second copy that replays the events ends up identical"                                                                                                                                                                                                                                                                 |
| Actors                        | `Actor { id, controls }`. Of the 38 commands, 25 check `controls(actor, team)` (the team is in the actor's list, or the actor is `local` and the team is `userControlled`); `team.rename`, `team.relocate` and `team.setUserControlled` are "local, or your own team"; 5 commissioner tools (`league.expand`, `commissioner.move`, `career.takeJob`, `league.setCanBeFired`, `league.setStopOn`) are local only; 5 clock commands (`sim.advance`, `offseason.openFreeAgency`, `offseason.startDraft`, `freeAgency.advanceDay`, `season.rollover`) check no actor at all. Outside tests nothing builds an actor other than `local` |
| Hot-seat (step 1)             | several `userControlled` teams in one save (`save.test.ts`); a trade between two human GMs is an offer the other answers (`trade.test.ts`); each GM sees other teams through his own analytics department, view only (`frontOffice.test.ts`). The seat is renderer state (`stores/ui.ts`): every command still goes out as `local`                                                                                                                                                                                                                                                                                                |
| Firing                        | `hotSeat.test.ts` is the owner's hot seat: a fired human GM is `state.career`, one slot for the whole league, and the way back, `career.takeJob`, is local only                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `LeagueService`               | one instance in main over a fixed path (`saves/league-1.sqlite`): a queue runs commands one at a time, persists, and reloads from disk when a save fails. Queries read the state and the save's history tables                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Save                          | SQLite, 10 tables, 23 migrations. The state cannot be rebuilt from the `events` table (`clock.advanced` is not stored, and the history tables are written from the state), so a joiner needs a snapshot, not a replay of the log                                                                                                                                                                                                                                                                                                                                                                                                  |
| IPC                           | one `ipcMain.handle` per channel; `commands.dispatch` passes the renderer's command through unchecked; main never pushes anything to the renderer; `newLeague` and `newLeagueFromRoster` are calls, not commands                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Renderer                      | `useDispatch` refetches `['league']` after its own command only; some screens read their command's events from the result (`res.events` in `App.tsx`, `Trades.tsx`, `Roster.tsx`)                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Validation                    | zod only for roster files (`parseRosterFile`). Commands and events are TypeScript types: nothing checks them at run time                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Pending decisions             | the live draft stops at a human pick (`stopForHumans`) and goes on at his `draft.pick`. Everything else runs on game days: a trade offer lapses after 7 days or at the deadline, an offer sheet the next day, owner cards at the next meeting, the free-agent bidding runs 5 market days (`MARKET_DAYS`). "Sim until it matters" already stops for any human team (`matters()` in `advance.ts`)                                                                                                                                                                                                                                   |
| Steam                         | `steam.ts` starts `steamworks.js` 0.4.0 with `STEAM_APP_ID` from the environment (default 480, Valve's public test app) and reads the player's name. No real App ID exists in this repo                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**What `steamworks.js` 0.4.0 offers** (its `client.d.ts` and `callbacks.d.ts`, read for this
brief; the design uses nothing else). Lobbies: `matchmaking.createLobby(LobbyType, maxMembers)`
and `joinLobby(id)`; on a `Lobby`, `getMembers()`, `getOwner()`, `setData` / `getData`,
`setJoinable()`, `openInviteDialog()` and `leave()`. Packets:
`networking.sendP2PPacket(steamId64, SendType.Reliable, Buffer)` (a reliable packet "can't be
larger than 1 megabyte"), `isP2PPacketAvailable()`, `readP2PPacket(size)` giving
`{ data, size, steamId }`, and `acceptP2PSession(steamId64)`. Callbacks:
`P2PSessionRequest { remote }`, `P2PSessionConnectFail { remote, error }`, `LobbyChatUpdate`,
`LobbyDataUpdate` and `GameLobbyJoinRequested { lobby_steam_id, friend_steam_id }`. Not there: a
call that validates an auth ticket (it can only create one), closing or inspecting a P2P
session, kicking a lobby member, lobby chat, another user's display name, and the newer
networking-sockets API.

So "the host validates and sims" is already how one machine works. What is missing is everything
between two machines, and the checks single-player never needed because the only sender was our
own renderer.

## Measured for this brief

A scratch script (not in the repo; job 2 turns its core into a test) played a generated league,
seed 42, through a season, the playoffs, a summer and 30 days of the next season, with a second
copy that was given only table rows and JSON events. The generator always makes 16 teams: a
32-team league (a roster file, or expansion) was not measured, so read each size as roughly
double for 32 teams.

- **A mirror stays identical.** Built from the host's rows at day 39 and fed every later event
  through `JSON.parse(JSON.stringify())`, the copy matched the host after every command to the
  end of the run: the state, the state reloaded from its file, and every row of every table.
- **Events are clean JSON.** 2,441 and 2,591 events in two runs, 45 and 46 of the 75 kinds (the
  kinds only human GMs cause were not exercised), held no `undefined`, non-finite number,
  negative zero or non-plain object, and no key or string naming a property of
  `Object.prototype`.
- **Events:** about 20 KB of JSON a sim day (7 to 26 KB); 30 days in one command 684 KB (104 KB
  gzipped); a whole season in one command 3.3 MB (487 KB gzipped). Simming takes 5 ms a day;
  applying and saving a day's events 1 ms, on the host and on the mirror alike.
- **Save:** 5.4 MB after a season, a summer and 30 days, 4.9 MB of it box scores, which are
  kept for every past season: about 5 MB more each season. As JSON rows 6.0 MB, 0.75 MB
  gzipped. The largest single cells: an event's payload 62 KB, a `meta` value 12 KB, a box
  score 7 KB.
- **Snapshot as rows,** at 1.15 MB: dump 1 ms, JSON 2 ms, parse 1 ms, insert into a fresh
  database 5 ms, load 4 ms.
- **A full-state checksum is not free.** Key order differs between a live state and a reloaded
  one, so it needs sorted-key JSON: 6 to 10 ms per 400 KB, about 70 ms at the end of a season
  (4.4 MB), on the main thread.
- **Not measured:** anything over Steam (no App ID), a 32-team league, a save of many seasons.

## Design

**The host is the only authority.** One `LeagueService` on the host owns the save and is the
only place a command runs. A guest sends `Command`s; the host works out who sent each one from
the connection it arrived on, runs it through the same queue as its own, persists, then sends
the events to every guest in queue order. Nothing is sent before `persist` succeeds, so a guest
never sees an event the save does not hold. Two GMs racing for one free agent are settled by
the queue; the loser gets the ordinary refusal. The wire has no actor field: the host builds
`{ id: <peer key>, controls: [the team the host seated that connection on] }` itself, and
`local` can never come from the network. Default: the person at the host machine stays `local`,
as today. He is the commissioner, plays his own team, and can act for any human team from the
hot-seat switcher, which is also how an absent GM's pick or offer gets answered. (He owns the
save file, so binding him to one team would stop nothing.)

**Host-only actions.** `Actor` gains an optional grant list, `can`, with one member in step 2:
`'advance'`. `handleCommand` refuses the 5 clock commands from an actor who is neither `local`
nor granted. The 5 commissioner tools stay local only, with no grant. One more gate: a
relocation picks a market size, which is money, so `team.relocate` becomes local only (a guest
may still rename his own team). Every gate lets `local` through as before, so single-player
and the lab do not move.

**A guest's game is a mirror, not a second sim.** Joining swaps main's active service for a
second `LeagueService` in mirror mode. It is built from the host's snapshot and applies the
host's events through the same `applyEvent` and `SaveFile.persist` the host ran, so every query
and every screen works on it unchanged, and the renderer still only calls `window.gm`. Its
`dispatch` forwards the command to the host instead of running it. A mirror never runs the sim,
so two machines never have to produce the same floats or hold the same model file. (Views a
guest's machine works out itself, such as odds and advice, use its own build and shot model;
the league only ever runs on the host's.) The mirror's database is in memory
(`openSave(':memory:')`, as the data tests use): the league lives on the host, a guest's own
single-player save is never opened while he is a guest, and leaving swaps it back.
`LeagueService` needs four small things for this: its save path as a parameter, an entry for a
command from a given actor, an entry for events from the host (same queue, same apply and
persist), and a hook that reports each persisted batch.

A guest's `dispatch` resolves like a local one: with the events of its own command, after the
mirror has applied them, because screens read `res.events` and refetch straight away. The host
tags the batch it sends back to the sender with the sender's request id; a refusal comes back
as the same `CommandError` a local command gives. A command is sent once: if the connection
drops before the answer, the promise fails with a "disconnected" error and nothing is resent.

**The wire.** One message is one packet on every transport: JSON, deflated with Node's zlib, at
most 1,000,000 bytes (Steam's reliable limit is 1 MB). There is no reassembly layer: the sender
cuts a long batch of events, or the snapshot, into messages of about 512 KB of JSON, and no
single event or row comes near that (62 KB measured; one that ever outgrew a packet would end
the session with an error, and a reassembly layer would be the fix). A mirror applies a
command's events only when the last piece has arrived, in one call, so it always sits on a
command boundary, where the host's own state sat.

| From  | Message                                           | Carries                                                                                                   |
| ----- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| guest | `hello`                                           | wire protocol number, app version, save schema, display name, join code (direct), resume key (optional)   |
| guest | `seat.request`                                    | a team id: a wish, the host decides                                                                       |
| guest | `ready`                                           | on or off                                                                                                 |
| guest | `command`                                         | a request id and one `Command`                                                                            |
| guest | `resync`                                          | the mirror's event sequence number, or none to ask for a snapshot                                         |
| guest | `pong`                                            | nothing                                                                                                   |
| host  | `welcome` or `refused`                            | session id, ruleset id, sport and a resume key, or the reason                                             |
| host  | `session`                                         | the peer list: name, team, connected, ready, grants                                                       |
| host  | `snapshot.begin`, `snapshot.rows`, `snapshot.end` | table rows in batches; the end carries the event sequence number and the row counts                       |
| host  | `events`                                          | the sequence number before its first event, the events, a last-piece flag, the request id (to the sender) |
| host  | `rejected`                                        | the request id and the `CommandError`                                                                     |
| host  | `ping`, `bye`                                     | nothing, or the reason                                                                                    |

**Everything from the network is untrusted.** Every message, either way, passes a zod schema
before a session acts on it. The schemas, the limits and the parse functions live in
`packages/shared`; unknown message kinds and extra keys are refused. Size and rate come first,
before anything is parsed, and breaking either closes the connection. Inflating uses zlib's
`maxOutputLength`, so a small packet cannot unpack into gigabytes.

| Limit                             | Value                                                                    |
| --------------------------------- | ------------------------------------------------------------------------ |
| One packet, either way            | 1,000,000 bytes                                                          |
| Guest to host, after inflating    | 64 KB a message                                                          |
| Host to guest, after inflating    | 8 MB a message; 64 MB for one command's events; 512 MB for a snapshot    |
| Guest messages                    | 20 a second, burst 40                                                    |
| Commands waiting, per guest       | 8; one more is refused with an error, not queued                         |
| Before `welcome`                  | `hello` only, 4 KB, within 10 s                                          |
| Guests                            | 31 (32 humans with the host)                                             |
| Display name                      | 32 characters                                                            |
| Snapshots                         | one per connection per 10 s, to admitted peers only                      |
| Host's unsent backlog for a guest | 64 MB, then he is dropped and resyncs when he is back                    |
| Heartbeat                         | `ping` every 5 s; 3 missed is a disconnect (the same on every transport) |

Then shape. The host side protects the save, so it is strict: a zod schema for the whole
`Command` union, every field typed and bounded, kept equal to the `Command` type at compile
time so a new command without a schema fails `pnpm typecheck`. The same schema guards local
`commands.dispatch`. The guest side protects a mirror that can be thrown away, so its default is
lighter: its schemas check the envelope and each event's header (`id`, `date`, `kind`,
`importance`, `teamIds`, `playerIds`) field by field, and the rest of each event (its payload
in the save) and every snapshot cell through one generic guard (plain JSON only, finite
numbers, bounded depth and string length, the string rule below). What an event's values can
reach on a mirror is bound SQL parameters, JSON text in the save, and text React escapes (the
renderer has no raw HTML): nothing from the wire is used as a file path, as SQL text or as
code, and the guest's own saves are not open. An event that passes the guard but makes
`applyEvent` or `persist` throw is contained: the mirror is dropped and asks for a snapshot,
and a second failure in a row ends the session with an error. What is left to a hostile host
is a guest who sees a nonsense league, or a game that stalls, until he leaves. Field-by-field
schemas for all 75 events and the league state are the alternative: about a thousand lines
that every later event PR must keep in step.

**The one dangerous kind of string.** The reducer and the handlers index plain objects by id
(`state.players[event.playerId]`), so an id that names a property of `Object.prototype`
(`__proto__`, `constructor` and the like) reads or writes the prototype instead of missing.
The rule, in `packages/shared`: an id is 1 to 80 characters and names no such property; and no
key or string anywhere in a message is such a name or contains `__proto__` (a pick id is a
composite, `<season>-<round>-<team id>`, that the engine splits). Snapshot cells that hold JSON
are parsed and walked the same way. A season of real events holds no such string (measured).
When hosting starts the host runs its own league through the same guard and refuses to host if
it fails, saying why: a roster file may carry any player id.

**Handshake and versions.** The first message must be `hello`. The host refuses unless the wire
protocol number, the app version (`app.getVersion()`) and the save schema (the number of
migrations, exported from `@gm/data`) all equal its own. `welcome` names the league's ruleset
and sport, and the guest leaves unless its build knows that ruleset and the sport is `nhl`. On
Steam the same values also sit in the lobby's data so the join screen can say "the host runs
another version" early; the handshake is what counts. Every dev build says 0.0.1 today, so two
different commits pass as equal: a real version per release fixes that, and adding the build's
commit to the check is the named alternative. Admission is this handshake plus the transport's
own gate (the join code on a direct connection, lobby membership on Steam). An admitted guest
is sent the snapshot and every later event, which is what lets him see the teams and ask for
one; he can change nothing until the host seats him.

**Seats.** A connection is a peer, and a peer holds at most one team. Only the host binds a
peer to a team: a guest sends `seat.request` (a wish) and the host approves it on the Online
screen, or assigns one himself. Seating an AI team makes it human with the existing
`team.setUserControlled`, sent by the host as `local`. The actor is rebuilt for every command
from the host's own table, and its `controls` is empty unless the team is still
`userControlled` (the engine's `controls()` does not check that for a remote actor), so a GM
who hands his team to its AI GM, or whose team the host takes back, holds nothing. A peer with
no team can do nothing: every command needs a team, a grant or `local`. He waits on the Online
screen. Names are text for the list: self-reported in `hello`, never used to give a seat back.
On Steam a peer's identity is the SteamID Steam puts on his packets, and the host's save
remembers which SteamID held which team (one `meta` key, left out of snapshots), so a returning
friend is seated without a click. A direct connection has no identity that lasts: inside a
session a random resume key from `welcome` gives a dropped guest his seat back, and in a new
session the host seats him again.

**Advancing the day; readiness.** The clock belongs to the host: he presses the sim buttons, and
so may a guest he grants `advance` (a co-commissioner). Every GM has a Ready toggle; on a guest
without the grant it stands where the sim bar was. Readiness is session state in the host's
main process, sent with the peer list: not league state, not an event, not saved. It clears
when the clock moves, and when another GM's command produces an event that names your team (an
offer just arrived). A disconnected GM counts as not ready. Readiness blocks nothing in the
engine: when a seated GM is not ready, whoever presses advance is asked to confirm, with the
names. Nobody can hold the league up, and nothing advances by itself.

**Pausing for a human decision.** The one place the engine itself waits for a human is the live
draft, and it already does: it stops when a human team is on the clock and goes on when that
team's `draft.pick` arrives, which is actor-checked. Online that pick comes from the GM's own
machine and everyone sees the picks land. Everything else lapses on game days (the table
above), so pausing means the host not advancing: readiness shows who is still busy, each name
in the list carries his to-do count (the existing `dashboard`, worked out on each machine from
its own copy), and a multi-day advance already stops at the first event that matters to any
human team. For a GM who is away, the host answers from the hot-seat switcher (his pick, his
offer) or hands the team to its AI GM. No pick timer: add one when a playtest asks.

**Firing is off in a hosted league.** A fired GM is `state.career`, one slot, and the way back
is local only: two fired guests could not be told apart and neither could take a job. Hosting
therefore turns "can be fired" off (the existing `league.setCanBeFired`, as `local`, so it
stays off in the save until the host turns it on again), keeps it off while a session is open,
and refuses to start while a GM is out of work. A job market for several GMs is its own job.

**Joining and resync: the snapshot.** The snapshot is the save's rows. At one point of its
queue (a command boundary) the host dumps every table in `rowid` order; the pieces go out as
`snapshot.rows` messages and later event batches queue behind them on that connection. The
guest creates a fresh in-memory database with its own migrations and inserts the rows with
bound values in one transaction (foreign keys deferred), checks the counts, then loads the
state. Table and column names always come from the guest's own schema: a message can only pick
a table from that list, and a row with the wrong number of cells ends the join. Every cell is a
string, a finite number or null. Both halves are new `SaveFile` methods, so SQL stays in
`packages/data`. Why rows: the guest never opens a database file that came from the network.
The alternative, the database's bytes (`db.serialize()`), was tried too: it works, the schema
can be compared with a fresh one, and it is a little faster, but it hands SQLite a foreign
file. A JSON state alone would leave the history tables empty, and the event log cannot rebuild
the state. A snapshot holds everything, every past box score included: about 0.75 MB on the
wire per season played at 16 teams. How long that takes through Steam is not known; if a join
proves slow, leaving finished seasons' box scores on the host is the named follow-up.

**Drops, reconnects and resync by sequence number.** `applyEvent` already counts every event
(`state.eventSeq`), on the host and on a mirror alike, so no new field is needed. Each `events`
message carries the host's number before its first event. A mirror whose own count (its number
plus the pieces it holds of an unfinished command) differs stops applying, drops those pieces
and sends `resync` with its number. The host keeps the last 16 MB of encoded event messages in
memory: if they reach back that far it replays them, if not it sends a snapshot. A guest who
drops keeps his seat (the team stays human; he shows as disconnected) and, inside the same
session, rejoins with his resume key and resyncs from his number. A new session (the host
restarted) or a restarted guest always takes a snapshot. No state checksum by default: the
sequence number catches every lost or repeated batch, the reducer is the same code on both
sides, and the tests compare whole states; a checksum a day is the named add-on if a playtest
shows mirrors that differ without a gap.

**No host migration.** The save lives on the host, so when he leaves the session ends for
everyone and the league goes on when he hosts again. A guest never accepts another machine as
the authority: on Steam, lobby ownership passes to another member when the owner leaves, and
guests ignore that.

**What a guest can see.** Everything. The mirror is the whole league, so true ratings, other
teams' draft lists and rival free-agent bids are all in a guest's memory. The app does not show
them: his seat is locked to his team and the screens ask for that team's view, as in hot-seat,
where the fog is view only. A modified client reads it all. That is acceptable among friends,
and it is what "anti-cheat is step 3" means: real fog needs a server that answers each GM's
queries instead of handing out the state. What step 2 does guarantee is that no guest can
change anything he is not allowed to.

**Transports.** One interface: a host side that listens and hands out connections, a guest side
that connects, and a connection with `send(bytes)`, `close()`, message and close callbacks, and
a `peerKey` the transport vouches for. Three implementations:

- **Loopback**, for tests. It carries bytes, not objects, so a test goes through the same
  deflate, size check, inflate and schema as a real connection, and it can drop messages on
  demand.
- **Direct connection: worth having.** It is the only way to run two real app instances end to
  end without a Steam App ID, now and in every later regression run; it gives LAN play; and it
  is about a hundred lines on Node's `net`, with no new dependency. A 4-byte length before each
  packet (a length over the limit closes the socket before the body is read), `setNoDelay`, a
  port the OS picks, listening only while the host has "direct" on. The handshake needs a join
  code: 6 random characters, new for each session and after every kick, compared in constant
  time; an address with 5 wrong tries is ignored for a minute. A kick also closes the socket
  and voids that guest's resume key, and a valid resume key stands in for the code, so the
  others can still rejoin. It is not encrypted and proves nothing about who is on the other
  end: LAN and testing only, and the screen says so.
- **Steam**, for play over the internet. The host creates a friends-only lobby of 32 and
  invites through `openInviteDialog()`. A friend's game gets `GameLobbyJoinRequested`, joins the
  lobby, reads the owner with `getOwner()` and sends `hello` to him with `sendP2PPacket`. The
  host accepts a `P2PSessionRequest` only from a lobby member, polls packets on a timer, and
  takes departures from `LobbyChatUpdate` and `P2PSessionConnectFail`. The SteamID on a packet
  is trusted as Steam delivers it: 0.4.0 has no call to validate a ticket, so there is no second
  check. It has no kick either, so a kicked guest's packets are ignored for the session. This
  transport is built against the real typings with a fake in tests, and it ends **built, not
  verified live**: no real Steam App ID exists in this repo and one machine runs one Steam
  account at a time, so it needs a two-machine test with the real App ID before it counts as
  working.

**Lobby and guest screens.** `GmApi.session` goes into `packages/shared/src/ipc.ts` first: host
(direct or Steam), join, leave, request a team, assign a team, ready, grant advance, kick and
status; plus the first push from main to the renderer, one `changed` signal that makes screens
refetch (the host needs it too: a guest's command changes his league without his renderer
asking). An Online screen: host a league; join by invite or by address and code; pick a team;
the list of who is connected, with team, ready and to-do count; for the host, approve, grant and
kick. On a guest the seat is the session's team, the hot-seat switcher and curtain are hidden,
the sim bar gives way to the Ready toggle (unless he is granted), and New league, Load roster
and the commissioner tools are hidden; main refuses them anyway. On the host the switcher
stays: it is the commissioner's way to act for an absent GM. Text in `en.ts` and `fr.ts`.

**Where the code goes.** Contracts, schemas and limits in `packages/shared`; the row dump and
restore in `packages/data`; sessions, the codec and the transports in
`apps/desktop/src/main/net/`. `packages/sim` gets the gate in `handleCommand` and nothing else.

## Defaults the owner can overrule

| Question                      | Default in this brief                                                                   | The alternative                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| The host's own actor          | `local`: commissioner, can act for any human team                                       | bound to his own team like a guest                                         |
| Who advances                  | the host, and guests he grants `advance`; never by itself                               | advance by itself when everyone is ready                                   |
| Readiness                     | advisory: whoever advances confirms past a GM who is not ready                          | blocking: no advance until all are ready                                   |
| An absent GM at the draft     | the host picks for him from the switcher; no timer                                      | a timer that picks from his list                                           |
| Commissioner tools            | host only, no grant                                                                     | a `commissioner` grant                                                     |
| Relocation by a guest         | refused (renaming his own team stays)                                                   | as coded today: a guest relocates his own team                             |
| Firing                        | off while hosted; no hosting while a GM is out of work                                  | a job market for several fired GMs (its own job)                           |
| Seats                         | the host approves each one; Steam seats remembered by SteamID; direct seats per session | first come, first served                                                   |
| Teams per connection          | one                                                                                     | several GMs on one guest machine (`controls` is already a list)            |
| A guest without a team        | waits on the Online screen                                                              | a spectator mode                                                           |
| The mirror                    | in memory; a guest's disk holds nothing of the league                                   | a mirror file (would allow "carry on from my copy")                        |
| Snapshot format               | table rows as checked JSON                                                              | the database's bytes (`db.serialize()`)                                    |
| Snapshot content              | everything, every past box score included                                               | finished seasons' box scores stay on the host                              |
| Checks on the guest side      | header by field, payload by the generic guard, failures contained by a resync           | a schema for each of the 75 events and the state (one more job)            |
| Sync check                    | sequence numbers                                                                        | plus a state checksum a day (about 70 ms on the main thread at season end) |
| Version check                 | wire protocol, app version, save schema, ruleset, sport                                 | plus the build's commit                                                    |
| A command when the link drops | fails with "disconnected"; never resent                                                 | resend after the reconnect                                                 |
| Direct connection             | built; any interface while hosting direct; join code; no encryption                     | loopback only, or TLS                                                      |
| Steam lobby                   | friends only, 32, invites                                                               | a public, listed lobby                                                     |
| Host migration                | none                                                                                    | step 3                                                                     |
| What a guest can see          | the whole league is in his mirror; fog is view only                                     | step 3                                                                     |
| The limits                    | the table above                                                                         | other numbers, after the live test                                         |

## Jobs (one PR each, in order)

Seven jobs; the eighth slot is left free in case job 3 or job 6 has to be split. Each is one PR
that stands alone, passes `pnpm check` and leaves main shippable: jobs 1 to 4 add tested layers
no screen reaches yet, nothing listens on a real network before job 5, and by then the limits of
job 4 are in.

1. **Commands from a stranger** (Fable, contracts and engine). In `packages/shared`: the id
   rule, a zod schema for the whole `Command` union kept equal to the type, `Actor.can`. In
   `handleCommand`: the clock gate, and relocation local only. `commands.dispatch` in main
   parses with the schema.
   _Done when:_ tests refuse a command with a prototype-named id, an oversized string or an
   extra key; a table test passes one valid example of each of the 38 commands; a remote actor
   cannot advance, open free agency, start the draft or roll the season over without the grant
   and can with it; he cannot use a commissioner tool, relocate, or act for another GM's team;
   `local` behaves as before (no sim number changes).
2. **The mirror** (Fable, data and main). `SaveFile`: dump every table's rows, restore them
   into a fresh database, and the save schema number exported. `LeagueService`: the save path
   as a parameter, a command from a given actor, events from the host, the persisted-batch
   hook, the worker started on first use. `packages/shared`: the generic guard, the messages'
   schemas, the limits; main: the codec (deflate, bounded inflate).
   _Done when:_ a test plays a stretch on one service, builds a second from its rows passed
   through the codec, feeds it every later batch through the codec across a summer, and finds
   the state, the reloaded state and every table's rows equal after each command; bad messages
   (unknown kind, extra key, prototype-named string, non-finite number, too big, a zip bomb)
   are refused at the boundary; a restore with a wrong cell count or a bad cell leaves nothing
   behind.
3. **Hosting over the loopback** (Fable, main). `apps/desktop/src/main/net/`: the transport
   interface, the loopback, the host and guest sessions: handshake and versions, the join code,
   admission, the snapshot stream, events broadcast after persist, commands forwarded with
   request ids and answered after the mirror applied them, the seat table and the actor per
   command, the host's start checks (the string guard, "can be fired" off, nobody out of
   work). ARCHITECTURE gains its networking rules.
   _Done when:_ two `LeagueService`s over the loopback end identical (state and rows) after a
   played stretch of days with commands from both sides, a trade between the two GMs among
   them; a command for the other GM's team is rejected and changes nothing, and a message that
   carries an actor is refused; a guest's advance is refused without the grant; a wrong app
   version, save schema or protocol is refused at the handshake; a peer with no team can do
   nothing.
4. **Drops, reconnects and limits** (Fable, main). The sequence check and `resync`, the replay
   buffer, rejoining inside a session with the seat kept, the heartbeat, the rate,
   waiting-command and backlog limits, the handshake timeout, a failed apply contained.
   _Done when:_ a mirror that missed events (the loopback drops them) resyncs from the buffer
   and ends identical; one too far behind gets a snapshot and ends identical; a guest who
   rejoins inside the session has his seat and one in a new session does not; a flood, an
   oversized packet, a silent peer and a late `hello` each end that connection and nothing
   else; a mirror fed an event it cannot apply resyncs once, then leaves with an error.
5. **Direct connection and the session API** (Fable, main and contracts). The TCP transport.
   Lobby state in the sessions: seat requests and approval, readiness, the advance grant, kick,
   the peer list. `GmApi.session` in `packages/shared/src/ipc.ts` first, then IPC, preload and
   the `changed` push; main swaps the active service on join and leave and refuses new leagues
   and roster loads while a session is open.
   _Done when:_ a test hosts and joins over real localhost sockets with two services: the join
   code is needed, a seat is requested and approved, both sides command, readiness clears when
   the clock moves, a granted guest advances, and both end identical; a kicked guest cannot
   rejoin with the old code or his resume key; a frame split across reads and one over the
   limit are handled; with no session the app behaves as before.
6. **Lobby and guest screens** (Fable, UI). The Online screen and the guest's view of the app
   as described above, the host's confirm when someone is not ready, a "reconnecting" state,
   refetch on `changed`; strings in `en.ts` and `fr.ts`.
   _Done when:_ component tests cover the Online screen's states; and two app instances on one
   machine (separate user-data folders) play a week over the direct connection: host, join,
   seat, lines and a trade from each side, an advance, a guest killed and back. That run is by
   hand or by an agent (the repo has no end-to-end runner) and the PR says exactly what was
   done.
7. **Steam transport** (Fable, main). The same interface over `steamworks.js` as described
   above, seats remembered by SteamID in the host's save, "Host on Steam" and "Invite" on the
   Online screen, the roadmap brought up to date.
   _Done when:_ the session tests pass over the Steam transport with a fake `steamworks.js`
   shaped by the real typings (lobby, packets, callbacks); a packet from a non-member is
   ignored; a remembered SteamID gets its seat back. This job ends **built, not verified
   live**, and its PR and the roadmap say so plainly: it still needs a two-machine test with
   the real Steam App ID. That test checks: an invite and a join with the game open, and with
   it closed (Steam starts the game with a `+connect_lobby` argument, read from the command
   line); the invite dialog of the overlay inside Electron; how fast a snapshot goes through
   `sendP2PPacket` and whether it needs pacing; a drop and a rejoin. (A first smoke on the
   default test app 480, two accounts on two machines, is possible earlier; it does not replace
   the run on the real App ID.)

Not in scope: step 3 (our servers, accounts, anti-cheat, real fog, leagues that run with the
host away); host migration; a job market for several fired GMs; a draft pick timer; chat; a
spectator mode; several GMs on one guest machine; encryption or internet play on the direct
connection; public or listed lobbies and joining from a friend's status; streaming a long sim
day by day to guests (the events arrive when the host's command is done); NBA and NFL (the
wire and the sessions are sport-neutral; the handshake refuses another sport).
