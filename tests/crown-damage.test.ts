import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Battle, type Replay, type Team } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { nativeCrownAmount } from "../src/game/crown-damage";
import { projectileDamagePackets } from "../src/game/projectile-impacts";
import { lightningDamageMap } from "../src/game/lightning-strikes";
import { towerDamageForecast } from "../src/game/king-damage";
import { damageSpellTarget } from "../src/game/spell-targeting";
import {
  applySnapshot,
  perspective,
  snapshot,
} from "../src/network/perspective";
import golden from "./fixtures/crown-damage-rules43-golden.json";

const amounts = {
  fireball: 276,
  arrows: 147,
  rocket: 594,
  lightning: 552,
  log: 204,
};
const cards = Object.keys(amounts) as (keyof typeof amounts)[];
function match(version: Replay["version"] = 44) {
  const b = new Battle({
    replay: {
      ...new Battle({ seed: 7051, ai: false }).exportReplay(),
      version,
    },
  });
  for (const e of b.entities) e.active = false;
  return b;
}
function prepare(b: Battle, team: Team, card: CardId, king: boolean) {
  const tower = b.entities.find((e) => e.team !== team && !!e.king === king)!;
  b.players[team].hand[0] = card;
  b.players[team].elixir = 10;
  const point = {
    x: tower.x,
    y: card === "log" ? (team === "blue" ? 17.5 : 14.5) : tower.y,
  };
  return { tower, point };
}
const digest = (b: Battle) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          golden.stateFields.map((key) => [key, (b as any)[key]]),
        ),
      ),
    )
    .digest("hex");

it("retains four independently captured complete rules-43 matches", () => {
  for (const row of golden.cases) {
    const b = new Battle({ replay: row.replay as Replay });
    if (row.ai) Object.assign(b, { ai: true, replayActions: null });
    for (const checkpoint of row.checkpoints) {
      while (b.tick < checkpoint.tick && !b.winner) {
        if (row.ai)
          for (const a of row.replay.actions.filter(
            (a) => a.team === "blue" && a.tick === b.tick,
          ))
            expect(
              b.play(
                "blue",
                b.players.blue.hand.indexOf(a.card as CardId),
                a.x,
                a.y,
              ).ok,
            ).toBe(true);
        b.step();
      }
      expect(digest(b), `${row.replay.seed}:${checkpoint.tick}`).toBe(
        checkpoint.digest,
      );
    }
  }
});

it("matches the executed native Crown helper, including percent clamps and exact boundaries", () => {
  const manifest = JSON.parse(
    readFileSync("reference/client/crown-damage-manifest.json", "utf8"),
  );
  for (const input of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(input.path)).digest("hex"),
    ).toBe(input.sha256);
  const trace = JSON.parse(readFileSync(manifest.inputs[0].path, "utf8"));
  let checked = 0;
  for (const row of [...trace.cases, ...trace.controls]) {
    if (!["KingTower", "PrincessTower"].includes(row.targetSource)) continue;
    for (const frame of row.frames) {
      const counter = frame.events.find((e: any[]) => e[0] === "counter");
      if (!counter) continue;
      expect(
        nativeCrownAmount(row.fields.providedDamage, row.fields.crownPercent),
      ).toBe(0 - counter[1]);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(100);
  // Keep the product integral before division (100 * 0.56 exceeds 56 in JS).
  expect(nativeCrownAmount(100, -44)).toBe(56);
});

for (const version of [43, 44] as const)
  for (const team of ["blue", "red"] as const)
    for (const king of [false, true])
      for (const card of cards)
        it(`rules ${version}: ${team} ${card} live and forecast damage agree on ${king ? "King" : "Princess"}`, () => {
          const b = match(version);
          const { tower, point } = prepare(b, team, card, king);
          const amount =
            version === 44 ? amounts[card] : CARD_MAP[card].damage * 0.4;
          const planned = towerDamageForecast(
            tower,
            [],
            [],
            b.entities,
          ).withSpell(card, team, point);
          expect(planned.reduce((sum, p) => sum + p.damage, 0)).toBe(amount);
          expect(b.play(team, 0, point.x, point.y).ok).toBe(true);
          const released =
            card === "lightning"
              ? lightningDamageMap(b.entities, b.areas).get(tower.id)!
              : projectileDamagePackets(tower, b.projectiles, b.entities);
          expect(released.reduce((sum, p) => sum + p.damage, 0)).toBe(amount);
          const before = tower.hp;
          while (b.tick < 180 && tower.hp === before) b.step();
          expect(tower.hp).toBeCloseTo(before - amount, 10);
          expect(b.tick).toBe(released[0].step);
          expect(tower.nativeProjectileCrownDamage).toBe(
            version === 44 ? true : undefined,
          );
        });

for (const card of cards)
  it(`${card} AI recognizes the new integer lethal threshold and rejects one HP more`, () => {
    const b = match();
    const { tower } = prepare(b, "red", card, false);
    tower.hp = amounts[card];
    expect(damageSpellTarget(card, "red", b.entities)?.lethalTower).toBe(
      tower.id,
    );
    tower.hp++;
    expect(
      damageSpellTarget(card, "red", b.entities)?.lethalTower,
    ).toBeUndefined();
    const old = match(43);
    const victim = prepare(old, "red", card, false).tower;
    victim.hp = amounts[card];
    expect(
      damageSpellTarget(card, "red", old.entities)?.lethalTower,
    ).toBeUndefined();
  });

it("carries authoritative tower policy into guests and clears it on older-host replacement", () => {
  const host = match();
  const saved = structuredClone(snapshot(host));
  const view = perspective(saved, "red");
  expect(view.entities.every((e) => e.nativeProjectileCrownDamage)).toBe(true);
  const guest = match(43);
  applySnapshot(guest, saved, "red");
  expect(guest.entities).toEqual(view.entities);
  const tower = guest.entities.find((e) => e.team === "blue" && e.king)!;
  expect(
    towerDamageForecast(tower, [], [], guest.entities).withSpell(
      "fireball",
      "red",
      tower,
    )[0].damage,
  ).toBe(276);
  applySnapshot(guest, snapshot(match(43)), "red");
  expect(guest.entities.every((e) => !e.nativeProjectileCrownDamage)).toBe(
    true,
  );
  expect(snapshot(host)).toEqual(saved);
});

it("applies the same rule to mirrored Fireball casts", () => {
  const b = match();
  const { tower, point } = prepare(b, "blue", "fireball", false);
  expect(b.play("blue", 0, point.x, point.y).ok).toBe(true);
  b.players.blue.hand[0] = "mirror";
  b.players.blue.elixir = 10;
  expect(b.play("blue", 0, point.x, point.y).ok).toBe(true);
  for (let i = 0; i < 150; i++) b.step();
  expect(tower.hp).toBe(tower.maxHp - 552);
});

it("records and replays a complete new-rules spell match", () => {
  const b = new Battle({
    replay: { ...golden.cases[3].replay, version: 44 } as Replay,
  });
  while (!b.winner && b.tick < 12000) b.step();
  expect(b.winner).toBeTruthy();
  const replay = new Battle({ replay: b.exportReplay() });
  while (replay.tick < b.tick) replay.step();
  expect(replay.rulesVersion).toBe(44);
  expect(digest(replay)).toBe(digest(b));
});
