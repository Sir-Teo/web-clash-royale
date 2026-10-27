import { Battle, other } from "../game/engine";
import type { Point, Team } from "../game/engine";
import type { BattleSnapshot } from "./protocol";
import { isLifecycleAudio } from "../game/combat-audio-events";

export const rotatePoint = <T extends Point>(p: T): T => ({
  ...p,
  x: 18 - p.x,
  y: 32 - p.y,
});
/** Keep simulation coordinates canonical; only the presentation rotates. */
export function perspective(s: BattleSnapshot, team: Team): BattleSnapshot {
  if (team === "blue") return s;
  const view: BattleSnapshot = {
    ...s,
    winner: s.winner && s.winner !== "draw" ? other(s.winner) : s.winner,
    players: { blue: s.players.red, red: s.players.blue },
    entities: s.entities.map((e) => {
      const rotated = {
        ...rotatePoint(e),
        team: other(e.team),
        lane: e.lane
          ? e.lane === "left"
            ? ("right" as const)
            : ("left" as const)
          : undefined,
      };
      if (e.nativeDistantTargets) {
        rotated.nativeLane =
          e.nativeLane === 1 ? 2 : e.nativeLane === 2 ? 1 : e.nativeLane;
        if (e.nativeDistantMirrored) delete rotated.nativeDistantMirrored;
        else rotated.nativeDistantMirrored = true;
      }
      return rotated;
    }),
    projectiles: s.projectiles.map((p) => ({
      ...rotatePoint(p),
      team: other(p.team),
      tx: 18 - p.tx,
      ty: 32 - p.ty,
      flight: p.flight ? rotatePoint(p.flight) : undefined,
      turn: p.turn ? rotatePoint(p.turn) : undefined,
    })),
    areas: s.areas?.map((area) => ({
      ...rotatePoint(area),
      team: other(area.team),
    })),
    events: s.events.map((e) => ({
      ...rotatePoint(e),
      team: other(e.team),
      origin: e.origin ? rotatePoint(e.origin) : undefined,
    })),
    audioEvents: s.audioEvents?.map((e) => ({
      ...e,
      team: other(e.team),
      ...(e.origin ? { origin: rotatePoint(e.origin) } : {}),
    })),
    lifecycleAudioEvents: s.lifecycleAudioEvents?.map((e) => ({
      ...e,
      team: other(e.team),
      ...(e.origin ? { origin: rotatePoint(e.origin) } : {}),
    })),
  };
  if (s.nativeArmyFormation || s.nativeGroupFormation || s.nativeGroundDeployment) {
    if (s.nativeArmyViewMirrored) delete view.nativeArmyViewMirrored;
    else view.nativeArmyViewMirrored = true;
  }
  return view;
}
export function snapshot(b: Battle): BattleSnapshot {
  const lifecycleAudioEvents = b.audioEvents.filter(
    (event) => isLifecycleAudio(event) && event.time >= b.time - 4,
  );
  return {
    tick: b.tick,
    ...(b.nativeTowerLayout ? { nativeTowerLayout: true as const } : {}),
    ...(b.nativeArmyFormation ? { nativeArmyFormation: true as const } : {}),
    ...(b.nativeGroupFormation ? { nativeGroupFormation: true as const } : {}),
    ...(b.nativeGroundDeployment ? { nativeGroundDeployment: true as const } : {}),
    ...((b.nativeArmyFormation || b.nativeGroupFormation || b.nativeGroundDeployment) &&
    b.nativeArmyViewMirrored
      ? { nativeArmyViewMirrored: true as const }
      : {}),
    entities: b.entities,
    projectiles: b.projectiles,
    ...(b.areas.length ? { areas: b.areas } : {}),
    events: b.events,
    // Older cues are already too late to play. Keep overlap for deduplication
    // without retransmitting the full presentation history at 15 Hz.
    audioEvents: b.audioEvents.filter(
      (event) => !isLifecycleAudio(event) && event.time >= b.time - 1,
    ),
    // Keep new phases out of the field consumed by older browser builds.
    ...(lifecycleAudioEvents.length ? { lifecycleAudioEvents } : {}),
    players: b.players,
    winner: b.winner,
    reason: b.reason,
    actionCount: b.actions.length,
  };
}
export function applySnapshot(b: Battle, s: BattleSnapshot, team: Team) {
  const view = perspective(s, team);
  b.tick = view.tick;
  b.nativeTowerLayout = view.nativeTowerLayout;
  b.nativeArmyFormation = view.nativeArmyFormation;
  b.nativeGroupFormation = view.nativeGroupFormation;
  b.nativeGroundDeployment = view.nativeGroundDeployment;
  b.nativeArmyViewMirrored = view.nativeArmyViewMirrored;
  b.entities = view.entities;
  b.projectiles = view.projectiles;
  b.areas = view.areas ?? [];
  b.events = view.events;
  b.audioEvents = [
    ...(view.audioEvents ?? []),
    ...(view.lifecycleAudioEvents ?? []),
  ].sort((a, b) => a.id - b.id);
  b.players = view.players;
  b.winner = view.winner;
  b.reason = view.reason;
}
