import type { CallbackReturns } from 'steamworks.js/callbacks';
import type { PlayerSteamId } from 'steamworks.js/client';
import {
  GAME_LOBBY_JOIN_REQUESTED,
  LOBBY_CHAT_UPDATE,
  P2P_SESSION_CONNECT_FAIL,
  P2P_SESSION_REQUEST,
  type Steam,
} from './steam';

type Lobby = Awaited<ReturnType<Steam['matchmaking']['createLobby']>>;

interface Room {
  id: bigint;
  /** As `createLobby` was asked. */
  type: number;
  max: number;
  owner: bigint;
  members: bigint[];
  /** Times a member opened the invite dialog. */
  invites: number;
}

interface Player {
  /** What `readP2PPacket` gives next. */
  inbox: { from: bigint; data: Buffer }[];
  /** Packets from those whose session this player has not accepted. */
  held: Map<bigint, Buffer[]>;
  accepted: Set<bigint>;
  handlers: Map<number, Set<(value: never) => void>>;
}

const steamId = (steamId64: bigint): PlayerSteamId => ({
  steamId64,
  steamId32: `[U:1:${steamId64 & 0xffffffffn}]`,
  accountId: Number(steamId64 & 0xffffffffn),
});

/**
 * Steam for the tests, in one process: players, lobbies and P2P packets behind the part of
 * `steamworks.js` a hosted league uses (`Steam`), held to its typings by the typecheck. It plays
 * what the transport leans on. A lobby has members and an owner, and an owner who leaves hands it
 * to another member. A packet from someone whose session a player has not accepted waits, and the
 * first one raises `P2PSessionRequest`, once. A callback comes later, never inside the call that
 * caused it. A reliable packet over a megabyte, or to nobody, is refused. `isP2PPacketAvailable`
 * is 0 for an empty packet and for none, and `readP2PPacket` throws when none waits. It is
 * stricter than Steam in one way: sending someone a packet does not accept his session.
 *
 * It does not play Steam's own gates (who may enter a friends-only lobby, who is whose friend) or
 * its network: only two machines on real Steam show those.
 */
export function fakeSteam() {
  const players = new Map<bigint, Player>();
  const lobbies = new Map<bigint, Room>();
  /** SteamIDs Steam refuses a packet to. */
  const unreachable = new Set<bigint>();
  let made = 0n;

  function fire<C extends keyof CallbackReturns>(to: bigint, kind: C, value: CallbackReturns[C]) {
    queueMicrotask(() => {
      for (const handler of [...(players.get(to)?.handlers.get(kind) ?? [])])
        (handler as (value: CallbackReturns[C]) => void)(value);
    });
  }

  /** A game running under a Steam account. The same SteamID again is that game started again. */
  function player(id: bigint, name: string) {
    const me: Player = { inbox: [], held: new Map(), accepted: new Set(), handlers: new Map() };
    players.set(id, me);

    const told = (room: Room, change: 0 | 1) => {
      for (const member of room.members)
        fire(member, LOBBY_CHAT_UPDATE, {
          lobby: room.id,
          user_changed: id,
          making_change: id,
          member_state_change: change,
        });
    };
    const enter = (room: Room): Lobby => {
      if (!room.members.includes(id)) {
        told(room, 0);
        room.members.push(id);
      }
      return {
        id: room.id,
        getMembers: () => room.members.map(steamId),
        getOwner: () => steamId(room.owner),
        openInviteDialog: () => {
          room.invites++;
        },
        leave: () => {
          if (!room.members.includes(id)) return;
          room.members = room.members.filter((member) => member !== id);
          if (room.owner === id) room.owner = room.members[0] ?? id;
          if (room.members.length === 0) lobbies.delete(room.id);
          told(room, 1);
        },
      };
    };

    const steam: Steam = {
      localplayer: { getSteamId: () => steamId(id), getName: () => name },
      matchmaking: {
        createLobby: (type, max) => {
          const room: Room = {
            id: 109775240000000000n + ++made,
            type,
            max,
            owner: id,
            members: [],
            invites: 0,
          };
          lobbies.set(room.id, room);
          return Promise.resolve(enter(room));
        },
        joinLobby: (lobbyId) => {
          const room = lobbies.get(lobbyId);
          if (!room) return Promise.reject(new Error('no such lobby'));
          if (!room.members.includes(id) && room.members.length >= room.max)
            return Promise.reject(new Error('the lobby is full'));
          return Promise.resolve(enter(room));
        },
      },
      networking: {
        sendP2PPacket: (to, sendType, data) => {
          const peer = players.get(to);
          // Send types 2 and 3 are the reliable ones: a megabyte. The others: one datagram.
          const most = sendType >= 2 ? 1024 * 1024 : 1200;
          if (!peer || unreachable.has(to) || data.length > most) return false;
          const copy = Buffer.from(data);
          const held = peer.held.get(id);
          if (peer.accepted.has(id)) peer.inbox.push({ from: id, data: copy });
          else if (held) held.push(copy);
          else {
            peer.held.set(id, [copy]);
            fire(to, P2P_SESSION_REQUEST, { remote: id });
          }
          return true;
        },
        isP2PPacketAvailable: () => me.inbox[0]?.data.length ?? 0,
        readP2PPacket: (size) => {
          const next = me.inbox.shift();
          if (!next) throw new Error('No packet available');
          const data = Buffer.alloc(size);
          return { data, size: next.data.copy(data), steamId: steamId(next.from) };
        },
        acceptP2PSession: (from) => {
          me.accepted.add(from);
          for (const data of me.held.get(from) ?? []) me.inbox.push({ from, data });
          me.held.delete(from);
        },
      },
      callback: {
        register: (kind, handler) => {
          const set = me.handlers.get(kind) ?? new Set();
          me.handlers.set(kind, set);
          set.add(handler);
          return { disconnect: () => void set.delete(handler) };
        },
      },
    };
    return { id, steam };
  }

  return {
    player,
    /** The lobbies that have a member, by id. */
    lobbies,
    unreachable,
    /** `to` accepts, in Steam, a friend's invite to a lobby: his running game is told. */
    invited(to: bigint, lobbyId: bigint, from: bigint) {
      fire(to, GAME_LOBBY_JOIN_REQUESTED, { lobby_steam_id: lobbyId, friend_steam_id: from });
    },
    /** Steam loses the line between two players: each is told, and must accept the other again. */
    cut(a: bigint, b: bigint) {
      for (const [at, remote] of [
        [a, b],
        [b, a],
      ] as const) {
        players.get(at)?.accepted.delete(remote);
        fire(at, P2P_SESSION_CONNECT_FAIL, { remote, error: 4 });
      }
    },
  };
}
