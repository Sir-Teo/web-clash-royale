import { Arena } from "../../src/render/arena";
import { Battle, STEP } from "../../src/game/engine";
import type { Team } from "../../src/game/engine";
import type { CardId } from "../../src/game/cards";
import { CARDS } from "../../src/game/cards";
const arena = new Arena(document.querySelector("#arena")!);
arena.crownTarget = (team) => {
  const target = document
    .querySelector(`#crown-${team}`)!
    .getBoundingClientRect();
  const host = arena.host.getBoundingClientRect();
  return {
    x: target.left + target.width / 2 - host.left,
    y: target.top + target.height / 2 - host.top,
  };
};
let battle: Battle,
  playing = false,
  elapsed = 0,
  renderedTime = 0,
  extraVisualTime = 0,
  last = performance.now();
let victims: { team: Team; x: number; y: number }[] = [];
document.querySelector("#death-card")!.innerHTML = CARDS.filter(
  (c) => c.kind !== "spell",
)
  .map(
    (c) =>
      `<option value="${c.id}" ${c.id === "skeleton-army" ? "selected" : ""}>${c.name}</option>`,
  )
  .join("");
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
  renderedTime = 0;
  extraVisualTime = 0;
  victims = [];
  document.querySelector("#play")!.textContent = "Play";
  battle = new Battle({ seed: 12, ai: false });
  for (const t of battle.entities) t.active = false;
  const scenario = (document.querySelector("#scenario") as HTMLSelectElement)
    .value;
  (document.querySelector("#attackers") as HTMLButtonElement).hidden =
    scenario !== "burrow";
  for (const id of ["death-config", "defeat", "death-stats"])
    (document.querySelector(`#${id}`) as HTMLElement).hidden =
      scenario !== "death";
  (document.querySelector("#death-config") as HTMLElement).hidden =
    scenario !== "death" && scenario !== "deployment";
  (document.querySelector("#spawn") as HTMLElement).hidden =
    scenario !== "deployment";
  for (const id of [
    "wake",
    "princess",
    "king-hits",
    "destroy-king",
    "destroy-both-kings",
    "result-state",
    "rebuild",
    "destruction",
  ])
    (document.querySelector(`#${id}`) as HTMLButtonElement).hidden =
      scenario !== "king";
  if (scenario === "volley") {
    unit("skeleton-army", "red", 4, 12);
    unit("giant", "red", 14, 12);
    unit("archers", "red", 14, 10);
    cast("arrows", "blue", 4, 12);
    cast("fireball", "blue", 14, 12);
  } else if (scenario === "fireball") {
    cast("fireball", "blue", 4, 13);
    cast("fireball", "red", 14, 19);
  } else if (scenario === "deployment") {
    // Spawn through the normal engine after setBattle, so lifecycle events
    // are fresh rather than treated as history by the renderer.
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
  } else if (scenario === "death") {
    const card = (document.querySelector("#death-card") as HTMLSelectElement)
      .value as CardId;
    for (const [team, y] of [
      ["red", 12],
      ["blue", 20],
    ] as [Team, number][])
      for (const x of card === "skeleton-army" ? [4, 14] : [9]) {
        victims.push({ team, x, y });
        for (const e of unit(card, team, x, y)) {
          e.active = false;
          e.hp = 1;
        }
      }
  } else if (scenario === "princess") {
    for (const e of battle.entities) if (!e.king) e.active = true;
    for (const [team, y] of [
      ["blue", 9],
      ["red", 23],
    ] as [Team, number][])
      for (const x of [5, 13])
        for (const e of unit("giant", team, x, y)) {
          e.active = false;
          e.hp = e.maxHp = 10000;
        }
  } else if (scenario === "king") {
    for (const [team, x, y] of [
      ["blue", 12, 7],
      ["red", 6, 25],
    ] as [Team, number, number][])
      for (const e of unit("knight", team, x, y)) {
        e.active = false;
        e.hp = e.maxHp = 10000;
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
document.querySelector("#death-card")!.addEventListener("change", setup);
document.querySelector("#defeat")!.addEventListener("click", () => {
  for (const v of victims)
    cast("zap", v.team === "red" ? "blue" : "red", v.x, v.y);
});
document.querySelector("#spawn")!.addEventListener("click", () => {
  const card = (document.querySelector("#death-card") as HTMLSelectElement)
    .value as CardId;
  cast(card, "blue", 9, 22);
  cast(card, "red", 9, 10);
  for (const e of battle.entities) if (e.kind !== "tower") e.active = false;
});
document.querySelector("#reset")!.addEventListener("click", setup);
document.querySelector("#wake")!.addEventListener("click", () => {
  for (const king of battle.entities.filter((e) => e.king))
    cast("zap", king.team === "blue" ? "red" : "blue", king.x, king.y);
});
document.querySelector("#princess")!.addEventListener("click", () => {
  for (const tower of battle.entities.filter(
    (e) => e.kind === "tower" && !e.king && e.lane === "left",
  )) {
    tower.hp = 1;
    cast("zap", tower.team === "blue" ? "red" : "blue", tower.x, tower.y);
  }
});
document.querySelector("#destroy-king")!.addEventListener("click", () => {
  const king = battle.entities.find((e) => e.king && e.team === "red");
  if (king) {
    king.hp = 1;
    cast("zap", "blue", king.x, king.y);
  }
});
document.querySelector("#destroy-both-kings")!.addEventListener("click", () => {
  for (const king of battle.entities.filter((e) => e.king)) {
    king.hp = 1;
    cast("zap", king.team === "blue" ? "red" : "blue", king.x, king.y);
  }
});
document
  .querySelector("#rebuild")!
  .addEventListener("click", () => arena.setBattle(battle));
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
function advance(ticks: number) {
  for (let i = 0; i < ticks; i++) {
    if (battle.winner) extraVisualTime += STEP;
    else battle.step();
  }
}
document.querySelector("#step")!.addEventListener("click", () => advance(3));
document.querySelector("#second")!.addEventListener("click", () => advance(30));
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
      advance(1);
      elapsed -= STEP;
    }
  }
  arena.render(
    Math.max(0, battle.time - renderedTime) + extraVisualTime,
    battle.time,
  );
  extraVisualTime = 0;
  renderedTime = battle.time;
  document.querySelector("#status")!.textContent =
    `${battle.time.toFixed(1)}s · ${battle.projectiles.length} shots · ${arena.loadedEffects} effects · ${arena.loadedBuildings} buildings loaded · ${arena.nativeTowerPrincesses} native Princesses · ${arena.nativePrincessTowers} layered towers`;
  document.querySelector("#buildings")!.textContent = battle.entities
    .filter((e) => e.burrow)
    .map(
      (e) =>
        `${e.team}: ${e.burrow!.phase} ${Math.round(e.burrow!.exposure * 100)}%`,
    )
    .join(" · ");
  document.querySelector("#particles")!.textContent =
    `${arena.particleCount} particles`;
  document.querySelector("#kings")!.textContent = battle.entities
    .filter((e) => e.king)
    .map(
      (e) =>
        `${e.team}: ${!e.active ? "asleep" : e.activation ? `waking ${e.activation.toFixed(1)}s` : "active"}`,
    )
    .join(" · ");
  document.querySelector("#king-hits")!.textContent =
    `${battle.events.filter((e) => e.type === "hit" && e.card === undefined).length} tower hits`;
  const destruction = arena.destructionState;
  (document.querySelector("#destruction") as HTMLElement).dataset.state =
    JSON.stringify(destruction);
  (document.querySelector("#destruction") as HTMLElement).dataset.impacts =
    String(
      battle.events.filter((e) => e.type === "hit" && e.card === "fireball")
        .length,
    );
  (document.querySelector("#destruction") as HTMLElement).dataset.shake =
    JSON.stringify(arena.shakeState);
  document.querySelector("#destruction")!.textContent =
    `${destruction.rubble} ruins · ${destruction.particles} debris · ${destruction.time.toFixed(1)}s visual`;
  document.querySelector("#result-state")!.textContent = battle.winner
    ? `${battle.winner} · ${battle.reason}`
    : "Battle in progress";
  document.querySelector("#death-stats")!.textContent =
    `${battle.events.filter((e) => e.type === "death" && e.card !== "tower").length} deaths · ${destruction.particles} native particles · ${destruction.ground} ground · ${destruction.draws} draws`;
  for (const team of ["blue", "red"] as const)
    document.querySelector(`#crown-${team}`)!.textContent =
      `♛ ${battle.players[team].crowns}`;
  const flights = document.querySelector<HTMLElement>("#crown-flights")!;
  flights.textContent = `${arena.crownState.length} flying crowns`;
  flights.dataset.poses = JSON.stringify(arena.crownState);
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
