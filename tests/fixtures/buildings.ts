import * as T from "three";
import { BuildingLibrary } from "../../src/render/buildings";
import type { Team } from "../../src/game/engine";
const library = new BuildingLibrary(),
  host = document.querySelector("main")!;
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = T.SRGBColorSpace;
host.prepend(renderer.domElement);
const scene = new T.Scene();
scene.background = new T.Color("#19382c");
const camera = new T.OrthographicCamera(-18, 18, 12, -12, 0.1, 100);
camera.position.z = 20;
await library.load();
function setup(id: string) {
  scene.clear();
  const count = library.assets.get(id)!.data.clips.blue.frames.length;
  const indexes =
    id === "cannon"
      ? Array.from({ length: 19 }, (_, i) => i)
      : [
          0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 21, 22, 24, 26, 28, 30, 32,
          34, 36, 38,
        ];
  document.querySelector(".labels")!.innerHTML = [
    "Blue, first half",
    "Blue, second half",
    "Red, first half",
    "Red, second half",
  ]
    .map((n) => `<span>${n}</span>`)
    .join("");
  for (const [team, row] of [
    ["blue", 0],
    ["red", 2],
  ] as [Team, number][])
    indexes.forEach((frame, i) => {
      const sprite = library.make(id, team)!;
      library.frame(sprite, frame);
      sprite.mesh.position.set(
        -16 + (i % 11) * 3.2,
        8 - (row + Math.floor(i / 11)) * 6,
        0,
      );
      scene.add(sprite.mesh);
    });
  document.title = `${id}: ${count} source frames`;
}
setup("cannon");
document
  .querySelector("#building")!
  .addEventListener("change", (e) =>
    setup((e.target as HTMLSelectElement).value),
  );
function render() {
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}
render();
