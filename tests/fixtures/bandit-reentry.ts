import { Battle, type Entity, type Point, type Replay, type Team } from "../../src/game/engine";
import { Arena } from "../../src/render/arena";
import { banditReentryOpening } from "./bandit-reentry-setup";

const arena = new Arena(document.querySelector<HTMLElement>("#arena")!);
const status = document.querySelector<HTMLOutputElement>("#status")!;
const value = (id: string) => document.querySelector<HTMLSelectElement>(`#${id}`)!.value;
let battle: Battle, bandit: Entity, knight: Entity, landing: Point, replayBuilds = 0, renderedTime = 0;
let stage = "landed";
function setup() {
  ({ battle, bandit, knight, landing } = banditReentryOpening(Number(value("rules")) as Replay["version"], value("team") as Team));
  replayBuilds = 0; stage = "landed";
  arena.setBattle(battle); renderedTime = battle.time;
}
document.querySelectorAll("select").forEach((s) => s.addEventListener("change", setup));
document.querySelector("#advance")!.addEventListener("click", () => {
  for (let i = 0; i < 3; i++) battle.step();
  stage = "follow-up";
});
document.querySelector("#launch")!.addEventListener("click", () => {
  for (let i = 0; !bandit.dash && i < 120 && bandit.hp > 0; i++) battle.step();
  if (!bandit.dash) throw new Error("Follow-up dash did not launch");
  stage = "launched";
});
document.querySelector("#replay")!.addEventListener("click", () => {
  const tick = battle.tick;
  battle = new Battle({ replay: battle.exportReplay() });
  while (battle.tick < tick) battle.step();
  bandit = battle.entities.find((e) => e.card === "bandit")!;
  knight = battle.entities.find((e) => e.id === knight.id)!;
  replayBuilds++; arena.setBattle(battle); renderedTime = battle.time;
});
setup();
function render() {
  arena.render(Math.max(0, battle.time - renderedTime), battle.time);
  renderedTime = battle.time;
  status.textContent = `Bandit · ${bandit.dashCharge ? "charging next dash" : bandit.dash ? "dashing" : "landed"}`;
  status.dataset.state = JSON.stringify({
    tick: battle.tick, version: battle.rulesVersion, runner: value("team"), stage,
    hp: bandit.hp, x: bandit.x, y: bandit.y, landing, charge: bandit.dashCharge, dash: bandit.dash,
    ready: !!bandit.dashReentry, native: !!bandit.nativeBanditReentry, knight: knight.id,
    replayBuilds, actions: battle.exportReplay().actions, effects: arena.loadedEffects,
    starts: battle.audioEvents.filter((e) => e.phase === "dash-start").length,
  });
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
