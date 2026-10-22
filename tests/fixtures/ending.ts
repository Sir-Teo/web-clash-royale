import "../../src/ui/native-font.css";
import "../../src/ui/ending.css";
import { NativeEnding } from "../../src/ui/ending";
const style = document.createElement("style");
style.textContent = `*{box-sizing:border-box}body{margin:0;background:#101d30;color:#e2edf9;font:14px system-ui}main{max-width:940px;padding:24px;margin:auto}h1{font-size:24px}.controls{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px}label{display:flex;gap:7px;align-items:center}input,button{min-height:44px;padding:8px;border-radius:6px;background:#223c57;color:white;border:1px solid #64819d}input[type=number]{width:65px}input:not([type]){width:150px}.stage{position:relative;width:min(100%,680px);height:500px;margin:auto;background:#6e984d url('/assets/scenery/battlefield.png') center/cover;border-radius:14px;overflow:hidden}.hidden{display:none!important}@media(max-width:500px){main{padding:12px}.stage{height:430px}.controls{gap:8px}}`;
document.head.append(style);
const input = (id: string) =>
  document.querySelector<HTMLInputElement>(`#${id}`)!;
const ending = new NativeEnding(document.querySelector("#ending")!);
function render() {
  const clamp = (v: number) => Math.max(0, Math.min(3, v));
  ending.start(
    {
      names: { blue: input("player").value, red: input("enemy").value },
      crowns: {
        blue: clamp(+input("blue").value),
        red: clamp(+input("red").value),
      },
      earned: { blue: clamp(+input("earned").value), red: 0 },
      winner: "blue",
    },
    input("hold").checked,
  );
  ending.clock.time = +input("time").value;
  ending.update(0);
}
document
  .querySelectorAll("input")
  .forEach((e) => e.addEventListener("input", render));
document.querySelector("#step")!.addEventListener("click", () => {
  input("time").value = String(+input("time").value + 0.1);
  render();
});
document.querySelector("#reset")!.addEventListener("click", () => {
  input("time").value = "0";
  input("hold").checked = false;
  render();
});
const wait = setInterval(() => {
  if (ending.loaded) {
    clearInterval(wait);
    document.querySelector("#status")!.textContent =
      `${ending.loaded} native ending clips · 402 source frames`;
    render();
  }
}, 50);
