import * as T from "three";
import type { AreaEffect } from "../game/engine";
import type { EffectLibrary, EffectSprite } from "./effects";

interface Visual {
  team: AreaEffect["team"];
  card: AreaEffect["card"];
  ground: EffectSprite | null;
  radius: EffectSprite;
  frame: number;
}

/** Source ground and radius clips follow active persistent spell areas. */
export class NativeSpellAreas {
  private visuals = new Map<number, Visual>();

  constructor(
    private scene: T.Scene,
    private effects: EffectLibrary,
  ) {}

  get state() {
    return [...this.visuals.entries()].map(([id, visual]) => ({
      id,
      team: visual.team,
      card: visual.card,
      frame: visual.frame,
    }));
  }

  update(areas: readonly AreaEffect[]) {
    const active = new Set<number>();
    for (const area of areas) {
      if (area.card === "lightning" || area.card === "ice-golem" || area.card === "heal") continue;
      active.add(area.id);
      let visual = this.visuals.get(area.id);
      if (visual?.team !== area.team || visual.card !== area.card) {
        if (visual) this.release(area.id, visual);
        const groundName =
          area.card === "clone"
            ? "clone_effect_ground"
            : area.card === "graveyard"
              ? area.team === "blue"
                ? "Graveyard_ground_area_blue"
                : "Graveyard_ground_area_red"
              : area.card === "tornado"
                ? null
                : area.card === "freeze"
                  ? area.team === "blue"
                    ? "freeze_effect_ground"
                    : "freeze_effect_ground_red"
                  : area.card === "rage"
                    ? "rage_effect_ground"
                    : "Poison_radius";
        const radiusName =
          area.card === "clone"
            ? area.team === "blue"
              ? "spell_clone_radius_blue"
              : "spell_clone_radius_red"
            : area.card === "graveyard"
              ? area.team === "blue"
                ? "spell_graveyard_radius_blue"
                : "spell_graveyard_radius_red"
              : area.card === "tornado"
                ? area.team === "blue"
                  ? "spell_tornado_radius_blue"
                  : "spell_tornado_radius_red"
                : area.card === "freeze"
                  ? area.team === "blue"
                    ? "spell_freeze_radius_blue"
                    : "spell_freeze_radius_red"
                  : area.card === "rage"
                    ? area.team === "blue"
                      ? "spell_rage_radius_blue"
                      : "spell_rage_radius_red"
                    : area.team === "blue"
                      ? "spell_poison_radius_blue"
                      : "spell_poison_radius_red";
        const ground = groundName ? this.effects.make(groundName) : null;
        const radius = this.effects.make(radiusName);
        if ((groundName && !ground) || !radius) continue;
        for (const [index, sprite] of [ground, radius]
          .filter((sprite) => sprite !== null)
          .entries()) {
          // Clone's 181-frame ground export includes a tall rising shaft;
          // retain its upright SWF orientation instead of laying it flat.
          sprite.mesh.rotation.x =
            area.card === "clone" && index === 0 ? 0 : -Math.PI / 2;
          sprite.mesh.renderOrder = 0.25 + index * 0.01;
          this.scene.add(sprite.mesh);
        }
        visual = { team: area.team, card: area.card, ground, radius, frame: 0 };
        this.visuals.set(area.id, visual);
      }
      const age = Math.max(0, area.duration - area.remaining);
      const frame = Math.floor(age * 30 + 1e-6);
      for (const [index, sprite] of [visual.ground, visual.radius]
        .filter((sprite) => sprite !== null)
        .entries()) {
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
    if (visual.ground) this.scene.remove(visual.ground.mesh);
    this.scene.remove(visual.radius.mesh);
    this.visuals.delete(id);
  }
}
