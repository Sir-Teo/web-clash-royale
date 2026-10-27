import * as T from "three";
import { CARD_MAP } from "../game/cards";
import type { CardId } from "../game/cards";
import { entityVisualHeight } from "../game/engine";
import type { Point } from "../game/engine";
import { deploymentPositions, goblinGangCharacter } from "../game/deployment";
import type { DeploymentYBounds } from "../game/placement-bounds";
import { troopModel } from "./models";
import { SpriteLibrary } from "./sprites";
import type { AnimatedSprite, SpriteState } from "./sprites";

export class DeploymentPreview {
  readonly object = new T.Group();
  private card: CardId | null = null;
  private units: {
    object: T.Group;
    sprite?: AnimatedSprite;
    state: SpriteState;
  }[] = [];
  private materials = new Set<T.Material>();
  constructor(
    private library: SpriteLibrary,
    private building: (id: CardId) => T.Group,
  ) {
    this.object.visible = false;
  }
  get nativeCount() {
    return this.units.filter((u) => !!u.sprite).length;
  }
  get count() {
    return this.units.length;
  }
  show(id: CardId, point: Point, valid: boolean, rulesVersion = 22, armyViewMirrored?: true, yBounds?: DeploymentYBounds) {
    if (this.card !== id) {
      this.clear();
      this.card = id;
      const card = CARD_MAP[id],
        materialCopies = new Map<T.Material, T.Material>();
      for (let i = 0; i < card.count; i++) {
        const body = id === "goblin-gang" ? goblinGangCharacter(i) : id;
        let object: T.Group, sprite: AnimatedSprite | undefined;
        if (card.kind === "building") object = this.building(id);
        else {
          sprite = this.library.make(
            body === "dark-prince" ? "dark-prince-shield" :
            body === "guards" ? "guards-shield" : body,
          ) ?? undefined;
          object = sprite ? new T.Group() : troopModel(body, "blue").group;
          if (sprite) object.add(sprite.mesh);
          else object.rotation.y = Math.PI;
        }
        object.traverse((child) => {
          if (!(child instanceof T.Mesh)) return;
          const originals: T.Material[] = Array.isArray(child.material)
            ? child.material
            : [child.material];
          const copies = originals.map((original) => {
            let copy = materialCopies.get(original);
            if (!copy) {
              copy = original.clone();
              copy.onBeforeCompile = original.onBeforeCompile;
              copy.customProgramCacheKey = original.customProgramCacheKey;
              copy.transparent = true;
              copy.depthWrite = false;
              copy.opacity = 0.56;
              this.materials.add(copy);
              materialCopies.set(original, copy);
              if (original.userData.previewOwned) original.dispose();
            }
            return copy;
          });
          child.material = Array.isArray(child.material) ? copies : copies[0];
          child.castShadow = false;
          child.renderOrder = 5;
        });
        this.object.add(object);
        this.units.push({
          object,
          sprite,
          state: {
            id: i,
            card: body,
            team: "blue",
            x: 0,
            y: 0,
            attack: 0,
            interval: CARD_MAP[body].interval,
            move: 0,
            deploy: 0,
          },
        });
      }
    }
    this.object.visible = true;
    const points = deploymentPositions(id, point, "blue", undefined, rulesVersion, armyViewMirrored, yBounds);
    this.units.forEach((unit, i) => {
      unit.object.position.set(
        points[i].x - 9,
        entityVisualHeight({ card: id, air: !!CARD_MAP[id].air }),
        points[i].y - 16,
      );
      Object.assign(unit.state, points[i]);
    });
    for (const m of this.materials) {
      (m as T.MeshBasicMaterial).color.set(valid ? 0xffffff : 0xff6677);
      m.opacity = valid ? 0.56 : 0.4;
    }
  }
  render(time: number, camera: T.Camera) {
    if (!this.object.visible) return;
    for (const unit of this.units) {
      if (unit.sprite)
        this.library.update(
          unit.sprite,
          unit.state,
          undefined,
          false,
          time,
          camera,
        );
      else if (CARD_MAP[unit.state.card as CardId].kind === "building")
        unit.object.traverse((o) => {
          if (o.userData.billboard) o.quaternion.copy(camera.quaternion);
        });
    }
  }
  clear() {
    this.object.traverse((o) => {
      if (o instanceof T.Mesh && !o.geometry.userData.shared)
        o.geometry.dispose();
    });
    for (const material of this.materials) material.dispose();
    this.materials.clear();
    this.units = [];
    this.card = null;
    this.object.clear();
    this.object.visible = false;
  }
}
