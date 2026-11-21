import { randomBytes } from 'node:crypto';
import { WIRE } from '@gm/shared';
import type { Client } from 'steamworks.js';
import type { ChatMemberStateChange } from 'steamworks.js/callbacks';
import type { callback, matchmaking, networking } from 'steamworks.js/client';
import type { Connection, GuestTransport, HostTransport } from './transport';

type Api = Omit<Client, 'init' | 'runCallbacks'>;
type Lobby = Pick<
  matchmaking.Lobby,
  'id' | 'leave' | 'openInviteDialog' | 'getMembers' | 'getOwner'
>;

/**
 * What a hosted league uses of `steamworks.js` 0.4.0, in its own typings' words: the client `init`
 * returns fits it (main hands that one to `Online`, and the typecheck holds the two together), and
 * so does the tests' fake (`fakeSteam.ts`).
 */
export interface Steam {
  localplayer: Pick<Api['localplayer'], 'getSteamId' | 'getName'>;
  matchmaking: {
    createLobby(lobbyType: matchmaking.LobbyType, maxMembers: number): Promise<Lobby>;
    joinLobby(lobbyId: bigint): Promise<Lobby>;
  };
  networking: Pick<
    Api['networking'],
    'sendP2PPacket' | 'isP2PPacketAvailable' | 'readP2PPacket' | 'acceptP2PSession'
  >;
  callback: Pick<Api['callback'], 'register'>;
}

// The numbers of the enums read here. The typings declare them `const enum`, which this build
// (isolated modules) cannot read as values, so each number is typed by its member: a wrong one, or
// a renumbering in a later steamworks.js, fails the typecheck.
const FRIENDS_ONLY: matchmaking.LobbyType.FriendsOnly = 1;
const RELIABLE: networking.SendType.Reliable = 2;
const ENTERED: ChatMemberStateChange.Entered = 0;
export const LOBBY_CHAT_UPDATE: callback.SteamCallback.LobbyChatUpdate = 5;
export const P2P_SESSION_REQUEST: callback.SteamCallback.P2PSessionRequest = 6;
export const P2P_SESSION_CONNECT_FAIL: callback.SteamCallback.P2PSessionConnectFail = 7;
export const GAME_LOBBY_JOIN_REQUESTED: callback.SteamCallback.GameLobbyJoinRequested = 8;

/** How often the waiting packets are read: about as often as steamworks.js runs Steam's callbacks. */
const POLL_MS = 30;
/** Packets read in one turn: a flood waits for the next turn, it does not hold the main process. */
const BATCH = 64;

/**
 * Steam's packets go to a SteamID and have no connection, so each carries one in front: a number
 * its guest picked (4 bytes) and what the frame is (1 byte). With the largest packet of the wire
 * that stays under the megabyte a reliable Steam packet may be.
 */
const HEADER = 5;
const DATA = 0;
const CLOSE = 1;

function frame(id: number, kind: number, packet: Uint8Array = new Uint8Array()) {
  const framed = Buffer.allocUnsafe(HEADER + packet.length);
  framed.writeUInt32BE(id);
  framed[4] = kind;
  framed.set(packet, HEADER);
  return framed;
}

/** A frame to one SteamID, reliable: whole and in order, or Steam reports the session failed. */
const sender = (steam: Steam, to: bigint) => (framed: Buffer) => {
  try {
    return steam.networking.sendP2PPacket(to, RELIABLE, framed);
  } catch {
    return false;
  }
};

/**
 * The frames waiting for this game, oldest first, each with who sent it: the SteamID Steam itself
 * puts on a packet, never anything inside it. A packet too short to be a frame is dropped.
 */
function* waiting(steam: Steam) {
  for (let n = 0; n < BATCH; n++) {
    let packet: networking.P2PPacket;
    try {
      // 0.4.0 gives the next packet's size, and 0 both for an empty packet and for none. Reading
      // tells the two apart (it throws when nothing waits), so an empty packet is taken out of the
      // way of the ones behind it and never holds them up.
      packet = steam.networking.readP2PPacket(steam.networking.isP2PPacketAvailable());
    } catch {
      return; // nothing waits, or Steam went away under the game
    }
    const data = packet.data.subarray(0, packet.size);
    if (data.length < HEADER) continue;
    yield {
      from: packet.steamId.steamId64,
      id: data.readUInt32BE(0),
      kind: data[4],
      packet: data.subarray(HEADER),
    };
  }
}

/**
 * One end of a connection: a SteamID and the connection's number. Steam does not say what it
 * still holds of what it was handed, so `unsent` is zero.
 */
class End implements Connection {
  readonly unsent = 0;
  private open = true;
  onPacket: (packet: Uint8Array) => void = () => undefined;
  onClose: () => void = () => undefined;

  constructor(
    readonly peerKey: string,
    readonly id: number,
    private readonly out: (framed: Buffer) => boolean,
    private readonly left: () => void = () => undefined,
  ) {}

  send(packet: Uint8Array) {
    // Steam takes a packet or says no (too big, nobody there): no is the end of the connection.
    if (this.open && !this.out(frame(this.id, DATA, packet))) this.drop();
  }

  close() {
    if (!this.open) return;
    this.out(frame(this.id, CLOSE));
    this.drop();
  }

  /** Gone, with no word to the other end: it said so itself, or Steam did. */
  drop() {
    if (!this.open) return;
    this.open = false;
    this.left();
    // Later, never inside the session's own call: it may be in the middle of a send to everyone.
    queueMicrotask(() => this.onClose());
  }

