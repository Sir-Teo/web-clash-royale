import { Arena } from "../../src/render/arena";
import { Battle } from "../../src/game/engine";

const arena = new Arena(document.querySelector<HTMLElement>("#arena")!);
const batcher = (arena as any).spriteBatcher;
const prepareSprites = batcher.prepare.bind(batcher);
const groundBatcher = (arena as any).groundBatcher;
const prepareGround = groundBatcher.prepare.bind(groundBatcher);
function setBatch(enabled: boolean) {
  batcher.prepare = enabled ? prepareSprites : () => {};
}
function setGroundBatch(enabled: boolean) {
  groundBatcher.prepare = enabled ? prepareGround : () => {};
}
setBatch(new URLSearchParams(location.search).get("batch") !== "off");
const battle = new Battle({ seed: 12, ai: false });
const count = Math.min(24, Math.max(0, Number(new URLSearchParams(location.search).get("swarms") ?? 8)));
const fixedTime = new URLSearchParams(location.search).get("fixedTime");
for (const tower of battle.entities) tower.active = false;
for (let i = 0; i < count; i++) {
  const team = i % 2 ? "red" : "blue";
  battle.players[team].elixir = 10;
  battle.players[team].hand[0] = "skeleton-army";
  battle.play(team, 0, 2 + (i % 8) * 2, team === "red" ? 10 : 22);
}
for (const entity of battle.entities) {
  entity.active = false;
  entity.deploy = 0;
  entity.age = 3;
}
arena.setBattle(battle);
const crowns = Math.min(3, Math.max(0, Number(new URLSearchParams(location.search).get("crowns") ?? 0)));
let pendingCrowns = false;
function burstCrowns() {
  arena.setBattle(battle);
  pendingCrowns = true;
  for (let i = 0; i < crowns; i++)
    battle.events.push({ id: 100000 + i, time: 0, type: "crown", team: "blue", x: 9, y: 16, value: 1 });
}
let frames = 0;
const start = performance.now();
function frame(now: number) {
  if (pendingCrowns) {
    pendingCrowns = false;
    const random = Math.random;
    let seed = 12345;
    Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    try {
      arena.render(0, fixedTime === null ? (now - start) / 1000 : Number(fixedTime));
    } finally {
      Math.random = random;
    }
  } else arena.render(0, fixedTime === null ? (now - start) / 1000 : Number(fixedTime));
  frames++;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
Object.defineProperty(window, "__arenaProfile", {
  value: {
    setRatio(value: number) { arena.renderer.setPixelRatio(value); },
    setBatch,
    setGroundBatch,
    burstCrowns,
    get state() {
      return {
        renderedFrames: frames,
        entities: battle.entities.length,
        particles: arena.particleCount,
        loadedAnimations: arena.loadedAnimations,
        drawCalls: arena.renderer.info.render.calls,
        geometries: arena.renderer.info.memory.geometries,
        textures: arena.renderer.info.memory.textures,
        renderPixelRatio: arena.renderer.getPixelRatio(),
      };
    },
  },
});
