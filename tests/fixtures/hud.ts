import { NativeBattleHud } from "../../src/ui/hud";
import { hudView, hudBox, type HudData } from "../../src/ui/hud-data";
import { renderNativeFrame } from "../../src/ui/native";
const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
const hud = new NativeBattleHud($(".match-timer"), $(".match-crowns"));
let time = 0,
  playing = false,
  previous = performance.now();
const counts = () => ({
  blue: Number($<HTMLInputElement>("#blue").value),
  red: Number($<HTMLInputElement>("#red").value),
});
$("#time").oninput = () => {
  time = Number($<HTMLInputElement>("#time").value);
  hud.reset(time, counts());
};
$("#reset").onclick = () => hud.reset(time, counts());
$("#step").onclick = () => {
  time += 0.1;
  $<HTMLInputElement>("#time").value = time.toFixed(1);
};
$("#play").onclick = () => {
  playing = !playing;
  $("#play").textContent = playing ? "Pause" : "Play";
};
function render(now: number) {
  if (playing) {
    time = Math.min(300, time + Math.min(0.1, (now - previous) / 1000));
    $<HTMLInputElement>("#time").value = time.toFixed(2);
  }
  previous = now;
  hud.update({ time, mode: "classic", winner: null }, counts());
  const state = hud.state;
  $("#status").textContent =
    `${hud.loaded} HUD clips · ${time.toFixed(2)}s · blue ${state.blueFrame} · red ${state.redFrame} · ${state.landscape ? "landscape" : "portrait"}`;
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
const data: HudData = await (await fetch("/assets/ui/hud/hud.json")).json();
await document.fonts.load('28px "Supercell Magic"');
const select = $<HTMLSelectElement>("#source"),
  frame = $<HTMLInputElement>("#frame");
for (const name of Object.keys(data.clips)) {
  const o = document.createElement("option");
  o.value = o.textContent = name;
  select.append(o);
}
function show() {
  const name = select.value,
    n = Number(frame.value),
    score = name.startsWith("HUD_rightMiddle"),
    landscape = name.endsWith("landscape");
  frame.max = String(score ? 99 : data.clips[name].frames.length - 1);
  const f = Math.min(n, Number(frame.max));
  frame.value = String(f);
  renderNativeFrame(
    $("#source-art"),
    score ? hudView(data, landscape, f, f) : data,
    score ? "display" : name,
    score ? 0 : f,
    {},
    {
      path: "/assets/ui/hud",
      viewBox: score
        ? hudBox(landscape)
        : name.startsWith("crown")
          ? "-85 -80 170 160"
          : "-110 -128 120 200",
      prefix: "hud-source",
    },
  );
  $("#source-status").textContent = `${f} / ${frame.max}`;
}
select.onchange = show;
frame.oninput = show;
show();
