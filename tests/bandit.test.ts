import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { Battle } from "../src/game/engine";
import { combatAudioPlan } from "../src/game/combat-audio";
import { perspective, snapshot } from "../src/network/perspective";
import { destructionPlan } from "../src/render/destruction";
import rules from "../src/game/bandit-data.json";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const setup = () => {
  const game = new Battle({ seed: 57, ai: false,
    deck: ["bandit", ...STARTER_DECK.filter((id) => id !== "arrows")] });
  for (const tower of game.entities) tower.active = false;
  game.players.blue.hand[0] = "bandit";
  game.players.blue.elixir = 10;
  expect(game.play("blue", 0, 4, 22).ok).toBe(true);
  const bandit = game.entities.find((e) => e.card === "bandit")!;
  Object.assign(bandit, { x: 4, y: 21, deploy: 0, cooldown: 0 });
  game.players.red.hand[0] = "knight";
  game.players.red.elixir = 10;
  expect(game.play("red", 0, 4, 10).ok).toBe(true);
  const target = game.entities.find((e) => e.team === "red" && e.card === "knight")!;
  Object.assign(target, { x: 4, y: 16, deploy: 0, hp: 10000, maxHp: 10000,
    active: false, speed: 0, damage: 0 });
  return { game, bandit, target };
};

describe("archived Bandit", () => {
  it("pins her original dash ranges, blue/red art, portrait and cues", () => {
    const manifest = json("reference/client/bandit-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({ card: "Assassin", rarity: "Legendary", cost: 3,
      sourceHitpoints: 750, sourceDamage: 160, sourceSpeed: 90,
      hitsGround: true, hitsAir: false,
      dash: { minimum: 4, maximum: 6, damage: 320, cooldown: 1,
        filter: "filter_bandit_charge", travelEffect: "assassin_dashing" } });
    expect(CARD_MAP.bandit).toMatchObject({ cost: 3, hp: 908, damage: 194,
      hitsAir: false });
    const model = json("public/assets/animations/manifest.json").files
      .find((file: { id: string }) => file.id === "bandit");
    expect(model.clips).toBe(72);
    expect(model.metadataSha256).toBe(hash("reference/sc/chr_bandit.bin"));
    expect(json("public/assets/ui/cards/cards.json").portraits.bandit.row).toBe("Assassin");
    expect(combatAudioPlan("bandit", "dash-start", 7).length).toBeGreaterThan(0);
    expect(combatAudioPlan("bandit", "dash-travel", 7).length).toBeGreaterThan(0);
    expect(combatAudioPlan("bandit", "dash-end", 7).length).toBeGreaterThan(0);
    expect(destructionPlan("dash-start:bandit", 7).length).toBeGreaterThan(0);
    expect(destructionPlan("dash-end:bandit", 7).length).toBeGreaterThan(0);
    expect(destructionPlan("hit-special:bandit", 7).length).toBeGreaterThan(0);
  });

  it("dashes from five tiles, ignores a spell in flight, and lands one heavy hit", () => {
    const { game, bandit, target } = setup();
    game.step();
    expect(bandit.dash?.target).toBe(target.id);
    expect(game.audioEvents.some((event) => event.profile === "bandit" &&
      event.phase === "dash-travel")).toBe(true);
    expect(perspective(snapshot(game), "red").entities.find((e) =>
      e.card === "bandit")?.dash?.target).toBe(target.id);
    const hp = bandit.hp;
    game.players.red.hand[0] = "zap";
    game.players.red.elixir = 10;
    expect(game.play("red", 0, bandit.x, bandit.y).ok).toBe(true);
    game.step();
    expect(bandit.hp).toBe(hp);
    expect(bandit.stun).toBe(0);
    for (let i = 0; i < 45 && bandit.dash; i++) game.step();
    expect(bandit.dash).toBeUndefined();
    expect(target.hp).toBe(10000 - Math.round(320 * 1.1 ** 2));
    expect(game.audioEvents.filter((event) => event.profile === "bandit" &&
      event.phase === "impact-special")).toHaveLength(1);
  });

  it("does not dash below the archived minimum or at an air target", () => {
    const { game, bandit, target } = setup();
    target.y = 18.5;
    game.step();
    expect(bandit.dash).toBeUndefined();
    target.air = true;
    target.y = 16;
    game.step();
    expect(bandit.dash).toBeUndefined();
  });
});
