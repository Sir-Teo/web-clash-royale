import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameAudio, battleMusicCue } from "../src/game/audio";
const instances: FakeAudio[] = [];
class FakeAudio {
  volume = 1;
  playbackRate = 1;
  loop = false;
  paused = true;
  currentTime = 0;
  preservesPitch = true;
  listeners = new Map<string, () => void>();
  play = vi.fn(() => { this.paused = false; return Promise.resolve(); });
  pause = vi.fn(() => { this.paused = true; });
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
  it("uses the archived battle, final-minute, final-30, and sudden-death tracks", () => {
    expect(battleMusicCue(0)).toEqual({ file: "battle", offset: 0 });
    expect(battleMusicCue(119).file).toBe("battle");
    expect(battleMusicCue(120)).toEqual({ file: "battle-last-minute", offset: 0 });
    expect(battleMusicCue(149).file).toBe("battle-last-minute");
    expect(battleMusicCue(150)).toEqual({ file: "battle-final-30", offset: 0 });
    expect(battleMusicCue(179).file).toBe("battle-final-30");
    expect(battleMusicCue(180)).toEqual({ file: "battle-sudden-death", offset: 0 });
    expect(battleMusicCue(230)).toEqual({ file: "battle-sudden-death", offset: 2 });
  });
  it("switches music with match time and resumes the correct phase after pause or seek", () => {
    const audio = new GameAudio();
    audio.musicEnabled = true;
    audio.startMusic(8);
    const main = instances.at(-1)!;
    expect(main.src).toContain("assets/audio/battle.ogg");
    expect(main.currentTime).toBe(8);
    expect(main.loop).toBe(true);
    audio.syncMusic(125, true);
    const minute = instances.at(-1)!;
    expect(main.pause).toHaveBeenCalledOnce();
    expect(minute.src).toContain("assets/audio/battle-last-minute.ogg");
    expect(minute.currentTime).toBe(5);
    audio.syncMusic(153, true);
    const final = instances.at(-1)!;
    expect(final.src).toContain("assets/audio/battle-final-30.ogg");
    expect(final.currentTime).toBe(3);
    audio.syncMusic(200, true);
    const sudden = instances.at(-1)!;
    expect(sudden.src).toContain("assets/audio/battle-sudden-death.ogg");
    expect(sudden.currentTime).toBe(20);
    audio.setRate(2);
    expect(sudden.playbackRate).toBe(2);
    audio.syncMusic(202, false);
    expect(sudden.paused).toBe(true);
    audio.startMusic(203);
    expect(instances.at(-1)).toBe(sudden);
    expect(sudden.currentTime).toBe(23);
    expect(sudden.paused).toBe(false);
    audio.setEnabled(false);
    expect(sudden.paused).toBe(false);
    audio.stopMusic();
    expect(sudden.paused).toBe(true);
  });
  it("keeps selected battle music on when sound effects are disabled", () => {
    const audio = new GameAudio();
    audio.setEnabled(false);
    audio.musicEnabled = true;
    audio.startMusic(125);
    const track = instances.at(-1)!;
    expect(track.src).toContain("battle-last-minute.ogg");
    expect(track.paused).toBe(false);
    audio.play("fireball_hit_01");
    expect(instances).toHaveLength(1);
    audio.syncMusic(160, true);
    expect(instances.at(-1)!.src).toContain("battle-final-30.ogg");
  });
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
