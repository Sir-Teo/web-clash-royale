import { RoomClient } from "./client";
import { PeerRoomClient } from "./peer-client";
import type { ServerMessage } from "./protocol";

// The shipped app is static. Keep the old room adapter only for explicit
// historical regressions; it is tree-shaken out of the normal build.
export const legacyNetwork =
  import.meta.env.VITE_LEGACY_ROOMS === "1" ? new RoomClient() : null;
export const peerNetwork = legacyNetwork ? null : new PeerRoomClient();
export const network = peerNetwork ?? legacyNetwork!;
export let startupRoomRequested = false;
const buffered = new Map<string, ServerMessage>();
let status: Parameters<RoomClient["onConnection"]>[0] = "closed";

// Reserve the saved seat before importing Three.js or constructing the arena.
// Keep only the latest room/snapshot while the graphics code is loading.
export async function resumeBeforeGraphics() {
  if (!legacyNetwork) return;
  const saved = legacyNetwork.saved;
  const invited = new URL(location.href).searchParams.get("room");
  if (!saved || (invited && invited.toUpperCase() !== saved.code)) return;
  startupRoomRequested = true;
  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, 8000);
    network.onConnection = (value) => (status = value);
    network.onMessage = (message) => {
      if (message.type === "error" && message.fatal) buffered.clear();
      if (["room", "state", "error"].includes(message.type))
        buffered.set(message.type, message);
      if (message.type === "welcome" || message.type === "error") {
        clearTimeout(timer);
        resolve();
      }
    };
    legacyNetwork.resume();
  });
}

export function flushStartupRoom() {
  network.onConnection(status);
  for (const kind of ["room", "state", "error"]) {
    const message = buffered.get(kind);
    if (message) network.onMessage(message);
  }
  buffered.clear();
}
