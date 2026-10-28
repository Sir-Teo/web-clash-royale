import { Battle, type Entity, type Replay, type Team } from "../../src/game/engine";
import { Arena } from "../../src/render/arena";
import { banditOrdinaryOpening } from "./bandit-ordinary-setup";

const arena = new Arena(document.querySelector<HTMLElement>("#arena")!);
const status = document.querySelector<HTMLOutputElement>("#status")!;
const value = (id: string) => document.querySelector<HTMLSelectElement>(`#${id}`)!.value;
let battle: Battle, bandit: Entity, knight: Entity, preparingTick = 0, replayBuilds = 0, renderedTime = 0;
let stage = "preparing";
const ordinaryHits = () => battle.events.filter((e) => e.type === "hit" && e.card === "bandit" && !e.effect);
function setup() {
  ({ battle, bandit, knight, preparingTick } = banditOrdinaryOpening(Number(value("rules")) as Replay["version"], value("team") as Team, value("buff") === "rage"));
  replayBuilds = 0; stage = "preparing";
  arena.setBattle(battle); renderedTime = battle.time;
}
document.querySelectorAll("select").forEach((s) => s.addEventListener("change", setup));
function advance(count: number) {
  for (let i = 0; ordinaryHits().length < count && i < 180 && bandit.hp > 0; i++) battle.step();
  if (ordinaryHits().length !== count) throw new Error(`Bandit did not release ${count} ordinary hits`);
  stage = count === 1 ? "first-hit" : "four-hits";
}
document.querySelector("#advance")!.addEventListener("click", () => advance(1));
document.querySelector("#launch")!.addEventListener("click", () => advance(4));
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
  status.textContent = `Bandit · ${ordinaryHits().length} ordinary hits before any dash`;
  status.dataset.state = JSON.stringify({
    tick: battle.tick, version: battle.rulesVersion, runner: value("team"), modifier: value("buff"), stage, preparingTick,
    hp: bandit.hp, targetHp: knight.hp, x: bandit.x, y: bandit.y,
    dash: bandit.dash, charge: bandit.dashCharge, pending: bandit.pendingAttack, recovery: bandit.banditRecovery, attack: bandit.attack,
    native: !!bandit.nativeBanditOrdinary, hits: ordinaryHits(), hitTicks: ordinaryHits().map((e) => Math.round(e.time * 30)), replayBuilds,
    actions: battle.exportReplay().actions, effects: arena.loadedEffects,
    attacks: battle.audioEvents.filter((e) => e.phase === "attack" && e.profile === "bandit").length,
  });
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
