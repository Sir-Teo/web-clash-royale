import {
  network,
  resumeBeforeGraphics,
  startupRoomRequested,
} from "./network/session";

const status = document.querySelector("#startup-status");
const ready = resumeBeforeGraphics();
if (startupRoomRequested && status)
  status.textContent = "Rejoining your battle…";
await ready;
try {
  await import("./main");
} catch (error) {
  network.disconnect(false);
  const app = document.querySelector("#app")!;
  if (!app.querySelector(".webgl-error")) {
    app.innerHTML =
      '<div id="startup" role="status"><img src="/crown.svg" alt=""/><p>Couldn’t load the arena.</p><button type="button">Try again</button></div>';
    app.querySelector("button")!.onclick = () => location.reload();
  }
  console.error("Arena startup failed", error);
}
