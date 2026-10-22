import "../../src/ui/announcements.css";
import { NativeIntro } from "../../src/ui/intro";
import { Arena } from "../../src/render/arena";
import { Battle, STEP, type Mode } from "../../src/game/engine";
const arena = new Arena(document.querySelector("#arena")!);
const intro = new NativeIntro(document.querySelector("#battle-intro")!);
let battle: Battle,
  playing = false,
  last = performance.now(),
  accumulated = 0,
  renderedTime = 0;
function advance(dt: number) {
  accumulated += intro.clock.advance(dt);
  while (accumulated + 1e-8 >= STEP) {
    battle.step();
    accumulated -= STEP;
  }
}
function jump() {
  battle = new Battle({ seed: 1, ai: false });
  arena.setBattle(battle);
  intro.start(
    (document.querySelector("#name") as HTMLInputElement).value,
    (document.querySelector("#mode") as HTMLSelectElement).value as Mode,
  );
  accumulated = renderedTime = 0;
  advance(
    Number((document.querySelector("#frame") as HTMLSelectElement).value) / 30,
  );
  playing = false;
  document.querySelector("#play")!.textContent = "Play";
}
for (const id of ["#frame", "#name", "#mode"])
  document.querySelector(id)!.addEventListener("change", jump);
document.querySelector("#play")!.addEventListener("click", () => {
  playing = !playing;
  document.querySelector("#play")!.textContent = playing ? "Pause" : "Play";
});
document.querySelector("#step")!.addEventListener("click", () => advance(STEP));
document.querySelector("#reset")!.addEventListener("click", () => {
  (document.querySelector("#frame") as HTMLSelectElement).value = "0";
  jump();
});
jump();
function render(now: number) {
  if (playing) advance(Math.min(0.1, (now - last) / 1000));
  last = now;
  arena.render(Math.max(0, battle.time - renderedTime), battle.time);
  renderedTime = battle.time;
  intro.update(true);
  document.querySelector("#status")!.textContent =
    `${intro.loaded} native clips · frame ${intro.state.frame} · battle ${battle.time.toFixed(2)}s · ${intro.clock.blocking ? "waiting" : "ready"}`;
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
