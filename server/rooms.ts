import type { Server } from "node:http";
import { randomBytes, randomInt } from "node:crypto";
import { performance } from "node:perf_hooks";
import { WebSocket, WebSocketServer } from "ws";
import { Battle, other, STEP } from "../src/game/engine";
import type { Mode, Team } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import type { CardId } from "../src/game/cards";
import { PROTOCOL, RECONNECT_MS } from "../src/network/protocol";
import { EMOTE_COOLDOWN, isEmote, isQuickChat } from "../src/game/emotes";
import type {
  ClientMessage,
  ServerMessage,
  RoomState,
} from "../src/network/protocol";
import { snapshot } from "../src/network/perspective";
import intro from "../src/ui/intro-settings.json";

type Peer = {
  ws: WebSocket;
  room?: Room;
  player?: Player;
  budget: number;
  budgetAt: number;
  alive: boolean;
  lastPong: number;
};
type Player = {
  team: Team;
  name: string;
  deck: CardId[];
  token: string;
  peer?: Peer;
  ready: boolean;
  disconnectedAt: number;
  seq: number;
  emoteAt: number;
};
type Room = {
  code: string;
  mode: Mode;
  players: Player[];
  battle?: Battle;
  phase: RoomState["phase"];
  createdAt: number;
  startsAt: number;
  nextTick: number;
  finishedAt: number;
};
const validDeck = (deck: unknown): deck is CardId[] =>
  Array.isArray(deck) &&
  deck.length === 8 &&
  new Set(deck).size === 8 &&
  deck.every((c) => typeof c === "string" && Object.hasOwn(CARD_MAP, c));
const validName = (name: unknown): name is string =>
  typeof name === "string" &&
  name.trim().length > 0 &&
  name.length <= 18 &&
  !/[\u0000-\u001f\u007f]/.test(name);
const teams: Team[] = ["blue", "red"];
function tracePeer(peer: Peer, event: string, details: object = {}) {
  if (process.env.ARENA_NETWORK_TRACE !== "1") return;
  console.info(
    "Room transport",
    JSON.stringify({
      at: Date.now(),
      event,
      team: peer.player?.team,
      phase: peer.room?.phase,
      buffered: peer.ws.bufferedAmount,
      lastPongAgo: Math.round(performance.now() - peer.lastPong),
      lastMessageAgo: Math.round(performance.now() - peer.budgetAt),
      ...details,
    }),
  );
}
const send = (peer: Peer | undefined, message: ServerMessage) => {
  if (!peer || peer.ws.readyState !== WebSocket.OPEN) return;
  if (peer.ws.bufferedAmount > 512_000) {
    tracePeer(peer, "backpressure-terminate");
    peer.ws.terminate();
    return;
  }
  peer.ws.send(JSON.stringify(message));
};

