import { Battle, STEP, type Entity, type Replay, type Team } from "../../src/game/engine";
import { Arena } from "../../src/render/arena";
import { retainedPoisonOpening, advanceRetainedPoisonTick } from "./retained-poison-setup";

const arena = new Arena(document.querySelector<HTMLElement>("#arena")!);
const status = document.querySelector<HTMLOutputElement>("#status")!;
const value = (id: string) => document.querySelector<HTMLSelectElement>(`#${id}`)!.value;
let battle: Battle, tesla: Entity, beforeHp = 0, beforeTick = 0, decayPerStep = 0, replayBuilds = 0, renderedTime = 0;
let stage = "hidden";
function setup() {
  ({ battle, tesla } = retainedPoisonOpening(Number(value("rules")) as Replay["version"], value("team") as Team));
  beforeHp = tesla.hp;
  beforeTick = battle.tick;
  decayPerStep = tesla.maxHp / tesla.lifetime! * STEP;
  replayBuilds = 0;
  stage = "hidden";
  arena.setBattle(battle);
  renderedTime = battle.time;
}
document.querySelectorAll("select").forEach((s) => s.addEventListener("change", setup));
document.querySelector("#tick")!.addEventListener("click", () => {
  advanceRetainedPoisonTick(battle, tesla);
  stage = "ticked";
});
document.querySelector("#replay")!.addEventListener("click", () => {
  const tick = battle.tick;
  battle = new Battle({ replay: battle.exportReplay() });
  while (battle.tick < tick) battle.step();
  tesla = battle.entities.find((e) => e.card === "tesla")!;
  replayBuilds++;
  arena.setBattle(battle);
  renderedTime = battle.time;
});
setup();
function render() {
  arena.render(Math.max(0, battle.time - renderedTime), battle.time);
  renderedTime = battle.time;
  status.textContent = `Poison · buried Tesla · ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(tesla.hp)} HP`;
  status.dataset.state = JSON.stringify({
    tick: battle.tick, version: battle.rulesVersion, caster: value("team"),
    stage, hp: tesla.hp, beforeHp, beforeTick, decayPerStep,
    phase: tesla.burrow?.phase, poison: tesla.poison,
    native: !!tesla.nativeRetainedPoison, replayBuilds,
    actions: battle.exportReplay().actions, effects: arena.loadedEffects,
  });
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
