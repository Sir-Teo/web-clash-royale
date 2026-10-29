import { Battle, type Entity, type Team } from "../../src/game/engine";
import { CARD_MAP, type CardId } from "../../src/game/cards";
import { towerDamageForecast } from "../../src/game/king-damage";
import { Arena } from "../../src/render/arena";

const arena = new Arena(document.querySelector<HTMLElement>("#arena")!);
const status = document.querySelector<HTMLOutputElement>("#status")!;
const value = (id: string) =>
  document.querySelector<HTMLSelectElement>(`#${id}`)!.value;
let battle: Battle,
  victim: Entity,
  forecast = 0,
  replayBuilds = 0,
  renderedTime = 0;
const freeze = () => {
  for (const e of battle.entities) e.active = false;
};
const target = () =>
  battle.entities.find(
    (e) => e.team !== value("team") && !!e.king === (value("tower") === "king"),
  )!;
function setup() {
  const card = value("card") as CardId,
    team = value("team") as Team;
  const deck: CardId[] = [
    "fireball",
    "arrows",
    "rocket",
    "lightning",
    "log",
    "poison",
    "archers",
    "zap",
  ];
  let seed = 1;
  do {
    battle = new Battle({ seed: seed++, ai: false, deck, enemyDeck: deck });
  } while (!battle.players[team].hand.includes(card));
  battle = new Battle({
    replay: {
      ...battle.exportReplay(),
      version: Number(value("rules")) as 43 | 44 | 45 | 46,
    },
  });
  freeze();
  for (let n = 0; n < 120; n++) battle.step();
  victim = target();
  forecast = 0;
  replayBuilds = 0;
  renderedTime = battle.time;
  arena.setBattle(battle);
}
document
  .querySelectorAll("select")
  .forEach((s) => s.addEventListener("change", setup));
document.querySelector("#cast")!.addEventListener("click", () => {
  const card = value("card") as CardId,
    team = value("team") as Team;
  const point = {
    x: victim.x,
    y: card === "log" ? (team === "blue" ? 17.5 : 14.5) : victim.y,
  };
  forecast = towerDamageForecast(
    victim,
    battle.projectiles,
    battle.areas,
    battle.entities,
  )
    .withSpell(card, team, point)
    .reduce((sum, p) => sum + p.damage, 0);
  const result = battle.play(
    team,
    battle.players[team].hand.indexOf(card),
    point.x,
    point.y,
  );
  if (!result.ok) throw new Error(result.reason);
});
document.querySelector("#advance")!.addEventListener("click", () => {
  for (let n = 0; n < 180; n++) battle.step();
});
document.querySelector("#advance3")!.addEventListener("click", () => {
  for (let n = 0; n < 90; n++) battle.step();
});
document.querySelector("#replay")!.addEventListener("click", () => {
  const tick = battle.tick;
  battle = new Battle({ replay: battle.exportReplay() });
  freeze();
  while (battle.tick < tick) battle.step();
  victim = target();
  replayBuilds++;
  arena.setBattle(battle);
  renderedTime = battle.time;
});
setup();
function render() {
  arena.render(Math.max(0, battle.time - renderedTime), battle.time);
  renderedTime = battle.time;
  status.textContent = `${CARD_MAP[value("card") as CardId].name} · ${victim.maxHp - victim.hp} damage · ${victim.hp} HP`;
  status.dataset.state = JSON.stringify({
    tick: battle.tick,
    version: battle.rulesVersion,
    buffNative: !!victim.nativeBuffCrownDamage,
    hp: victim.hp,
    maxHp: victim.maxHp,
    forecast,
    damage: victim.maxHp - victim.hp,
    native: !!victim.nativeProjectileCrownDamage,
    areaNative: !!victim.nativeAreaCrownDamage,
    replayBuilds,
    effects: arena.loadedEffects,
    shots: battle.projectiles.length,
    areas: battle.areas.length,
    actions: battle.exportReplay().actions,
  });
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
