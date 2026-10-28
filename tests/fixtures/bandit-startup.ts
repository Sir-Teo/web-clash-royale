import { Battle, type Entity, type Replay, type Team } from "../../src/game/engine";
import { Arena } from "../../src/render/arena";
import { banditStartupOpening, finishBanditStartup, zapChargingBandit } from "./bandit-startup-setup";

const arena = new Arena(document.querySelector<HTMLElement>("#arena")!);
const status = document.querySelector<HTMLOutputElement>("#status")!;
const value = (id: string) => document.querySelector<HTMLSelectElement>(`#${id}`)!.value;
let battle: Battle, bandit: Entity, defender: Team, replayBuilds = 0, renderedTime = 0;
let stage = "ready", zapDamage: number | undefined;
function setup() {
  ({ battle, bandit, defender } = banditStartupOpening(Number(value("rules")) as Replay["version"], value("team") as Team));
  replayBuilds = 0; stage = "ready"; zapDamage = undefined;
  arena.setBattle(battle); renderedTime = battle.time;
}
document.querySelectorAll("select").forEach((s) => s.addEventListener("change", setup));
document.querySelector("#zap")!.addEventListener("click", () => {
  zapDamage = zapChargingBandit(battle, bandit, defender);
  stage = "zapped";
});
document.querySelector("#tick")!.addEventListener("click", () => {
  finishBanditStartup(battle, bandit); stage = "launched";
});
document.querySelector("#replay")!.addEventListener("click", () => {
  const tick = battle.tick;
  battle = new Battle({ replay: battle.exportReplay() });
  while (battle.tick < tick) battle.step();
  bandit = battle.entities.find((e) => e.card === "bandit")!;
  replayBuilds++; arena.setBattle(battle); renderedTime = battle.time;
});
setup();
function render() {
  arena.render(Math.max(0, battle.time - renderedTime), battle.time);
  renderedTime = battle.time;
  status.textContent = `Bandit · ${bandit.dashCharge ? "charging" : bandit.dash ? "dashing" : "ready"}${zapDamage === undefined ? "" : ` · Zap damage ${zapDamage}`}`;
  status.dataset.state = JSON.stringify({
    tick: battle.tick, version: battle.rulesVersion, runner: value("team"), stage,
    hp: bandit.hp, x: bandit.x, y: bandit.y, charge: bandit.dashCharge, dash: bandit.dash,
    stun: bandit.stun, native: !!bandit.nativeBanditStartup, replayBuilds, zapDamage,
    actions: battle.exportReplay().actions, effects: arena.loadedEffects,
    filter: arena.banditFilterState, trails: arena.banditTrailState,
  });
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
