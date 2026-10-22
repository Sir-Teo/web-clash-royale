import { Arena } from "../../src/render/arena";
import { Battle, STEP } from "../../src/game/engine";
import type { CardId } from "../../src/game/cards";
import type { Team } from "../../src/game/engine";
const arena = new Arena(document.querySelector("#arena")!);
let battle: Battle,
  playing = false,
  elapsed = 0,
  renderedTime = 0,
  last = performance.now();
const $ = (s: string) => document.querySelector<HTMLElement>(s)!;
function reset() {
  battle = new Battle({ seed: 71, ai: false });
  playing = false;
  elapsed = renderedTime = 0;
  $("#play").textContent = "Play";
  for (const team of ["blue", "red"] as Team[])
    for (const [id, x, y] of [
      ["archers", 3, 22],
      ["knight", 7, 22],
      ["giant", 12, 22],
      ["baby-dragon", 15, 23],
    ] as [CardId, number, number][]) {
      const p = battle.players[team];
      p.hand[0] = id;
      p.elixir = 10;
      battle.play(team, 0, x, team === "blue" ? y : 32 - y);
    }
  for (const e of battle.entities)
    if (e.kind !== "tower") {
      e.deploy = 0;
      e.age = 1;
      e.speed = 0;
      e.range = 0;
    } else {
      e.range = 0;
    }
  arena.setBattle(battle);
}
function step(seconds: number) {
  for (let i = 0; i < Math.round(seconds / STEP); i++) battle.step();
}
$("#damage").onclick = () => {
  for (const e of battle.entities)
    if (e.kind !== "tower") e.hp = Math.max(1, e.hp - e.maxHp * 0.25);
};
$("#wake").onclick = () => {
  for (const team of ["blue", "red"] as Team[]) {
    const target = battle.entities.find((e) => e.king && e.team !== team)!;
    battle.players[team].hand[0] = "zap";
    battle.players[team].elixir = 10;
    battle.play(team, 0, target.x, target.y);
  }
};
$("#step").onclick = () => step(0.1);
$("#second").onclick = () => step(1);
$("#play").onclick = () => {
  playing = !playing;
  $("#play").textContent = playing ? "Pause" : "Play";
};
$("#defeat").onclick = () => {
  for (const e of battle.entities) if (e.kind !== "tower") e.hp = 0;
};
$("#rebuild").onclick = () => arena.setBattle(battle);
$("#reset").onclick = reset;
function render(now: number) {
  if (playing) {
    elapsed += Math.min(0.1, (now - last) / 1000);
    while (elapsed >= STEP) {
      step(STEP);
      elapsed -= STEP;
    }
  }
  last = now;
  arena.render(Math.max(0, battle.time - renderedTime), battle.time);
  renderedTime = battle.time;
  const kings = [
    ...document.querySelectorAll<HTMLElement>('[data-health-kind="king"]'),
  ]
    .map((e) => e.dataset.healthFrame)
    .join("/");
  $("#status").textContent =
    `${arena.loadedHealth} health clips · ${battle.time.toFixed(1)}s · Kings ${kings} · ${arena.healthState.length} troop HUDs`;
  $("#units").dataset.positions = JSON.stringify(
    arena.healthState.map((s) => [s.x, s.y]),
  );
  $("#units").textContent = arena.healthState
    .map((s) => `${s.name.replace("hp_", "")}:${s.fill}`)
    .join(" · ");
  requestAnimationFrame(render);
}
reset();
requestAnimationFrame(render);
