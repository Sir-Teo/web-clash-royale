import "../../src/ui/announcements.css";
import { Arena } from "../../src/render/arena";
import { Battle, STEP } from "../../src/game/engine";
import { GameAudio } from "../../src/game/audio";
import { NativeAnnouncements, battleClock } from "../../src/ui/announcements";
const arena = new Arena(document.querySelector("#arena")!);
const native = new NativeAnnouncements(
  document.querySelector("#battle-announcements")!,
);
const audio = new GameAudio();
audio.enabled = false;
let battle: Battle,
  playing = false,
  speed = 1,
  elapsed = 0,
  renderedTime = 0,
  last = performance.now();
let cues = 0;
native.onCue = (file, volume) => {
  cues++;
  document.querySelector("#cue")!.textContent = `${cues} cues · ${file}`;
  audio.play(file, volume);
};
function jump() {
  battle = new Battle({ seed: 1, ai: false });
  battle.tick = Math.round(
    Number((document.querySelector("#jump") as HTMLSelectElement).value) / STEP,
  );
  arena.setBattle(battle);
  renderedTime = battle.time;
  native.reset();
  audio.stopEffects();
  cues = 0;
  document.querySelector("#cue")!.textContent = "0 cues";
  playing = false;
  elapsed = 0;
  document.querySelector("#play")!.textContent = "Play";
}
document.querySelector("#jump")!.addEventListener("change", jump);
document.querySelector("#play")!.addEventListener("click", () => {
  playing = !playing;
  if (!playing) audio.stopEffects();
  document.querySelector("#play")!.textContent = playing ? "Pause" : "Play";
});
document.querySelector("#step")!.addEventListener("click", () => battle.step());
document.querySelector("#speed")!.addEventListener("click", () => {
  speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
  audio.setRate(speed);
  document.querySelector("#speed")!.textContent = `${speed}×`;
});
document
  .querySelector("#finish")!
  .addEventListener("click", () => battle.finish("blue", "More crowns"));
document
  .querySelector("#sound")!
  .addEventListener("change", (event) =>
    audio.setEnabled((event.target as HTMLInputElement).checked),
  );
jump();
function render(now: number) {
  if (playing) {
    elapsed += Math.min(0.1, (now - last) / 1000) * speed;
    while (elapsed >= STEP) {
      battle.step();
      elapsed -= STEP;
    }
  }
  last = now;
  arena.render(Math.max(0, battle.time - renderedTime), battle.time);
  renderedTime = battle.time;
  native.update(battle, true);
  const timer = battleClock(battle),
    remaining = Math.ceil(timer.remaining);
  document.querySelector("#phase-label")!.textContent = timer.overtime
    ? "SUDDEN DEATH"
    : "TIME LEFT";
  document.querySelector("#match-clock")!.textContent =
    `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  document.querySelector("#status")!.textContent =
    `${battle.time.toFixed(2)}s · ${native.loaded} native clips · ${battle.winner ?? "playing"}`;
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
