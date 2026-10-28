import { Battle, type Entity, type Replay, type Team } from "../../src/game/engine";
import { Arena } from "../../src/render/arena";
import { banditDashOpening } from "./bandit-dash-setup";

const arena = new Arena(document.querySelector<HTMLElement>("#arena")!);
const status = document.querySelector<HTMLOutputElement>("#status")!;
const value = (id: string) => document.querySelector<HTMLSelectElement>(`#${id}`)!.value;
let battle: Battle, bandit: Entity, replayBuilds = 0, renderedTime = 0;
let stage = "ready";
function setup() {
  ({ battle, bandit } = banditDashOpening(Number(value("rules")) as Replay["version"], value("team") as Team));
  replayBuilds = 0;
  stage = "ready";
  arena.setBattle(battle);
  renderedTime = battle.time;
}
document.querySelectorAll("select").forEach((s) => s.addEventListener("change", setup));
document.querySelector("#tick")!.addEventListener("click", () => {
  battle.step();
  stage = "ticked";
});
document.querySelector("#replay")!.addEventListener("click", () => {
  const tick = battle.tick;
  battle = new Battle({ replay: battle.exportReplay() });
  while (battle.tick < tick) battle.step();
  bandit = battle.entities.find((e) => e.card === "bandit")!;
  replayBuilds++;
  arena.setBattle(battle);
  renderedTime = battle.time;
});
setup();
function render() {
  arena.render(Math.max(0, battle.time - renderedTime), battle.time);
  renderedTime = battle.time;
  status.textContent = `Bandit dash · Poison · ${bandit.hp} HP`;
  status.dataset.state = JSON.stringify({
    tick: battle.tick, version: battle.rulesVersion, runner: value("team"), stage,
    hp: bandit.hp, x: bandit.x, y: bandit.y, dash: bandit.dash,
    poison: bandit.poison, native: !!bandit.nativeBanditDash, replayBuilds,
    actions: battle.exportReplay().actions, effects: arena.loadedEffects,
  });
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