/** A single authoritative simulation per room. The browser never supplies time, team or damage. */
export function attachRooms(
  server: Server,
  options: { reconnectMs?: number; introMs?: number; maxRooms?: number } = {},
) {
  const rooms = new Map<string, Room>();
  const peers = new Set<Peer>();
  const reconnectMs = options.reconnectMs ?? RECONNECT_MS;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
    perMessageDeflate: false,
  });
  const roomState = (r: Room): RoomState => ({
    code: r.code,
    mode: r.mode,
    phase: r.phase,
    players: r.players.map((p) => ({
      team: p.team,
      name: p.name,
      ready: p.ready,
      connected: !!p.peer,
    })),
  });
  const broadcast = (r: Room, m: ServerMessage) =>
    r.players.forEach((p) => send(p.peer, m));
  const roomChanged = (r: Room) =>
    broadcast(r, { type: "room", room: roomState(r) });
  function state(r: Room, only?: Player) {
    if (!r.battle) return;
    for (const p of only ? [only] : r.players) {
      const s = snapshot(r.battle);
      // An opponent's next cards and elixir are private during the battle.
      s.players = {
        ...s.players,
        [other(p.team)]: {
          elixir: 0,
          crowns: s.players[other(p.team)].crowns,
          hand: STARTER_DECK.slice(0, 4),
          queue: STARTER_DECK.slice(4),
        },
      };
      send(p.peer, {
        type: "state",
        state: s,
        countdownMs: Math.max(0, r.startsAt - performance.now()),
        ...(r.battle.winner ? { replay: r.battle.exportReplay() } : {}),
      });
    }
  }
  function finish(r: Room, winner: Team | "draw", reason: string) {
    if (!r.battle || r.phase === "finished") return;
    r.battle.finish(winner, reason);
    r.phase = "finished";
    r.finishedAt = performance.now();
    state(r);
    roomChanged(r);
  }
  function remove(peer: Peer, explicit: boolean) {
    const r = peer.room,
      p = peer.player;
    peer.room = undefined;
    peer.player = undefined;
    if (!r || !p || p.peer !== peer) return;
    p.peer = undefined;
    if (r.phase === "waiting") p.ready = false;
    p.disconnectedAt = performance.now();
    if (explicit && r.phase !== "waiting" && r.phase !== "finished")
      finish(r, other(p.team), "Opponent left the battle");
    if (r.phase === "waiting" && explicit)
      r.players = r.players.filter((x) => x !== p);
    if (explicit) p.token = "";
    if (!r.players.length) rooms.delete(r.code);
    else roomChanged(r);
  }
  const fail = (p: Peer, message: string, fatal = false) =>
    send(p, { type: "error", message, fatal });
  function welcome(peer: Peer, r: Room, p: Player) {
    peer.room = r;
    peer.player = p;
    p.peer = peer;
    p.disconnectedAt = 0;
    tracePeer(peer, "welcome");
    send(peer, {
      type: "welcome",
      code: r.code,
      token: p.token,
      team: p.team,
      deck: p.deck,
      mode: r.mode,
    });
    roomChanged(r);
    state(r, p);
  }
  function handle(peer: Peer, value: unknown) {
    if (!value || typeof value !== "object" || !("type" in value))
      return fail(peer, "Invalid message.");
    const m = value as ClientMessage;
    if (m.type === "ping") {
      if (typeof m.at === "number" && Number.isFinite(m.at))
        send(peer, { type: "pong", at: m.at });
      return;
    }
    if (m.type === "create" || m.type === "join" || m.type === "resume") {
      if (m.version !== PROTOCOL)
        return fail(peer, "Game updated. Reload to reconnect.", true);
      if (peer.room) return fail(peer, "Leave your current room first.");
      if (m.type === "resume") {
        const r = typeof m.code === "string" ? rooms.get(m.code) : undefined;
        const p = r?.players.find(
          (p) =>
            typeof m.token === "string" &&
            m.token.length === 64 &&
            p.token === m.token,
        );
        if (!r || !p)
          return fail(peer, "This room has expired. Create a new room.", true);
        if (p.peer) {
          const old = p.peer;
          old.room = undefined;
          old.player = undefined;
          old.ws.close(4001, "Connected in another tab");
        }
        welcome(peer, r, p);
        return;
      }
      if (!validName(m.name) || !validDeck(m.deck))
        return fail(peer, "Choose a player name and eight unique cards.");
      let r: Room | undefined;
      if (m.type === "create") {
        if (!["classic", "double"].includes(m.mode))
          return fail(peer, "Choose Classic or Double elixir.");
        if (rooms.size >= (options.maxRooms ?? 100))
          return fail(peer, "The server is full. Try again shortly.");
        let code: string;
        do {
          code = Array.from(
            randomBytes(6),
            (n) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[n % 32],
          ).join("");
        } while (rooms.has(code));
        r = {
          code,
          mode: m.mode,
          players: [],
          phase: "waiting",
          createdAt: performance.now(),
          startsAt: 0,
          nextTick: 0,
          finishedAt: 0,
        };
        rooms.set(code, r);
      } else {
        r =
          typeof m.code === "string"
            ? rooms.get(m.code.toUpperCase())
            : undefined;
        if (!r)
          return fail(
            peer,
            "Room not found. Check the code and server address.",
          );
        if (r.phase !== "waiting" || r.players.length >= 2)
          return fail(peer, "This room is full or already playing.");
      }
      const p: Player = {
        team: teams.find((t) => !r!.players.some((p) => p.team === t))!,
        name: m.name.trim(),
        deck: [...m.deck],
        token: randomBytes(32).toString("hex"),
        ready: false,
        disconnectedAt: 0,
        seq: -1,
        emoteAt: -5000,
      };
      r.players.push(p);
      welcome(peer, r, p);
      return;
    }
    const r = peer.room,
      p = peer.player;
    if (!r || !p) return fail(peer, "Join a room first.");
    if (m.type === "leave") {
      remove(peer, true);
      return;
    }
    if (m.type === "ready" && r.phase === "waiting") {
      p.ready = m.ready === true;
      if (r.players.length === 2 && r.players.every((p) => p.ready && p.peer)) {
        r.battle = new Battle({
          ai: false,
          mode: r.mode,
          seed: randomInt(1, 2147483647),
          deck: r.players.find((p) => p.team === "blue")!.deck,
          enemyDeck: r.players.find((p) => p.team === "red")!.deck,
        });
        r.phase = "countdown";
        r.startsAt =
          performance.now() +
          (options.introMs ?? (intro.actionFrame / intro.fps) * 1000);
        r.nextTick = r.startsAt + STEP * 1000;
        state(r);
      }
      roomChanged(r);
      return;
    }
    if (m.type === "surrender") {
      finish(r, other(p.team), "Surrender");
      return;
    }
    if (m.type === "emote") {
      const kind = m.kind === undefined ? "laugh" : m.kind;
      if (
        isEmote(kind) &&
        (r.phase === "playing" || r.phase === "countdown") &&
        performance.now() - p.emoteAt >= EMOTE_COOLDOWN * 1000
      ) {
        p.emoteAt = performance.now();
        broadcast(r, { type: "emote", team: p.team, kind });
      }
      return;
    }
    if (m.type === "quick-chat") {
      if (
        isQuickChat(m.phrase) &&
        (r.phase === "playing" || r.phase === "countdown") &&
        performance.now() - p.emoteAt >= EMOTE_COOLDOWN * 1000
      ) {
        p.emoteAt = performance.now();
        broadcast(r, { type: "quick-chat", team: p.team, phrase: m.phrase });
      }
      return;
    }
    if (m.type === "play") {
      if (!Number.isSafeInteger(m.seq) || m.seq < 0 || m.seq <= p.seq)
        return fail(peer, "Duplicate or invalid move.");
      p.seq = m.seq;
      const b = r.battle;
      const valid =
        typeof m.card === "string" &&
        Object.hasOwn(CARD_MAP, m.card) &&
        typeof m.x === "number" &&
        typeof m.y === "number" &&
        Number.isFinite(m.x) &&
        Number.isFinite(m.y);
      const result =
        valid && b && r.phase === "playing"
          ? b.play(p.team, b.players[p.team].hand.indexOf(m.card), m.x, m.y)
          : {
              ok: false,
              reason:
                r.phase === "countdown"
                  ? "The battle is starting."
                  : "That move is unavailable.",
            };
      send(peer, { type: "ack", seq: m.seq, ...result });
      if (result.ok) state(r);
    }
  }
  wss.on("connection", (ws) => {
    const peer: Peer = {
      ws,
      budget: 40,
      budgetAt: performance.now(),
      alive: true,
      lastPong: performance.now(),
    };
    peers.add(peer);
    ws.on("pong", () => {
      peer.alive = true;
      peer.lastPong = performance.now();
    });
    ws.on("message", (data, binary) => {
      const now = performance.now();
      peer.budget = Math.min(40, peer.budget + (now - peer.budgetAt) * 0.02);
      peer.budgetAt = now;
      if (binary || --peer.budget < 0) {
        tracePeer(peer, "invalid-or-excessive-messages", { binary });
        ws.close(1008, "Too many messages");
        return;
      }
      try {
        handle(peer, JSON.parse(data.toString()));
      } catch {
        fail(peer, "Invalid message.");
      }
    });
    ws.on("error", (error) => {
      tracePeer(peer, "socket-error", { message: error.message.slice(0, 120) });
      ws.terminate();
    });
    ws.on("close", (code, reason) => {
      tracePeer(peer, "close", {
        code,
        reason: reason.toString().slice(0, 120),
      });
      remove(peer, false);
      peers.delete(peer);
    });
  });
  // Ignore Vite's HMR socket; this listener owns only /battle.
  const onUpgrade = (
    req: import("node:http").IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ) => {
    if (req.url?.split("?")[0] !== "/battle") return;
    const origin = req.headers.origin;
    let allowed = !origin;
    try {
      allowed ||=
        new URL(origin!).host === req.headers.host ||
        origin === process.env.PUBLIC_ORIGIN;
    } catch {
      /* malformed origin */
    }
    if (!allowed || peers.size >= 250) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  };
  server.on("upgrade", onUpgrade);
  let broadcasts = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    broadcasts++;
    for (const r of rooms.values()) {
      if (r.phase === "waiting") {
        const before = r.players.length;
        r.players = r.players.filter(
          (p) => p.peer || now - p.disconnectedAt < reconnectMs,
        );
        if (before !== r.players.length) roomChanged(r);
        if (!r.players.length || now - r.createdAt > 600_000) {
          broadcast(r, {
            type: "error",
            message: "Room expired. Create a new room.",
            fatal: true,
          });
          r.players.forEach((p) => {
            if (p.peer) remove(p.peer, true);
          });
          rooms.delete(r.code);
        }
        continue;
      }
      if (r.phase === "finished") {
        if (now - r.finishedAt > 120_000) {
          r.players.forEach((p) => {
            if (p.peer) remove(p.peer, true);
          });
          rooms.delete(r.code);
        }
        continue;
      }
      const expired = r.players.filter(
        (p) => !p.peer && now - p.disconnectedAt >= reconnectMs,
      );
      if (expired.length) {
        finish(
          r,
          expired.length === 2 ? "draw" : other(expired[0].team),
          "Connection lost",
        );
        continue;
      }
      if (r.phase === "countdown" && now >= r.startsAt) {
        r.phase = "playing";
        roomChanged(r);
      }
      let count = 0;
      while (r.phase === "playing" && now >= r.nextTick && count++ < 15) {
        r.battle!.step();
        r.nextTick += STEP * 1000;
        if (r.battle!.winner) {
          finish(r, r.battle!.winner!, r.battle!.reason);
          break;
        }
      }
      if (count >= 15) r.nextTick = now + STEP * 1000;
      if (broadcasts % 2 === 0) state(r);
    }
  }, 1000 / 30);
  const heartbeat = setInterval(() => {
    for (const p of peers) {
      if (!p.alive) {
        tracePeer(p, "heartbeat-terminate");
        p.ws.terminate();
      } else {
        p.alive = false;
        p.ws.ping();
      }
    }
  }, 10_000);
  function close() {
    clearInterval(timer);
    clearInterval(heartbeat);
    server.off("upgrade", onUpgrade);
    peers.forEach((p) => p.ws.terminate());
    wss.close();
    rooms.clear();
  }
  server.once("close", close);
  return { close, rooms };
}
