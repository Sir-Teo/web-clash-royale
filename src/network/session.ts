import { RoomClient } from "./client";
import type { ServerMessage } from "./protocol";

export const network = new RoomClient();
export let startupRoomRequested = false;
const buffered = new Map<string, ServerMessage>();
let status: Parameters<RoomClient["onConnection"]>[0] = "closed";

// Reserve the saved seat before importing Three.js or constructing the arena.
// Keep only the latest room/snapshot while the graphics code is loading.
export async function resumeBeforeGraphics() {
  const saved = network.saved;
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
    network.resume();
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
