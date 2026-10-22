import * as T from "three";
import { BuildingLibrary } from "../../src/render/buildings";
import { spriteGeometry } from "../../src/render/sprites";
import type { Entity, Team } from "../../src/game/engine";
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
  if (id === "king-barrel") {
    document.querySelector(".labels")!.innerHTML =
      "<span>Source direction frames: 0 · 9 · 18 · 27</span>";
    for (const [i, frame] of [0, 9, 18, 27].entries()) {
      const asset = library.assets.get("king")!;
      const sprite = library.make("king", "red")!;
      library.update(
        sprite,
        {
          card: "tower",
          king: true,
          active: true,
          activation: 0,
          deploy: 0,
          team: "red",
          x: 0,
          y: 0,
        } as Entity,
        {
          x: Math.sin((frame / 36) * Math.PI * 2),
          y: -Math.cos((frame / 36) * Math.PI * 2),
        } as Entity,
        camera,
      );
      const mesh = sprite.king!.turret;
      mesh.geometry = spriteGeometry(
        asset,
        asset.data.clips["red-turret"].frames[frame],
      );
      sprite.mesh.remove(mesh);
      mesh.geometry.computeBoundingBox();
      const center = mesh.geometry.boundingBox!.getCenter(new T.Vector3());
      mesh.scale.setScalar(6);
      mesh.position.set(-12 + i * 8 - center.x * 6, -center.y * 6, 0);
      scene.add(mesh);
    }
    return;
  }
  const assetId = id.startsWith("king") ? "king" : id;
  const count =
    id === "king-aim"
      ? 36
      : library.assets.get(assetId)!.data.clips.blue.frames.length;
  const indexes =
    id === "king-aim"
      ? [...Array.from({ length: 18 }, (_, i) => i * 2), 35]
      : id === "cannon"
        ? Array.from({ length: 19 }, (_, i) => i)
        : id === "king"
          ? [
              0, 1, 6, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56, 61, 66, 71, 76,
              81, 86, 91, 96, 97,
            ]
          : [
              0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 21, 22, 24, 26, 28, 30,
              32, 34, 36, 38,
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
      const sprite = library.make(assetId, team)!;
      if (id === "king-aim") {
        const angle = (frame / 36) * Math.PI * 2;
        library.update(
          sprite,
          {
            card: "tower",
            king: true,
            active: true,
            activation: 0,
            deploy: 0,
            team,
            x: 0,
            y: 0,
          } as Entity,
          { x: Math.sin(angle), y: -Math.cos(angle) } as Entity,
          camera,
        );
      } else library.frame(sprite, frame);
      if (assetId === "king") sprite.mesh.scale.setScalar(0.72);
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
