import type { CardId } from "../game/cards";
import type {
  BattleEvent,
  Entity,
  Mode,
  PlayerState,
  Projectile,
  Replay,
  Team,
} from "../game/engine";
export const PROTOCOL = 1;
export const RECONNECT_MS = 30_000;
export type RoomPhase = "waiting" | "countdown" | "playing" | "finished";
export interface RoomState {
  code: string;
  phase: RoomPhase;
  mode: Mode;
  players: { team: Team; name: string; ready: boolean; connected: boolean }[];
}
export interface BattleSnapshot {
  tick: number;
  entities: Entity[];
  projectiles: Projectile[];
  events: BattleEvent[];
  players: Record<Team, PlayerState>;
  winner: Team | "draw" | null;
  reason: string;
  actionCount: number;
}
export type ClientMessage =
  | {
      type: "create";
      version: number;
      name: string;
      deck: CardId[];
      mode: Mode;
    }
  | {
      type: "join";
      version: number;
      code: string;
      name: string;
      deck: CardId[];
    }
  | { type: "resume"; version: number; code: string; token: string }
  | { type: "ready"; ready: boolean }
  | { type: "play"; seq: number; card: CardId; x: number; y: number }
  | { type: "leave" | "surrender" | "emote" }
  | { type: "ping"; at: number };
export type ServerMessage =
  | {
      type: "welcome";
      code: string;
      token: string;
      team: Team;
      deck: CardId[];
      mode: Mode;
    }
  | { type: "room"; room: RoomState }
  | {
      type: "state";
      state: BattleSnapshot;
      countdownMs: number;
      replay?: Replay;
    }
  | { type: "ack"; seq: number; ok: boolean; reason: string }
  | { type: "error"; message: string; fatal?: boolean }
  | { type: "emote"; team: Team }
  | { type: "pong"; at: number };
