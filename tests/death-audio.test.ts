import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { csvGroups } from "../scripts/lib/csv.mjs";
import { deathAudioPlan, NativeDeathAudio } from "../src/game/death-audio";
import definitions from "../src/game/death-audio-data.json";
import type { BattleEvent } from "../src/game/engine";
import { Battle } from "../src/game/engine";

const event = (card: BattleEvent["card"] = "wizard", id = 1): BattleEvent => ({
  id,
  card,
  type: "death",
  time: 10,
  team: "blue",
  x: 4,
  y: 21,
});
const harness = () => {
  const audio = { enabled: true, play: vi.fn() };
  return { audio, cues: new NativeDeathAudio(audio) };
};

describe("retained native death audio", () => {
  it("verifies pinned audio and source-table hashes and preserves every imported sound field", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/death-audio-manifest.json", "utf8"),
    );
    expect(manifest.audioFiles).toHaveLength(7);
    for (const file of [
      ...manifest.sources,
      ...manifest.audioFiles,
      manifest.output,
    ])
      expect(
        createHash("sha256").update(readFileSync(file.path)).digest("hex"),
      ).toBe(file.sha256);
    const source = csvGroups(
      readFileSync("reference/client/sounds.csv", "utf8"),
    );
    expect(Object.keys(definitions.effects)).toHaveLength(38);
    expect(Object.keys(definitions.sounds)).toHaveLength(33);
    for (const [name, sound] of Object.entries(definitions.sounds)) {
      const row = source[name][0];
      expect(sound.sourceFiles.join(",")).toBe(row.FileNames);
      expect(sound.volume).toEqual([
        Number(row.MinVolume) / 100,
        Number(row.MaxVolume) / 100,
      ]);
      expect(sound.pitch).toEqual([
        Number(row.MinPitch) / 100,
        Number(row.MaxPitch) / 100,
      ]);
      expect(sound.startDelay).toEqual([
        Number(row.StartDelayMinMs) / 1000,
        Number(row.StartDelayMaxMs) / 1000,
      ]);
      expect(sound.maximum).toBe(Number(row.MaximumByType));
      expect(sound.priority).toBe(Number(row.Priority));
      expect(sound.padding).toBe(Number(row.PadEmpyToEndMs) / 1000);
    }
  });
  it("retains nested and enemy-specific cues without inventing silent voices", () => {
    const groups = (effect: string, team: "blue" | "red" = "blue") =>
      deathAudioPlan(effect, 42, team).map((c) => c.group);
    expect(groups("knight")).toEqual([
      "sound_knight_die",
      "sound_generic_death",
    ]);
    expect(groups("skeleton-army")).toEqual([
      "sound_bat_die",
      "sound_skeleton_die",
    ]);
    expect(groups("mini-pekka", "blue")).toEqual([
      "sound_minipekka_die",
      "sound_generic_death",
    ]);
    expect(groups("mini-pekka", "red")).toEqual([
      "sound_pekka_die",
      "sound_generic_death",
    ]);
    expect(groups("musketeer")).toEqual(["sound_generic_death"]);
    expect(groups("prince")).toEqual(["sound_generic_death"]);
    expect(groups("cannon")).toEqual(["sound_generic_death", "Boulder impact"]);
    expect(deathAudioPlan("balloon", 42)[0].file).toBe("building_destroyed_05");
    for (const effect of ["king", "tower", "fireball", "toString"])
      expect(deathAudioPlan(effect, 42)).toEqual([]);
  });
  it("makes cosmetic variation deterministic and keeps the archived delay/gain/pitch ranges", () => {
    const first = deathAudioPlan("wizard", 12);
    expect(deathAudioPlan("wizard", 12)).toEqual(first);
    expect(deathAudioPlan("wizard", 13)).not.toEqual(first);
    for (let seed = 0; seed < 100; seed++) {
      const [generic, delayed] = deathAudioPlan("wizard", seed);
      expect(generic.volume).toBeGreaterThanOrEqual(0.35 * 0.35);
      expect(generic.volume).toBeLessThanOrEqual(0.45 * 0.35);
      expect(generic.pitch).toBeGreaterThanOrEqual(0.95);
      expect(generic.pitch).toBeLessThanOrEqual(1.04);
      expect(delayed.file).toBe("dummy_01");
      expect(delayed.delay).toBeGreaterThanOrEqual(5);
      expect(delayed.delay).toBeLessThanOrEqual(6);
      expect(delayed.volume).toBeCloseTo(0.0035);
    }
  });
  it("runs delayed cues on match time and holds them while paused", () => {
    const { audio, cues } = harness();
    cues.queue(event(), 12, 10);
    const delayed = deathAudioPlan("wizard", 12 ^ 1)[1];
    cues.update(10);
    expect(audio.play).toHaveBeenCalledTimes(1);
    cues.update(14);
    cues.update(10 + delayed.delay, true);
    expect(audio.play).toHaveBeenCalledTimes(1);
    cues.update(10 + delayed.delay);
    expect(audio.play).toHaveBeenLastCalledWith("dummy_01", delayed.volume, {
      pitch: 1,
      group: delayed.group,
      maximum: 1,
    });
    cues.update(16);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });
  it("discards pending cues on reset and mute and ignores stale network catch-up", () => {
    const { audio, cues } = harness();
    cues.queue(event(), 12, 10);
    cues.reset();
    cues.update(16);
    expect(audio.play).not.toHaveBeenCalled();
    cues.queue(event(), 12, 10);
    audio.enabled = false;
    cues.update(10, true);
    audio.enabled = true;
    cues.update(16);
    expect(audio.play).not.toHaveBeenCalled();
    cues.queue(event(), 12, 11);
    cues.update(16);
    expect(audio.play).not.toHaveBeenCalled();
    cues.queue(event("knight"), 12, 10);
    cues.update(11);
    expect(audio.play).not.toHaveBeenCalled();
  });
  it("consumes real engine deaths without advancing the simulation random state", () => {
    const { audio, cues } = harness();
    const battle = new Battle({ seed: 7, ai: false });
    battle.players.blue.hand[0] = "knight";
    battle.play("blue", 0, 4, 21);
    battle.entities.find((e) => e.card === "knight")!.hp = 1;
    battle.players.red.hand[0] = "zap";
    battle.play("red", 0, 4, 21);
    for (let tick = 0; tick < 10; tick++) battle.step();
    const before = JSON.stringify(battle);
    const deaths = battle.events.filter((e) => e.type === "death");
    expect(deaths).toHaveLength(1);
    for (const death of deaths) cues.queue(death, battle.seed, battle.time);
    cues.update(battle.time);
    expect(audio.play.mock.calls.map((call) => call[0])).toEqual([
      "knight_death_01",
      "npc_die_04",
    ]);
    expect(JSON.stringify(battle)).toBe(before);
  });
});
