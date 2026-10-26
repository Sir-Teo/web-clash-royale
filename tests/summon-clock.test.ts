import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  advanceSummonClock,
  summonCycle,
  summonProfile,
  type SummonProfile,
} from "../src/game/summon-clock";
import trace from "../reference/client/spawn-clock-native-trace.json";

it("pins the source tables and native capture used by summoner profiles", () => {
  const manifest = JSON.parse(
    readFileSync("reference/client/summon-clock-manifest.json", "utf8"),
  );
  for (const entry of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(entry.path)).digest("hex"),
    ).toBe(entry.sha256);
  expect(trace.sha256).toBe(
    "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746",
  );
  expect(summonProfile("knight")).toBeUndefined();
  expect(summonCycle(summonProfile("witch")!)).toBe(7.5);
});

describe.each(trace.cases)(
  "captured native summoner clock: $name",
  (sample) => {
    it("matches every event and sampled counter over 720 native updates", () => {
      const profile: SummonProfile = {
        source: "Witch",
        child: "skeletons",
        start: Math.max(0, sample.startMs) / 1000,
        interval: sample.intervalMs / 1000,
        count: sample.count,
        pause: sample.pauseMs / 1000,
      };
      if (!sample.name.startsWith("witch-"))
        expect(summonProfile(sample.name)).toMatchObject({
          start: profile.start,
          interval: profile.interval,
          count: profile.count,
          pause: profile.pause,
        });
      const clock = { spawnTimer: profile.start, spawnIndex: 0 };
      expect(clock.spawnTimer * 1000).toBe(sample.initialRemaining);
      const events: {
        tick: number;
        counts: number[];
        remaining: number;
        index: number;
      }[] = [];
      for (let tick = 1; tick <= trace.steps; tick++) {
        const spawn = advanceSummonClock(clock, profile, trace.stepMs / 1000);
        if (spawn)
          events.push({
            tick,
            counts: [spawn.count],
            remaining: Math.round(clock.spawnTimer * 1000),
            index: clock.spawnIndex,
          });
        const checkpoint = sample.checkpoints.find((c) => c.tick === tick);
        if (checkpoint) {
          expect(clock.spawnTimer * 1000).toBeCloseTo(checkpoint.remaining, 7);
          expect(clock.spawnIndex).toBe(checkpoint.index);
        }
      }
      expect(events).toEqual(sample.events);
    });
  },
);
