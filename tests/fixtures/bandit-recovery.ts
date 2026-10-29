import { Battle, type Entity, type Replay, type Team } from "../../src/game/engine";
import { Arena } from "../../src/render/arena";
import { banditStartupOpening, finishBanditStartup } from "./bandit-startup-setup";

const arena = new Arena(document.querySelector<HTMLElement>("#arena")!);
const status = document.querySelector<HTMLOutputElement>("#status")!;
const value = (id: string) => document.querySelector<HTMLSelectElement>(`#${id}`)!.value;
let battle: Battle, bandit: Entity, knight: Entity, landingTick = 0, replayBuilds = 0, renderedTime = 0;
let stage = "landed";
const ordinaryHits = () => battle.events.filter((e) => e.type === "hit" && e.card === "bandit" && !e.effect);
function setup() {
  ({ battle, bandit } = banditStartupOpening(Number(value("rules")) as Replay["version"], value("team") as Team));
  finishBanditStartup(battle, bandit);
  while (bandit.dash) battle.step();
  knight = battle.entities.find((e) => e.card === "knight")!;
  landingTick = battle.tick;
  replayBuilds = 0; stage = "landed";
  arena.setBattle(battle); renderedTime = battle.time;
}
document.querySelectorAll("select").forEach((s) => s.addEventListener("change", setup));
document.querySelector("#advance")!.addEventListener("click", () => {
  for (let i = 0; i < 18; i++) battle.step();
  stage = "preparing";
});
document.querySelector("#launch")!.addEventListener("click", () => {
  for (let i = 0; !ordinaryHits().length && i < 180 && bandit.hp > 0; i++) battle.step();
  if (!ordinaryHits().length) throw new Error("Bandit did not release an ordinary hit");
  stage = "hit";
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
  status.textContent = `Bandit · ${stage === "hit" ? "first melee hit" : stage === "preparing" ? "recovering after landing" : "landed"}`;
  status.dataset.state = JSON.stringify({
    tick: battle.tick, version: battle.rulesVersion, runner: value("team"), stage, landingTick,
    hp: bandit.hp, targetHp: knight.hp, x: bandit.x, y: bandit.y,
    pending: bandit.pendingAttack, recovery: bandit.banditRecovery, attack: bandit.attack,
    native: !!bandit.nativeBanditRecovery, hits: ordinaryHits(), replayBuilds,
    actions: battle.exportReplay().actions, effects: arena.loadedEffects,
    attacks: battle.audioEvents.filter((e) => e.phase === "attack" && e.profile === "bandit").length,
  });
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
