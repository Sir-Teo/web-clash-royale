import type { CardId } from "../game/cards";
import type { EmoteKind, QuickChatKind } from "../game/emotes";
import type { CombatAudioEvent } from "../game/combat-audio-events";
import type {
  BattleEvent,
  AreaEffect,
  Entity,
  Mode,
  PlayerState,
  Projectile,
  Replay,
  Team,
} from "../game/engine";
export const PROTOCOL = 1;
export const PEER_PROTOCOL = 4;
export const RECONNECT_MS = 30_000;
export type RoomPhase = "waiting" | "countdown" | "playing" | "finished";
export interface RoomState {
  code: string;
  phase: RoomPhase;
  mode: Mode;
  paused?: boolean;
  matchId?: string;
  players: {
    team: Team;
    name: string;
    ready: boolean;
    connected: boolean;
    rematch?: boolean;
  }[];
}
export interface BattleSnapshot {
  tick: number;
  entities: Entity[];
  projectiles: Projectile[];
  areas?: AreaEffect[];
  events: BattleEvent[];
  audioEvents?: CombatAudioEvent[];
  lifecycleAudioEvents?: CombatAudioEvent[];
  players: Record<Team, PlayerState>;
  winner: Team | "draw" | null;
  reason: string;
  actionCount: number;
}
export type ClientMessage = (
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
  | { type: "loadout"; name: string; deck: CardId[] }
  | { type: "ready"; ready: boolean }
  | { type: "rematch"; ready: boolean; matchId: string }
  | { type: "play"; seq: number; card: CardId; x: number; y: number }
  | { type: "leave" | "surrender" }
  | { type: "emote"; kind?: EmoteKind }
  | { type: "quick-chat"; phrase: QuickChatKind }
  | { type: "ping"; at: number }
) & { matchId?: string };
export type ServerMessage =
  | {
      type: "welcome";
      code: string;
      token: string;
      peerVersion?: number;
      name?: string;
      team: Team;
      deck: CardId[];
      mode: Mode;
    }
  | { type: "room"; room: RoomState }
  | {
      type: "state";
      state: BattleSnapshot;
      countdownMs: number;
      matchId?: string;
      replay?: Replay;
    }
  | { type: "ack"; seq: number; ok: boolean; reason: string; matchId?: string }
  | { type: "error"; message: string; fatal?: boolean }
  | { type: "emote"; team: Team; kind: EmoteKind; matchId?: string }
  | { type: "quick-chat"; team: Team; phrase: QuickChatKind; matchId?: string }
  | { type: "pong"; at: number };
