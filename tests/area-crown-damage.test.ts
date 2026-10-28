import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Battle, type Replay, type Team } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { nativeCrownAmount } from "../src/game/crown-damage";
import { projectileDamagePackets } from "../src/game/projectile-impacts";
import { towerDamageForecast } from "../src/game/king-damage";
import { createMatchFinisher } from "../src/game/match-finisher";
import { damageSpellTarget } from "../src/game/spell-targeting";
import { cardDetails } from "../src/ui/card-details";
import {
  applySnapshot,
  perspective,
  snapshot,
} from "../src/network/perspective";
import golden from "./fixtures/area-crown-rules44-golden.json";

function match(version: Replay["version"] = 45) {
  const b = new Battle({
    replay: {
      ...new Battle({ seed: 1511, ai: false }).exportReplay(),
      version,
    },
  });
  for (const e of b.entities) e.active = false;
  return b;
}
function prepare(b: Battle, team: Team, card: CardId, king: boolean) {
  b.players[team].hand[0] = card;
  b.players[team].elixir = 10;
  return b.entities.find((e) => e.team !== team && !!e.king === king)!;
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

it("retains four independently captured complete rules-44 worlds, actions, RNG and audio", () => {
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

it("binds Zap's source percentage and every executed area amount to the shared integer arithmetic", () => {
  const manifest = JSON.parse(
    readFileSync("reference/client/area-crown-damage-manifest.json", "utf8"),
  );
  for (const input of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(input.path)).digest("hex"),
    ).toBe(input.sha256);
  const trace = JSON.parse(readFileSync(manifest.inputs[0].path, "utf8"));
  let checked = 0;
  for (const row of [...trace.cases, ...trace.controls]) {
    const packet = row.pulse.events.find((e: any[]) => e[0] === "areaRequest");
    if (!packet) continue;
    expect(nativeCrownAmount(row.fields.damage, row.fields.percent)).toBe(
      packet[14],
    );
    checked++;
  }
  expect(checked).toBe(84);
});

for (const version of [44, 45] as const)
  for (const team of ["blue", "red"] as const)
    for (const king of [false, true])
      it(`rules ${version}: ${team} Zap live, released and planned damage agree on ${king ? "King" : "Princess"}`, () => {
        const b = match(version),
          tower = prepare(b, team, "zap", king);
        const amount = version === 45 ? 77 : 76.8;
        const proposed = towerDamageForecast(
          tower,
          [],
          [],
          b.entities,
        ).withSpell("zap", team, tower);
        expect(proposed[0].damage).toBeCloseTo(amount, 12);
        expect(b.play(team, 0, tower.x, tower.y).ok).toBe(true);
        const packets = projectileDamagePackets(
          tower,
          b.projectiles,
          b.entities,
        );
        expect(packets).toHaveLength(1);
        expect(packets[0].damage).toBeCloseTo(amount, 12);
        const before = tower.hp;
        while (tower.hp === before && b.tick < 20) b.step();
        expect(b.tick).toBe(packets[0].step);
        expect(tower.hp).toBeCloseTo(before - amount, 10);
        expect(tower.stun).toBeGreaterThan(0);
        expect(tower.nativeAreaCrownDamage).toBe(
          version === 45 ? true : undefined,
        );
      });

for (const team of ["blue", "red"] as const)
  for (const king of [false, true])
    it(`${team} AI recognizes Zap's integer lethal threshold for ${king ? "King" : "Princess"}`, () => {
      for (const version of [44, 45] as const) {
        const b = match(version),
          tower = prepare(b, team, "zap", king);
        tower.hp = 77;
        const finisher = createMatchFinisher(
          team,
          b.entities,
          [],
          [],
          { blue: 0, red: 0 },
          60,
          true,
        );
        expect(finisher.outcomeAt("zap", tower)?.winner).toBe(
          version === 45 ? team : undefined,
        );
        expect(damageSpellTarget("zap", team, b.entities)?.lethalTower).toBe(
          version === 45 ? tower.id : undefined,
        );
        tower.hp = 78;
        expect(
          damageSpellTarget("zap", team, b.entities)?.lethalTower,
        ).toBeUndefined();
      }
    });

for (const version of [44, 45] as const)
  for (const team of ["blue", "red"] as const)
    for (const king of [false, true])
      it(`rules ${version}: ${team} deployment Zap shares area rounding on a supplied nearby ${king ? "King" : "Princess"}`, () => {
        const b = match(version),
          tower = prepare(b, team, "electro-wizard", king);
        const before = tower.hp;
        expect(b.play(team, 0, 4, team === "blue" ? 22 : 10).ok).toBe(true);
        // Supply a nearby Crown victim after a legal deployment so its moved
        // position does not affect the native deployment bounds themselves.
        const wizard = b.entities.find((e) => e.card === "electro-wizard")!;
        tower.x = wizard.x;
        tower.y = wizard.y + (team === "blue" ? -2.75 : 2.75);
        while (tower.hp === before && b.tick < 60) b.step();
        expect(tower.hp).toBeCloseTo(before - (version === 45 ? 65 : 64.4), 10);
        expect(tower.stun).toBeGreaterThan(0);
      });

for (const team of ["blue", "red"] as const)
  it(`${team} Zap retains full troop and building damage`, () => {
    const b = match(),
      enemy = team === "blue" ? "red" : "blue";
    const victims = ["knight", "cannon"].map((card, i) => {
      (b as any).spawn(card, enemy, 8 + i, 12, false, 0);
      const body = b.entities.at(-1)!;
      body.active = false;
      body.lifetime = undefined;
      return body;
    });
    prepare(b, team, "zap", false);
    expect(b.play(team, 0, 8.5, 12).ok).toBe(true);
    for (let n = 0; n < 5; n++) b.step();
    for (const body of victims) {
      expect(body.hp).toBe(body.maxHp - 192);
      expect(body.stun).toBeGreaterThan(0);
    }
  });

for (const team of ["blue", "red"] as const)
  it(`${team} Mirror uses the resolved Zap's new area rounding`, () => {
    const b = match(),
      tower = prepare(b, team, "zap", false);
    expect(b.play(team, 0, tower.x, tower.y).ok).toBe(true);
    prepare(b, team, "mirror", false);
    expect(b.play(team, 0, tower.x, tower.y).ok).toBe(true);
    for (let i = 0; i < 20; i++) b.step();
    expect(tower.hp).toBe(tower.maxHp - 154);
  });

it("preserves authoritative area damage in guest rotation and clears it on old-host replacement", () => {
  const host = match(),
    saved = structuredClone(snapshot(host)),
    view = perspective(saved, "red");
  expect(view.entities.every((e) => e.nativeAreaCrownDamage)).toBe(true);
  const guest = match(44);
  applySnapshot(guest, saved, "red");
  const tower = guest.entities.find((e) => e.team === "blue" && e.king)!;
  expect(
    towerDamageForecast(tower, [], [], guest.entities).withSpell(
      "zap",
      "red",
      tower,
    )[0].damage,
  ).toBe(77);
  applySnapshot(guest, snapshot(match(44)), "red");
  const older = guest.entities.find((e) => e.team === "blue" && e.king)!;
  expect(guest.entities.every((e) => !e.nativeAreaCrownDamage)).toBe(true);
  expect(
    towerDamageForecast(older, [], [], guest.entities).withSpell(
      "zap",
      "red",
      older,
    )[0].damage,
  ).toBeCloseTo(76.8, 12);
  expect(snapshot(host)).toEqual(saved);
});

it("shows current Zap damage in the card panel", () => {
  const stats = Object.fromEntries(
    cardDetails("zap").stats.map((r) => [r.label, r.value]),
  );
  expect(stats).toMatchObject({
    Damage: "192",
    "Crown Tower damage": "77",
    Stun: "0.5 s",
  });
});

it("records and replays a complete rules-45 match with Zap and Electro Wizard", () => {
  const b = new Battle({
    replay: { ...golden.cases[3].replay, version: 45 } as Replay,
  });
  while (!b.winner && b.tick < 12000) b.step();
  expect(b.winner).toBeTruthy();
  expect(b.actions.some((a) => a.card === "zap")).toBe(true);
  expect(b.actions.some((a) => a.card === "electro-wizard")).toBe(true);
  const replay = new Battle({ replay: b.exportReplay() });
  while (replay.tick < b.tick) replay.step();
  expect(replay.rulesVersion).toBe(45);
  expect(digest(replay)).toBe(digest(b));
});
