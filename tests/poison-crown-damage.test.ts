import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Battle, STEP, type Replay, type Team } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { poisonTickDamage } from "../src/game/poison-damage";
import { poisonDamagePackets } from "../src/game/status-health";
import { towerDamageForecast } from "../src/game/king-damage";
import { createMatchFinisher } from "../src/game/match-finisher";
import { areaSpellTarget } from "../src/game/area-spell-targeting";
import { createWindupHealth } from "../src/game/windup-health";
import { projectAreaFrames } from "../src/game/tornado-pull";
import { cardDetails } from "../src/ui/card-details";
import { applySnapshot, perspective, snapshot } from "../src/network/perspective";
import poison from "../src/game/poison-data.json";
import golden from "./fixtures/poison-crown-rules45-golden.json";

function match(version: Replay["version"] = 46) {
  const b = new Battle({
    replay: {
      ...new Battle({ seed: 1511, ai: false }).exportReplay(),
      version,
    },
  });
  for (const e of b.entities) e.active = false;
  return b;
}
function prepare(b: Battle, team: Team, king: boolean, card: CardId = "poison") {
  b.players[team].hand[0] = card;
  b.players[team].elixir = 10;
  return b.entities.find((e) => e.team !== team && !!e.king === king)!;
}
const digest = (b: Battle) => createHash("sha256")
  .update(JSON.stringify(Object.fromEntries(
    golden.stateFields.map((key) => [key, (b as any)[key]]),
  )))
  .digest("hex");

it("preserves four independently captured complete rules-45 games with Poison and historical AI", () => {
  for (const row of golden.cases) {
    const b = new Battle({ replay: row.replay as Replay });
    if (row.ai) Object.assign(b, { ai: true, replayActions: null });
    for (const checkpoint of row.checkpoints) {
      while (b.tick < checkpoint.tick && !b.winner) {
        if (row.ai)
          for (const a of row.replay.actions.filter(
            (a) => a.team === "blue" && a.tick === b.tick,
          ))
            expect(b.play("blue", b.players.blue.hand.indexOf(a.card as CardId), a.x, a.y).ok).toBe(true);
        b.step();
      }
      expect(digest(b), `${row.replay.seed}:${checkpoint.tick}`).toBe(checkpoint.digest);
    }
  }
  for (const kind of ["tower", "troop"] as const)
    expect(golden.cases.some((r) => r.poisonedUpdates[kind] > 0)).toBe(true);
});

it("binds Poison's runtime percentage to the executed buff evidence and archived source", () => {
  const manifest = JSON.parse(readFileSync("reference/client/poison-manifest.json", "utf8"));
  for (const input of [...manifest.inputs, manifest.output])
    expect(createHash("sha256").update(readFileSync(input.path)).digest("hex")).toBe(input.sha256);
  expect(poison.crownTowerDamagePercent).toBe(-60);
  expect(poison.damageInterval).toBe(1);
  expect(manifest.nativeHelper).toBe("0x1d7e36..0x1d7eb4");
  expect(poisonTickDamage({ kind: "tower", nativeBuffCrownDamage: true })).toBe(49);
  expect(poisonTickDamage({ kind: "tower" })).toBeCloseTo(48.4, 12);
});

for (const version of [45, 46] as const)
  for (const team of ["blue", "red"] as const)
    for (const king of [false, true])
      it(`rules ${version}: ${team} Poison live and planned ticks agree on ${king ? "King" : "Princess"}`, () => {
        const b = match(version), tower = prepare(b, team, king);
        const amount = version === 46 ? 49 : 48.4;
        expect(tower.nativeBuffCrownDamage).toBe(version === 46 ? true : undefined);
        const planned = towerDamageForecast(tower, [], [], b.entities)
          .withSpell("poison", team, tower);
        expect(planned).toHaveLength(8);
        expect(planned.map((p) => p.step)).toEqual([30, 60, 90, 120, 150, 180, 210, 240]);
        expect(planned.every((p) => Math.abs(p.damage - amount) < 1e-8)).toBe(true);
        expect(b.play(team, 0, tower.x, tower.y).ok).toBe(true);
        expect(poisonDamagePackets(tower, b.areas)).toEqual(planned);
        const hp = tower.hp;
        for (let step = 1; step <= 270; step++) {
          b.step();
          const count = planned.filter((p) => p.step <= step).length;
          expect(tower.hp).toBeCloseTo(hp - count * amount, 9);
        }
        expect(tower.poison).toBeUndefined();
        expect(b.areas).toHaveLength(0);
      });

