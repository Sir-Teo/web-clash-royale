import { DirectRoomClient } from "./client-core";
import { LatestSnapshot, UiDelivery } from "./transport-protocol";
import type { TransportCommand, TransportEvent } from "./transport-protocol";
import type { ServerMessage } from "./protocol";

const channel = globalThis as unknown as {
  onmessage: (event: MessageEvent<TransportCommand>) => void;
  postMessage: (event: TransportEvent) => void;
};
let ui = new UiDelivery(performance.now());
const client = new DirectRoomClient(() => ui.ready(performance.now()));
let generation = 0;
const snapshots = new LatestSnapshot<ServerMessage>((message, serial) => {
  channel.postMessage({
    type: "message",
    generation,
    message,
    serial,
    latency: client.latency,
  });
});
client.onMessage = (message) => {
  if (message.type === "state") snapshots.push(message);
  else
    channel.postMessage({
      type: "message",
      generation,
      message,
      latency: client.latency,
    });
};
client.onConnection = (status) => {
  // The welcome message sets the UI's connected state and persists its token.
  if (status !== "connected")
    channel.postMessage({ type: "connection", generation, status });
};
channel.onmessage = ({ data }) => {
  if (data.type === "connect" || data.type === "disconnect") {
    if (data.generation < generation) return;
    generation = data.generation;
    snapshots.reset();
    if (data.type === "connect") {
      ui = new UiDelivery(performance.now());
      client.connect(data.first);
    } else client.disconnect(data.clear);
    return;
  }
  if (data.generation !== generation) return;
  if (data.type === "consumed") snapshots.consumed(data.serial);
  else if (data.type === "pulse") ui.pulse(performance.now());
  else client.send(data.message);
};
