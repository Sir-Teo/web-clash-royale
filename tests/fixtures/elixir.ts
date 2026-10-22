import "../../src/ui/elixir.css";
import { NativeElixir, elixirMarkup } from "../../src/ui/elixir";
const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
$("#preview").innerHTML = elixirMarkup;
const hud = new NativeElixir($("#elixir-hud"));
let time = 0,
  value = 5,
  playing = false,
  last = performance.now();
const rate = () => Number($<HTMLSelectElement>("#rate").value);
const cost = () => Number($<HTMLSelectElement>("#cost").value);
function reset() {
  time = 0;
  value = Number($<HTMLInputElement>("#amount").value);
  hud.reset(time, value, rate());
}
$<HTMLInputElement>("#amount").addEventListener("input", reset);
$("#play").onclick = () => {
  playing = !playing;
  $("#play").textContent = playing ? "Pause" : "Play";
};
function advance(delta: number) {
  time += delta;
  value = Math.min(10, value + (delta * rate()) / 2.8);
}
$("#step").onclick = () => advance(1 / 30);
$("#spend").onclick = () => {
  if (cost() && value >= cost()) {
    value -= cost();
    hud.spend(cost(), time, value);
  }
};
$("#reset").onclick = () => {
  $<HTMLInputElement>("#amount").value = "5";
  reset();
};
function render(now: number) {
  if (playing) advance(Math.min(0.1, (now - last) / 1000));
  last = now;
  hud.update(time, value, rate(), cost() || null);
  $("#status").textContent =
    `${hud.loaded} native clips · ${value.toFixed(2)} elixir · ${time.toFixed(2)}s · ${hud.feedback.spends.length} spends`;
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
