import { sendPeerCommand } from "./helpers/peer-command";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP, type Team } from "../src/game/engine";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";
import { CARD_MAP, STARTER_DECK, type CardId } from "../src/game/cards";
import { applySnapshot, snapshot } from "../src/network/perspective";
import rocket from "../src/game/rocket-data.json";
import definitions from "../src/render/destruction-data.json";
import { destructionPlan } from "../src/render/destruction";
import { NativeProjectileTrails } from "../src/render/projectile-trails";
import { projectilePose } from "../src/render/projectile-path";
const deck: CardId[] = ["rocket", ...STARTER_DECK.slice(1)];
function battle() {
  const b = new Battle({ seed: 4, ai: false, deck, enemyDeck: deck });
  for (const e of b.entities) e.active = false;
  return b;
}
function cast(b: Battle, team: Team, x: number, y: number) {
  b.players[team].hand[0] = "rocket";
  b.players[team].elixir = 10;
  expect(b.play(team, 0, x, y).ok).toBe(true);
}
function advance(b: Battle, ticks: number) {
  for (let i = 0; i < ticks; i++) b.step();
}

describe("archived Rocket", () => {
  it("pins source rows, normalized damage, portraits and native compositions", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/rocket-manifest.json", "utf8"),
    );
    for (const file of [...manifest.inputs, manifest.output])
      expect(
        createHash("sha256").update(readFileSync(file.path)).digest("hex"),
      ).toBe(file.sha256);
    expect(rocket).toMatchObject({
      cost: 6,
      sourceDamage: 700,
      speed: 350 / 60,
      radius: 2,
      knockback: 1.8,
      crownTowerDamageFraction: 0.4,
    });
    expect(CARD_MAP.rocket).toMatchObject({
      kind: "spell",
      rarity: "Rare",
      cost: 6,
    });
    expect(definitions.impacts.rocket.source).toBe("Rocket_explosion");
    expect(definitions.trails.rocket.components).toHaveLength(4);
    expect(destructionPlan("trail:rocket", 42)).toEqual(
      destructionPlan("trail:rocket", 42),
    );
    const art = JSON.parse(
      readFileSync("public/assets/effects/effects.json", "utf8"),
    );
    expect(art.clips.projectile_rocket.frames).toHaveLength(60);
    expect(art.clips.projectile_rocket.fps).toBe(60);
    expect(art.clips.projectile_shadow_rocket.frames).toHaveLength(1);
  });
  it.each(["blue", "red"] as Team[])(
    "flies from the %s King at source speed and hits its fixed target once",
    (team) => {
      const b = battle(),
        target = b.entities.find((e) => e.team !== team && !e.king)!;
      const hp = target.hp;
      cast(b, team, target.x, target.y);
      expect(b.players[team].elixir).toBe(4);
      const p = b.projectiles[0];
      expect(p.duration).toBeCloseTo(
        Math.hypot(target.x - 9, target.y - (team === "blue" ? 30 : 2)) /
          rocket.speed,
      );
      const ticks = Math.ceil((p.duration - 1e-8) / STEP);
      advance(b, ticks - 1);
      expect(target.hp).toBe(hp);
      expect(b.projectiles).toHaveLength(1);
      b.step();
      expect(target.hp).toBeCloseTo(hp - CARD_MAP.rocket.damage * 0.4);
      expect(b.projectiles).toHaveLength(0);
      advance(b, 30);
      expect(
        b.events.filter((e) => e.type === "hit" && e.card === "rocket"),
      ).toHaveLength(1);
      expect(
        b.audioEvents.filter((e) => e.profile === "rocket").map((e) => e.phase),
      ).toEqual(["cast", "impact"]);
    },
  );
  it("damages enemy air and ground, excludes friends and hidden Tesla, and respects heavy knockback immunity", () => {
    const b = battle();
    const spawn = (id: CardId, team: Team, x: number, y: number) => {
      const old = new Set(b.entities.map((e) => e.id));
      b.players[team].hand[0] = id;
      b.players[team].elixir = 10;
      expect(
        b.play(team, 0, id === "tesla" ? 14 : x, team === "blue" ? 22 : 10).ok,
      ).toBe(true);
      const e = b.entities.find((e) => !old.has(e.id))!;
      Object.assign(e, {
        x,
        y,
        active: false,
        deploy: 0,
        hp: 10000,
        maxHp: 10000,
        lifetime: undefined,
      });
      return e;
    };
    const ground = spawn("knight", "red", 9.5, 12),
      air = spawn("baby-dragon", "red", 8.5, 12),
      heavy = spawn("giant", "red", 9, 12.5),
      friend = spawn("knight", "blue", 9, 12),
      hidden = spawn("tesla", "red", 9, 12),
      outside = spawn("knight", "red", 14, 12);
    const before = [ground, air, heavy, friend, hidden, outside].map((e) => ({
      hp: e.hp,
      x: e.x,
      y: e.y,
    }));
    cast(b, "blue", 9, 12);
    advance(b, Math.ceil(b.projectiles[0].duration / STEP) - 1);
    const heavyBefore = { x: heavy.x, y: heavy.y };
    b.step();
    for (const e of [ground, air, heavy])
      expect(e.hp).toBeCloseTo(10000 - CARD_MAP.rocket.damage);
    for (const e of [friend, hidden, outside]) expect(e.hp).toBe(10000);
    expect(ground.x).toBeGreaterThan(before[0].x);
    expect(
      Math.hypot(heavy.x - heavyBefore.x, heavy.y - heavyBefore.y),
    ).toBeLessThan(0.1);
  });
  it("rejects an unaffordable cast and allows a moving enemy to leave the fixed blast", () => {
    const b = battle();
    b.players.blue.hand[0] = "rocket";
    b.players.blue.elixir = 5;
    expect(b.play("blue", 0, 9, 12).ok).toBe(false);
    expect(b.projectiles).toEqual([]);
    expect(b.players.blue.hand[0]).toBe("rocket");
    b.players.red.hand[0] = "knight";
    b.players.red.elixir = 10;
    expect(b.play("red", 0, 9, 10).ok).toBe(true);
    const enemy = b.entities.find((e) => e.card === "knight")!;
    Object.assign(enemy, { x: 9, y: 12, deploy: 0, active: false });
    cast(b, "blue", 9, 12);
    advance(b, 30);
    enemy.x = 15;
    const hp = enemy.hp;
    advance(b, 90);
    expect(enemy.hp).toBe(hp);
    expect(
      b.events.find((e) => e.type === "hit" && e.card === "rocket"),
    ).toMatchObject({ x: 9, y: 12 });
  });
  it("keeps replay state and red-side snapshots deterministic during flight and impact", () => {
    let b = new Battle({ seed: 4, ai: false, deck, enemyDeck: deck });
    for (let seed = 5; !b.players.blue.hand.includes("rocket"); seed++)
      b = new Battle({ seed, ai: false, deck, enemyDeck: deck });
    while (b.players.blue.elixir < 6) b.step();
    expect(b.play("blue", b.players.blue.hand.indexOf("rocket"), 4, 6).ok).toBe(
      true,
    );
    advance(b, 40);
    const guest = new Battle({ seed: 4, ai: false, deck, enemyDeck: deck });
    applySnapshot(guest, snapshot(b), "red");
    expect(guest.projectiles[0]).toMatchObject({
      team: "red",
      x: 9,
      y: 2,
      tx: 14,
      ty: 26,
      towerDamageFraction: 0.4,
      speed: rocket.speed,
    });
    const replay = new Battle({ replay: b.exportReplay() });
    advance(replay, b.tick);
    expect(replay.projectiles).toEqual(b.projectiles);
    advance(b, 110);
    advance(replay, 110);
    expect(snapshot(replay)).toEqual(snapshot(b));
  });
  it("accepts Rocket through the peer host and holds its flight during interruption", () => {
    const seed = Array.from({ length: 100 }, (_, i) => i + 1).find((seed) =>
      new Battle({ seed, deck, ai: false }).players.blue.hand.includes(
        "rocket",
      ),
    )!;
    const sent: { team: Team; message: ServerMessage }[] = [];
    const host = new PeerMatch(
      "1234567890abcdef12345678",
      "classic",
      { name: "Blue", deck },
      seed,
      (team, message) => sent.push({ team, message: structuredClone(message) }),
    );
    expect(host.join({ name: "Red", deck })).toBe(true);
    for (const team of ["blue", "red"] as const)
      sendPeerCommand(host, team, { type: "ready", ready: true });
    for (let i = 0; i < 210; i++) host.advance(STEP);
    sendPeerCommand(host, "blue", {
      type: "play",
      seq: 1,
      card: "rocket",
      x: 4,
      y: 6,
    });
    expect(
      sent.findLast((e) => e.team === "blue" && e.message.type === "ack")
        ?.message,
    ).toMatchObject({ ok: true });
    for (let i = 0; i < 10; i++) host.advance(STEP);
    expect(host.battle!.projectiles[0]).toMatchObject({
      style: "rocket",
      towerDamageFraction: 0.4,
    });
    const before = structuredClone(snapshot(host.battle!));
    host.availability("red", false);
    for (let i = 0; i < 30; i++) host.advance(STEP);
    expect(snapshot(host.battle!)).toEqual(before);
    host.availability("red", true);
    for (let i = 0; i < 150; i++) host.advance(STEP);
    expect(
      host.battle!.events.filter(
        (e) => e.type === "hit" && e.card === "rocket",
      ),
    ).toHaveLength(1);
  });
  it("schedules bounded trail cycles independent of render frequency and rebuilds late flight", () => {
    const b = battle();
    cast(b, "blue", 4, 6);
    const p = b.projectiles[0];
    const trails = new NativeProjectileTrails();
    const first = trails.consume([p], 4);
    expect(first).toHaveLength(1);
    expect(trails.consume([p], 4)).toEqual([]);
    advance(b, 60);
    const later = trails.consume([p], 4);
    expect(later.map((v) => v.start)).toEqual([0.8, 1.6]);
    const rebuilt = new NativeProjectileTrails().consume([p], 4);
    expect(rebuilt.map((v) => v.seed)).toEqual(
      [...first, ...later].map((v) => v.seed),
    );
    expect(projectilePose(p, 0)).toEqual({ x: 0, y: 2.4, z: 14 });
    expect(projectilePose(p, p.duration).x).toBe(-5);
    expect(projectilePose(p, p.duration).z).toBe(-10);
    expect(trails.consume([], 4)).toEqual([]);
    trails.reset();
    expect(trails.consume([p], 4)).toEqual(rebuilt);
  });
});
