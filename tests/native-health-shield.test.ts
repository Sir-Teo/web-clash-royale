import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Battle, type Entity, type Team } from "../src/game/engine";
import type { CardId } from "../src/game/cards";

interface Episode {
  kind: string;
  targetSource: string;
  fields: { hp: number; shield: number };
  frames: {
    amount: number;
    hpBefore: number;
    shieldBefore: number;
    hpAfter: number;
    shieldAfter: number;
    events: unknown[][];
  }[];
}
const trace = JSON.parse(
  readFileSync("reference/client/health-shield-native-trace.json", "utf8"),
);
const aliases: Record<string, CardId> = {
  Knight: "knight",
  DarkPrince: "dark-prince",
  SkeletonWarrior: "guards",
  Cannon: "cannon",
};

it("pins native health/shield evidence to the executed binary and source inputs", () => {
  expect(trace.sha256).toBe(
    "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746",
  );
  for (const input of trace.inputs)
    expect(
      createHash("sha256").update(readFileSync(input.path)).digest("hex"),
    ).toBe(input.sha256);
  expect(trace.cases).toHaveLength(228);
  expect(trace.profiles).toHaveLength(6);
});

for (const source of [
  "Knight",
  "DarkPrince",
  "SkeletonWarrior",
  "Cannon",
  "PrincessTower",
  "KingTower",
])
  for (const team of ["blue", "red"] as const)
    it(`${team} ${source} matches native HP, shield absorption and loss notifications for every captured projectile amount`, () => {
      const episodes = (trace.cases as Episode[]).filter(
        (row) => row.targetSource === source,
      );
      expect(episodes).toHaveLength(38);
      for (const row of episodes) compare(row, team);
    });

function compare(row: Episode, team: Team) {
  const b = new Battle({ seed: 9091, ai: false });
  let body: Entity;
  if (
    row.targetSource === "PrincessTower" ||
    row.targetSource === "KingTower"
  ) {
    body = b.entities.find(
      (e) => e.team === team && !!e.king === (row.targetSource === "KingTower"),
    )!;
  } else {
    const card = aliases[row.targetSource];
    (b as any).spawn(card, team, 4, team === "blue" ? 22 : 10, false, 0);
    body = b.entities.find((e) => e.team === team && e.card === card)!;
  }
  // Native records use archived base values; isolate the common reducer from
  // this roster's level normalization and native table projection.
  Object.assign(body, {
    hp: row.fields.hp,
    maxHp: row.fields.hp,
    shield: row.fields.shield,
    maxShield: row.fields.shield,
  });
  const losses = () =>
    b.audioEvents.filter(
      (e) => e.phase === "shield-lost" && e.actor === body.id,
    ).length;
  for (const frame of row.frames) {
    expect(body.hp).toBe(frame.hpBefore);
    expect(body.shield).toBe(frame.shieldBefore);
    const before = losses();
    (b as any).hurt(body, frame.amount);
    expect(body.hp).toBe(frame.hpAfter);
    expect(body.shield).toBe(frame.shieldAfter);
    expect(losses() - before).toBe(
      frame.events.filter((e) => e[0] === "shieldLost").length,
    );
  }
}

it("matches native shield-break boundaries, repeated hits and fatal HP clamping", () => {
  const controls = (trace.controls as Episode[]).filter((row) =>
    ["boundary", "sequence"].includes(row.kind),
  );
  expect(controls).toHaveLength(45);
  for (const row of controls)
    for (const team of ["blue", "red"] as const) compare(row, team);
});
