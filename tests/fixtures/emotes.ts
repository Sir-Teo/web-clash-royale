import { NativeEmotes } from "../../src/ui/emotes";
import { GameAudio } from "../../src/game/audio";
import type { ReactionKind } from "../../src/game/emotes";
const style = document.createElement("style");
style.textContent = `*{box-sizing:border-box}body{margin:0;background:#13233d;color:#eef5ff;font:14px system-ui}main{max-width:800px;padding:16px;margin:auto}h1{font-size:24px}.controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:16px}.controls label{display:flex;align-items:center;gap:6px}button,input,select{min-height:44px;border-radius:6px;border:1px solid #7395af;background:#243e58;color:white;padding:7px}input[type=number]{width:80px}.stage{position:relative;width:min(100%,480px);height:520px;margin:auto;border-radius:12px;background:#6e984d url('/assets/scenery/battlefield.png') center/cover;overflow:hidden}.battle-tools{position:absolute;bottom:8px;right:8px;z-index:17}.battle-tools button{width:44px;height:44px;cursor:pointer}.hidden{display:none!important}output{display:block;padding:12px}@media(orientation:landscape)and(max-height:540px){main{padding:8px}.stage{height:230px;width:100%}.controls{margin-bottom:8px}h1{margin:4px 0;font-size:18px}}`;
document.head.append(style);
const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const emotes = new NativeEmotes($("#emotes"), $("#toggle"));
const audio = new GameAudio();
audio.enabled = false;
emotes.onCue = (name, volume) => {
  $("#cue").textContent = name;
  return audio.play(name, volume);
};
emotes.onSend = (kind) => emotes.show("blue", kind);
$("#blue-show").onclick = () =>
  emotes.show("blue", $<HTMLSelectElement>("#kind").value as ReactionKind);
$("#red-show").onclick = () =>
  emotes.show("red", $<HTMLSelectElement>("#kind").value as ReactionKind);
function seek() {
  for (const item of Object.values(emotes.clock.active))
    item.time = +$<HTMLInputElement>("#time").value;
  emotes.update(0, true);
}
$("#time").oninput = seek;
$("#step").onclick = () => {
  $<HTMLInputElement>("#time").value = String(
    +$<HTMLInputElement>("#time").value + 1 / 60,
  );
  seek();
};
$("#reset").onclick = () => {
  emotes.reset();
  $<HTMLInputElement>("#time").value = "0";
};
$("#sound").onchange = () =>
  audio.setEnabled($<HTMLInputElement>("#sound").checked);
let last = performance.now();
function frame(now: number) {
  emotes.update(
    $<HTMLInputElement>("#playing").checked
      ? Math.min(0.1, (now - last) / 1000)
      : 0,
    true,
  );
  last = now;
  if (emotes.loaded)
    $("#status").textContent =
      `${emotes.loaded} native clips · 744 source frames · 16 voices · 6 phrases`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
