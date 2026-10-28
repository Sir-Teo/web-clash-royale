import { Battle, type Entity, type Replay, type Team } from "../../src/game/engine";
import { Arena } from "../../src/render/arena";
import { banditTransitionOpening, pullPreparingBandit } from "./bandit-transition-setup";

const arena = new Arena(document.querySelector<HTMLElement>("#arena")!);
const status = document.querySelector<HTMLOutputElement>("#status")!;
const value = (id: string) => document.querySelector<HTMLSelectElement>(`#${id}`)!.value;
let scene: ReturnType<typeof banditTransitionOpening>, battle: Battle, bandit: Entity, knight: Entity;
let replayBuilds = 0, renderedTime = 0, stage = "preparing";
const hits = () => battle.events.filter((e) => e.type === "hit" && e.card === "bandit" && !e.effect);
function setup() {
  scene = banditTransitionOpening(Number(value("rules")) as Replay["version"], value("team") as Team);
  ({ battle, bandit, knight } = scene);
  replayBuilds = 0; stage = "preparing";
  arena.setBattle(battle); renderedTime = battle.time;
}
document.querySelectorAll("select").forEach((s) => s.addEventListener("change", setup));
document.querySelector("#pull")!.addEventListener("click", () => {
  if (stage !== "preparing") return;
  pullPreparingBandit({ ...scene, battle, bandit, knight });
  stage = "cast";
});
document.querySelector("#advance")!.addEventListener("click", () => {
  if (stage !== "cast") return;
  while (battle.tick < scene.releaseTick) battle.step();
  stage = "resolved";
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
  status.textContent = `Bandit · ${stage} · ${hits().length} ordinary hits`;
  status.dataset.state = JSON.stringify({
    tick: battle.tick, version: battle.rulesVersion, runner: value("team"), stage,
    landingTick: scene.landingTick, landingHp: scene.landingHp, hp: bandit.hp, targetHp: knight.hp,
    x: bandit.x, y: bandit.y, targetX: knight.x, targetY: knight.y,
    gap: Math.hypot(bandit.x - knight.x, bandit.y - knight.y), damage: bandit.damage,
    pending: bandit.pendingAttack, recovery: bandit.banditRecovery,
    native: !!bandit.nativeBanditTransitions, hits: hits(), replayBuilds,
    actions: battle.exportReplay().actions, effects: arena.loadedEffects,
    attacks: battle.audioEvents.filter((e) => e.phase === "attack" && e.profile === "bandit").length,
  });
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
