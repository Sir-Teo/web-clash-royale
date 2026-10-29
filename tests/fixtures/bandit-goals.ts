import { Battle, type Entity, type Point, type Replay, type Team } from "../../src/game/engine";
import { Arena } from "../../src/render/arena";
import { banditGoalOpening, finishCommittedDash } from "./bandit-goals-setup";

const arena = new Arena(document.querySelector<HTMLElement>("#arena")!);
const status = document.querySelector<HTMLOutputElement>("#status")!;
const value = (id: string) => document.querySelector<HTMLSelectElement>(`#${id}`)!.value;
let battle: Battle, bandit: Entity, goal: Point | undefined, replayBuilds = 0, renderedTime = 0;
let stage = "target-lost";
function setup() {
  ({ battle, bandit, goal } = banditGoalOpening(Number(value("rules")) as Replay["version"], value("team") as Team));
  replayBuilds = 0;
  stage = "target-lost";
  arena.setBattle(battle);
  renderedTime = battle.time;
}
document.querySelectorAll("select").forEach((s) => s.addEventListener("change", setup));
document.querySelector("#tick")!.addEventListener("click", () => {
  finishCommittedDash(battle, bandit);
  stage = "finished";
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
  status.textContent = `Bandit · target lost · ${bandit.dash ? "finishing dash" : "dash finished"}`;
  status.dataset.state = JSON.stringify({
    tick: battle.tick, version: battle.rulesVersion, runner: value("team"), stage,
    hp: bandit.hp, x: bandit.x, y: bandit.y, dash: bandit.dash, goal,
    native: !!bandit.nativeBanditGoal, replayBuilds,
    actions: battle.exportReplay().actions, effects: arena.loadedEffects,
    hits: battle.audioEvents.filter((e) => e.phase === "impact-special").length,
  });
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
