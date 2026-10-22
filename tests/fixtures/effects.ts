import * as T from "three";
import { EffectLibrary } from "../../src/render/effects";
const library = new EffectLibrary(),
  host = document.querySelector("main")!;
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = T.SRGBColorSpace;
host.prepend(renderer.domElement);
const scene = new T.Scene();
scene.background = new T.Color("#19382c");
const camera = new T.OrthographicCamera(-24, 24, 12, -12, 0.1, 100);
camera.position.z = 20;
await library.load();
function setup(page: string) {
  scene.clear();
  const names =
    page === "0"
      ? [
          "projectile_arrow_basic",
          "projectile_arrow_basic_enemy",
          "projectile_spear_360",
          "fireball_projectile1",
          "dragon_projectile",
          "fireball_small",
        ]
      : [
          "projectile_bomb",
          "projectile_cannonball_large",
          "tesla_beam",
          "zap_bolt1",
          "effect_Hit1",
          "explosion_cloud_1",
        ];
  document.querySelector(".labels")!.innerHTML = names
    .map((name) => `<span>${name}</span>`)
    .join("");
  names.forEach((name, row) => {
    const count = library.asset!.data.clips[name].frames.length;
    for (let i = 0; i < 15; i++) {
      const sprite = library.make(name)!;
      library.frame(sprite, Math.round((i / 14) * (count - 1)));
      sprite.mesh.position.set(-22 + i * 3.2, 9.5 - row * 4, 0);
      if (name.includes("bolt")) sprite.mesh.scale.y = 0.08;
      scene.add(sprite.mesh);
    }
  });
}
setup("0");
document
  .querySelector("#page")!
  .addEventListener("change", (e) =>
    setup((e.target as HTMLSelectElement).value),
  );
function render() {
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}
render();