for (const team of ["blue", "red"] as const)
  for (const king of [false, true]) {
    it(`${team} Poison AI and sudden death use the new ${king ? "King" : "Princess"} lethal boundary`, () => {
      for (const version of [45, 46] as const) {
        const b = match(version), tower = prepare(b, team, king);
        tower.hp = 392;
        const finisher = createMatchFinisher(team, b.entities, [], [], { blue: 0, red: 0 }, 60, true);
        expect(finisher.outcomeAt("poison", tower)?.winner).toBe(version === 46 ? team : undefined);
        expect(areaSpellTarget("poison", team, b.entities)?.lethalTower).toBe(version === 46 ? tower.id : undefined);
        tower.hp = 393;
        expect(areaSpellTarget("poison", team, b.entities)?.lethalTower).toBeUndefined();
      }
    });

    it(`${team} pending Poison and windup survival agree on a 49-HP ${king ? "King" : "Princess"}`, () => {
      for (const version of [45, 46] as const) {
        const b = match(version), tower = prepare(b, team, king);
        tower.hp = 49;
        tower.poison = { remaining: 1, elapsed: 1 - STEP };
        const packets = poisonDamagePackets(tower, []);
        expect(packets[0].step).toBe(1);
        expect(packets[0].damage).toBeCloseTo(version === 46 ? 49 : 48.4, 12);
        const survival = createWindupHealth([], b.entities).survival(
          tower, projectAreaFrames(tower, [], 1), [],
        );
        expect(survival[0].afterAlive).toBe(version === 45);
        b.step();
        expect(tower.hp > 0).toBe(version === 45);
        if (king) expect(b.winner).toBe(version === 46 ? team : null);
      }
    });
  }

for (const team of ["blue", "red"] as const) {
  it(`${team} Poison keeps full troop and building ticks`, () => {
    const b = match(), enemy = team === "blue" ? "red" : "blue";
    const victims = ["knight", "cannon"].map((card, i) => {
      (b as any).spawn(card, enemy, 8 + i, 12, false, 0);
      const body = b.entities.at(-1)!;
      body.active = false;
      body.lifetime = undefined;
      return body;
    });
    prepare(b, team, false);
    expect(b.play(team, 0, 8.5, 12).ok).toBe(true);
    for (let n = 0; n < 30; n++) b.step();
    for (const body of victims) expect(body.hp).toBe(body.maxHp - 121);
  });

  it(`${team} overlapping mirrored Poison preserves tick phase and applies one integer packet`, () => {
    const b = match(), tower = prepare(b, team, false);
    expect(b.play(team, 0, tower.x, tower.y).ok).toBe(true);
    for (let i = 0; i < 15; i++) b.step();
    prepare(b, team, false, "mirror");
    expect(b.play(team, 0, tower.x, tower.y).ok).toBe(true);
    expect(b.areas).toHaveLength(2);
    for (let i = 0; i < 15; i++) b.step();
    expect(tower.hp).toBe(tower.maxHp - 49);
    for (let i = 0; i < 30; i++) b.step();
    expect(tower.hp).toBe(tower.maxHp - 98);
  });
}

it("retains host buff arithmetic in guest views and clears it on an older host snapshot", () => {
  const host = match(), saved = structuredClone(snapshot(host));
  expect(perspective(saved, "red").entities.every((e) => e.nativeBuffCrownDamage)).toBe(true);
  const guest = match(45);
  applySnapshot(guest, saved, "red");
  const damage = () => poisonTickDamage(guest.entities.find((e) => e.team === "blue" && e.king)!);
  expect(damage()).toBe(49);
  applySnapshot(guest, snapshot(match(45)), "red");
  expect(guest.entities.every((e) => !e.nativeBuffCrownDamage)).toBe(true);
  expect(damage()).toBeCloseTo(48.4, 12);
  expect(snapshot(host)).toEqual(saved);
});

it("shows current Poison damage without changing its full damage or timing", () => {
  const stats = Object.fromEntries(cardDetails("poison").stats.map((r) => [r.label, r.value]));
  expect(stats).toMatchObject({ "Damage per second": "121", "Crown Tower / second": "49", Duration: "8 s" });
});

it("records and replays a complete rules-46 Poison match", () => {
  const b = new Battle({ replay: { ...golden.cases[3].replay, version: 46 } as Replay });
  while (!b.winner && b.tick < 12000) b.step();
  expect(b.winner).toBeTruthy();
  expect(b.actions.some((a) => a.card === "poison")).toBe(true);
  const replay = new Battle({ replay: b.exportReplay() });
  while (replay.tick < b.tick) replay.step();
  expect(replay.rulesVersion).toBe(46);
  expect(digest(replay)).toBe(digest(b));
});
