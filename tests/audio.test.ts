import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameAudio } from "../src/game/audio";
const instances: FakeAudio[] = [];
class FakeAudio {
  volume = 1;
  playbackRate = 1;
  loop = false;
  preservesPitch = true;
  listeners = new Map<string, () => void>();
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  constructor(readonly src: string) {
    instances.push(this);
  }
  cloneNode() {
    return new FakeAudio(this.src);
  }
  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, listener);
  }
}
beforeEach(() => {
  instances.length = 0;
  vi.stubGlobal("Audio", FakeAudio);
});
afterEach(() => vi.unstubAllGlobals());
describe("battle cue audio", () => {
  it("can stop an emote voice without silencing an active combat cue", () => {
    const audio = new GameAudio();
    audio.play("fireball_hit_01");
    const combat = instances.at(-1)!;
    const stop = audio.play("king_laughter_01");
    const voice = instances.at(-1)!;
    stop!();
    expect(voice.pause).toHaveBeenCalledOnce();
    expect(combat.pause).not.toHaveBeenCalled();
    audio.stopEffects();
    expect(combat.pause).toHaveBeenCalledOnce();
    expect(voice.pause).toHaveBeenCalledOnce();
  });
  it("follows replay speed and stops all active effects on pause or mute", () => {
    const audio = new GameAudio();
    audio.play("10_cd_02", 0.3);
    const ten = instances.at(-1)!;
    expect(ten.volume).toBe(0.3);
    audio.setRate(4);
    expect(ten.playbackRate).toBe(4);
    audio.play("9_cd_02");
    const nine = instances.at(-1)!;
    expect(nine.playbackRate).toBe(4);
    audio.stopEffects();
    expect(ten.pause).toHaveBeenCalledOnce();
    expect(nine.pause).toHaveBeenCalledOnce();
    audio.play("extratime_jingle_02");
    const overtime = instances.at(-1)!;
    audio.setEnabled(false);
    expect(overtime.pause).toHaveBeenCalledOnce();
    const count = instances.length;
    audio.play("8_cd_02");
    expect(instances).toHaveLength(count);
  });
  it("releases ended sounds instead of retaining them for later stops", () => {
    const audio = new GameAudio();
    audio.play("1_cd_02");
    const one = instances.at(-1)!;
    one.listeners.get("ended")!();
    audio.stopEffects();
    expect(one.pause).not.toHaveBeenCalled();
  });
  it("limits native sound groups, releases failed voices and preserves source pitch at replay speed", () => {
    const audio = new GameAudio();
    const options = { group: "generic death", maximum: 3, pitch: 0.97 };
    for (let i = 0; i < 60; i++) audio.play("npc_die_04", 0.14, options);
    const voices = instances.filter((a) => a.play.mock.calls.length);
    expect(voices).toHaveLength(3);
    expect(
      voices.every((a) => !a.preservesPitch && a.playbackRate === 0.97),
    ).toBe(true);
    audio.setRate(4);
    expect(voices.every((a) => a.playbackRate === 3.88)).toBe(true);
    voices[0].listeners.get("error")!();
    audio.play("npc_die_04", 0.14, options);
    expect(instances.at(-1)!.playbackRate).toBe(3.88);
    expect(instances.filter((a) => a.play.mock.calls.length)).toHaveLength(4);
    audio.stopEffects();
    expect(voices[0].pause).not.toHaveBeenCalled();
    audio.play("npc_die_04", 0.14, options);
    expect(instances.filter((a) => a.play.mock.calls.length)).toHaveLength(5);
  });
  it("uses source groups independently when they share a file", () => {
    const audio = new GameAudio();
    audio.play("npc_die_02", 0.01, { group: "bat", maximum: 1 });
    audio.play("npc_die_02", 0.01, { group: "skeleton", maximum: 1 });
    audio.play("npc_die_02", 0.01, { group: "bat", maximum: 1 });
    expect(instances.filter((a) => a.play.mock.calls.length)).toHaveLength(2);
  });
});
