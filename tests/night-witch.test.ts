import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { Battle } from "../src/game/engine";
import { combatAudioPlan } from "../src/game/combat-audio";
import { perspective, snapshot } from "../src/network/perspective";
import { destructionPlan } from "../src/render/destruction";
import rules from "../src/game/night-witch-data.json";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const battle = () => {
  const game = new Battle({ seed: 55, ai: false,
    deck: ["night-witch", ...STARTER_DECK.filter((id) => id !== "arrows")] });
  for (const tower of game.entities) tower.active = false;
  game.players.blue.hand[0] = "night-witch";
  game.players.blue.elixir = 10;
  expect(game.play("blue", 0, 4, 22).ok).toBe(true);
  const witch = game.entities.find((e) => e.card === "night-witch")!;
  Object.assign(witch, { x: 4, y: 21, deploy: 0, speed: 0 });
  return { game, witch };
};

describe("archived Night Witch", () => {
  it("pins the source Bat-summon rules and native model, portrait, effect and audio", () => {
    const manifest = json("reference/client/night-witch-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      card: "DarkWitch", cost: 4, rarity: "Legendary",
      sourceHitpoints: 750, sourceDamage: 285,
      sourceRange: 1.85, sourceHitSpeed: 1.5,
      hitsGround: true, hitsAir: false,
      spawn: { character: "Bat", count: 2, pause: 5, radius: 1.5,
        effect: "bat_dark_witch_spawn", effectDelay: 0.3 },
      deathSpawn: { character: "Bat", count: 4, radius: 2.5,
        angleShift: 90, pushback: true },
    });
    expect(CARD_MAP["night-witch"]).toMatchObject({ cost: 4,
      hp: 908, damage: 345, hitsAir: false });
    const model = json("public/assets/animations/manifest.json").files
      .find((file: { id: string }) => file.id === "night-witch");
    expect(model.clips).toBe(54);
    expect(model.metadataSha256).toBe(hash("reference/sc/chr_dark_witch.bin"));
    expect(json("public/assets/ui/cards/cards.json").portraits["night-witch"].row).toBe("DarkWitch");
    expect(destructionPlan("summon:night-witch", 7)).toHaveLength(16);
    expect(combatAudioPlan("night-witch", "summon", 7).length).toBeGreaterThan(0);
  });

  it("summons two Bats every five active seconds and sends the event to the guest", () => {
    const { game, witch } = battle();
    expect(witch.spawnTimer).toBe(5);
    for (let i = 0; i < 149; i++) game.step();
    expect(game.entities.filter((e) => e.card === "bats")).toHaveLength(0);
    game.step();
    expect(game.entities.filter((e) => e.card === "bats" && e.team === "blue")).toHaveLength(2);
    expect(game.events.filter((e) => e.effect === "summon:night-witch")).toHaveLength(1);
    expect(game.audioEvents.some((e) => e.phase === "summon" && e.profile === "night-witch")).toBe(true);
    const guest = perspective(snapshot(game), "red");
    expect(guest.entities.filter((e) => e.card === "bats" && e.team === "red")).toHaveLength(2);
    expect(guest.events?.some((e) => e.effect === "summon:night-witch")).toBe(true);
    for (let i = 0; i < 150; i++) game.step();
    expect(game.entities.filter((e) => e.card === "bats" && e.team === "blue")).toHaveLength(4);
  });

  it("releases four surviving Bats once when Fireball defeats her", () => {
    const { game, witch } = battle();
    witch.hp = 1;
    game.players.red.hand[0] = "fireball";
    game.players.red.elixir = 10;
    expect(game.play("red", 0, 4, 21).ok).toBe(true);
    for (let i = 0; i < 100 && witch.hp > 0; i++) game.step();
    expect(witch.hp).toBe(0);
    const bats = game.entities.filter((e) => e.team === "blue" && e.card === "bats");
    expect(bats).toHaveLength(4);
    expect(bats.every((e) => e.hp > 0)).toBe(true);
    expect(game.audioEvents.filter((e) => e.phase === "death-spawn" && e.profile === "night-witch")).toHaveLength(1);
  });
});
