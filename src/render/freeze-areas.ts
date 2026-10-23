import * as T from "three";
import type { AreaEffect } from "../game/engine";
import type { EffectLibrary, EffectSprite } from "./effects";

interface Visual {
  team: AreaEffect["team"];
  ground: EffectSprite;
  radius: EffectSprite;
  frame: number;
}

/** The source Freeze ground and radius SWFs follow the active simulation area. */
export class NativeFreezeAreas {
  private visuals = new Map<number, Visual>();

  constructor(
    private scene: T.Scene,
    private effects: EffectLibrary,
  ) {}

  get state() {
    return [...this.visuals.entries()].map(([id, visual]) => ({
      id,
      team: visual.team,
      frame: visual.frame,
    }));
  }

  update(areas: readonly AreaEffect[]) {
    const active = new Set<number>();
    for (const area of areas) {
      if (area.card !== "freeze") continue;
      active.add(area.id);
      let visual = this.visuals.get(area.id);
      if (visual?.team !== area.team) {
        if (visual) this.release(area.id, visual);
        const ground = this.effects.make(
          area.team === "blue"
            ? "freeze_effect_ground"
            : "freeze_effect_ground_red",
        );
        const radius = this.effects.make(
          area.team === "blue"
            ? "spell_freeze_radius_blue"
            : "spell_freeze_radius_red",
        );
        if (!ground || !radius) continue;
        for (const [index, sprite] of [ground, radius].entries()) {
          sprite.mesh.rotation.x = -Math.PI / 2;
          sprite.mesh.renderOrder = 0.25 + index * 0.01;
          this.scene.add(sprite.mesh);
        }
        visual = { team: area.team, ground, radius, frame: 0 };
        this.visuals.set(area.id, visual);
      }
      const age = Math.max(0, area.duration - area.remaining);
      const frame = Math.floor(age * 30 + 1e-6);
      for (const [index, sprite] of [visual.ground, visual.radius].entries()) {
        sprite.mesh.position.set(area.x - 9, 0.21 + index * 0.002, area.y - 16);
        this.effects.frame(sprite, frame);
      }
      visual.frame = frame;
    }
    for (const [id, visual] of this.visuals)
      if (!active.has(id)) this.release(id, visual);
  }

  clear() {
    for (const [id, visual] of this.visuals) this.release(id, visual);
  }

  private release(id: number, visual: Visual) {
    this.scene.remove(visual.ground.mesh, visual.radius.mesh);
    this.visuals.delete(id);
  }
}
