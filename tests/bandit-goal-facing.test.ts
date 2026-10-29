import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import * as T from "three";
import { SpriteLibrary, type SpriteAsset } from "../src/render/sprites";
import { animationFrame, facing, selectClip } from "../src/render/animation";

it("faces the committed goal in a paused or late snapshot before rendered motion exists", () => {
  const data = JSON.parse(readFileSync("public/assets/animations/bandit.json", "utf8"));
  const asset = { data, materials: [], textures: [], geometry: new Map(), scale: 1 } as SpriteAsset;
  const sprite = { mesh: new T.Mesh(new T.BufferGeometry(), []), asset,
    lastFrame: -1, facingX: 0, facingY: 0 };
  const entity = { id: 9, card: "bandit" as const, team: "blue" as const,
    x: 4, y: 20, attack: 0, interval: 1, move: 0, deploy: 0,
    dash: { target: 10, elapsed: 0.1, remaining: 0.5, goal: { x: 10, y: 20 }, carry: 0 } };
  new SpriteLibrary().update(sprite, entity, { x: 0, y: 31 }, false, 1,
    new T.PerspectiveCamera(), { x: 0, y: 0 });
  expect([sprite.facingX, sprite.facingY]).toEqual([6, 0]);
  const clip = selectClip(data.clips, "blue", "dash", facing(6, 0).direction);
  expect(sprite.lastFrame).toBe(animationFrame(clip, 0.1, true, 0.7));
});

it("faces the charging target without showing protected dash travel", () => {
  const data = JSON.parse(readFileSync("public/assets/animations/bandit.json", "utf8"));
  const asset = { data, materials: [], textures: [], geometry: new Map(), scale: 1 } as SpriteAsset;
  const sprite = { mesh: new T.Mesh(new T.BufferGeometry(), []), asset,
    lastFrame: -1, facingX: 0, facingY: 0 };
  const entity = { id: 9, card: "bandit" as const, team: "blue" as const,
    x: 4, y: 20, attack: 0, interval: 1, move: 0, deploy: 0, animationTime: 0,
    dashCharge: { target: 10, remainingMs: 950, carry: 0, started: true as const } };
  new SpriteLibrary().update(sprite, entity, { x: 10, y: 20 }, false, 1,
    new T.PerspectiveCamera(), { x: 0, y: 0 });
  expect([sprite.facingX, sprite.facingY]).toEqual([6, 0]);
  const clip = selectClip(data.clips, "blue", "idle", facing(6, 0).direction);
  expect(sprite.lastFrame).toBe(animationFrame(clip, 9 * 0.13, false, 1));
});