  /** A frame that came for this connection: a packet, or (any other kind) its end. */
  take(kind: number | undefined, packet: Uint8Array) {
    if (!this.open) return;
    if (kind === DATA) this.onPacket(packet);
    else this.drop();
  }
}

/**
 * The host's side: a friends-only lobby of 32, and a connection for each member who sends a
 * frame. Only a member's P2P session is accepted (when he enters the lobby, and when he asks as a
 * member: Steam sends the two by different roads, in either order), and a packet from anyone who
 * is not in the lobby as it is read is dropped: somebody who left can still send, since 0.4.0
 * closes no session. Who a packet is from is Steam's word (0.4.0 has no second check). A member's
 * new connection number is a new connection, which ends his old one, once in `WIRE.reconnectMs`:
 * sooner, its frames are dropped. A member who leaves the lobby, or whom Steam cannot reach, has
 * his connection closed.
 *
 * The packets are read from the moment the lobby exists, before `listen`: what waits from an
 * earlier session is from nobody in this lobby yet, and goes unread into nothing.
 *
 * ponytail: 0.4.0 can put nobody out of a lobby or a P2P session, so a member, or one who left,
 * can make the host read up to `BATCH` megabyte packets a turn for nothing. Friends only; the
 * newer networking-sockets API, when steamworks.js has it, is the upgrade.
 */
export async function hostSteam(steam: Steam): Promise<HostTransport & { invite(): void }> {
  const lobby = await steam.matchmaking.createLobby(FRIENDS_ONLY, WIRE.guests + 1);
  const me = steam.localplayer.getSteamId().steamId64;
  let listener: ((connection: Connection) => void) | null = null;
  /** Each SteamID's last connection, open or not, and when it began. */
  const last = new Map<bigint, { end: End; at: number }>();
  const handles = [
    steam.callback.register(P2P_SESSION_REQUEST, ({ remote }) => {
      if (lobby.getMembers().some((m) => m.steamId64 === remote))
        steam.networking.acceptP2PSession(remote);
    }),
    steam.callback.register(LOBBY_CHAT_UPDATE, (change) => {
      if (change.lobby !== lobby.id) return;
      const who = change.user_changed;
      if (change.member_state_change === ENTERED) steam.networking.acceptP2PSession(who);
      else last.get(who)?.end.drop();
    }),
    steam.callback.register(P2P_SESSION_CONNECT_FAIL, ({ remote }) => last.get(remote)?.end.drop()),
  ];
  const poll = setInterval(() => {
    let members: Set<bigint> | undefined;
    for (const { from, id, kind, packet } of waiting(steam)) {
      members ??= new Set(lobby.getMembers().map((m) => m.steamId64));
      if (!listener || from === me || !members.has(from)) continue;
      let peer = last.get(from);
      if (peer?.end.id !== id) {
        const now = Date.now();
        if (kind !== DATA || (peer && now - peer.at < WIRE.reconnectMs)) continue;
        peer?.end.drop();
        peer = { end: new End(String(from), id, sender(steam, from)), at: now };
        last.set(from, peer);
        listener(peer.end);
      }
      peer.end.take(kind, packet);
    }
  }, POLL_MS);
  return {
    listen: (onConnection) => {
      listener = onConnection;
    },
    // The open connections still send (the session's goodbye): only the reading stops.
    close: () => {
      listener = null;
      clearInterval(poll);
      for (const handle of handles) handle.disconnect();
      lobby.leave();
    },
    invite: () => lobby.openInviteDialog(),
  };
}

/**
 * A guest's side: into the host's lobby, then frames to its owner. The owner as this guest first
 * found him is the host for good: Steam hands a lobby whose owner left to another member, and that
 * one is never taken for the host. Only the host's packets are read and only his P2P session is
 * accepted: before the first frame goes, and again if Steam asks. A closed connection leaves the
 * lobby and the next one joins it again, so a member is a game with a connection; one connection
 * at a time, as the guest's session opens them.
 *
 * Short of the interface in one place: the host hears nobody who is out of the lobby, so a packet
 * this guest sends in the same turn as his `close()` can be dropped with him. A guest's session
 * sends none before it closes; the host's last word (a `bye`, a refusal) does arrive.
 */
export function joinSteam(steam: Steam, lobbyId: bigint): GuestTransport {
  let host: bigint | undefined;
  return {
    async connect() {
      const lobby = await steam.matchmaking.joinLobby(lobbyId);
      const to = (host ??= lobby.getOwner().steamId64);
      if (to === steam.localplayer.getSteamId().steamId64) {
        lobby.leave();
        throw new Error('Nobody is hosting.');
      }
      steam.networking.acceptP2PSession(to);
      const handles = [
        steam.callback.register(P2P_SESSION_REQUEST, ({ remote }) => {
          if (remote === to) steam.networking.acceptP2PSession(remote);
        }),
        steam.callback.register(P2P_SESSION_CONNECT_FAIL, ({ remote }) => {
          if (remote === to) end.drop();
        }),
      ];
      const poll = setInterval(() => {
        for (const { from, id, kind, packet } of waiting(steam))
          if (from === to && id === end.id) end.take(kind, packet);
      }, POLL_MS);
      const end = new End(String(to), randomBytes(4).readUInt32BE(), sender(steam, to), () => {
        clearInterval(poll);
        for (const handle of handles) handle.disconnect();
        lobby.leave();
      });
      return end;
    },
  };
}

/** A friend's invite accepted in Steam while the game runs: `join` is handed the lobby. */
export const onInvite = (steam: Steam, join: (lobbyId: bigint) => void) =>
  steam.callback.register(GAME_LOBBY_JOIN_REQUESTED, ({ lobby_steam_id }) => join(lobby_steam_id));
