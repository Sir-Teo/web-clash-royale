import { Arena } from "../../src/render/arena";
import { Battle, STEP } from "../../src/game/engine";
import type { Team } from "../../src/game/engine";
import type { CardId } from "../../src/game/cards";
const arena = new Arena(document.querySelector("#arena")!);
let battle: Battle,
  playing = false,
  elapsed = 0,
  last = performance.now();
function cast(id: CardId, team: Team, x: number, y: number) {
  battle.players[team].elixir = 10;
  battle.players[team].hand[0] = id;
  battle.play(team, 0, x, y);
}
function unit(id: CardId, team: Team, x: number, y: number) {
  const ids = new Set(battle.entities.map((e) => e.id));
  cast(id, team, x, team === "blue" ? 22 : 10);
  const units = battle.entities.filter((e) => !ids.has(e.id));
  for (const e of units) {
    e.y += y - (team === "blue" ? 22 : 10);
    e.deploy = 0;
    e.cooldown = 0;
  }
  return units;
}
function setup() {
  playing = false;
  elapsed = 0;
  document.querySelector("#play")!.textContent = "Play";
  battle = new Battle({ seed: 12, ai: false });
  for (const t of battle.entities) t.active = false;
  const scenario = (document.querySelector("#scenario") as HTMLSelectElement)
    .value;
  (document.querySelector("#attackers") as HTMLButtonElement).hidden =
    scenario !== "burrow";
  if (scenario === "volley") {
    unit("skeleton-army", "red", 4, 12);
    unit("giant", "red", 14, 12);
    unit("archers", "red", 14, 10);
    cast("arrows", "blue", 4, 12);
    cast("fireball", "blue", 14, 12);
  } else if (scenario === "ranged") {
    for (const [id, x, y] of [
      ["archers", 3, 23],
      ["spear-goblins", 7, 23],
      ["bomber", 11, 23],
      ["wizard", 15, 23],
    ] as [CardId, number, number][]) {
      unit(id, "blue", x, y);
      for (const e of unit("giant", "red", x, y - 4)) e.active = false;
    }
  } else if (scenario === "burrow") {
    unit("tesla", "blue", 6, 21);
    unit("tesla", "red", 12, 11);
    unit("cannon", "blue", 3, 22);
    unit("cannon", "red", 15, 10);
  } else if (scenario === "tesla") {
    unit("tesla", "blue", 6, 21);
    unit("minions", "red", 6, 17.6);
    unit("knight", "red", 13, 19);
    cast("zap", "blue", 13, 19);
  } else {
    unit("knight", "blue", 4, 21);
    unit("knight", "red", 4, 19.9);
    unit("prince", "blue", 14, 21);
    unit("valkyrie", "red", 14, 19.9);
  }
  arena.setBattle(battle);
}
document.querySelector("#scenario")!.addEventListener("change", setup);
document.querySelector("#reset")!.addEventListener("click", setup);
document.querySelector("#attackers")!.addEventListener("click", () => {
  const attackers = battle.entities.filter(
    (e) => e.kind === "troop" && e.hp > 0,
  );
  if (attackers.length) for (const e of attackers) e.hp = 0;
  else
    for (const [team, x, y] of [
      ["red", 6, 18.5],
      ["blue", 12, 13.5],
    ] as [Team, number, number][]) {
      for (const e of unit("knight", team, x, y)) {
        e.active = false;
        e.hp = e.maxHp = 10000;
      }
    }
});
document.querySelector("#step")!.addEventListener("click", () => {
  for (let i = 0; i < 3; i++) battle.step();
});
document.querySelector("#play")!.addEventListener("click", () => {
  playing = !playing;
  document.querySelector("#play")!.textContent = playing ? "Pause" : "Play";
});
setup();
function render(now: number) {
  const delta = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing) {
    elapsed += delta;
    while (elapsed >= STEP) {
      battle.step();
      elapsed -= STEP;
    }
  }
  arena.render(delta, battle.time);
  document.querySelector("#status")!.textContent =
    `${battle.time.toFixed(1)}s · ${battle.projectiles.length} shots · ${arena.loadedEffects} effects · ${arena.loadedBuildings} buildings loaded`;
  document.querySelector("#buildings")!.textContent = battle.entities
    .filter((e) => e.burrow)
    .map(
      (e) =>
        `${e.team}: ${e.burrow!.phase} ${Math.round(e.burrow!.exposure * 100)}%`,
    )
    .join(" · ");
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
