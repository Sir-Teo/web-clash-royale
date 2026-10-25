import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BattleEvent, Entity } from "../src/game/engine";
import { banditAfterimages } from "../src/render/bandit-trail";
import source from "../src/render/bandit-trail-data.json";

const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const start: BattleEvent = { id: 7, time: 1, type: "spell", team: "blue",
  card: "bandit", value: 42, x: 4, y: 21, effect: "dash-start:bandit" };

describe("native Bandit directional afterimages", () => {
  it("pins the eight source model exports and 25-ms emitter spacing", () => {
    const manifest = JSON.parse(readFileSync("reference/client/bandit-trail-manifest.json", "utf8"));
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(source).toMatchObject({ source: "assassin_dashing", count: 8,
      interval: 0.025, life: [0.3, 0.4], fadeOut: 0.5 });
    expect(source.blueExports).toEqual(Array.from({ length: 9 }, (_, i) => `bandit_dash1_${i + 1}`));
    expect(source.redExports).toEqual(Array.from({ length: 9 }, (_, i) => `bandit_red_dash1_${i + 1}`));
  });

  it("reconstructs the same directional trail from a late or seeked snapshot", () => {
    const bandit = { id: 42, card: "bandit", team: "blue", x: 4, y: 20,
      dash: { target: 9, elapsed: 0.12, remaining: 0.4 } } as Entity;
    const first = banditAfterimages([start], [bandit], 1.12);
    expect(first.length).toBeGreaterThan(1);
    expect(first[0]).toMatchObject({ key: "7-0", x: 4, y: 21,
      team: "blue", direction: 1, flip: false });
    expect(first.every((image) => image.opacity > 0 && image.opacity <= 0.7)).toBe(true);
    expect(banditAfterimages([start], [bandit], 1.12)).toEqual(first);
    const end: BattleEvent = { ...start, id: 8, time: 1.25, x: 4, y: 18.9,
      effect: "dash-end:bandit" };
    const completed = banditAfterimages([start, end], [], 1.28);
    expect(completed.length).toBeGreaterThan(0);
    expect(completed.some((image) => image.y < 21)).toBe(true);
    expect(banditAfterimages([start, end], [], 1.7)).toEqual([]);
  });
});
