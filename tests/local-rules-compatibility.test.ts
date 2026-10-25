import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Battle, type Replay } from "../src/game/engine";
import { snapshot } from "../src/network/perspective";
import fixture from "./fixtures/local-rules-v5.json";

const hash = (value: unknown) => createHash("sha256")
  .update(JSON.stringify(value)).digest("hex");

describe("local version 5 replay compatibility", () => {
  it("preserves snapshots, audio and the ending captured with the independent original engine", () => {
    expect(fixture.replay.actions.some((action) => action.card === "rage")).toBe(true);
    expect(fixture.replay.actions.some((action) => action.card === "rocket")).toBe(true);
    const battle = new Battle({ replay: { ...fixture.replay, rulesFamily: "local" } as Replay });
    for (const point of fixture.checkpoints) {
      while (battle.tick < point.tick) battle.step();
      expect(hash(snapshot(battle)), `snapshot at ${point.tick}`).toBe(point.snapshot);
      expect(hash(battle.audioEvents), `audio at ${point.tick}`).toBe(point.audio);
    }
    expect(battle.winner).toBe(fixture.winner);
    expect(battle.exportReplay()).toMatchObject({ version: 5, rulesFamily: "local" });
  });
});
