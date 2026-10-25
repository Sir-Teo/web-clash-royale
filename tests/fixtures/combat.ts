import { defensiveThreats } from "../../src/game/defensive-threats";
import { Arena } from "../../src/render/arena";
import { Battle, STEP } from "../../src/game/engine";
import type { Entity, Team } from "../../src/game/engine";
import type { CardId } from "../../src/game/cards";
import { CARDS, STARTER_DECK } from "../../src/game/cards";
const sceneSelect = document.querySelector<HTMLSelectElement>("#scenario")!;
const initialScene = new URL(location.href).searchParams.get("scene");
if (
  initialScene &&
  Array.from(sceneSelect.options).some(
    (option) => option.value === initialScene,
  )
)
  sceneSelect.value = initialScene;
const arena = new Arena(document.querySelector("#arena")!);
const unitPlanes = (id: number) => {
  const visual = (arena as any).units.get(id);
  if (!visual) return null;
  return {
    height: visual.object.position.y,
    shadowHeight: visual.shadow ? visual.object.position.y + visual.shadow.position.y : null,
    ringHeight: visual.ring ? visual.object.position.y + visual.ring.position.y : null,
  };
};
let chargeCues = 0;
arena.onCharge = () => chargeCues++;
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
  chargeCues = 0;
  playing = false;
  elapsed = 0;
  renderedTime = 0;
  extraVisualTime = 0;
  victims = [];
  document.querySelector("#play")!.textContent = "Play";
  const selectedScene = (
    document.querySelector("#scenario") as HTMLSelectElement
  ).value;
  battle = new Battle(selectedScene === "rage" ? {
    replay: { rulesFamily: "local", version: 5, seed: 12, mode: "classic",
      deck: STARTER_DECK, enemyDeck: STARTER_DECK, actions: [], duration: 0 },
  } : { seed: selectedScene === "ai-lightning-combo" ? 8 : selectedScene === "ai-lightning-followup" ? 1 : selectedScene === "ai-spells-mirror" ? 2 : 12, ai: selectedScene.startsWith("ai-") });
  if (selectedScene === "rage")
    Object.assign(battle, { replayActions: null, replayDuration: undefined });
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
  (document.querySelector("#attack-config") as HTMLElement).hidden =
    scenario !== "attack-impacts";
  (document.querySelector("#break-shield") as HTMLElement).hidden =
    scenario !== "dark-prince" && scenario !== "guards";
  (document.querySelector("#kill-night-witch") as HTMLElement).hidden =
    scenario !== "night-witch";
  (document.querySelector("#kill-tombstone") as HTMLElement).hidden =
    scenario !== "tombstone";
  (document.querySelector("#kill-golem") as HTMLElement).hidden =
    scenario !== "golem";
  (document.querySelector("#kill-ice-golem") as HTMLElement).hidden =
    scenario !== "ice-golem";
  (document.querySelector("#kill-giant-skeleton") as HTMLElement).hidden =
    scenario !== "giant-skeleton";
  (document.querySelector("#kill-lava-hound") as HTMLElement).hidden =
    scenario !== "lava-hound";
  (document.querySelector("#spawn") as HTMLElement).hidden =
    scenario !== "deployment";
  (document.querySelector("#freeze-cast") as HTMLElement).hidden =
    scenario !== "freeze";
  for (const id of ["rage-cast", "rage-towers"])
    (document.querySelector(`#${id}`) as HTMLElement).hidden =
      !["rage", "rage-troops"].includes(scenario);
  (document.querySelector("#poison-cast") as HTMLElement).hidden =
    scenario !== "poison";
  (document.querySelector("#tornado-cast") as HTMLElement).hidden =
    scenario !== "tornado";
  (document.querySelector("#poison-towers") as HTMLElement).hidden =
    scenario !== "poison";
  (document.querySelector("#freeze-towers") as HTMLElement).hidden =
    scenario !== "freeze";
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
      scenario !== "king" &&
      !(scenario === "rocket" && ["rebuild", "destruction"].includes(id));
  if (scenario === "volley") {
    unit("skeleton-army", "red", 4, 12);
    unit("giant", "red", 14, 12);
    unit("archers", "red", 14, 10);
    cast("arrows", "blue", 4, 12);
    cast("fireball", "blue", 14, 12);
  } else if (["ai-freeze-king", "ai-freeze-race", "ai-freeze-ranged", "ai-freeze-ranged-fast"].includes(scenario)) {
    const ranged = scenario.startsWith("ai-freeze-ranged");
    const fast = scenario.endsWith("-fast");
    const king = battle.entities.find((e) => e.team === "red" && e.king)!;
    Object.assign(king, { hp: 100, active: true, cooldown: 3 });
    for (const [i, id] of (["giant", "witch"] as const).entries())
      for (const e of unit(id, "red", 4 + i, 20)) {
        e.active = false;
        e.speed = 0;
      }
    for (const e of unit(ranged ? "musketeer" : "lumberjack", "blue", king.x, king.y + (ranged ? 5.5 : 2)))
      Object.assign(e, { hp: 200, deploy: 2.3 });
    const race = scenario === "ai-freeze-race" || ranged;
    if (race) battle.entities.find((e) => e.team === "blue" && e.king)!.hp = 50;
    battle.players.red.hand = fast ? ["zap", "freeze", "pekka", "pekka"]
      : race ? ["rocket", "freeze", "pekka", "pekka"]
      : ["freeze", "clone", "pekka", "pekka"];
    battle.players.red.queue = ["pekka", "pekka", "pekka", "pekka"];
    battle.players.red.elixir = fast ? 4 : race ? 6 : 4;
  } else if (["ai-rage", "ai-freeze", "ai-poison", "ai-heal", "ai-clone"].includes(scenario)) {
    const card = scenario.slice(3) as "rage" | "freeze" | "poison" | "heal" | "clone";
    if (card === "rage") {
      for (const e of unit("giant", "red", 4, 20)) {
        e.active = false;
        e.speed = 0;
      }
    } else if (card === "freeze") {
      for (const e of unit("balloon", "red", 4, 23)) {
        e.active = false;
        e.speed = 0;
      }
      for (const e of unit("wizard", "blue", 4, 22)) {
        e.active = false;
        e.speed = 0;
      }
    } else if (card === "heal" || card === "clone") {
      for (const [i, id] of (card === "heal"
        ? ["musketeer", "musketeer"] as const
        : ["giant", "witch"] as const).entries())
        for (const e of unit(id, "red", 4 + i, 20)) {
          e.active = false;
          e.speed = 0;
          e.deploy = 3;
          if (card === "heal") e.hp = e.maxHp * 0.2;
        }
    } else {
      for (const id of ["wizard", "witch"] as const)
        for (const e of unit(id, "blue", id === "wizard" ? 4 : 5, 23)) {
          e.active = false;
          e.speed = 0;
        }
    }
    battle.players.red.hand = [card, "pekka", "pekka", "pekka"];
    battle.players.red.queue[0] = card;
    battle.players.red.elixir = card === "rage" ? 2
      : card === "heal" || card === "clone" ? 3 : 10;
  } else if (scenario.startsWith("ai-defense-balloon")) {
    unit("balloon", "blue", 14, 14.2);
    if (scenario.endsWith("blocked"))
      for (const e of unit("tesla", "red", 9, 10)) {
        e.active = false;
        e.burrow = { exposure: 0, idle: 0, phase: "hidden" };
      }
    battle.players.red.hand = ["cannon", "giant", "hog-rider", "prince"];
    battle.players.red.queue = ["pekka", "pekka", "pekka", "pekka"];
    battle.players.red.elixir = 3;
    // The fixture's red Tesla setup is not an AI decision.
    battle.actions = battle.actions.filter((a) => a.team !== "red");
  } else if (scenario.startsWith("ai-defense-moving-")) {
    unit("hog-rider", "blue", scenario.endsWith("left") ? 4 : 14, 17.1);
    battle.players.red.hand = [
      "mini-pekka",
      "giant",
      "pekka",
      "three-musketeers",
    ];
    battle.players.red.queue = ["prince", "wizard", "witch", "balloon"];
    battle.players.red.elixir = 4;
  } else if (scenario.startsWith("ai-defense-")) {
    if (
      scenario === "ai-defense-ground-swarm" ||
      scenario === "ai-defense-air-swarm" ||
      scenario.startsWith("ai-defense-fallback-")
    ) {
      const card =
        scenario === "ai-defense-ground-swarm"
          ? "skeleton-army"
          : "minion-horde";
      for (const e of unit(card, "blue", 4, 8)) e.active = false;
      for (const e of unit("hog-rider", "blue", 14, 8)) e.active = false;
    } else if (scenario === "ai-defense-lane") {
      for (const e of unit("skeletons", "blue", 4, 1)) {
        e.hp = 1;
        e.active = false;
      }
      for (const e of unit("hog-rider", "blue", 14, 8)) e.active = false;
      battle.entities.find((e) => e.team === "red" && e.lane === "right")!.hp =
        100;
    } else {
      for (const e of unit("knight", "blue", 9, 3)) e.active = false;
    }
    battle.players.red.hand =
      scenario === "ai-defense-ground-swarm"
        ? ["mini-pekka", "valkyrie", "giant", "hog-rider"]
        : scenario === "ai-defense-air-swarm"
          ? ["mini-pekka", "baby-dragon", "musketeer", "giant"]
          : ["mini-pekka", "knight", "giant", "hog-rider"];
    battle.players.red.elixir = 4;
    if (scenario.startsWith("ai-defense-fallback-")) {
      battle.players.red.hand = scenario.endsWith("unaffordable")
        ? ["knight", "musketeer", "giant", "hog-rider"]
        : ["knight", "mini-pekka", "giant", "hog-rider"];
      battle.players.red.queue = ["pekka", "pekka", "pekka", "pekka"];
      battle.players.red.elixir = 3;
    }
  } else if (scenario === "ai-lightning-combo") {
    const king = battle.entities.find((e) => e.team === "blue" && e.king)!;
    king.hp = 80;
    for (const card of ["wizard", "witch", "musketeer"] as CardId[])
      for (const e of unit(card, "blue", king.x, king.y))
        Object.assign(e, { hp: 100, active: false, speed: 0 });
    battle.players.red.hand = ["lightning", "pekka", "pekka", "pekka"];
    battle.players.red.queue = ["zap", "pekka", "pekka", "pekka"];
    battle.players.red.elixir = 10;
  } else if (scenario === "ai-lightning-health") {
    const king = battle.entities.find((e) => e.team === "blue" && e.king)!;
    king.hp = 400;
    for (let i = 0; i < 3; i++)
      for (const e of unit("giant", "blue", king.x, king.y))
        Object.assign(e, { hp: 600, active: false, speed: 0 });
    cast("fireball", "red", king.x, king.y);
    battle.players.red.hand = ["lightning", "pekka", "pekka", "pekka"];
    battle.players.red.elixir = 6;
  } else if (scenario === "ai-lightning-followup") {
    battle.entities.find((e) => e.team === "blue" && !e.king)!.hp = 100;
    for (const [card, x, y] of [["witch", 3, 25], ["wizard", 5, 25]] as [CardId, number, number][])
      for (const e of unit(card, "blue", x, y)) Object.assign(e, { active: false, speed: 0 });
    battle.players.red.hand = ["lightning", "pekka", "pekka", "pekka"];
    battle.players.red.queue = ["fireball", "pekka", "pekka", "pekka"];
    battle.players.red.elixir = 10;
  } else if (scenario === "ai-lightning" || scenario === "ai-lightning-king") {
    if (scenario === "ai-lightning") {
      for (const [card, x, y] of [["wizard", 4, 9], ["witch", 6, 9], ["musketeer", 5, 11]] as [CardId, number, number][])
        for (const e of unit(card, "blue", x, y)) Object.assign(e, { active: false, speed: 0 });
    } else {
      battle.entities.find((e) => e.team === "blue" && e.king)!.hp = 400;
      battle.entities.find((e) => e.team === "red" && e.king)!.hp = 100;
    }
    battle.players.red.hand = scenario === "ai-lightning" ? ["lightning", "pekka", "pekka", "pekka"] : ["mirror", "lightning", "pekka", "pekka"];
    battle.players.red.lastPlayed = "lightning";
    battle.players.red.elixir = scenario === "ai-lightning" ? 6 : 7;
  } else if (scenario === "ai-regulation" || scenario === "ai-regulation-tie") {
    battle.tick = 5295;
    battle.entities.find((e) => e.team === "red" && e.king)!.hp = 100;
    battle.entities.find((e) => e.team === "blue" && e.king)!.hp = 300;
    battle.entities.find((e) => e.team === "blue" && !e.king)!.hp = 50;
    if (scenario === "ai-regulation-tie") {
      const removed = battle.entities.find((e) => e.team === "red" && !e.king)!;
      battle.entities = battle.entities.filter((e) => e.id !== removed.id);
      battle.players.blue.crowns = 1;
    }
    battle.players.red.hand = ["rocket", "zap", "pekka", "pekka"];
    battle.players.red.elixir = 6;
  } else if (
    scenario === "ai-overtime" ||
    scenario === "ai-tiebreaker" ||
    scenario === "ai-overtime-reserved"
  ) {
    const king = battle.entities.find((e) => e.team === "red" && e.king)!;
    const enemyKing = battle.entities.find((e) => e.team === "blue" && e.king)!;
    const princess = battle.entities.find((e) => e.team === "blue" && !e.king)!;
    if (scenario !== "ai-tiebreaker") {
      const reserved = scenario === "ai-overtime-reserved";
      battle.tick = 6000;
      king.hp = 100;
      enemyKing.hp = reserved ? 50 : 300;
      princess.hp = 50;
      const target = reserved ? princess : king;
      cast("rocket", reserved ? "red" : "blue", target.x, target.y);
      const incoming = battle.projectiles.at(-1)!;
      incoming.remaining = reserved ? 2.6 : 3;
      incoming.elapsed = incoming.duration - incoming.remaining;
      incoming.flight = {
        x:
          incoming.x +
          ((incoming.tx - incoming.x) * incoming.elapsed) / incoming.duration,
        y:
          incoming.y +
          ((incoming.ty - incoming.y) * incoming.elapsed) / incoming.duration,
      };
      battle.players.red.hand = reserved
        ? ["zap", "pekka", "pekka", "pekka"]
        : ["rocket", "zap", "pekka", "pekka"];
      battle.players.red.elixir = reserved ? 2 : 6;
    } else {
      battle.tick = 8919;
      king.hp = 80;
      princess.hp = 100;
      battle.players.red.hand = ["zap", "pekka", "pekka", "pekka"];
      battle.players.red.elixir = 2;
    }
  } else if (scenario === "ai-launched-poison" || scenario === "ai-launched-zap") {
    const king = battle.entities.find((e) => e.team === "red" && e.king)!;
    const enemyKing = battle.entities.find((e) => e.team === "blue" && e.king)!;
    king.hp = 100;
    enemyKing.hp = scenario === "ai-launched-poison" ? 40 : 50;
    cast("rocket", "blue", king.x, king.y);
    const incoming = battle.projectiles.at(-1)!;
    // Start with a physically consistent shot already partway along its path.
    const remaining = scenario === "ai-launched-poison" ? 4 : 2.8;
    incoming.elapsed = incoming.duration - remaining;
    incoming.remaining = remaining;
    incoming.flight = {
      x: incoming.x + (incoming.tx - incoming.x) * incoming.elapsed / incoming.duration,
      y: incoming.y + (incoming.ty - incoming.y) * incoming.elapsed / incoming.duration,
    };
    if (scenario === "ai-launched-zap") cast("rocket", "red", enemyKing.x, enemyKing.y);
    battle.players.red.hand = scenario === "ai-launched-poison"
      ? ["arrows", "poison", "pekka", "pekka"] : ["zap", "arrows", "pekka", "pekka"];
    battle.players.red.elixir = scenario === "ai-launched-poison" ? 4 : 3;
  } else if (scenario === "ai-spells" || scenario === "ai-spells-mirror") {
    // Let the ordinary AI timer choose its cast; no private think call here.
    const tower = battle.entities.find((e) => e.team === "blue" && !e.king)!;
    tower.hp = 100;
    const mirrored = scenario === "ai-spells-mirror";
    battle.players.red.hand = mirrored
      ? ["mirror", "fireball", "pekka", "pekka"]
      : ["rocket", "fireball", "pekka", "giant"];
    battle.players.red.elixir = mirrored ? 5 : 10;
    if (mirrored) battle.players.red.lastPlayed = "fireball";
  } else if (scenario === "rocket") {
    cast("rocket", "blue", 4, 10);
    cast("rocket", "red", 14, 22);
  } else if (scenario === "fireball") {
    cast("fireball", "blue", 4, 13);
    cast("fireball", "red", 14, 19);
  } else if (scenario === "rocket-trail") {
    cast("rocket", "blue", 4, 13);
  } else if (scenario === "lightning") {
    for (const card of ["giant", "knight", "minions"] as CardId[])
      for (const entity of unit(card, "red", 4, 12)) entity.active = false;
    cast("lightning", "blue", 4, 12);
  } else if (scenario === "log") {
    for (const entity of unit("giant", "red", 4, 13)) {
      entity.active = false;
      entity.hp = entity.maxHp = 10000;
    }
    cast("log", "blue", 4, 22);
  } else if (scenario === "tornado") {
    for (const card of ["giant", "minions"] as CardId[])
      for (const entity of unit(card, "red", 7, 11)) {
        entity.active = false;
        entity.hp = entity.maxHp = 10000;
      }
  } else if (scenario === "goblin-barrel") {
    cast("goblin-barrel", "blue", 4, 9);
  } else if (scenario === "graveyard") {
    for (const tower of battle.entities) tower.hp = tower.maxHp = 100000;
    cast("graveyard", "blue", 5, 13);
    cast("graveyard", "red", 13, 19);
  } else if (scenario === "clone") {
    for (const card of ["knight", "minions"] as CardId[])
      for (const entity of unit(card, "blue", card === "knight" ? 4 : 6, 22))
        entity.active = false;
    for (const entity of unit("knight", "red", 8, 22)) entity.active = false;
    unit("cannon", "blue", 5, 22);
    cast("clone", "blue", 5, 22);
  } else if (scenario === "spell-impacts") {
    cast("zap", "blue", 4, 13);
    cast("arrows", "red", 14, 19);
  } else if (scenario === "miner") {
    cast("miner", "blue", 4, 8);
  } else if (scenario === "bowler") {
    const attacker = unit("bowler", "blue", 4, 21)[0];
    attacker.speed = 0;
    for (const [card, y] of [["knight", 18], ["knight", 16], ["minions", 17]] as [CardId, number][]) {
      for (const target of unit(card, "red", 4, y)) {
        target.active = false;
        target.speed = 0;
        target.damage = 0;
        target.hp = target.maxHp = 10000;
      }
    }
  } else if (scenario === "dark-prince") {
    const attacker = unit("dark-prince", "blue", 4, 21)[0];
    attacker.speed = 0;
    attacker.move = 2.6;
    for (const [card, x, y] of [
      ["knight", 4, 19.9], ["knight", 4.85, 19.9], ["minions", 5, 19.8],
    ] as [CardId, number, number][]) {
      for (const target of unit(card, "red", x, y)) {
        target.active = false;
        target.speed = 0;
        target.damage = 0;
        target.hp = target.maxHp = 10000;
      }
    }
  } else if (scenario === "guards") {
    for (const guard of unit("guards", "blue", 9, 21)) {
      guard.active = false;
      guard.speed = guard.damage = 0;
    }
  } else if (scenario === "battle-ram") {
    const attacker = unit("battle-ram", "blue", 4, 23)[0];
    attacker.cooldown = 0;
    for (const target of unit("knight", "red", 4, 20)) {
      target.active = false;
      target.speed = target.damage = 0;
      target.hp = target.maxHp = 10000;
    }
    for (const target of unit("cannon", "red", 4, 17.5)) {
      target.active = false;
      target.damage = 0;
      target.hp = target.maxHp = 10000;
      target.lifetime = undefined;
    }
  } else if (scenario === "ice-wizard") {
    const attacker = unit("ice-wizard", "blue", 4, 21)[0];
    attacker.speed = attacker.cooldown = 0;
    const target = unit("knight", "red", 4, 18.5)[0];
    target.active = false;
    target.speed = target.damage = 0;
    target.hp = target.maxHp = 10000;
  } else if (scenario === "executioner") {
    const attacker = unit("executioner", "blue", 4, 21)[0];
    attacker.speed = attacker.cooldown = 0;
    for (const [card, y] of [["knight", 18], ["minions", 16.5]] as [CardId, number][]) {
      for (const [index, target] of unit(card, "red", 4, y).entries()) {
        target.x = index ? 14 : 4;
        target.y = y;
        target.active = false;
        target.speed = target.damage = 0;
        target.hp = target.maxHp = 10000;
      }
    }
  } else if (scenario === "sparky") {
    const attacker = unit("sparky", "blue", 4, 21)[0];
    attacker.speed = 0;
    attacker.cooldown = 4.5;
    for (const [card, x] of [["knight", 4], ["knight", 4.8], ["minions", 4.5]] as [CardId, number][]) {
      for (const [index, target] of unit(card, "red", x, 18).entries()) {
        target.x = index ? 14 : x;
        target.active = false;
        target.speed = target.damage = 0;
        target.hp = target.maxHp = 10000;
      }
    }
  } else if (scenario === "lumberjack") {
    const attacker = unit("lumberjack", "blue", 4, 21)[0];
    attacker.hp = 1;
    attacker.active = false;
    attacker.speed = 0;
    for (const [card, team, x] of [
      ["knight", "blue", 5],
      ["minions", "blue", 6],
      ["knight", "red", 9],
    ] as [CardId, Team, number][]) {
      for (const target of unit(card, team, x, 21)) {
        target.active = false;
        target.speed = target.damage = 0;
        target.hp = target.maxHp = 10000;
      }
    }
    cast("fireball", "red", 4, 21);
  } else if (scenario === "bats") {
    for (const bat of unit("bats", "blue", 4, 21)) {
      bat.speed = 0;
      bat.cooldown = 0;
    }
    for (const [index, target] of unit("minions", "red", 4, 19).entries()) {
      target.x = index ? 14 : 4;
      target.active = false;
      target.speed = target.damage = 0;
      target.hp = target.maxHp = 10000;
    }
  } else if (scenario === "night-witch") {
    const witch = unit("night-witch", "blue", 4, 21)[0];
    witch.speed = 0;
    for (const target of unit("knight", "red", 4, 17.5)) {
      target.active = false;
      target.speed = target.damage = 0;
      target.hp = target.maxHp = 10000;
    }
  } else if (scenario === "bandit") {
    unit("bandit", "blue", 4, 21);
    for (const target of unit("knight", "red", 4, 16)) {
      target.active = false;
      target.speed = target.damage = 0;
      target.hp = target.maxHp = 10000;
    }
  } else if (scenario === "golem") {
    const golem = unit("golem", "blue", 4, 21)[0];
    golem.speed = 0;
    golem.age = 3;
    for (const [card, x] of [["knight", 4], ["minions", 4.5]] as [CardId, number][]) {
      for (const target of unit(card, "red", x, 20)) {
        target.active = false;
        target.speed = target.damage = 0;
        target.hp = target.maxHp = 10000;
      }
    }
  } else if (scenario === "ice-golem") {
    const golem = unit("ice-golem", "blue", 9, 21)[0];
    golem.speed = 0;
    golem.active = false;
    for (const [card, x] of [["knight", 9], ["minions", 9.7]] as [CardId, number][]) {
      for (const target of unit(card, "red", x, 20)) {
        target.active = false;
        target.speed = target.damage = 0;
        target.hp = target.maxHp = 10000;
      }
    }
  } else if (scenario === "giant-skeleton") {
    const skeleton = unit("giant-skeleton", "blue", 9, 21)[0];
    skeleton.speed = 0;
    skeleton.active = false;
    for (const [card, x] of [["knight", 9], ["minions", 9.7]] as [CardId, number][]) {
      for (const target of unit(card, "red", x, 20)) {
        target.active = false;
        target.speed = target.damage = 0;
        target.hp = target.maxHp = 10000;
      }
    }
  } else if (scenario === "lava-hound") {
    const hound = unit("lava-hound", "blue", 4, 12)[0];
    hound.speed = 0;
    for (const target of unit("cannon", "red", 4, 9.5)) {
      target.active = false;
      target.damage = 0;
      target.hp = target.maxHp = 10000;
      target.lifetime = undefined;
    }
    for (const target of unit("minions", "red", 7, 12.5)) {
      target.active = false;
      target.speed = target.damage = 0;
      target.hp = target.maxHp = 10000;
    }
  } else if (scenario === "attack-impacts") {
    const attacker = (
      document.querySelector("#attack-card") as HTMLSelectElement
    ).value as CardId;
    unit(attacker, "blue", 9, 21);
    const points = attacker === "electro-wizard" ? [8, 10] : [9];
    for (const x of points)
      for (const target of unit(
        attacker === "balloon" || attacker === "giant" ? "cannon" : "giant",
        "red",
        x,
        18,
      )) {
        target.active = false;
        target.hp = target.maxHp = 10000;
      }
    if (attacker === "ice-spirit" || attacker === "fire-spirits")
      for (const target of unit("minions", "red", 9.8, 18)) {
        target.active = false;
        target.speed = target.damage = 0;
        target.hp = target.maxHp = 10000;
      }
  } else if (scenario === "elixir-collector") {
    unit("elixir-collector", "blue", 9, 22);
  } else if (scenario === "goblin-hut") {
    unit("goblin-hut", "blue", 9, 22);
  } else if (scenario === "tombstone") {
    unit("tombstone", "blue", 9, 22);
  } else if (scenario === "furnace") {
    unit("furnace", "blue", 9, 22);
  } else if (scenario === "barbarian-hut") {
    unit("barbarian-hut", "blue", 9, 22);
  } else if (scenario === "footsteps") {
    for (const [card, x] of [
      ["knight", 4],
      ["prince", 14],
    ] as [CardId, number][]) {
      unit(card, "blue", x, 23);
      for (const target of unit("giant", "red", x, 10)) {
        target.active = false;
        target.hp = target.maxHp = 10000;
      }
    }
  } else if (scenario === "hog-jump") {
    unit("hog-rider", "blue", 4, 23);
    unit("hog-rider", "red", 14, 9);
    for (const [team, x, y] of [
      ["red", 4, 11],
      ["blue", 14, 21],
    ] as [Team, number, number][]) {
      for (const target of unit("cannon", team, x, y)) {
        target.active = false;
        target.hp = target.maxHp = 10000;
      }
    }
  } else if (scenario === "deployment") {
    // Spawn through the normal engine after setBattle, so lifecycle events
    // are fresh rather than treated as history by the renderer.
  } else if (scenario === "freeze") {
    for (const [team, y] of [
      ["red", 12],
      ["blue", 20],
    ] as [Team, number][]) {
      for (const entity of unit("knight", team, 9, y)) entity.active = false;
      for (const entity of unit("tesla", team, 11.2, y)) entity.active = false;
    }
  } else if (scenario === "poison" || scenario === "rage") {
    for (const [team, y] of [
      ["red", 12],
      ["blue", 20],
    ] as [Team, number][]) {
      for (const entity of unit("knight", team, 9, y)) entity.active = false;
      for (const entity of unit("tesla", team, 11.2, y)) {
        entity.active = false;
        entity.lifetime = undefined;
        if (entity.burrow) {
          entity.burrow.phase = "exposed";
          entity.burrow.exposure = 1;
        }
      }
    }
  } else if (scenario === "rage-troops") {
    for (const [team, y] of [
      ["blue", 20],
      ["red", 12],
    ] as [Team, number][]) {
      for (const entity of unit("knight", team, 9, y)) entity.active = false;
      for (const entity of unit("witch", team, 11, y)) entity.active = false;
    }
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
document.querySelector("#break-shield")!.addEventListener("click", () =>
  cast("fireball", "red",
    (document.querySelector("#scenario") as HTMLSelectElement).value === "guards" ? 9 : 4,
    21));
document.querySelector("#death-card")!.addEventListener("change", setup);
document.querySelector("#attack-card")!.addEventListener("change", setup);
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
document.querySelector("#freeze-cast")!.addEventListener("click", () => {
  cast("freeze", "blue", 9, 12);
  cast("freeze", "red", 9, 20);
});
document.querySelector("#rage-cast")!.addEventListener("click", () => {
  cast("rage", "blue", 9, 20);
  cast("rage", "red", 9, 12);
});
document.querySelector("#rage-towers")!.addEventListener("click", () => {
  for (const tower of battle.entities.filter(
    (e) => e.kind === "tower" && !e.king && e.lane === "left",
  ))
    cast("rage", tower.team, tower.x, tower.y);
});
document.querySelector("#poison-cast")!.addEventListener("click", () => {
  cast("poison", "blue", 9, 12);
  cast("poison", "red", 9, 20);
});
document.querySelector("#tornado-cast")!.addEventListener("click", () => {
  cast("tornado", "blue", 9, 14);
});
document.querySelector("#poison-towers")!.addEventListener("click", () => {
  for (const tower of battle.entities.filter(
    (entity) =>
      entity.kind === "tower" && !entity.king && entity.lane === "left",
  ))
    cast("poison", tower.team === "blue" ? "red" : "blue", tower.x, tower.y);
});
document.querySelector("#freeze-towers")!.addEventListener("click", () => {
  for (const tower of battle.entities.filter(
    (entity) =>
      entity.kind === "tower" && !entity.king && entity.lane === "left",
  ))
    cast("freeze", tower.team === "blue" ? "red" : "blue", tower.x, tower.y);
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
document.querySelector("#kill-tombstone")!.addEventListener("click", () => {
  const stone = battle.entities.find((e) => e.team === "blue" && e.card === "tombstone" && e.hp > 0);
  if (!stone) return;
  (battle as unknown as { hurt: (entity: Entity, amount: number) => void })
    .hurt(stone, stone.hp);
});
document.querySelector("#kill-night-witch")!.addEventListener("click", () => {
  const witch = battle.entities.find((e) => e.team === "blue" && e.card === "night-witch" && e.hp > 0);
  if (!witch) return;
  witch.hp = 1;
  cast("fireball", "red", witch.x, witch.y);
});
document.querySelector("#kill-golem")!.addEventListener("click", () => {
  const golem = battle.entities.find((e) => e.team === "blue" && e.card === "golem" && e.hp > 0);
  if (!golem) return;
  golem.hp = 1;
  cast("fireball", "red", golem.x, golem.y);
});
document.querySelector("#kill-ice-golem")!.addEventListener("click", () => {
  const golem = battle.entities.find((e) => e.team === "blue" && e.card === "ice-golem" && e.hp > 0);
  if (!golem) return;
  golem.hp = 1;
  (battle as unknown as { hurt: (entity: typeof golem, amount: number) => void })
    .hurt(golem, 1);
});
document.querySelector("#kill-giant-skeleton")!.addEventListener("click", () => {
  const skeleton = battle.entities.find((e) => e.team === "blue" && e.card === "giant-skeleton" && e.hp > 0);
  if (!skeleton) return;
  skeleton.hp = 1;
  (battle as unknown as { hurt: (entity: typeof skeleton, amount: number) => void })
    .hurt(skeleton, 1);
});
document.querySelector("#kill-lava-hound")!.addEventListener("click", () => {
  const hound = battle.entities.find((e) => e.team === "blue" && e.card === "lava-hound" && e.hp > 0);
  if (!hound) return;
  hound.hp = 1;
  cast("fireball", "red", hound.x, hound.y);
});
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
  (document.querySelector("#destruction") as HTMLElement).dataset.impactSprites =
    JSON.stringify(arena.impactSpriteState);
  (document.querySelector("#destruction") as HTMLElement).dataset.infernoBeams =
    JSON.stringify(arena.infernoBeamState);
  const collector = battle.entities.find((entity) => entity.card === "elixir-collector");
  (document.querySelector("#destruction") as HTMLElement).dataset.collector =
    JSON.stringify({
      elixir: battle.players.blue.elixir,
      frame: collector ? (arena as any).units.get(collector.id)?.building?.frame : null,
      timer: collector?.spawnTimer ?? null,
      collections: battle.audioEvents.filter((event) => event.phase === "collect").length,
    });
  const hut = battle.entities.find((entity) => entity.card === "goblin-hut");
  (document.querySelector("#destruction") as HTMLElement).dataset.goblinHut =
    JSON.stringify({
      frame: hut ? (arena as any).units.get(hut.id)?.building?.frame : null,
      timer: hut?.spawnTimer ?? null,
      spears: battle.entities.filter((entity) =>
        entity.card === "spear-goblins" && entity.team === "blue" && entity.hp > 0
      ).length,
    });
  const stone = battle.entities.find((entity) => entity.card === "tombstone" && entity.hp > 0);
  (document.querySelector("#destruction") as HTMLElement).dataset.tombstone =
    JSON.stringify({
      frame: stone ? (arena as any).units.get(stone.id)?.building?.frame : null,
      timer: stone?.spawnTimer ?? null,
      skeletons: battle.entities.filter((entity) =>
        entity.card === "skeletons" && entity.team === "blue" && entity.hp > 0
      ).length,
      deaths: battle.events.filter((event) =>
        event.type === "death" && event.card === "tombstone"
      ).length,
    });
  const furnace = battle.entities.find((entity) => entity.card === "furnace" && entity.hp > 0);
  (document.querySelector("#destruction") as HTMLElement).dataset.furnace =
    JSON.stringify({
      frame: furnace ? (arena as any).units.get(furnace.id)?.building?.frame : null,
      timer: furnace?.spawnTimer ?? null,
      burst: furnace?.spawnBurst ?? null,
      spirits: battle.entities.filter((entity) =>
        entity.card === "fire-spirits" && entity.team === "blue" && entity.hp > 0
      ).length,
    });
  const barbarianHut = battle.entities.find((entity) =>
    entity.card === "barbarian-hut" && entity.hp > 0
  );
  (document.querySelector("#destruction") as HTMLElement).dataset.barbarianHut =
    JSON.stringify({
      frame: barbarianHut ? (arena as any).units.get(barbarianHut.id)?.building?.frame : null,
      timer: barbarianHut?.spawnTimer ?? null,
      burst: barbarianHut?.spawnBurst ?? null,
      barbarians: battle.entities.filter((entity) =>
        entity.card === "barbarians" && entity.team === "blue" && entity.hp > 0
      ).length,
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.miner =
    JSON.stringify({
      trails: arena.minerTrailState,
      traveling: battle.projectiles.filter((p) => p.style === "miner-travel").length,
      units: battle.entities.filter((e) => e.card === "miner" && e.hp > 0).length,
      arrivals: battle.events.filter((e) => e.type === "deploy" && e.card === "miner").length,
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.bowler =
    JSON.stringify({
      shots: battle.projectiles.filter((p) => p.style === "bowler").length,
      hits: battle.events.filter((event) => event.type === "hit" && event.card === "bowler" && event.value).length,
      enemies: battle.entities.filter((e) => e.team === "red" && ["knight", "minions"].includes(e.card))
        .map((e) => ({ card: e.card, x: e.x, y: e.y, hp: e.hp })),
      visuals: arena.projectileState.filter((shot) => shot.sprites.some((sprite) => sprite.name === "bowler_projectile")),
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.iceSpirit =
    JSON.stringify({
      alive: battle.entities.some((e) =>
        e.team === "blue" && e.card === "ice-spirit" && e.hp > 0),
      shots: battle.projectiles.filter((p) => p.style === "ice-spirit")
        .map((p) => ({ id: p.id, x: p.flight?.x, y: p.flight?.y })),
      hits: battle.events.filter((e) =>
        e.type === "hit" && e.card === "ice-spirit").length,
      targets: battle.entities.filter((e) =>
        e.team === "red" && ["giant", "minions"].includes(e.card))
        .map((e) => ({ card: e.card, hp: e.hp, stun: e.stun, air: e.air })),
      cold: arena.coldFilterState,
      visuals: arena.projectileState.filter((p) =>
        p.sprites.some((sprite) => sprite.name === "projectile_icespirit")),
      particles: arena.particleCount,
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.fireSpirits =
    JSON.stringify({
      alive: battle.entities.filter((e) =>
        e.team === "blue" && e.card === "fire-spirits" && e.hp > 0).length,
      shots: battle.projectiles.filter((p) => p.style === "fire-spirits")
        .map((p) => ({ id: p.id, x: p.flight?.x, y: p.flight?.y })),
      hits: battle.events.filter((e) =>
        e.type === "hit" && e.card === "fire-spirits").length,
      targets: battle.entities.filter((e) =>
        e.team === "red" && ["giant", "minions"].includes(e.card))
        .map((e) => ({ card: e.card, hp: e.hp, air: e.air })),
      visuals: arena.projectileState.filter((p) =>
        p.sprites.some((sprite) => sprite.name === "projectile_firespirit")),
      particles: arena.particleCount,
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.battleRam =
    JSON.stringify({
      chargeCues,
      rams: battle.entities.filter((e) => e.card === "battle-ram")
        .map((e) => ({ x: e.x, y: e.y, move: e.move, hp: e.hp })),
      barbarians: battle.entities.filter((e) => e.team === "blue" && e.card === "barbarians")
        .map((e) => ({ x: e.x, y: e.y, deploy: e.deploy })),
      cannon: battle.entities.find((e) => e.team === "red" && e.card === "cannon")?.hp,
      knight: battle.entities.find((e) => e.team === "red" && e.card === "knight")?.hp,
      hits: battle.events.filter((event) => event.type === "hit" && event.card === "battle-ram" && event.value).length,
      deaths: battle.events.filter((event) => event.type === "death" && event.card === "battle-ram").length,
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.executioner =
    JSON.stringify({
      shots: battle.projectiles.filter((p) => p.style === "executioner")
        .map((p) => ({ id: p.id, returning: p.returning, x: p.flight?.x, y: p.flight?.y })),
      hits: battle.events.filter((event) => event.type === "hit" && event.card === "executioner" && event.value).length,
      enemies: battle.entities.filter((e) => e.team === "red" && ["knight", "minions"].includes(e.card))
        .map((e) => ({ card: e.card, x: e.x, hp: e.hp })),
      visuals: arena.projectileState.filter((shot) => shot.sprites.some((sprite) => sprite.name === "executioner_projectile")),
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.sparky =
    JSON.stringify({
      charge: battle.entities.find((e) => e.team === "blue" && e.card === "sparky")?.sparkyCharge,
      shots: battle.projectiles.filter((p) => p.style === "sparky")
        .map((p) => ({ id: p.id, x: p.flight?.x, y: p.flight?.y })),
      hits: battle.events.filter((event) => event.type === "hit" && event.card === "sparky").length,
      enemies: battle.entities.filter((e) => e.team === "red" && ["knight", "minions"].includes(e.card))
        .map((e) => ({ card: e.card, x: e.x, hp: e.hp })),
      loadCues: battle.audioEvents.filter((event) => event.profile === "sparky" && event.phase.startsWith("load-"))
        .map((event) => event.phase),
      visuals: arena.projectileState.filter((shot) => shot.sprites.some((sprite) => sprite.name === "zapMachine_projectile")),
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.lumberjack =
    JSON.stringify({
      alive: battle.entities.some((e) => e.card === "lumberjack" && e.hp > 0),
      bottles: battle.projectiles.filter((p) => p.style === "rage-bottle")
        .map((p) => ({ id: p.id, remaining: p.remaining })),
      visuals: arena.projectileState.filter((shot) => shot.sprites.some((sprite) => sprite.name === "rage_bottle_fall")),
      areas: arena.rageAreaState,
      friends: battle.entities.filter((e) => e.team === "blue" && ["knight", "minions"].includes(e.card))
        .map((e) => ({ card: e.card, raged: !!e.rage && e.rage.remaining > 0 })),
      enemies: battle.entities.filter((e) => e.team === "red" && e.card === "knight")
        .map((e) => ({ card: e.card, raged: !!e.rage && e.rage.remaining > 0 })),
      impacts: battle.events.filter((e) => e.effect === "bottle:lumberjack").length,
      impactEvents: battle.events.filter((e) => e.effect === "bottle:lumberjack").map((e) => ({ id: e.id, time: e.time })),
      lumberjacks: battle.entities.filter((e) => e.card === "lumberjack").map((e) => ({ id: e.id, team: e.team, hp: e.hp })),
      rawAreas: battle.areas.filter((a) => a.card === "rage").map((a) => ({ id: a.id, team: a.team, remaining: a.remaining })),
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.bats =
    JSON.stringify({
      units: battle.entities.filter((e) => e.team === "blue" && e.card === "bats")
        .map((e) => ({ id: e.id, air: e.air, hp: e.hp })),
      wiggle: arena.batWiggleState,
      airTargets: battle.entities.filter((e) => e.team === "red" && e.card === "minions")
        .map((e) => ({ x: e.x, hp: e.hp })),
      hits: battle.events.filter((e) => e.type === "hit" && e.card === "bats" && e.value).length,
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.nightWitch =
    JSON.stringify({
      alive: battle.entities.some((e) => e.team === "blue" && e.card === "night-witch" && e.hp > 0),
      bats: battle.entities.filter((e) => e.team === "blue" && e.card === "bats" && e.hp > 0)
        .map((e) => ({ id: e.id, x: e.x, y: e.y, deploy: e.deploy })),
      summons: battle.events.filter((e) => e.effect === "summon:night-witch").length,
      summonCues: battle.audioEvents.filter((e) => e.profile === "night-witch" && e.phase === "summon").length,
      deathCues: battle.audioEvents.filter((e) => e.profile === "night-witch" && e.phase === "death-spawn").length,
      particles: arena.particleCount,
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.bandit =
    JSON.stringify({
      unit: battle.entities.find((e) => e.card === "bandit" && e.team === "blue"),
      target: battle.entities.find((e) => e.card === "knight" && e.team === "red"),
      start: battle.events.filter((e) => e.effect === "dash-start:bandit").length,
      end: battle.events.filter((e) => e.effect === "dash-end:bandit").length,
      special: battle.events.filter((e) => e.effect === "hit-special:bandit").length,
      cues: battle.audioEvents.filter((e) => e.profile === "bandit" &&
        e.phase.startsWith("dash-")).map((e) => e.phase),
      filter: arena.banditFilterState,
      trail: arena.banditTrailState,
      particles: arena.particleCount,
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.golem =
    JSON.stringify({
      alive: battle.entities.some((e) => e.team === "blue" && e.card === "golem" && e.hp > 0),
      children: battle.entities.filter((e) => e.team === "blue" && e.card === "golemite" && e.hp > 0)
        .map((e) => ({ x: e.x, y: e.y, deploy: e.deploy, hp: e.hp })),
      targets: battle.entities.filter((e) => e.team === "red" &&
        (e.card === "knight" || e.card === "minions"))
        .map((e) => ({ card: e.card, hp: e.hp, x: e.x, y: e.y })),
      deaths: battle.events.filter((e) => e.type === "death" && e.card === "golem").length,
      childCues: battle.audioEvents.filter((e) => e.phase === "spawn" && e.profile === "golemite").length,
      fireflies: Object.entries(arena.destructionState.clips)
        .filter(([clip]) => clip.startsWith("Golem_firefly_")),
      particles: arena.particleCount,
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.iceGolem =
    JSON.stringify({
      alive: battle.entities.some((e) => e.team === "blue" && e.card === "ice-golem" && e.hp > 0),
      deaths: battle.events.filter((e) => e.type === "death" && e.card === "ice-golem").length,
      area: battle.areas.find((area) => area.card === "ice-golem")?.remaining ?? 0,
      targets: battle.entities.filter((e) => e.team === "red" &&
        ["knight", "minions"].includes(e.card))
        .map((e) => ({ card: e.card, hp: e.hp, air: e.air, slow: e.slow?.remaining ?? 0 })),
      cold: arena.coldFilterState,
      clips: arena.destructionState.clips,
      particles: arena.particleCount,
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.giantSkeleton =
    JSON.stringify({
      alive: battle.entities.some((e) => e.team === "blue" && e.card === "giant-skeleton" && e.hp > 0),
      bombs: battle.projectiles.filter((p) => p.style === "giant-skeleton-bomb")
        .map((p) => ({ id: p.id, remaining: p.remaining })),
      visuals: arena.projectileState.filter((p) =>
        p.sprites.some((sprite) => sprite.name === "giant_skeleton_bomb_blue")),
      targets: battle.entities.filter((e) => e.team === "red" &&
        ["knight", "minions"].includes(e.card))
        .map((e) => ({ card: e.card, hp: e.hp, air: e.air, x: e.x, y: e.y })),
      hits: battle.events.filter((e) => e.type === "hit" &&
        e.effect === "giant-skeleton-bomb").length,
      impactAudio: battle.audioEvents.filter((e) =>
        e.phase === "death-impact" && e.profile === "giant-skeleton").length,
      clips: arena.destructionState.clips,
      particles: arena.particleCount,
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.lavaHound =
    JSON.stringify({
      alive: battle.entities.some((e) => e.team === "blue" && e.card === "lava-hound" && e.hp > 0),
      height: (() => {
        const hound = battle.entities.find((e) => e.team === "blue" && e.card === "lava-hound" && e.hp > 0);
        return hound ? unitPlanes(hound.id)?.height : null;
      })(),
      ground: (() => {
        const hound = battle.entities.find((e) => e.team === "blue" && e.card === "lava-hound" && e.hp > 0);
        return hound ? unitPlanes(hound.id) : null;
      })(),
      pups: battle.entities.filter((e) => e.team === "blue" && e.card === "lava-pup" && e.hp > 0)
        .map((e) => ({ x: e.x, y: e.y, hp: e.hp, air: e.air, deploy: e.deploy,
          ...unitPlanes(e.id) })),
      coals: battle.projectiles.filter((p) => p.style === "lava-hound" || p.style === "lava-pup")
        .map((p) => ({ style: p.style, damage: p.damage, air: p.air })),
      deaths: battle.events.filter((e) => e.type === "death" && e.card === "lava-hound").length,
      pupCues: battle.audioEvents.filter((e) => e.phase === "spawn" && e.profile === "lava-pup").length,
      particles: arena.particleCount,
      clips: arena.destructionState.clips,
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.darkPrince =
    JSON.stringify({
      units: arena.darkPrinceState,
      hits: battle.events.filter((event) => event.type === "hit" && event.card === "dark-prince" && event.value).length,
      shieldBreaks: battle.events.filter((event) => event.effect === "shield:dark-prince").length,
      enemyHealth: battle.entities.filter((e) => e.team === "red" && ["knight", "minions"].includes(e.card))
        .map((e) => ({ card: e.card, hp: e.hp })),
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.guards =
    JSON.stringify({
      units: arena.guardsState,
      shieldBreaks: battle.events.filter((event) => event.effect === "shield:guards").length,
      shieldAudio: battle.audioEvents.filter((event) => event.phase === "shield-lost" && event.profile === "guards").length,
      particles: arena.particleCount,
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.projectiles =
    JSON.stringify(arena.projectileState);
  (document.querySelector("#destruction") as HTMLElement).dataset.iceWizard =
    JSON.stringify({
      caster: battle.entities.filter((e) => e.card === "ice-wizard" && e.hp > 0).length,
      targetHp: battle.entities.find((e) => e.team === "red" && e.card === "knight")?.hp,
      hits: battle.events.filter((event) => event.type === "hit" && event.card === "ice-wizard" && event.value).length,
      visuals: arena.projectileState.filter((shot) =>
        shot.sprites.some((sprite) => sprite.name === "ice_wizard_projectile")),
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.tornadoAreas =
    JSON.stringify(arena.tornadoAreaState);
  (
    document.querySelector("#destruction") as HTMLElement
  ).dataset.graveyardAreas = JSON.stringify(arena.graveyardAreaState);
  (
    document.querySelector("#destruction") as HTMLElement
  ).dataset.graveyardBirths = JSON.stringify(
    battle.events
      .filter((event) => event.effect === "graveyard-appear")
      .map((event) => ({ team: event.team, x: event.x, y: event.y })),
  );
  (document.querySelector("#destruction") as HTMLElement).dataset.cloneAreas =
    JSON.stringify(arena.cloneAreaState);
  (document.querySelector("#destruction") as HTMLElement).dataset.cloneFilter =
    JSON.stringify(arena.cloneFilterState);
  (
    document.querySelector("#destruction") as HTMLElement
  ).dataset.cloneEntities = JSON.stringify(
    battle.entities
      .filter((entity) => entity.clone)
      .map((entity) => ({ id: entity.id, card: entity.card, hp: entity.hp })),
  );
  (
    document.querySelector("#destruction") as HTMLElement
  ).dataset.tornadoEntities = JSON.stringify(
    battle.entities
      .filter((entity) => entity.card === "giant" || entity.card === "minions")
      .map((entity) => ({
        id: entity.id,
        card: entity.card,
        x: entity.x,
        y: entity.y,
        hp: entity.hp,
      })),
  );
  (
    document.querySelector("#destruction") as HTMLElement
  ).dataset.barrelGoblins = JSON.stringify(
    battle.entities
      .filter((entity) => entity.card === "goblins" && entity.team === "blue")
      .map((entity) => ({
        id: entity.id,
        x: entity.x,
        y: entity.y,
        deploy: entity.deploy,
      })),
  );
  (document.querySelector("#destruction") as HTMLElement).dataset.chargeCues =
    String(chargeCues);
  (document.querySelector("#destruction") as HTMLElement).dataset.chargeFilter =
    JSON.stringify(arena.chargeFilterState);
  (document.querySelector("#destruction") as HTMLElement).dataset.deployFilter =
    JSON.stringify(arena.deployFilterState);
  (document.querySelector("#destruction") as HTMLElement).dataset.coldFilter =
    JSON.stringify(arena.coldFilterState);
  const rageNode = document.querySelector("#destruction") as HTMLElement;
  rageNode.dataset.rageFilter = JSON.stringify(arena.rageFilterState);
  rageNode.dataset.rageStructures = JSON.stringify(arena.rageStructureState);
  rageNode.dataset.rageAreas = JSON.stringify(arena.rageAreaState);
  rageNode.dataset.rageEntities = JSON.stringify(
    battle.entities
      .filter((e) => e.card === "knight")
      .map((e) => ({ team: e.team, hp: e.hp, rage: e.rage })),
  );
  (document.querySelector("#destruction") as HTMLElement).dataset.poisonFilter =
    JSON.stringify(arena.poisonFilterState);
  (
    document.querySelector("#destruction") as HTMLElement
  ).dataset.coldStructures = JSON.stringify(arena.coldStructureState);
  (
    document.querySelector("#destruction") as HTMLElement
  ).dataset.poisonStructures = JSON.stringify(arena.poisonStructureState);
  (document.querySelector("#destruction") as HTMLElement).dataset.freezeAreas =
    JSON.stringify(arena.freezeAreaState);
  (document.querySelector("#destruction") as HTMLElement).dataset.poisonAreas =
    JSON.stringify(arena.poisonAreaState);
  (
    document.querySelector("#destruction") as HTMLElement
  ).dataset.poisonEntities = JSON.stringify(
    battle.entities
      .filter((entity) => entity.card === "knight")
      .map((entity) => ({
        team: entity.team,
        hp: entity.hp,
        poison: entity.poison,
      })),
  );
  (document.querySelector("#destruction") as HTMLElement).dataset.hogJump =
    JSON.stringify(
      battle.entities
        .filter((e) => e.card === "hog-rider")
        .map((e) => ({
          team: e.team,
          y: e.y,
          height: (arena as any).units.get(e.id)?.sprite?.mesh.position.y ?? 0,
        })),
    );
  (document.querySelector("#destruction") as HTMLElement).dataset.aiAreas =
    JSON.stringify({
      scene: (document.querySelector("#scenario") as HTMLSelectElement).value,
      actions: battle.actions.filter(
        (a) =>
          a.team === "red" && ["rage", "freeze", "poison", "heal", "clone"].includes(a.card),
      ),
      areas: battle.areas,
      kings: battle.entities.filter((e) => e.king)
        .map((e) => ({ team: e.team, hp: e.hp })),
      winner: battle.winner,
      time: battle.time,
      reason: battle.reason,
      phase: battle.phase,
      crowns: { blue: battle.players.blue.crowns, red: battle.players.red.crowns },
      entities: battle.entities
        .filter((e) => e.kind !== "tower")
        .map((e) => ({
          team: e.team,
          card: e.card,
          stun: e.stun,
          rage: e.rage,
          poison: e.poison,
          heal: e.heal,
          clone: e.clone,
          hp: e.hp,
          maxHp: e.maxHp,
          x: e.x,
          y: e.y,
          radius: e.radius,
          deploy: e.deploy,
        })),
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.aiSpells =
    JSON.stringify({
      actions: battle.actions.filter(
        (a) =>
          a.team === "red" &&
          ["rocket", "fireball", "arrows", "zap", "mirror"].includes(a.card),
      ),
      towers: battle.entities
        .filter((e) => e.team === "blue" && e.kind === "tower")
        .map((e) => ({ id: e.id, hp: e.hp, x: e.x, y: e.y, radius: e.radius })),
      crowns: battle.players.red.crowns,
      elixir: battle.players.red.elixir,
      hand: battle.players.red.hand,
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.aiDefense =
    JSON.stringify({
      scene: (document.querySelector("#scenario") as HTMLSelectElement).value,
      actions: battle.actions.filter((a) => a.team === "red"),
      priority: (
        document.querySelector("#scenario") as HTMLSelectElement
      ).value.startsWith("ai-defense-")
        ? defensiveThreats("red", battle.entities).map((e) => e.id)
        : [],
      defenders: battle.entities
        .filter((e) => e.team === "red" && e.kind === "troop" && e.hp > 0)
        .map((e) => ({
          id: e.id,
          card: e.card,
          x: e.x,
          y: e.y,
          target: e.target,
        })),
      targets: battle.entities
        .filter((e) => e.team === "blue" && e.kind === "troop" && e.hp > 0)
        .map((e) => ({
          id: e.id,
          card: e.card,
          x: e.x,
          y: e.y,
          target: e.target,
          hp: e.hp,
          maxHp: e.maxHp,
        })),
      buildings: battle.entities
        .filter((e) => e.team === "red" && e.kind === "building")
        .map((e) => ({
          id: e.id,
          card: e.card,
          x: e.x,
          y: e.y,
          hp: e.hp,
          maxHp: e.maxHp,
          target: e.target,
        })),
      balloonHits: battle.events.filter(
        (e) => e.type === "hit" && e.card === "balloon",
      ),
      guardHits: battle.events.filter(
        (e) => e.type === "hit" && e.card === "mini-pekka",
      ),
      hogHits: battle.events.filter(
        (e) => e.type === "hit" && e.card === "hog-rider",
      ),
      elixir: battle.players.red.elixir,
      towers: battle.entities
        .filter((e) => e.team === "red" && e.kind === "tower")
        .map((e) => ({ hp: e.hp, maxHp: e.maxHp, lane: e.lane, king: e.king })),
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.rockets =
    JSON.stringify({
      shots: arena.projectileState,
      impacts: battle.events.filter(
        (e) => e.type === "hit" && e.card === "rocket",
      ).length,
    });
  (document.querySelector("#destruction") as HTMLElement).dataset.impacts =
    String(
      battle.events.filter((e) => e.type === "hit" && e.card === "fireball")
        .length,
    );
  (document.querySelector("#destruction") as HTMLElement).dataset.shake =
    JSON.stringify(arena.shakeState);
  (document.querySelector("#destruction") as HTMLElement).dataset.spellImpacts =
    JSON.stringify({
      zap: battle.events.filter((e) => e.type === "hit" && e.card === "zap")
        .length,
      arrows: battle.events.filter(
        (e) => e.type === "hit" && e.card === "arrows",
      ).length,
      arrowSprites: arena.projectileState
        .filter((p) => p.sprites[0]?.name.includes("arrow_basic"))
        .map((p) => p.sprites.length),
    });
  (
    document.querySelector("#destruction") as HTMLElement
  ).dataset.attackImpacts = JSON.stringify(
    battle.events
      .filter((e) => e.type === "hit")
      .reduce((counts: Record<string, number>, event) => {
        const card = event.card ?? "tower";
        counts[card] = (counts[card] ?? 0) + 1;
        return counts;
      }, {}),
  );
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
