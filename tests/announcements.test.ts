import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  announcementAt,
  battleClock,
  timingCue,
  textureMatrix,
} from "../src/ui/announcements";
import { Battle } from "../src/game/engine";
import { parseSC } from "../scripts/lib/sc.mjs";
const native = JSON.parse(
  readFileSync("public/assets/ui/announcements.json", "utf8"),
);
const timing = (time: number) => ({
  time,
  mode: "classic" as const,
  winner: null,
});
describe("native battle announcements", () => {
  it("retains source text styles, timelines, font and output hashes", () => {
    const manifest = JSON.parse(
      readFileSync("public/assets/ui/manifest.json", "utf8"),
    );
    const digest = (path: string) =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    for (const source of manifest.sources)
      if (source.path) expect(digest(source.path)).toBe(source.sha256);
    for (const file of manifest.files)
      expect(digest(`public/assets/ui/${file.file}`)).toBe(file.sha256);
    const source = parseSC(readFileSync("reference/sc/ui.bin"));
    expect(
      Object.values(native.clips).map((clip: any) => clip.frames.length),
    ).toEqual([357, 80, 148, 71, 139]);
    expect(Object.keys(native.texts)).toHaveLength(13);
    for (const [id, style] of Object.entries(native.texts)) {
      expect(style).toEqual(source.texts[id]);
      expect((style as any).font).toBe("Supercell-Magic");
    }
    expect(
      readFileSync("public/assets/ui/supercell-magic.ttf").readUInt32BE(0),
    ).toBe(0x10000);
    for (const [name, clip] of Object.entries(native.clips) as [
      string,
      any,
    ][]) {
      expect(clip.fps).toBe(30);
      expect(clip.frames).toHaveLength(
        source.clips[source.names[name]].frames.length,
      );
      for (const frame of clip.frames)
        for (const part of frame) {
          expect(part.matrix.every(Number.isFinite)).toBe(true);
          expect(
            part.color.every(
              (n: number) => Number.isFinite(n) && n >= 0 && n <= 255,
            ),
          ).toBe(true);
          if (part.text !== undefined) {
            expect(native.texts[part.text]).toBeDefined();
            expect(native.translations[part.binding]).toBeTypeOf("string");
          } else expect(native.shapes[part.shape]).toBeDefined();
        }
    }
    expect(Object.keys(native.audio)).toHaveLength(13);
    for (const cue of Object.values(native.audio) as any[])
      expect(
        readFileSync(`public/assets/audio/${cue.file}.ogg`)
          .subarray(0, 4)
          .toString(),
      ).toBe("OggS");
  });

  it("maps the cropped native elixir texture back onto its authored polygon", () => {
    const shape = native.shapes[683],
      m = textureMatrix(shape);
    for (let i = 0; i < shape.xy.length; i++) {
      const [u, v] = shape.uv[i],
        [x, y] = shape.xy[i];
      expect(Math.abs(m[0] * u + m[2] * v + m[4] - x)).toBeLessThan(0.04);
      expect(Math.abs(m[1] * u + m[3] * v + m[5] - y)).toBeLessThan(0.04);
    }
  });

  it("uses the complete countdown and advances digits on the displayed second", () => {
    expect(announcementAt(timing(167.99))).toBeNull();
    expect(announcementAt(timing(168.5))?.frame).toBe(15);
    for (let number = 10; number >= 1; number--) {
      for (const fraction of [0, 0.5, 29 / 30]) {
        const selected = announcementAt(timing(180 - number + fraction))!;
        const part = native.clips[selected.name].frames[selected.frame][0];
        expect(native.translations[part.binding]).toBe(String(number));
        expect(announcementAt(timing(300 - number + fraction))).toEqual(
          selected,
        );
      }
    }
    expect(announcementAt(timing(180))?.name).toBe("print_extra_time");
    expect(announcementAt({ ...timing(300), winner: "draw" })).toBeNull();
  });

  it("adapts source overtime and elixir wording to the match's rules", () => {
    expect(announcementAt(timing(120.5))?.name).toBe("print_60secondsLeft");
    expect(announcementAt({ ...timing(120.5), mode: "double" })?.name).toBe(
      "print_60secondsLeft_overtime",
    );
    expect(announcementAt({ ...timing(123), mode: "double" })).toBeNull();
    expect(announcementAt(timing(150.5))?.name).toBe("print_30secondsLeft");
    expect(announcementAt(timing(180.5))?.overrides.TID_60S).toBe("+120s");
    expect(announcementAt(timing(243.2))?.overrides.TID_X2_ELIXIR).toBe(
      "X3 Elixir",
    );
    expect(announcementAt(timing(270.5))?.name).toBe("print_30secondsLeft");
  });

  it("does not show overtime or reset the clock when regulation already has a winner", () => {
    const b = new Battle({ ai: false, seed: 1 });
    b.players.blue.crowns = 1;
    b.tick = 5399;
    b.step();
    expect(b.winner).toBe("blue");
    expect(battleClock(b)).toEqual({ overtime: false, remaining: 0 });
    expect(announcementAt(b)).toBeNull();
    expect(timingCue(179.99, b)).toBeNull();
    const tied = new Battle({ ai: false, seed: 1 });
    tied.tick = 5399;
    tied.step();
    expect(battleClock(tied)).toEqual({ overtime: true, remaining: 120 });
    expect(announcementAt(tied)?.name).toBe("print_extra_time");
  });

  it("emits one voice at a crossed second, stays silent while paused and ignores seeks", () => {
    expect(timingCue(169.99, timing(170))).toBe("Countdown_10");
    expect(timingCue(170, timing(170))).toBeNull();
    expect(timingCue(170.9, timing(171.1))).toBe("Countdown_9");
    expect(timingCue(179.99, timing(180))).toBe("sound_extra_time_jingle");
    expect(timingCue(289.99, timing(290))).toBe("Countdown_10");
    expect(timingCue(null, timing(175))).toBeNull();
    expect(timingCue(170, timing(175))).toBeNull();
    expect(timingCue(179, timing(175))).toBeNull();
  });
});
