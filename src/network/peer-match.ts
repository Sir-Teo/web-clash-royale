import { Battle, other, STEP } from "../game/engine";
import type { Mode, Team } from "../game/engine";
import { CARD_MAP, STARTER_DECK } from "../game/cards";
import type { CardId } from "../game/cards";
import { EMOTE_COOLDOWN, isEmote, isQuickChat } from "../game/emotes";
import type { ClientMessage, RoomState, ServerMessage } from "./protocol";
import { PEER_PROTOCOL } from "./protocol";
import { snapshot } from "./perspective";
import intro from "../ui/intro-settings.json";

export interface PeerPlayer {
  name: string;
  deck: CardId[];
}
export function validPeerPlayer(value: unknown): value is PeerPlayer {
  if (!value || typeof value !== "object") return false;
  const p = value as PeerPlayer;
  return (
    typeof p.name === "string" &&
    !!p.name.trim() &&
    p.name.length <= 18 &&
    !/[\u0000-\u001f\u007f]/.test(p.name) &&
    Array.isArray(p.deck) &&
    p.deck.length === 8 &&
    new Set(p.deck).size === 8 &&
    p.deck.every((c) => typeof c === "string" && Object.hasOwn(CARD_MAP, c))
  );
}

/** Browser-owned match. Both players use the same validated command path. */
export class PeerMatch {
  readonly room: RoomState;
  battle?: Battle;
  private players: Partial<Record<Team, PeerPlayer>>;
  private available = { blue: true, red: false };
  private sequences = { blue: -1, red: -1 };
  private reactions = { blue: -Infinity, red: -Infinity };
  private elapsed = 0;
  private countdown = intro.actionFrame / intro.fps;
  private accumulator = 0;
  private frames = 0;
  private round = 1;
  constructor(
    code: string,
    mode: Mode,
    host: PeerPlayer,
    private seed: number,
    private emit: (team: Team, message: ServerMessage) => void,
  ) {
    if (!validPeerPlayer(host) || !["classic", "double"].includes(mode))
      throw new Error("Invalid match settings");
    this.players = { blue: structuredClone(host) };
    this.room = {
      code,
      matchId: `${code}:1`,
      mode,
      phase: "waiting",
      players: [
        { team: "blue", name: host.name, ready: false, connected: true },
      ],
    };
  }
  join(player: PeerPlayer) {
    if (
      !validPeerPlayer(player) ||
      this.players.red ||
      this.room.phase !== "waiting"
    )
      return false;
    this.players.red = structuredClone(player);
    this.available.red = true;
    this.room.players.push({
      team: "red",
      name: player.name,
      ready: false,
      connected: true,
    });
    for (const team of ["blue", "red"] as const) {
      this.emit(team, {
        type: "welcome",
        code: this.room.code,
        token: "",
        peerVersion: PEER_PROTOCOL,
        name: this.players[team]!.name,
        team,
        deck: [...this.players[team]!.deck],
        mode: this.room.mode,
      });
    }
    this.changed();
    return true;
  }
  availability(team: Team, active: boolean, connected = true) {
    this.available[team] = active && connected;
    const p = this.room.players.find((p) => p.team === team);
    const connectionChanged = !!p && p.connected !== connected;
    if (p) p.connected = connected;
    if (!connected && this.room.phase === "finished")
      for (const player of this.room.players) player.rematch = false;
    const paused = !this.available.blue || !this.available.red;
    if (this.room.paused !== paused || connectionChanged) {
      this.room.paused = paused;
      this.changed();
    }
  }
  private changed() {
    this.broadcast({ type: "room", room: structuredClone(this.room) });
  }
  private broadcast(message: ServerMessage) {
    for (const team of ["blue", "red"] as const)
      if (this.players[team]) this.emit(team, message);
  }
  private state() {
    if (!this.battle) return;
    for (const team of ["blue", "red"] as const) {
      const s = snapshot(this.battle);
      s.players = {
        ...s.players,
        [other(team)]: {
          elixir: 0,
          crowns: s.players[other(team)].crowns,
          hand: STARTER_DECK.slice(0, 4),
          queue: STARTER_DECK.slice(4),
        },
      };
      this.emit(team, {
        type: "state",
        matchId: this.room.matchId,
        state: s,
        countdownMs: Math.max(0, this.countdown * 1000),
        ...(this.battle.winner ? { replay: this.battle.exportReplay() } : {}),
      });
    }
  }
  private finish(winner: Team | "draw", reason: string) {
    if (!this.battle || this.battle.winner) return;
    this.battle.finish(winner, reason);
    this.room.phase = "finished";
    this.state();
    this.changed();
  }
  receive(team: Team, m: ClientMessage) {
    if (!this.players[team] || !m || typeof m !== "object") return;
    if (m.type !== "ping" && m.matchId !== this.room.matchId) return;
    if (m.type === "rematch") {
      if (
        this.room.phase !== "finished" ||
        m.matchId !== this.room.matchId ||
        typeof m.ready !== "boolean" ||
        !this.room.players.every((p) => p.connected)
      )
        return;
      const player = this.room.players.find((p) => p.team === team)!;
      if (player.rematch === m.ready) return;
      player.rematch = m.ready;
      if (this.players.red && this.room.players.every((p) => p.rematch)) {
        this.round++;
        this.room.matchId = `${this.room.code}:${this.round}`;
        this.room.phase = "waiting";
        this.room.paused = !this.available.blue || !this.available.red;
        this.battle = undefined;
        // A fresh seeded match, with no old elapsed time, audio or reaction budget.
        this.seed = (this.seed * 48271) % 2147483647;
        this.elapsed = this.accumulator = this.frames = 0;
        this.countdown = intro.actionFrame / intro.fps;
        this.reactions = { blue: -Infinity, red: -Infinity };
        for (const p of this.room.players) {
          p.ready = false;
          p.rematch = false;
        }
      }
      this.changed();
    } else if (m.type === "ping") {
      if (Number.isFinite(m.at)) this.emit(team, { type: "pong", at: m.at });
    } else if (m.type === "loadout" && this.room.phase === "waiting") {
      if (!this.players.red) return;
      if (!validPeerPlayer(m)) {
        this.emit(team, {
          type: "error",
          message: "Choose a valid name and eight different cards.",
        });
        return;
      }
      const previous = this.players[team]!;
      if (
        previous.name === m.name &&
        previous.deck.every((id, i) => id === m.deck[i])
      )
        return;
      this.players[team] = { name: m.name, deck: [...m.deck] };
      for (const player of this.room.players) {
        if (player.team === team) player.name = m.name;
        player.ready = false;
      }
      this.emit(team, {
        type: "welcome",
        code: this.room.code,
        token: "",
        team,
        peerVersion: PEER_PROTOCOL,
        name: m.name,
        deck: [...m.deck],
        mode: this.room.mode,
      });
      this.changed();
    } else if (m.type === "ready" && this.room.phase === "waiting") {
      this.room.players.find((p) => p.team === team)!.ready = m.ready === true;
      if (
        this.players.red &&
        this.room.players.every((p) => p.ready && p.connected)
      ) {
        this.battle = new Battle({
          ai: false,
          mode: this.room.mode,
          seed: this.seed,
          deck: this.players.blue!.deck,
          enemyDeck: this.players.red.deck,
        });
        this.room.phase = "countdown";
        this.room.paused = !this.available.blue || !this.available.red;
        this.state();
      }
      this.changed();
    } else if (m.type === "leave" || m.type === "surrender") {
      this.finish(
        other(team),
        m.type === "leave" ? "Opponent left the battle" : "Surrender",
      );
    } else if (
      (m.type === "emote" || m.type === "quick-chat") &&
      ["countdown", "playing"].includes(this.room.phase) &&
      this.elapsed - this.reactions[team] >= EMOTE_COOLDOWN
    ) {
      if (m.type === "emote" && isEmote(m.kind ?? "laugh")) {
        this.reactions[team] = this.elapsed;
        this.broadcast({
          type: "emote",
          matchId: this.room.matchId,
          team,
          kind: m.kind ?? "laugh",
        });
      } else if (m.type === "quick-chat" && isQuickChat(m.phrase)) {
        this.reactions[team] = this.elapsed;
        this.broadcast({
          type: "quick-chat",
          matchId: this.room.matchId,
          team,
          phrase: m.phrase,
        });
      }
    } else if (m.type === "play") {
      if (
        !Number.isSafeInteger(m.seq) ||
        m.seq < 0 ||
        m.seq <= this.sequences[team]
      )
        return;
      this.sequences[team] = m.seq;
      const b = this.battle;
      const result =
        b &&
        this.room.phase === "playing" &&
        !this.room.paused &&
        typeof m.card === "string" &&
        Object.hasOwn(CARD_MAP, m.card) &&
        Number.isFinite(m.x) &&
        Number.isFinite(m.y)
          ? b.play(team, b.players[team].hand.indexOf(m.card), m.x, m.y)
          : {
              ok: false,
              reason: this.room.paused
                ? "Waiting for both players."
                : "The battle is starting.",
            };
      this.emit(team, {
        type: "ack",
        matchId: this.room.matchId,
        seq: m.seq,
        ...result,
      });
      if (result.ok) this.state();
    }
  }
  advance(seconds: number) {
    const dt = Math.min(0.5, Math.max(0, seconds));
    if (
      !Number.isFinite(dt) ||
      this.room.paused ||
      !this.battle ||
      this.battle.winner
    )
      return;
    this.elapsed += dt;
    let remaining = dt;
    if (this.countdown > 0) {
      const consumed = Math.min(this.countdown, remaining);
      this.countdown -= consumed;
      remaining -= consumed;
      if (this.countdown < 1e-8) {
        this.countdown = 0;
        this.room.phase = "playing";
        this.changed();
      }
    }
    this.accumulator += remaining;
    while (this.accumulator + 1e-9 >= STEP && !this.battle.winner) {
      this.battle.step();
      this.accumulator -= STEP;
    }
    if (this.battle.winner) {
      this.room.phase = "finished";
      this.state();
      this.changed();
    } else if (++this.frames % 2 === 0) this.state();
  }
}
