import "../../src/ui/announcements.css";
import {
  healthView,
  healthBox,
  healthFrame,
  type HealthData,
} from "../../src/ui/health-data";
import { renderNativeFrame } from "../../src/ui/native";
const data: HealthData = await fetch("/assets/ui/health/health.json").then(
  (r) => r.json(),
);
await document.fonts.load('18px "Supercell Magic"');
const gallery = document.querySelector<HTMLElement>("#gallery")!;
const names = Object.keys(data.clips).filter((n) => !n.endsWith("_bar"));
gallery.innerHTML = names
  .map(
    (n) =>
      `<section class="sample"><h3>${n.replace("hp_", "").replace("_tower_withNumber", " Princess").replace("_wizard", " King").replace("_", " ")}</h3><div class="art" data-name="${n}"></div></section>`,
  )
  .join("");
function draw() {
  const ratio =
      Number((document.querySelector("#health") as HTMLInputElement).value) /
      100,
    frame = Number(
      (document.querySelector("#frame") as HTMLInputElement).value,
    );
  for (const [i, name] of names.entries()) {
    const host = gallery.querySelector<HTMLElement>(`[data-name="${name}"]`)!;
    renderNativeFrame(
      host,
      healthView(data, name, ratio, name.endsWith("wizard") ? frame : 0),
      "display",
      0,
      {
        "hpNumber/txt": String(
          Math.ceil(ratio * (name.endsWith("wizard") ? 4824 : 3052)),
        ),
        level: "11",
      },
      {
        path: "/assets/ui/health",
        viewBox: healthBox(name),
        prefix: `health-fixture-${i}`,
      },
    );
  }
  document.querySelector("#status")!.textContent =
    `${names.length} native roots · health state ${healthFrame(ratio)} · King frame ${frame}`;
}
document
  .querySelectorAll("input")
  .forEach((e) => e.addEventListener("input", draw));
document.querySelector("#step")!.addEventListener("click", () => {
  const e = document.querySelector<HTMLInputElement>("#frame")!;
  e.value = String(Math.min(31, Number(e.value) + 1));
  draw();
});
draw();
