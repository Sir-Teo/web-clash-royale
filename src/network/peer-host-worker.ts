import { PeerMatch } from "./peer-match";
import type { PeerPlayer } from "./peer-match";
import type { Mode, Team } from "../game/engine";
import type { ClientMessage, ServerMessage } from "./protocol";
export type PeerHostCommand =
  | { type: "init"; id: string; mode: Mode; player: PeerPlayer; seed: number }
  | { type: "join"; player: PeerPlayer }
  | { type: "command"; team: Team; message: ClientMessage }
  | { type: "availability"; team: Team; active: boolean; connected: boolean }
  | { type: "pulse" }
  | { type: "consumed"; team: Team };
let match: PeerMatch | undefined;
let pulse = performance.now();
let last = pulse;
let held = false;
// UI pulses clear the watchdog hold, not the player's explicit availability.
let localAvailability = { active: true, connected: true };
function updateHostAvailability() {
  match?.availability(
    "blue",
    localAvailability.active && !held,
    localAvailability.connected,
  );
}
const pending: Partial<Record<Team, ServerMessage>> = {};
const inflight = { blue: false, red: false };
function emit(team: Team, message: ServerMessage) {
  if (message.type === "state") {
    if (inflight[team]) {
      // The engine continues mutating entities after this tick. A retained
      // snapshot must own those values until the UI acknowledges delivery.
      pending[team] = structuredClone(message);
      return;
    }
    inflight[team] = true;
  }
  postMessage({ team, message });
}
self.onmessage = (event: MessageEvent<PeerHostCommand>) => {
  const m = event.data;
  if (m.type === "init")
    match = new PeerMatch(m.id, m.mode, m.player, m.seed, emit);
  else if (m.type === "join") match?.join(m.player);
  else if (m.type === "command") match?.receive(m.team, m.message);
  else if (m.type === "availability") {
    if (m.team === "blue") {
      localAvailability = { active: m.active, connected: m.connected };
      updateHostAvailability();
    } else match?.availability(m.team, m.active, m.connected);
  } else if (m.type === "pulse") {
    pulse = performance.now();
    if (held) {
      held = false;
      updateHostAvailability();
    }
  } else if (m.type === "consumed") {
    inflight[m.team] = false;
    const next = pending[m.team];
    delete pending[m.team];
    if (next) emit(m.team, next);
  }
};
setInterval(() => {
  const now = performance.now();
  if (!held && now - pulse > 4000) {
    held = true;
    updateHostAvailability();
  }
  match?.advance((now - last) / 1000);
  last = now;
}, 1000 / 30);
