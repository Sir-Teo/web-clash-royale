import { Battle, other } from "../game/engine";
import type { Point, Team } from "../game/engine";
import type { BattleSnapshot } from "./protocol";

export const rotatePoint = <T extends Point>(p: T): T => ({
  ...p,
  x: 18 - p.x,
  y: 32 - p.y,
});
/** Keep simulation coordinates canonical; only the presentation rotates. */
export function perspective(s: BattleSnapshot, team: Team): BattleSnapshot {
  if (team === "blue") return s;
  return {
    ...s,
    winner: s.winner && s.winner !== "draw" ? other(s.winner) : s.winner,
    players: { blue: s.players.red, red: s.players.blue },
    entities: s.entities.map((e) => ({
      ...rotatePoint(e),
      team: other(e.team),
      lane: e.lane ? (e.lane === "left" ? "right" : "left") : undefined,
    })),
    projectiles: s.projectiles.map((p) => ({
      ...rotatePoint(p),
      team: other(p.team),
      tx: 18 - p.tx,
      ty: 32 - p.ty,
      flight: p.flight ? rotatePoint(p.flight) : undefined,
    })),
    events: s.events.map((e) => ({
      ...rotatePoint(e),
      team: other(e.team),
      origin: e.origin ? rotatePoint(e.origin) : undefined,
    })),
    audioEvents: s.audioEvents?.map((e) => ({ ...e, team: other(e.team) })),
  };
}
export function snapshot(b: Battle): BattleSnapshot {
  return {
    tick: b.tick,
    entities: b.entities,
    projectiles: b.projectiles,
    events: b.events,
    // Older cues are already too late to play. Keep overlap for deduplication
    // without retransmitting the full presentation history at 15 Hz.
    audioEvents: b.audioEvents.filter((event) => event.time >= b.time - 1),
    players: b.players,
    winner: b.winner,
    reason: b.reason,
    actionCount: b.actions.length,
  };
}
export function applySnapshot(b: Battle, s: BattleSnapshot, team: Team) {
  const view = perspective(s, team);
  b.tick = view.tick;
  b.entities = view.entities;
  b.projectiles = view.projectiles;
  b.events = view.events;
  b.audioEvents = view.audioEvents ?? [];
  b.players = view.players;
  b.winner = view.winner;
  b.reason = view.reason;
}
