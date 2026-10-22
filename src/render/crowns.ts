import * as T from "three";
import type { Point, Team } from "../game/engine";
import type { EffectLibrary, EffectSprite } from "./effects";
import { makeMaterial } from "./sprites";
import type { AnimationClip } from "./animation";

export const CROWN_FLIGHT_SECONDS = 1.15;
const STAGGER = 0.08;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

// The art/timeline are native; the screen-space reward trajectory is reconstructed.
export function crownPose(
  age: number,
  origin: Point,
  target: Point,
  lift: number,
  spread = 0,
) {
  const pop = clamp(age / 0.24);
  const travel = clamp((age - 0.24) / (CROWN_FLIGHT_SECONDS - 0.24));
  const ease = travel * travel * (3 - 2 * travel);
  const x = origin.x + spread * Math.sin((pop * Math.PI) / 2);
  const y = origin.y - lift * (1 - (1 - pop) ** 3);
  return {
    x: T.MathUtils.lerp(x, target.x, ease),
    y:
      T.MathUtils.lerp(y, target.y, ease) -
      Math.sin(travel * Math.PI) * lift * 0.35,
    scale: T.MathUtils.lerp(0.35 + 0.65 * Math.min(1, pop * 2), 0.35, ease),
  };
}

interface Flight {
  sprite: EffectSprite;
  team: Team;
  origin: T.Vector3;
  start: number;
  spread: number;
  screen: Point;
}

export class CrownEffects {
  private flights: Flight[] = [];
  constructor(
    private scene: T.Scene,
    private library: EffectLibrary,
  ) {}
  get state() {
    return this.flights.map((f) => ({
      team: f.team,
      x: f.screen.x,
      y: f.screen.y,
      frame: f.sprite.frame,
      visible: f.sprite.mesh.visible,
    }));
  }
  burst(team: Team, origin: T.Vector3, count: number, time: number, age = 0) {
    const asset = this.library.asset;
    if (!asset) return;
    for (let i = 0; i < Math.min(3, count); i++) {
      if (this.flights.length >= 6) break;
      if (age - i * STAGGER >= CROWN_FLIGHT_SECONDS) continue;
      const sprite = this.library.make("crown_rotate_anim");
      if (!sprite) return;
      sprite.mesh.material = asset.textures.map((texture) => {
        const material = makeMaterial(texture);
        material.depthTest = false;
        if (team === "red") {
          const compile = material.onBeforeCompile;
          material.onBeforeCompile = (shader, renderer) => {
            compile.call(material, shader, renderer);
            // The retained crown export has a blue ribbon. Recolor only that
            // ribbon for the opponent, preserving its gold and neutral highlights.
            shader.fragmentShader = shader.fragmentShader.replace(
              "diffuseColor = sRGBTransferEOTF(sourceColor);",
              `float ribbon = smoothstep(0.02, 0.1, sourceColor.b - max(sourceColor.r, sourceColor.g));
              sourceColor.rgb = mix(sourceColor.rgb, vec3(sourceColor.b, sourceColor.r, mix(sourceColor.r, sourceColor.g, 0.15)), ribbon);
              diffuseColor = sRGBTransferEOTF(sourceColor);`,
            );
          };
          material.customProgramCacheKey = () => "sc1-crown-red-ribbon-v1";
        }
        return material;
      });
      sprite.mesh.renderOrder = 5;
      sprite.mesh.frustumCulled = false;
      sprite.mesh.visible = false;
      this.scene.add(sprite.mesh);
      this.flights.push({
        sprite,
        team,
        origin: origin.clone(),
        start: time - age + i * STAGGER,
        spread: (i - (count - 1) / 2) * 19,
        screen: { x: 0, y: 0 },
      });
    }
  }
  update(
    time: number,
    camera: T.OrthographicCamera,
    width: number,
    height: number,
    targetFor: (team: Team) => Point | null,
  ) {
    this.flights = this.flights.filter((flight) => {
      const age = time - flight.start;
      const mesh = flight.sprite.mesh;
      if (age >= CROWN_FLIGHT_SECONDS) {
        this.release(flight);
        return false;
      }
      mesh.visible = age >= 0;
      if (age < 0) return true;
      const ndc = flight.origin.clone().project(camera);
      const origin = {
        x: ((ndc.x + 1) * width) / 2,
        y: ((1 - ndc.y) * height) / 2,
      };
      const target = targetFor(flight.team) ?? {
        x: width - (flight.team === "blue" ? 25 : 65),
        y: 30,
      };
      const clip = this.library.asset!.data.clips[
        flight.sprite.name
      ] as AnimationClip & { bounds: number[] };
      const sourceWidth = clip.bounds[2] - clip.bounds[0];
      const pixels = Math.max(24, Math.min(48, width * 0.1));
      const top = -clip.bounds[1] / sourceWidth;
      const bottom = clip.bounds[3] / sourceWidth;
      const pose = crownPose(
        age,
        origin,
        target,
        Math.max(0, Math.min(58, height * 0.12, origin.y - pixels * top - 8)),
        flight.spread,
      );
      const size = pixels * pose.scale;
      pose.x = T.MathUtils.clamp(pose.x, size / 2 + 4, width - size / 2 - 4);
      pose.y = T.MathUtils.clamp(
        pose.y,
        size * top + 4,
        height - size * bottom - 4,
      );
      flight.screen = { x: pose.x, y: pose.y };
      mesh.position
        .set((pose.x / width) * 2 - 1, 1 - (pose.y / height) * 2, 0)
        .unproject(camera);
      mesh.quaternion.copy(camera.quaternion);
      const nativeWidth = sourceWidth * this.library.asset!.scale;
      const unitsPerPixel = (camera.right - camera.left) / camera.zoom / width;
      mesh.scale.setScalar(
        ((pixels * unitsPerPixel) / nativeWidth) * pose.scale,
      );
      this.library.animate(flight.sprite, age, true);
      return true;
    });
  }
  private release(flight: Flight) {
    this.scene.remove(flight.sprite.mesh);
    flight.sprite.mesh.material.forEach((material) => material.dispose());
  }
  clear() {
    this.flights.forEach((f) => this.release(f));
    this.flights = [];
  }
}
