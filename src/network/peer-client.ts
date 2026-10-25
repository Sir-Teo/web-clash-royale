import type { Mode, Team } from "../game/engine";
import type { CardId } from "../game/cards";
import type { ClientMessage, RoomState, ServerMessage } from "./protocol";
import { PEER_PROTOCOL } from "./protocol";
import type { PeerPlayer } from "./peer-match";
import type { PeerHostCommand } from "./peer-host-worker";
import {
  decodeSignal,
  encodeSignal,
  PeerAssembler,
  peerChunks,
} from "./peer-signaling";
import { validPeerPlayer } from "./peer-match";

const INCOMPATIBLE_PEER =
  "The other browser sent an incompatible battle update. Update both games and create a new invite.";

export type PeerSetup =
  "idle" | "gathering" | "offer" | "answer" | "connecting" | "connected";
export class PeerRoomClient {
  readonly transport = "peer";
  readonly saved = null;
  room: RoomState | null = null;
  team: Team = "blue";
  connected = false;
  latency = 0;
  pending = false;
  actionCount = 0;
  setup: PeerSetup = "idle";
  signal = "";
  onMessage: (message: ServerMessage) => void = () => {};
  onConnection: (
    status: "connecting" | "connected" | "reconnecting" | "closed",
  ) => void = () => {};
  onSetup: () => void = () => {};
  private pc?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private worker?: Worker;
  private timer?: ReturnType<typeof setInterval>;
  private timeout?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private seq = 0;
  get playSequence() {
    return this.seq;
  }
  private packet = 0;
  private id = "";
  private mode: Mode = "classic";
  private player?: PeerPlayer;
  private pendingPlayer?: PeerPlayer;
  private lastReceived = 0;
  private opponentActive = true;
  private gameplayAvailable = true;
  private joined = false;
  private remoteBudget = 60;
  private budgetAt = 0;
  get loadout(): PeerPlayer | null {
    return this.joined && this.player ? structuredClone(this.player) : null;
  }
  updatePlayer(player: PeerPlayer) {
    if (
      !this.joined ||
      !this.connected ||
      this.room?.phase !== "waiting" ||
      !validPeerPlayer(player)
    )
      return false;
    const queued = this.pendingPlayer ?? this.player;
    if (
      queued?.name === player.name &&
      queued.deck.every((id, i) => id === player.deck[i])
    )
      return true;
    if (
      !this.send({ type: "loadout", name: player.name, deck: [...player.deck] })
    )
      return false;
    this.pendingPlayer = structuredClone(player);
    return true;
  }
  constructor() {
    document.addEventListener("visibilitychange", () => this.visibility());
  }
  private get active() {
    return this.gameplayAvailable && !document.hidden;
  }
  setGameplayAvailable(available: boolean) {
    if (this.gameplayAvailable === available) return;
    this.gameplayAvailable = available;
    this.visibility();
  }
  private changed(setup: PeerSetup) {
    this.setup = setup;
    this.onSetup();
  }
  private post(message: PeerHostCommand) {
    this.worker?.postMessage(message);
  }
  private create(player: PeerPlayer, team: Team) {
    if (typeof RTCPeerConnection === "undefined")
      throw new Error(
        "This browser cannot connect directly. Try an up-to-date Safari or Chrome using HTTPS.",
      );
    if (!validPeerPlayer(player))
      throw new Error("Choose a name and eight unique cards.");
    this.disconnect();
    this.player = structuredClone(player);
    this.team = team;
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    this.pc = pc;
    const generation = this.generation;
    pc.onconnectionstatechange = () => {
      if (generation !== this.generation) return;
      if (pc.connectionState === "failed")
        this.fail(
          "The direct connection ended. Create a new invite; this network may need a relay.",
        );
      else if (pc.connectionState === "disconnected") this.connection(false);
      else if (pc.connectionState === "connected" && this.joined)
        this.connection(true);
    };
    pc.ondatachannel = (event) => {
      if (generation !== this.generation || this.channel) {
        event.channel.close();
        return;
      }
      this.bind(event.channel, generation);
    };
    this.changed("gathering");
    return { pc, generation };
  }
  async offer(player: PeerPlayer, mode: Mode) {
    const { pc, generation } = this.create(player, "blue");
    this.id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("");
    this.mode = mode;
    try {
      const worker = new Worker(
        new URL("./peer-host-worker.ts", import.meta.url),
        { type: "module", name: "royale-peer-match" },
      );
      this.worker = worker;
      worker.onmessage = (
        event: MessageEvent<{ team: Team; message: ServerMessage }>,
      ) => {
        if (generation !== this.generation) return;
        const { team, message } = event.data;
        if (team === "blue") this.receive(message);
        else this.wire({ kind: "event", message });
        if (message.type === "state") this.post({ type: "consumed", team });
      };
      worker.onerror = (event) => {
        event.preventDefault();
        if (generation === this.generation)
          this.fail(
            "The browser could not start the match. Reload and create a new invite.",
          );
      };
      this.post({
        type: "init",
        id: this.id,
        mode,
        player,
        seed: (crypto.getRandomValues(new Uint32Array(1))[0] % 2147483646) + 1,
      });
      this.visibility();
      this.bind(pc.createDataChannel("royale", { ordered: true }), generation);
      await pc.setLocalDescription(await pc.createOffer());
      await this.gather(pc);
      if (generation !== this.generation) return;
      this.signal = encodeSignal({
        version: 1,
        type: "offer",
        id: this.id,
        mode,
        sdp: pc.localDescription!.sdp,
      });
      this.changed("offer");
    } catch (error) {
      if (generation === this.generation) this.setupError(error);
    }
  }
  async answer(input: string, player: PeerPlayer) {
    const signal = decodeSignal(input);
    if (signal.type !== "offer")
      throw new Error(
        "This is a reply. The player who created the invite needs to paste it.",
      );
    const { pc, generation } = this.create(player, "red");
    this.id = signal.id;
    this.mode = signal.mode;
    try {
      await pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await this.gather(pc);
      if (generation !== this.generation) return;
      this.signal = encodeSignal({
        ...signal,
        type: "answer",
        sdp: pc.localDescription!.sdp,
      });
      this.changed("answer");
    } catch (error) {
      if (generation === this.generation) this.setupError(error);
    }
  }
  async accept(input: string) {
    const signal = decodeSignal(input);
    if (
      !this.pc ||
      this.team !== "blue" ||
      signal.type !== "answer" ||
      signal.id !== this.id ||
      signal.mode !== this.mode
    )
      throw new Error(
        "That reply belongs to another invite. Ask your friend to use the current invite.",
      );
    const generation = this.generation;
    await this.pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
    if (generation !== this.generation) return;
    this.changed("connecting");
    this.timeout = setTimeout(() => {
      if (generation === this.generation && !this.connected)
        this.fail(
          "The browsers could not connect. Try the same Wi-Fi or another network; some networks require a relay.",
        );
    }, 25000);
  }
  private gather(pc: RTCPeerConnection) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const complete = () => {
        if (
          pc.iceGatheringState !== "complete" &&
          pc.connectionState !== "closed"
        )
          return;
        clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange", complete);
        if (pc.connectionState === "closed")
          reject(new Error("Invite cancelled"));
        else resolve();
      };
      // Keep local candidates usable when public STUN cannot answer.
      const timer = setTimeout(() => {
        pc.removeEventListener("icegatheringstatechange", complete);
        resolve();
      }, 7000);
      pc.addEventListener("icegatheringstatechange", complete);
    });
  }
  private setupError(error: unknown) {
    this.disconnect();
    this.onMessage({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "Could not prepare the invite. Try again.",
    });
  }
  private bind(channel: RTCDataChannel, generation: number) {
    this.channel = channel;
    const assembler = new PeerAssembler();
    channel.onopen = () => {
      if (generation !== this.generation) return;
      this.lastReceived = performance.now();
      this.budgetAt = this.lastReceived;
      if (this.team === "red")
        this.wire({
          kind: "hello",
          version: PEER_PROTOCOL,
          player: this.player,
          id: this.id,
          active: this.active,
        });
      this.timer = setInterval(() => {
        if (document.hidden) return;
        this.post({ type: "pulse" });
        this.wire({ kind: "ping", at: performance.now(), active: this.active });
        if (this.joined && performance.now() - this.lastReceived > 8000)
          this.connection(false);
      }, 1000);
    };
    channel.onmessage = (event) => {
      if (generation !== this.generation) return;
      try {
        const value = assembler.receive(event.data);
        if (value !== undefined) this.handle(value);
      } catch {
        this.fail(INCOMPATIBLE_PEER);
      }
    };
    channel.onclose = () => {
      if (generation === this.generation && this.setup !== "idle") {
        if (this.room?.phase === "finished") {
          this.connection(false);
          clearInterval(this.timer);
        } else
          this.fail(
            "Your friend left or the connection ended. Create a new invite to play again.",
          );
      }
    };
    channel.onerror = () => {
      if (generation === this.generation) this.connection(false);
    };
  }
  private handle(value: unknown) {
    if (!value || typeof value !== "object") throw new Error();
    const m = value as any;
    this.lastReceived = performance.now();
    if (this.joined && !this.connected) this.connection(true);
    if (
      m.kind === "ping" &&
      typeof m.at === "number" &&
      Number.isFinite(m.at)
    ) {
      this.opponentActive = m.active !== false;
      this.wire({ kind: "pong", at: m.at });
      this.post({
        type: "availability",
        team: "red",
        active: this.opponentActive,
        connected: true,
      });
    } else if (m.kind === "pong") {
      if (typeof m.at === "number" && Number.isFinite(m.at))
        this.latency = Math.max(0, Math.round(performance.now() - m.at));
    } else if (m.kind === "visibility") {
      this.opponentActive = m.active === true;
      this.post({
        type: "availability",
        team: "red",
        active: this.opponentActive,
        connected: true,
      });
    } else if (
      this.team === "blue" &&
      m.kind === "hello" &&
      m.id === this.id &&
      !this.joined
    ) {
      if (m.version !== PEER_PROTOCOL || !validPeerPlayer(m.player))
        throw new Error();
      this.joined = true;
      this.post({ type: "join", player: m.player });
      this.opponentActive = m.active === true;
      this.post({
        type: "availability",
        team: "red",
        active: this.opponentActive,
        connected: true,
      });
      this.visibility();
    } else if (this.team === "blue" && m.kind === "command" && this.joined) {
      this.remoteBudget = Math.min(
        60,
        this.remoteBudget + (performance.now() - this.budgetAt) * 0.02,
      );
      this.budgetAt = performance.now();
      if (--this.remoteBudget < 0) throw new Error();
      if (JSON.stringify(m.message).length > 4096) throw new Error();
      this.post({ type: "command", team: "red", message: m.message });
    } else if (
      this.team === "red" &&
      m.kind === "event" &&
      m.message &&
      typeof m.message.type === "string"
    )
      this.receive(m.message);
  }
  private receive(message: ServerMessage) {
    // Worker liveness can change while an invite is still being exchanged.
    // Do not replace that form with a one-player room before the handshake.
    if (!this.joined && message.type !== "welcome") return;
    if (
      (message.type === "state" ||
        message.type === "ack" ||
        message.type === "emote" ||
        message.type === "quick-chat") &&
      message.matchId !== this.room?.matchId
    )
      return;
    if (message.type === "welcome") {
      const accepted = { name: message.name, deck: message.deck };
      if (message.peerVersion !== PEER_PROTOCOL || !validPeerPlayer(accepted)) {
        this.fail(INCOMPATIBLE_PEER);
        return;
      }
      this.player = structuredClone(accepted);
      if (
        this.pendingPlayer?.name === accepted.name &&
        this.pendingPlayer.deck.every((id, i) => id === accepted.deck[i])
      )
        this.pendingPlayer = undefined;
      this.joined = true;
      this.connection(true);
      this.changed("connected");
      clearTimeout(this.timeout);
    }
    if (message.type === "room") {
      this.room = message.room;
      if (message.room.phase !== "waiting") this.pendingPlayer = undefined;
    }
    if (message.type === "state") {
      this.actionCount = message.state.actionCount;
      this.pending = false;
    }
    if (message.type === "ack") this.pending = false;
    this.onMessage(message);
  }
  private wire(value: unknown) {
    const channel = this.channel;
    if (channel?.readyState !== "open") return false;
    // Replace stale snapshots with the next live one instead of queuing seconds of play.
    if (
      channel.bufferedAmount > 128000 &&
      (value as any)?.message?.type === "state" &&
      !(value as any).message.replay
    )
      return false;
    if (channel.bufferedAmount > 2_000_000) {
      this.connection(false);
      return false;
    }
    try {
      for (const part of peerChunks(value, ++this.packet)) channel.send(part);
      return true;
    } catch {
      this.connection(false);
      return false;
    }
  }
  private connection(connected: boolean) {
    if (this.connected === connected) return;
    this.connected = connected;
    this.pending = false;
    this.post({
      type: "availability",
      team: "red",
      active: this.opponentActive,
      connected,
    });
    this.onConnection(connected ? "connected" : "reconnecting");
  }
  private visibility() {
    this.post({
      type: "availability",
      team: "blue",
      active: this.active,
      connected: true,
    });
    if (!document.hidden) this.post({ type: "pulse" });
    this.wire({ kind: "visibility", active: this.active });
  }
  send(message: ClientMessage) {
    if (!this.connected) return false;
    const matchId = message.matchId ?? this.room?.matchId;
    if (!matchId) return false;
    message = { ...message, matchId };
    if (this.team === "blue") {
      this.post({ type: "command", team: "blue", message });
      return true;
    }
    return this.wire({ kind: "command", message });
  }
  play(card: CardId, x: number, y: number) {
    if (!this.connected || this.pending || this.room?.paused) return false;
    this.pending = this.send({
      type: "play",
      seq: ++this.seq,
      card,
      x: this.team === "red" ? 18 - x : x,
      y: this.team === "red" ? 32 - y : y,
    });
    return this.pending;
  }
  private fail(message: string) {
    this.disconnect();
    this.onMessage({ type: "error", message, fatal: true });
  }
  disconnect(_clear = true) {
    this.generation++;
    clearTimeout(this.timeout);
    clearInterval(this.timer);
    this.worker?.terminate();
    this.worker = undefined;
    this.channel?.close();
    this.pc?.close();
    this.channel = undefined;
    this.pc = undefined;
    this.connected = false;
    this.pending = false;
    this.room = null;
    this.joined = false;
    this.player = undefined;
    this.pendingPlayer = undefined;
    this.opponentActive = true;
    this.remoteBudget = 60;
    this.signal = "";
    this.setup = "idle";
  }
  leave() {
    this.send({ type: "leave" });
    // Give an ordered leave/final snapshot a turn before closing the channel.
    const worker = this.worker,
      channel = this.channel,
      pc = this.pc;
    this.generation++;
    clearInterval(this.timer);
    clearTimeout(this.timeout);
    this.worker = undefined;
    this.channel = undefined;
    this.pc = undefined;
    this.connected = false;
    this.pending = false;
    this.room = null;
    this.joined = false;
    this.player = undefined;
    this.pendingPlayer = undefined;
    this.signal = "";
    this.setup = "idle";
    setTimeout(() => {
      worker?.terminate();
      channel?.close();
      pc?.close();
    }, 150);
  }
}
