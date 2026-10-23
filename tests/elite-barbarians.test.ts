import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARD_MAP, CARDS, STARTER_DECK } from "../src/game/cards";
import { combatTraits } from "../src/game/combat";
import { combatAudioPlan } from "../src/game/combat-audio";
import { deploymentPositions } from "../src/game/deployment";
import { Battle } from "../src/game/engine";
import { perspective, snapshot } from "../src/network/perspective";
import rules from "../src/game/elite-barbarians-data.json";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const deck = ["elite-barbarians", ...STARTER_DECK.filter((id) => id !== "arrows")];
const seed = Array.from({ length: 200 }, (_, i) => i + 1).find((value) =>
  new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes("elite-barbarians"),
)!;

describe("archived Elite Barbarians", () => {
  it("pins their card, two team animation sets, portrait and distinct audio", () => {
    const manifest = json("reference/client/elite-barbarians-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      card: "AngryBarbarians", character: "AngryBarbarian", rarity: "Common",
      cost: 6, count: 2, summonRadius: 0.7,
      sourceHitpoints: 478, sourceDamage: 120, sourceSpeed: 120,
      sourceRange: 1, sourceHitSpeed: 1.5, sourceLoadTime: 1.1,
      deployDelay: 0.4, blueExport: "angry_barbarian",
      redExport: "angry_barbarian_red",
    });
    const sprite = json("public/assets/animations/elite-barbarians.json");
    expect(Object.keys(sprite.clips)).toHaveLength(54);
    expect(sprite.clips["blue-attack-1"].source).toBe("angry_barbarian_attack1_1");
    expect(sprite.clips["red-run-9"].source).toBe("angry_barbarian_red_run1_9");
    expect(json("public/assets/ui/cards/cards.json").portraits["elite-barbarians"].row)
      .toBe("AngryBarbarians");
    expect(combatAudioPlan("elite-barbarians", "spawn", 7).length).toBeGreaterThan(0);
    expect(combatAudioPlan("elite-barbarians", "attack", 7).length).toBeGreaterThan(0);
    expect(CARDS).toHaveLength(61);
  });

  it("spends six elixir, places two symmetric melee units and replays their positions", () => {
    expect(CARD_MAP["elite-barbarians"]).toMatchObject({
      cost: 6, count: 2, hp: 1207, damage: 323, speed: 2,
      range: 1, interval: 1.5,
    });
    expect(combatTraits({ card: "elite-barbarians" })).toMatchObject({
      source: "AngryBarbarian", windup: 0.4, sight: 5.5,
    });
    const positions = deploymentPositions("elite-barbarians", { x: 4, y: 22 });
    expect(positions).toEqual([{ x: 3.3, y: 22 }, { x: 4.7, y: 22 }]);
    const battle = new Battle({ seed, ai: false, deck, enemyDeck: deck });
    while (battle.players.blue.elixir < 6) battle.step();
    const beforeElixir = battle.players.blue.elixir;
    expect(battle.play("blue", battle.players.blue.hand.indexOf("elite-barbarians"), 4, 22).ok).toBe(true);
    expect(battle.players.blue.elixir).toBeCloseTo(beforeElixir - 6);
    const units = battle.entities.filter((e) => e.card === "elite-barbarians");
    expect(units.map(({ x, y, deploy }) => ({ x, y, deploy }))).toEqual(
      positions.map(({ x, y }) => ({ x, y, deploy: 1.4 })),
    );
    expect(perspective(snapshot(battle), "red").entities.filter((e) =>
      e.card === "elite-barbarians")).toHaveLength(2);
    const replay = new Battle({ replay: battle.exportReplay() });
    for (let i = 0; i <= battle.tick; i++) replay.step();
    expect(replay.entities.filter((e) => e.card === "elite-barbarians")
      .map(({ x, y }) => ({ x, y }))).toEqual(positions);
  });
});
