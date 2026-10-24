import * as T from "three";
import { SpriteLibrary } from "../../src/render/sprites";
import type { SpriteId } from "../../src/render/sprites";
import { CARD_MAP } from "../../src/game/cards";
import type { Entity } from "../../src/game/engine";
const library = new SpriteLibrary();
const host = document.querySelector("main")!;
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = T.SRGBColorSpace;
host.prepend(renderer.domElement);
const scene = new T.Scene();
scene.background = new T.Color("#19382c");
const camera = new T.OrthographicCamera(-18, 18, 13, -13, 0.1, 100);
camera.position.z = 20;
await library.load();
const textures = [...library.assets.values()].flatMap((asset) => asset.textures);
Object.defineProperty(window, "__animationTextures", {
  value: {
    references: textures.length,
    unique: new Set(textures).size,
    shared: [
      ["barbarians", "elite-barbarians"],
      ["princess", "tower-princess"],
      ["inferno-dragon", "baby-dragon"],
      ["dark-prince", "dark-prince-shield"],
      ["guards", "guards-shield"],
    ].every(([a, b]) => library.assets.get(a as SpriteId)?.textures[0] ===
      library.assets.get(b as SpriteId)?.textures[0]),
  },
});
const sprites = [...library.assets.keys()].flatMap((id: SpriteId, i) =>
  ["blue", "red"].map((team, side) => {
    const sprite = library.make(id)!;
    const e = {
      id: i * 2 + side,
      card: id === "tower-princess" ? "tower" : id,
      team,
      x: 0,
      y: 0,
      attack: 0,
      deploy: 0,
      interval: CARD_MAP[id as keyof typeof CARD_MAP]?.interval ?? 0.8,
      move: 0,
    } as Entity;
    sprite.mesh.position.set(
      (i % 6) * 6 - 15 + (side === 0 ? -1.35 : 1.35),
      9 - Math.floor(i / 6) * 6,
      0,
    );
    scene.add(sprite.mesh);
    return { sprite, e };
  }),
);
document.querySelector(".labels")!.innerHTML = [...library.assets.keys()]
  .map(
    (id) =>
      `<span>${id === "tower-princess" ? "Tower Princess" : CARD_MAP[id as keyof typeof CARD_MAP]?.name ?? id}<br><small>Blue / Red</small></span>`,
  )
  .join("");
document.querySelector("#status")!.textContent =
  `${library.assets.size} families loaded`;
let paused = false,
  time = 0,
  last = performance.now();
document.querySelector("#pause")!.addEventListener("click", () => {
  paused = !paused;
  document.querySelector("#pause")!.textContent = paused ? "Resume" : "Pause";
});
function render(now: number) {
  if (!paused) time += (now - last) / 1000;
  last = now;
  const state = (document.querySelector("#state") as HTMLSelectElement).value;
  const direction = Number(
    (document.querySelector("#direction") as HTMLSelectElement).value,
  );
  const angle = ((Math.abs(direction) - 1) / 8) * Math.PI;
  const dx = Math.sin(angle) * (direction < 0 ? -1 : 1),
    dy = -Math.cos(angle);
  for (const { sprite, e } of sprites) {
    e.attack = state === "attack" ? e.interval - (time % e.interval) : 0;
    sprite.facingX = dx;
    sprite.facingY = dy;
    library.update(
      sprite,
      e,
      { ...e, x: dx, y: dy },
      state === "run",
      time,
      camera,
      { x: dx, y: dy },
    );
  }
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
