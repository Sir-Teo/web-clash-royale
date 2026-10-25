import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { Battle, type Entity, type Point, type Team } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import golden from "./fixtures/movement-step-golden.json";

it("preserves 184,320 original movement frames across all 48 mobile playable-card profiles", () => {
  expect(golden.sourceCommit).toBe("93e3f47");
  expect(golden.frames).toBe(120);
  expect(golden.cards).toHaveLength(48);
  expect(golden.cases).toHaveLength(1536);
  const battle = new Battle({ seed: 12, ai: false });
  const towers = [...battle.entities];
  const blueprints = new Map<string, Entity>();
  const api = battle as unknown as {
    spawn: (card: CardId, team: Team, x: number, y: number) => void;
    moveToward: (body: Entity, target: Entity) => void;
  };
  for (const row of golden.cases) {
    const team = row.team as Team;
    const mirror = (p: Point) =>
      team === "red" ? p : { x: 18 - p.x, y: 32 - p.y };
    const route = golden.routes[row.route],
      from = mirror(route.from),
      to = mirror(route.to);
    const key = `${row.card}:${team}`;
    let blueprint = blueprints.get(key);
    if (!blueprint) {
      battle.entities = [...towers];
      api.spawn(row.card as CardId, team, from.x, from.y);
      blueprint = battle.entities.at(-1)!;
      blueprints.set(key, blueprint);
    }
    const body = { ...blueprint };
    Object.assign(body, {
      x: from.x,
      y: from.y,
      move: row.modifier === "charged" ? 3.2 : 0,
      rage: ["rage", "charged"].includes(row.modifier)
        ? { remaining: 10 }
        : undefined,
      slow: ["slow", "charged"].includes(row.modifier)
        ? { remaining: 10 }
        : undefined,
    });
    const target = {
      ...towers.find((e) => e.team !== team && e.king)!,
      ...to,
    };
    const trace: number[][] = [];
    for (let frame = 0; frame < golden.frames; frame++) {
      api.moveToward(body, target);
      trace.push(
        [body.x, body.y, body.move].map((v) => +v.toFixed(golden.precision)),
      );
    }
    const digest = createHash("sha256")
      .update(JSON.stringify(trace))
      .digest("hex");
    expect(
      digest,
      `${row.card} ${row.team} route ${row.route} ${row.modifier}`,
    ).toBe(row.digest);
  }
});
