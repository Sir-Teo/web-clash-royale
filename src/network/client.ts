import { PROTOCOL } from "./protocol";
import type { ClientMessage, RoomState, ServerMessage } from "./protocol";
import type { Team } from "../game/engine";
const KEY = "browser-royale.room.v1";
type Session = { code: string; token: string };
export class RoomClient {
  room: RoomState | null = null;
  team: Team = "blue";
  connected = false;
  latency = 0;
  pending = false;
  actionCount = 0;
  onMessage: (message: ServerMessage) => void = () => {};
  onConnection: (
    status: "connecting" | "connected" | "reconnecting" | "closed",
  ) => void = () => {};
  private ws?: WebSocket;
  private session: Session | null = null;
  private stopped = true;
  private retry = 0;
  private timer = 0;
  private heartbeat = 0;
  private lastMessage = 0;
  private seq = Date.now();
  get saved() {
    try {
      const s = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
      return s && /^[A-Z2-9]{6}$/.test(s.code) && /^[a-f0-9]{64}$/.test(s.token)
        ? (s as Session)
        : null;
    } catch {
      return null;
    }
  }
  connect(first: ClientMessage) {
    this.disconnect(first.type !== "resume");
    if (first.type === "resume")
      this.session = { code: first.code, token: first.token };
    this.stopped = false;
    this.open(first);
  }
  resume() {
    const saved = this.saved;
    if (!saved) return false;
    this.session = saved;
    this.connect({ type: "resume", version: PROTOCOL, ...saved });
    return true;
  }
  private open(first: ClientMessage) {
    this.onConnection(this.retry ? "reconnecting" : "connecting");
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/battle`,
    );
    this.ws = ws;
    const timeout = window.setTimeout(() => ws.close(), 10_000);
    ws.onopen = () => {
      clearTimeout(timeout);
      this.lastMessage = performance.now();
      this.send(first);
      clearInterval(this.heartbeat);
      this.heartbeat = window.setInterval(() => {
        if (performance.now() - this.lastMessage > 15_000) {
          ws.close();
          return;
        }
        this.send({ type: "ping", at: performance.now() });
      }, 3000);
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      this.lastMessage = performance.now();
      let m: ServerMessage;
      try {
        m = JSON.parse(e.data);
      } catch {
        ws.close();
        return;
      }
      if (m.type === "welcome") {
        this.team = m.team;
        this.session = { code: m.code, token: m.token };
        try {
          sessionStorage.setItem(KEY, JSON.stringify(this.session));
        } catch {
          /* memory reconnect remains available */
        }
        this.connected = true;
        this.retry = 0;
        this.onConnection("connected");
      }
      if (m.type === "room") this.room = m.room;
      if (m.type === "state") {
        this.actionCount = m.state.actionCount;
        this.pending = false;
      }
      if (m.type === "ack") this.pending = false;
      if (m.type === "pong")
        this.latency = Math.round(performance.now() - m.at);
      if (m.type === "error" && m.fatal) this.disconnect();
      this.onMessage(m);
    };
    ws.onclose = (e) => {
      clearTimeout(timeout);
      if (this.ws !== ws) return;
      this.connected = false;
      this.pending = false;
      clearInterval(this.heartbeat);
      if (e.code === 4001) {
        this.disconnect();
        this.onMessage({
          type: "error",
          message: "This room was opened in another tab.",
          fatal: true,
        });
        return;
      }
      if (!this.stopped && this.session && this.retry < 12) {
        this.onConnection("reconnecting");
        this.timer = window.setTimeout(
          () => {
            if (this.session)
              this.open({ type: "resume", version: PROTOCOL, ...this.session });
          },
          Math.min(3000, 500 * ++this.retry),
        );
      } else {
        this.onConnection("closed");
        if (!this.stopped)
          this.onMessage({
            type: "error",
            message:
              "Could not connect. Open the same running game server on both devices.",
            fatal: true,
          });
      }
    };
    ws.onerror = () => ws.close();
  }
  send(m: ClientMessage) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(m));
    return true;
  }
  play(card: import("../game/cards").CardId, x: number, y: number) {
    if (!this.connected || this.pending) return false;
    this.pending = this.send({
      type: "play",
      seq: ++this.seq,
      card,
      x: this.team === "red" ? 18 - x : x,
      y: this.team === "red" ? 32 - y : y,
    });
    return this.pending;
  }
  disconnect(clear = true) {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.heartbeat);
    const ws = this.ws;
    this.ws = undefined;
    ws?.close();
    this.connected = false;
    this.pending = false;
    this.retry = 0;
    if (clear) {
      this.session = null;
      this.room = null;
      try {
        sessionStorage.removeItem(KEY);
      } catch {
        /* optional storage */
      }
    }
  }
  leave() {
    this.send({ type: "leave" });
    this.disconnect();
  }
}
