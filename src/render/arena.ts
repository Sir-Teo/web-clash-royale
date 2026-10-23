import * as T from "three";
import { Battle } from "../game/engine";
import type { Entity, Point, Team } from "../game/engine";
import { CARD_MAP } from "../game/cards";
import type { CardId } from "../game/cards";
import {
  box,
  cylinder,
  sphere,
  mat,
  towerModel,
  troopModel,
  buildingModel,
  teamColor,
  batchGeometry,
} from "./models";
import type { Model } from "./models";
import { SpriteLibrary } from "./sprites";
import type { AnimatedSprite } from "./sprites";
import { EffectLibrary } from "./effects";
import type { EffectSprite } from "./effects";
import {
  makeProjectile,
  rocketFlightPoint,
  logFlightPoint,
  curvedFlightPoint,
  updateProjectile,
} from "./projectiles";
import type { ProjectileVisual } from "./projectiles";
import { DeploymentPreview } from "./deployment";
import { BuildingLibrary } from "./buildings";
import type { BuildingSprite } from "./buildings";
import { destroyedTowerSites, TOWER_SITES } from "../game/arena-layout";
import { DestructionEffects, deathEffect, impactEffect } from "./destruction";
import { NativeDeploymentEffects } from "./deployment-effects";
import { NativeLaunchEffects } from "./launch-effects";
import { NativeMovementEffects } from "./movement-effects";
import type { MovementBurst } from "./movement-effects";
import { hogJumpHeight, NativeHogLandings } from "./hog-jump";
import { NativeChargeMarkers } from "./charge-marker";
import { NativeChargeFilter } from "./charge-filter";
import { NativeDeployFilter } from "./deploy-filter";
import { NativeColdFilter, NativeColdStructures } from "./cold-filter";
import { NativeInfernoBeams } from "./inferno-beam";
import { NativePoisonFilter } from "./poison-filter";
import { NativeRageFilter } from "./rage-filter";
import { NativeCloneFilter } from "./clone-filter";
import type { ColdStructurePart } from "./cold-filter";
import { SpriteFilterStack } from "./sprite-filter";
import { NativeSpellAreas } from "./spell-areas";
import { arrowOffsets } from "./arrow-volley";
import { CrownEffects } from "./crowns";
import { HealthLibrary, type HealthSprite } from "./health";
import { NativeScreenShake } from "./screen-shake";
interface Visual {
  object: T.Group;
  model?: Model;
  sprite?: AnimatedSprite;
  archer?: AnimatedSprite;
  building?: BuildingSprite;
  art?: T.Mesh;
  label?: HTMLDivElement;
  labelTransform?: string;
  health?: T.Group;
  healthFill?: T.Mesh;
  nativeHealth?: HealthSprite;
}
interface Particle {
  mesh: T.Mesh;
  velocity: T.Vector3;
  life: number;
  max: number;
}
export class Arena {
  readonly renderer: T.WebGLRenderer;
  readonly scene = new T.Scene();
  readonly camera: T.OrthographicCamera;
  private root = new T.Group();
  private units = new Map<number, Visual>();
  private shots = new Map<number, ProjectileVisual>();
  private trailCycles = new Map<number, number>();
  private effects = new EffectLibrary();
  private buildings = new BuildingLibrary();
  private health = new HealthLibrary();
  private healthPosition = new T.Vector3();
  private shake = new NativeScreenShake();
  private readonly reducedMotion = matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  private destruction = new DestructionEffects(this.scene, this.effects);
  private deploymentEffects = new NativeDeploymentEffects();
  private launchEffects = new NativeLaunchEffects();
  private movementEffects = new NativeMovementEffects();
  private chargeMarkers: NativeChargeMarkers;
  private spriteFilters = new SpriteFilterStack();
  private chargeFilter = new NativeChargeFilter(this.spriteFilters);
  private deployFilter = new NativeDeployFilter(this.spriteFilters);
  private cloneFilter = new NativeCloneFilter(this.spriteFilters);
  private coldFilter = new NativeColdFilter(this.spriteFilters);
  private poisonFilter = new NativePoisonFilter(this.spriteFilters);
  private rageFilter = new NativeRageFilter(this.spriteFilters);
  private coldStructures = new NativeColdStructures();
  private infernoBeams = new NativeInfernoBeams(this.scene, this.effects);
  private spellAreas = new NativeSpellAreas(this.scene, this.effects);
  private hogLandings = new NativeHogLandings();
  private crowns = new CrownEffects(this.scene, this.effects);
  private rubble = new Map<string, T.Mesh>();
  private impacts: { sprite: EffectSprite; start: number; life: number }[] = [];
  private particles: Particle[] = [];
  private waters: T.Mesh[] = [];
  private flags: T.Mesh[] = [];
  private observer: ResizeObserver;
  private ray = new T.Raycaster();
  private floor = new T.Plane(new T.Vector3(0, 1, 0), 0);
  private cursor = new T.Group();
  private rangeRing: T.Mesh;
  private block = new T.Group();
  private blockedLanes: T.Mesh[] = [];
  private deployment: DeploymentPreview;
  private placementFeedback: HTMLDivElement;
  private placement: {
    card: CardId;
    point: Point | null;
    valid: boolean;
    reason: string;
  } | null = null;
  private lastEvent = 0;
  private battle: Battle | null = null;
  private width = 1;
  private height = 1;
  private labels: HTMLDivElement;
  private destroyed = false;
  private sprites = new SpriteLibrary();
  private towerArt = new Map<
    string,
    { texture: T.Texture; aspect: number; anchor: [number, number] }
  >();
  private artwork: T.Mesh[] = [];
  private contextLost = false;
  onContextLost: () => void = () => {};
  onCharge: (burst: MovementBurst) => void = () => {};
  crownTarget: (team: Team) => Point | null = () => null;
  constructor(readonly host: HTMLElement) {
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "3D battle arena. Select a card, then click your side of the arena to deploy.",
    );
    this.renderer.domElement.setAttribute("role", "img");
    this.renderer.domElement.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.onContextLost();
    });
    this.renderer.domElement.addEventListener("webglcontextrestored", () => {
      this.contextLost = false;
    });
    host.append(this.renderer.domElement);
    this.labels = document.createElement("div");
    this.labels.className = "tower-labels";
    host.append(this.labels);
    this.chargeMarkers = new NativeChargeMarkers(host, (x, y, height) =>
      this.screen(x, y, height),
    );
    this.placementFeedback = document.createElement("div");
    this.placementFeedback.className = "placement-feedback hidden";
    this.placementFeedback.setAttribute("role", "status");
    this.placementFeedback.setAttribute("aria-live", "polite");
    this.placementFeedback.setAttribute("aria-atomic", "true");
    host.append(this.placementFeedback);
    this.deployment = new DeploymentPreview(this.sprites, (id) =>
      this.previewBuilding(id),
    );
    this.scene.add(this.deployment.object);
    this.camera = new T.OrthographicCamera(-12, 12, 18, -18, 0.1, 160);
    this.camera.position.set(0, 40, 29);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new T.HemisphereLight(0xe0f4ff, 0x597846, 1.5));
    const sun = new T.DirectionalLight(0xffedce, 2.3);
    sun.position.set(-15, 28, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -22;
    sun.shadow.camera.right = 22;
    sun.shadow.camera.top = 25;
    sun.shadow.camera.bottom = -25;
    sun.shadow.normalBias = 0.04;
    sun.shadow.bias = -0.0002;
    this.scene.add(sun);
    this.scene.add(this.root);
    this.buildArena();
    this.rangeRing = new T.Mesh(
      new T.RingGeometry(1, 1.08, 64),
      new T.MeshBasicMaterial({
        color: 0x8bffcc,
        transparent: true,
        opacity: 0.85,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    );
    this.rangeRing.rotation.x = -Math.PI / 2;
    this.rangeRing.position.y = 0.09;
    this.cursor.add(this.rangeRing);
    const center = new T.Mesh(
      new T.CircleGeometry(0.1, 16),
      new T.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.8,
      }),
    );
    center.rotation.x = -Math.PI / 2;
    center.position.y = 0.1;
    this.cursor.add(center);
    this.cursor.visible = false;
    this.scene.add(this.cursor);
    const illegalMaterial = new T.MeshBasicMaterial({
      color: 0xee3848,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
    });
    for (let lane = 0; lane < 2; lane++) {
      const overlay = new T.Mesh(new T.PlaneGeometry(9, 1), illegalMaterial);
      overlay.rotation.x = -Math.PI / 2;
      overlay.position.x = lane === 0 ? -4.5 : 4.5;
      overlay.position.y = 0.21;
      this.blockedLanes.push(overlay);
      this.block.add(overlay);
    }
    const river = new T.Mesh(new T.PlaneGeometry(18, 3), illegalMaterial);
    river.rotation.x = -Math.PI / 2;
    river.position.set(0, 0.22, 0);
    this.block.add(river);
    this.block.visible = false;
    this.scene.add(this.block);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    void Promise.all([
      this.sprites.load(),
      this.effects.load(),
      this.buildings.load(),
      this.health.load(),
      this.loadArtwork(),
    ]).then(() => {
      if (!this.destroyed && this.battle) this.setBattle(this.battle);
    });
  }
  private async loadArtwork() {
    const loader = new T.TextureLoader();
    await Promise.all(
      [
        "king-blue",
        "king-red",
        "princess-base-blue",
        "princess-base-red",
        "balloon-blue",
        "balloon-red",
        "cannon-blue",
        "cannon-red",
        "tesla-blue",
        "tesla-red",
      ].map(async (name) => {
        try {
          const texture = await loader.loadAsync(
            `${import.meta.env.BASE_URL}assets/scenery/${name}.png`,
          );
          texture.colorSpace = T.SRGBColorSpace;
          const anchorY = name.startsWith("balloon")
            ? 0.04
            : name.startsWith("tesla")
              ? 0.22
              : name.startsWith("cannon")
                ? 0.32
                : 0.34;
          const aspect = texture.image.width / texture.image.height;
          this.towerArt.set(name, {
            texture,
            aspect,
            anchor: [0.5, anchorY],
          });
        } catch {}
      }),
    );
    try {
      const texture = await loader.loadAsync(
        `${import.meta.env.BASE_URL}assets/scenery/goblin-field.png`,
      );
      texture.colorSpace = T.SRGBColorSpace;
      texture.anisotropy = Math.min(
        8,
        this.renderer.capabilities.getMaxAnisotropy(),
      );
      const floor = new T.Mesh(
        new T.PlaneGeometry(18, 32),
        new T.MeshBasicMaterial({ map: texture, toneMapped: false }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0.16;
      this.root.add(floor);
      const layout = (await fetch(
        `${import.meta.env.BASE_URL}assets/scenery/goblin-layout.json`,
      ).then((r) => r.json())) as {
        file: string;
        width: number;
        height: number;
        anchor: [number, number];
        positions: { x: number; y: number }[];
      }[];
      await Promise.all(
        layout.map(async (item) => {
          const tex = await loader.loadAsync(
            `${import.meta.env.BASE_URL}assets/scenery/${item.file}`,
          );
          tex.colorSpace = T.SRGBColorSpace;
          const material = new T.MeshBasicMaterial({
            map: tex,
            transparent: true,
            alphaTest: 0.06,
            depthWrite: false,
            toneMapped: false,
            side: T.DoubleSide,
          });
          for (const point of item.positions) {
            const geometry = new T.PlaneGeometry(item.width, item.height);
            geometry.translate(
              (0.5 - item.anchor[0]) * item.width,
              (0.5 - item.anchor[1]) * item.height,
              0,
            );
            const mesh = new T.Mesh(geometry, material);
            mesh.position.set(point.x - 9, 0.15, point.y - 16);
            this.scene.add(mesh);
            this.artwork.push(mesh);
          }
        }),
      );
    } catch {
      /* Keep the fully local 3D terrain if an artwork asset fails. */
    }
  }
  private buildArena() {
    const r = this.root;
    box(r, 0, -1.15, 0, 22.6, 1.8, 35.6, 0x35484c);
    box(r, 0, -0.42, 0, 22, 0.5, 35, 0x6a8074);
    box(r, 0, -0.1, 0, 20.8, 0.35, 34.1, 0x9da28d);
    const tileGeo = new T.BoxGeometry(0.99, 0.09, 0.99),
      tileMat = mat(0xffffff);
    const grass = new T.InstancedMesh(tileGeo, tileMat, 18 * 32);
    grass.receiveShadow = true;
    const m = new T.Matrix4(),
      col = new T.Color();
    let n = 0;
    for (let x = 0; x < 18; x++)
      for (let z = 0; z < 32; z++) {
        m.makeTranslation(x - 8.5, 0.02, z - 15.5);
        grass.setMatrixAt(n, m);
        col.setHex((x + z) % 2 === 0 ? 0x86b954 : 0x7aaf4a);
        if (z === 14 || z === 15 || z === 16) col.setHex(0x779948);
        grass.setColorAt(n++, col);
      }
    r.add(grass);
    for (const x of [-5, 5])
      for (const z of [-9.4, 9.4]) {
        const path = box(r, x, 0.085, z, 2.6, 0.035, 10.8, 0xa6b77b);
        path.receiveShadow = true;
        for (let k = 0; k < 8; k++) {
          const stone = box(
            r,
            x + Math.sin(k * 3.1) * 0.32,
            0.12,
            z - 4.5 + k * 1.25,
            0.8,
            0.05,
            0.75,
            0xbac394,
          );
          stone.rotation.y = k * 0.7;
        }
      }
    const water = new T.Mesh(
      new T.PlaneGeometry(20.7, 2.85),
      new T.MeshStandardMaterial({
        color: 0x42c0d4,
        roughness: 0.22,
        metalness: 0.15,
        transparent: true,
        opacity: 0.95,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.1, 0);
    water.receiveShadow = true;
    r.add(water);
    for (let i = 0; i < 20; i++) {
      const wave = new T.Mesh(
        new T.PlaneGeometry(0.35 + (i % 4) * 0.28, 0.055),
        new T.MeshBasicMaterial({
          color: 0xbcf1e5,
          transparent: true,
          opacity: 0.25,
          depthWrite: false,
        }),
      );
      wave.rotation.x = -Math.PI / 2;
      wave.position.set(-10 + i * 1.1, 0.13, Math.sin(i * 12) * 1);
      r.add(wave);
      this.waters.push(wave);
    }
    for (const z of [-1.6, 1.6])
      for (let x = -9.5; x <= 9.5; x += 1) {
        if (Math.abs(x + 5) < 1.2 || Math.abs(x - 5) < 1.2) continue;
        box(r, x, 0.12, z, 0.96, 0.27, 0.36, 0xc2c4a1);
      }
    for (const x of [-5, 5]) {
      for (let i = 0; i < 9; i++)
        box(
          r,
          x,
          0.19,
          -1.6 + i * 0.4,
          2.5,
          0.25,
          0.37,
          i % 2 ? 0xb98c52 : 0xc89b60,
        );
      for (const dx of [-1.2, 1.2]) {
        box(r, x + dx, 0.17, 0, 0.16, 0.37, 3.7, 0x8f673f);
        for (const z of [-1.7, 1.7])
          cylinder(r, x + dx, 0.45, z, 0.13, 0.85, 0xa67a48);
      }
    }
    for (const s of [-1, 1]) {
      for (let i = 0; i < 34; i++) {
        const z = i - 16.5;
        box(r, s * 9.55, 0.2, z, 0.65, 0.4, 0.96, i % 3 ? 0xb0b8a6 : 0x929f94);
      }
      for (let i = 0; i < 8; i++) {
        const z = -14 + i * 4;
        box(r, s * 10.45, 0.48, z, 0.75, 0.55, 2.6, 0x798c76);
        box(r, s * 10.45, 0.81, z - 0.4, 0.75, 0.12, 1.8, 0xb0ba9a);
      }
      for (const z of [-16.6, 16.6])
        for (let i = 0; i < 20; i++)
          box(r, -9.5 + i, 0.2, z, 0.96, 0.4, 0.65, 0xadb6a2);
    }
    for (const z of [-13, 13])
      for (const s of [-1, 1]) {
        const x = s * 10.4;
        box(r, x, 0.2, z, 0.6, 0.4, 0.6, 0x8c9989);
        cylinder(r, x, 1.6, z, 0.055, 3, 0xdbc18c);
        sphere(r, x, 3.2, z, 0.12, 0xffda68);
        const flag = new T.Mesh(
          new T.PlaneGeometry(1.1, 0.75, 8, 1),
          new T.MeshStandardMaterial({
            color: z < 0 ? 0xdb4b52 : 0x428fda,
            side: T.DoubleSide,
            roughness: 1,
          }),
        );
        flag.position.set(x + s * 0.56, 2.7, z);
        flag.userData.base = new Float32Array(
          flag.geometry.attributes.position.array,
        );
        r.add(flag);
        this.flags.push(flag);
      }
    // Shrubs, flowers and river stones make the arena feel like a little physical diorama.
    for (let i = 0; i < 65; i++) {
      const s = i % 2 ? -1 : 1,
        x = s * (9.9 + (i % 3) * 0.28),
        z = Math.sin(i * 17.3) * 15.7;
      if (Math.abs(z) < 2) continue;
      sphere(
        r,
        x,
        0.14,
        z,
        0.14,
        i % 7 === 0 ? 0xf3d772 : i % 11 === 0 ? 0xe8c8e6 : 0x6b9f43,
        1,
        0.7,
        1,
      );
    }
    for (let i = 0; i < 12; i++) {
      const x = -10.4 + (i % 2) * 20.8,
        z = -1.3 + Math.floor(i / 2) * 0.48;
      sphere(r, x, 0.1, z, 0.3, 0x8a9c8e, 1, 0.55, 0.7);
    }
    batchGeometry(r, [...this.waters, ...this.flags]);
  }
  setBattle(battle: Battle) {
    this.deploymentEffects.reset(battle.audioEvents);
    this.launchEffects.reset(battle.audioEvents);
    this.movementEffects.reset();
    this.chargeMarkers.clear();
    this.chargeFilter.clear();
    this.deployFilter.clear();
    this.cloneFilter.clear();
    this.coldFilter.clear();
    this.poisonFilter.clear();
    this.rageFilter.clear();
    this.coldStructures.clear();
    this.infernoBeams.clear();
    this.spriteFilters.clear();
    this.spellAreas.clear();
    this.hogLandings.reset();
    this.shake.reset(battle.audioEvents);
    this.camera.clearViewOffset();
    this.destruction.clear();
    this.crowns.clear();
    for (const mesh of this.rubble.values()) this.scene.remove(mesh);
    this.rubble.clear();
    this.showPlacement(null, null);
    this.deployment.clear();
    for (const v of this.units.values()) {
      this.scene.remove(v.object);
      v.label?.remove();
      if (v.nativeHealth) this.scene.remove(v.nativeHealth.mesh);
      this.disposeObject(v.object);
    }
    this.units.clear();
    for (const p of this.shots.values()) {
      this.scene.remove(p.object);
      this.disposeObject(p.object);
    }
    this.shots.clear();
    this.trailCycles.clear();
    for (const impact of this.impacts) this.scene.remove(impact.sprite.mesh);
    this.impacts = [];
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
    }
    this.particles = [];
    this.battle = battle;
    this.lastEvent = battle.events.at(-1)?.id ?? 0;
  }
  get loadedAnimations() {
    return this.sprites.assets.size;
  }
  get shakeState() {
    return {
      ...this.shake.state,
      reduced: this.reducedMotion.matches,
      pixelsPerUnit: this.width / (this.camera.right - this.camera.left) / 30,
    };
  }
  get nativeTowerPrincesses() {
    const asset = this.sprites.assets.get("tower-princess");
    return [...this.units.values()].filter(
      (v) => asset && v.archer?.asset === asset,
    ).length;
  }
  get nativePrincessTowers() {
    return [...this.units.values()].filter((v) => v.building?.princess).length;
  }
  get crownState() {
    return this.crowns.state;
  }
  get effectTime() {
    return this.destruction.time;
  }
  get loadedEffects() {
    return Object.keys(this.effects.asset?.data.clips ?? {}).length;
  }
  get projectileState() {
    return [...this.shots.entries()].map(([id, shot]) => ({
      id,
      visible: shot.object.visible,
      position: shot.object.position.toArray(),
      sprites: shot.sprites.map((sprite) => ({
        name: sprite.name,
        frame: sprite.frame,
      })),
    }));
  }
  get infernoBeamState() {
    return this.infernoBeams.state;
  }
  get loadedHealth() {
    return this.health.loaded;
  }
  get healthState() {
    return [...this.units.entries()]
      .filter(([, v]) => v.nativeHealth?.mesh.visible)
      .map(([id, v]) => ({
        id,
        ...v.nativeHealth!.mesh.userData.health,
        x: v.nativeHealth!.mesh.position.x + 9,
        y: v.nativeHealth!.mesh.position.z + 16,
      }));
  }
  get loadedBuildings() {
    return this.buildings.assets.size;
  }
  get particleCount() {
    return this.particles.length + this.destruction.count;
  }
  get destructionState() {
    return {
      rubble: this.rubble.size,
      particles: this.destruction.count,
      ground: this.destruction.groundCount,
      draws: this.destruction.drawCount,
      time: this.destruction.time,
      clips: this.destruction.activeClips,
      tails: this.destruction.tailState,
    };
  }
  get impactSpriteState() {
    return this.impacts.map((impact) => ({
      name: impact.sprite.name,
      frame: impact.sprite.frame,
    }));
  }
  get chargeFilterState() {
    return this.chargeFilter.state;
  }
  get deployFilterState() {
    return this.deployFilter.state;
  }
  get coldFilterState() {
    return this.coldFilter.state;
  }
  get poisonFilterState() {
    return this.poisonFilter.state;
  }
  get rageFilterState() {
    return this.rageFilter.state;
  }
  get coldStructureState() {
    return this.coldStructures.state;
  }
  get poisonStructureState() {
    return this.coldStructures.poisonState;
  }

  private coldStructureParts(id: number): ColdStructurePart[] {
    const visual = this.units.get(id);
    if (!visual) return [];
    const parts: ColdStructurePart[] = [];
    const building = visual.building;
    if (building) {
      for (const mesh of [
        building.mesh,
        building.princess?.front,
        building.king?.turret,
        building.king?.front,
      ])
        if (mesh) parts.push({ mesh, originals: building.asset.materials });
    }
    if (visual.archer)
      parts.push({
        mesh: visual.archer.mesh,
        originals: visual.archer.asset.materials,
      });
    return parts;
  }
  get freezeAreaState() {
    return this.spellAreas.state.filter((area) => area.card === "freeze");
  }
  get poisonAreaState() {
    return this.spellAreas.state.filter((area) => area.card === "poison");
  }
  get rageAreaState() {
    return this.spellAreas.state.filter((area) => area.card === "rage");
  }
  get tornadoAreaState() {
    return this.spellAreas.state.filter((area) => area.card === "tornado");
  }
  get graveyardAreaState() {
    return this.spellAreas.state.filter((area) => area.card === "graveyard");
  }
  get cloneFilterState() {
    return this.cloneFilter.state;
  }
  get cloneAreaState() {
    return this.spellAreas.state.filter((area) => area.card === "clone");
  }
  get placementState() {
    return this.placement
      ? {
          ...this.placement,
          point: this.placement.point ? { ...this.placement.point } : null,
          count: this.deployment.object.visible ? this.deployment.count : 0,
          nativeCount: this.deployment.object.visible
            ? this.deployment.nativeCount
            : 0,
          blockedUntil: this.blockedLanes.map((o) => o.scale.y),
        }
      : null;
  }
  private resize() {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    const ratio = width / height;
    const h = Math.max(34, 24 / ratio),
      w = h * ratio;
    this.camera.left = -w / 2;
    this.camera.right = w / 2;
    this.camera.top = h / 2;
    this.camera.bottom = -h / 2;
    this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }
  point(clientX: number, clientY: number): Point | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new T.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      (-(clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.ray.setFromCamera(v, this.camera);
    const hit = new T.Vector3();
    if (!this.ray.ray.intersectPlane(this.floor, hit)) return null;
    return { x: hit.x + 9, y: hit.z + 16 };
  }
  screen(x: number, y: number, height = 0) {
    const v = new T.Vector3(x - 9, height, y - 16).project(this.camera);
    return {
      x: ((v.x + 1) / 2) * this.width,
      y: ((-v.y + 1) / 2) * this.height,
    };
  }
  private previewBuilding(id: CardId) {
    const native = this.buildings.make(id, "blue");
    if (native) {
      const group = new T.Group();
      native.mesh.quaternion.copy(this.camera.quaternion);
      group.add(native.mesh);
      return group;
    }
    const art = this.towerArt.get(`${id}-blue`);
    if (!art) return buildingModel(id, "blue");
    const group = new T.Group(),
      width = 2.2,
      height = width / art.aspect;
    const geometry = new T.PlaneGeometry(width, height);
    geometry.translate(0, (0.5 - art.anchor[1]) * height, 0);
    const material = new T.MeshBasicMaterial({
      map: art.texture,
      transparent: true,
      alphaTest: 0.04,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: T.DoubleSide,
    });
    material.userData.previewOwned = true;
    const mesh = new T.Mesh(geometry, material);
    mesh.userData.billboard = true;
    mesh.quaternion.copy(this.camera.quaternion);
    group.add(mesh);
    return group;
  }
  showPlacement(
    id: CardId | null,
    point: Point | null,
    valid = true,
    reason = "",
  ) {
    this.placement = id ? { card: id, point, valid, reason } : null;
    this.block.visible = !!id && CARD_MAP[id].kind !== "spell";
    this.cursor.visible = !!id && !!point;
    this.placementFeedback.classList.toggle("hidden", !id || !point);
    this.blockedLanes.forEach((overlay, i) => {
      const lane = i === 0 ? "left" : "right";
      const enemyTower = this.battle?.entities.some(
        (e) =>
          e.team === "red" &&
          e.kind === "tower" &&
          !e.king &&
          e.lane === lane &&
          e.hp > 0,
      );
      const height = enemyTower ? 17.8 : 11.5;
      overlay.scale.y = height;
      overlay.position.z = height / 2 - 16;
    });
    if (!id || !point) {
      this.deployment.object.visible = false;
      return;
    }
    this.cursor.position.set(point.x - 9, 0.2, point.y - 16);
    const card = CARD_MAP[id];
    const radius = card.radius ?? (card.kind === "building" ? card.range : 0.8);
    this.rangeRing.scale.set(radius, radius, 1);
    (this.rangeRing.material as T.MeshBasicMaterial).color.setHex(
      valid ? 0x9bffca : 0xff536a,
    );
    if (card.kind !== "spell") this.deployment.show(id, point, valid);
    else this.deployment.object.visible = false;
    this.placementFeedback.classList.toggle("invalid", !valid);
    const feedback = valid
      ? `${card.name}${card.count > 1 ? ` ×${card.count}` : ""} · Level 11`
      : reason || "Cannot deploy here";
    if (this.placementFeedback.textContent !== feedback)
      this.placementFeedback.textContent = feedback;
    this.positionPlacementFeedback();
  }
  private positionPlacementFeedback() {
    const point = this.placement?.point;
    if (!point) return;
    const p = this.screen(
      point.x,
      point.y,
      CARD_MAP[this.placement!.card].air ? 5 : 3.2,
    );
    const x = T.MathUtils.clamp(p.x, 92, Math.max(92, this.width - 92));
    const labelHeight = this.placementFeedback.offsetHeight;
    const y = T.MathUtils.clamp(
      p.y,
      labelHeight + 8,
      Math.max(labelHeight + 8, this.height - 12),
    );
    this.placementFeedback.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`;
  }
  render(dt: number, time: number, effectDelta = dt) {
    if (this.destroyed || this.contextLost) return;
    for (let i = 0; i < this.waters.length; i++) {
      const wave = this.waters[i];
      wave.position.x += dt * 0.35;
      if (wave.position.x > 10) wave.position.x = -10;
      (wave.material as T.MeshBasicMaterial).opacity =
        0.2 + Math.sin(time * 1.8 + i) * 0.12;
    }
    for (let i = 0; i < this.flags.length; i++) {
      const f = this.flags[i],
        positions = f.geometry.attributes.position,
        base = f.userData.base as Float32Array;
      for (let j = 0; j < positions.count; j++) {
        positions.setZ(
          j,
          base[j * 3 + 2] +
            Math.sin(time * 3 + base[j * 3] * 4 + i) *
              0.11 *
              (base[j * 3] + 0.56),
        );
      }
      positions.needsUpdate = true;
      f.geometry.computeVertexNormals();
    }
    const b = this.battle;
    if (!b) return;
    this.shake.consume(b.audioEvents, b.seed, b.time);
    const shake = this.shake.update(effectDelta, this.reducedMotion.matches);
    // Native effect points share the renderer's existing 30-points-per-tile
    // art scale. Projection shifts preserve ray picking and HUD crown anchors.
    const pixelsPerUnit =
      this.width / (this.camera.right - this.camera.left) / 30;
    if (shake.x || shake.y)
      this.camera.setViewOffset(
        this.width,
        this.height,
        -shake.x * pixelsPerUnit,
        -shake.y * pixelsPerUnit,
        this.width,
        this.height,
      );
    else if (this.camera.view?.enabled) this.camera.clearViewOffset();
    // Authored effects use elapsed presentation time. Movement and legacy
    // particle integration keep the bounded step supplied separately.
    this.destruction.advance(effectDelta);
    const ruins = destroyedTowerSites(b.entities);
    const ruinKeys = new Set(ruins.map((s) => `${s.team}-${s.x}`));
    for (const [key, mesh] of this.rubble)
      if (!ruinKeys.has(key)) {
        this.scene.remove(mesh);
        this.rubble.delete(key);
      }
    for (const site of ruins) {
      const key = `${site.team}-${site.x}`;
      let mesh = this.rubble.get(key);
      if (!mesh) {
        mesh = this.buildings.rubble(site.king) ?? undefined;
        if (!mesh) continue;
        mesh.position.set(site.x - 9, 0.19, site.y - 16);
        this.rubble.set(key, mesh);
        this.scene.add(mesh);
      }
      // Ground artwork retains its authored projected proportions without the
      // bottom half of a billboard intersecting the opaque arena floor.
      mesh.rotation.x = -Math.PI / 2;
      mesh.scale.y =
        1 /
        Math.abs(
          new T.Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion).y,
        );
    }
    for (const mesh of this.artwork)
      mesh.quaternion.copy(this.camera.quaternion);
    const alive = new Set<number>();
    for (const e of b.entities) {
      alive.add(e.id);
      let v = this.units.get(e.id);
      if (!v) {
        let object: T.Group,
          model: Model | undefined,
          sprite: AnimatedSprite | undefined,
          towerArcher: AnimatedSprite | undefined,
          buildingSprite: BuildingSprite | undefined,
          art: T.Mesh | undefined;
        const tower = this.towerArt.get(
          `${e.king ? "king" : "princess-base"}-${e.team}`,
        );
        if (
          e.kind === "tower" &&
          (buildingSprite =
            this.buildings.make(e.king ? "king" : "princess", e.team) ??
            undefined)
        ) {
          object = new T.Group();
          object.add(buildingSprite.mesh);
        } else if (e.kind === "tower" && tower) {
          object = new T.Group();
          const width = e.king ? 3.5 : 2.85,
            height = width / tower.aspect;
          const geometry = new T.PlaneGeometry(width, height);
          geometry.translate(
            (0.5 - tower.anchor[0]) * width,
            (0.5 - tower.anchor[1]) * height,
            0,
          );
          art = new T.Mesh(
            geometry,
            new T.MeshBasicMaterial({
              map: tower.texture,
              transparent: true,
              alphaTest: 0.04,
              depthTest: false,
              depthWrite: false,
              toneMapped: false,
              side: T.DoubleSide,
            }),
          );
          object.add(art);
        } else if (
          e.kind === "building" &&
          (buildingSprite = this.buildings.make(e.card, e.team) ?? undefined)
        ) {
          object = new T.Group();
          object.add(buildingSprite.mesh);
        } else if (
          ["cannon", "tesla"].includes(e.card) &&
          this.towerArt.has(`${e.card}-${e.team}`)
        ) {
          const a = this.towerArt.get(`${e.card}-${e.team}`)!;
          object = new T.Group();
          const width = e.card === "balloon" ? 3 : 2.2,
            height = width / a.aspect;
          const geometry = new T.PlaneGeometry(width, height);
          geometry.translate(0, (0.5 - a.anchor[1]) * height, 0);
          art = new T.Mesh(
            geometry,
            new T.MeshBasicMaterial({
              map: a.texture,
              transparent: true,
              alphaTest: 0.04,
              depthTest: false,
              depthWrite: false,
              toneMapped: false,
              side: T.DoubleSide,
            }),
          );
          object.add(art);
        } else if (e.kind === "tower") object = towerModel(e.team, !!e.king);
        else if (e.kind === "building")
          object = buildingModel(e.card as CardId, e.team);
        else {
          sprite = this.sprites.make(e.card as CardId) ?? undefined;
          if (sprite) {
            object = new T.Group();
            object.add(sprite.mesh);
            const shadow = new T.Mesh(
              new T.CircleGeometry(e.radius * 1.2, 16),
              new T.MeshBasicMaterial({
                color: 0x173721,
                transparent: true,
                opacity: 0.22,
                depthWrite: false,
              }),
            );
            shadow.rotation.x = -Math.PI / 2;
            shadow.position.y = 0.02;
            object.add(shadow);
          } else {
            model = troopModel(e.card as CardId, e.team);
            object = model.group;
          }
        }
        if (e.kind === "tower" && !e.king) {
          const archer =
            this.sprites.make("tower-princess") ?? this.sprites.make("archers");
          if (archer) {
            towerArcher = archer;
            archer.mesh.position.set(0, 1.6, -0.15);
            if (buildingSprite?.princess) {
              // Preserve screen placement in the tower's billboard plane, with
              // the character between the native base and front battlements.
              archer.mesh.position.set(0, buildingSprite.princess.height, 0);
              archer.mesh.position.applyQuaternion(
                this.camera.quaternion.clone().invert(),
              );
              archer.mesh.position.z = 0.01;
              buildingSprite.mesh.add(archer.mesh);
            } else object.add(archer.mesh);
          }
        }
        // Rebuilt/seeked entities may already be old while the clock is paused.
        // Initialize their actual position before any movement interpolation.
        object.position.set(e.x - 9, e.air ? 2.2 : 0.2, e.y - 16);
        this.scene.add(object);
        v = {
          object,
          model,
          sprite,
          art,
          archer: towerArcher,
          building: buildingSprite,
        };
        if (e.kind === "tower") {
          const label = document.createElement("div");
          label.className = `tower-health ${e.team}`;
          label.dataset.entityId = String(e.id);
          label.innerHTML = "<span></span><i><b></b></i>";
          this.labels.append(label);
          v.label = label;
        } else {
          const ring = new T.Mesh(
            new T.RingGeometry(e.radius * 1.1, e.radius * 1.35, 24),
            new T.MeshBasicMaterial({
              color: teamColor(e.team),
              transparent: true,
              opacity: 0.8,
              depthWrite: false,
              side: T.DoubleSide,
            }),
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = 0.03;
          object.add(ring);
          v.nativeHealth = this.health.make(e) ?? undefined;
          if (v.nativeHealth) this.scene.add(v.nativeHealth.mesh);
          else {
            const health = new T.Group();
            const back = new T.Mesh(
              new T.PlaneGeometry(0.95, 0.16),
              new T.MeshBasicMaterial({ color: 0x20312d, depthWrite: false }),
            );
            const fill = new T.Mesh(
              new T.PlaneGeometry(0.85, 0.09),
              new T.MeshBasicMaterial({
                color: teamColor(e.team),
                depthWrite: false,
              }),
            );
            fill.position.z = 0.008;
            health.add(back, fill);
            health.renderOrder = 3;
            object.add(health);
            v.health = health;
            v.healthFill = fill;
          }
        }
        this.units.set(e.id, v);
      }
      this.updateUnit(v, e, dt, time);
    }
    for (const [id, v] of this.units)
      if (!alive.has(id)) {
        this.scene.remove(v.object);
        this.disposeObject(v.object);
        v.label?.remove();
        if (v.nativeHealth) this.scene.remove(v.nativeHealth.mesh);
        this.units.delete(id);
      }
    this.infernoBeams.update(b.entities, this.camera);
    const liveShots = new Set<number>();
    for (const p of b.projectiles) {
      liveShots.add(p.id);
      let shot = this.shots.get(p.id);
      if (!shot) {
        shot = makeProjectile(p, this.effects);
        this.shots.set(p.id, shot);
        this.scene.add(shot.object);
      }
      const target = b.entities.find((e) => e.id === p.target && e.hp > 0);
      updateProjectile(shot, p, this.effects, this.camera, target);
      if (p.style === "rocket" && p.speed && this.effects.asset) {
        const age = p.elapsed ?? 0;
        const cycle = Math.floor((age + 1e-8) / 0.8);
        const last = this.trailCycles.get(p.id) ?? -1;
        const duration = Math.hypot(p.tx - p.x, p.ty - p.y) / p.speed;
        for (let i = last + 1; i <= cycle; i++)
          this.destruction.burstAlong(
            "trail:rocket",
            (seconds) => rocketFlightPoint(p, seconds),
            duration,
            i * 0.8,
            b.seed ^ p.id ^ Math.imul(i, 0x9e3779b9),
            p.team,
            age,
          );
        this.trailCycles.set(p.id, cycle);
      }
      if (p.style === "log" && p.speed && this.effects.asset) {
        const age = p.elapsed ?? 0;
        const cycle = Math.floor((age + 1e-8) / 0.8);
        const last = this.trailCycles.get(p.id) ?? -1;
        for (let i = last + 1; i <= cycle; i++)
          this.destruction.burstAlong(
            "trail:log",
            (seconds) => logFlightPoint(p, seconds),
            p.duration,
            i * 0.8,
            b.seed ^ p.id ^ Math.imul(i, 0x9e3779b9),
            p.team,
            age,
          );
        this.trailCycles.set(p.id, cycle);
      }
      if (p.style === "dart-goblin" && p.speed && this.effects.asset) {
        // The source emitter lays fifteen fragments across one short dart flight.
        // Rebuilding a late snapshot retains only fragments still alive.
        if (!this.trailCycles.has(p.id)) {
          const duration = Math.hypot(p.tx - p.x, p.ty - p.y) / p.speed;
          this.destruction.burstAlong(
            "trail:dart-goblin",
            (seconds) => rocketFlightPoint(p, seconds),
            duration,
            0,
            b.seed ^ p.id,
            p.team,
            p.elapsed ?? 0,
          );
          this.trailCycles.set(p.id, 0);
        }
      }
      if (p.style === "ice-wizard" && p.speed && this.effects.asset) {
        if (!this.trailCycles.has(p.id)) {
          const duration = Math.hypot(p.tx - p.x, p.ty - p.y) / p.speed;
          this.destruction.burstAlong(
            "trail:ice-wizard",
            (seconds) => curvedFlightPoint(p, seconds),
            duration,
            0,
            b.seed ^ p.id,
            p.team,
            p.elapsed ?? 0,
          );
          this.trailCycles.set(p.id, 0);
        }
      }
      if (p.style === "princess" && p.speed && this.effects.asset) {
        if (!this.trailCycles.has(p.id)) {
          const duration = Math.hypot(p.tx - p.x, p.ty - p.y) / p.speed;
          this.destruction.burstAlong(
            "trail:princess",
            (seconds) => curvedFlightPoint(p, seconds),
            duration,
            0,
            b.seed ^ p.id,
            p.team,
            p.elapsed ?? 0,
          );
          this.trailCycles.set(p.id, 0);
        }
      }
      if (
        dt > 0 &&
        !b.winner &&
        shot.object.visible &&
        ["fireball", "wizard", "baby-dragon"].includes(p.style) &&
        Math.random() < 0.6
      )
        this.particle(
          shot.object.position,
          0xffab3d,
          p.style === "fireball" ? 0.12 : 0.06,
          0.3,
          0.4,
        );
    }
    for (const [id, s] of this.shots)
      if (!liveShots.has(id)) {
        this.scene.remove(s.object);
        this.disposeObject(s.object);
        this.shots.delete(id);
        this.trailCycles.delete(id);
      }
    for (const event of b.events) {
      if (event.id <= this.lastEvent) continue;
      this.lastEvent = event.id;
      const eventAge = Math.max(0, b.time - event.time);
      const pos = new T.Vector3(event.x - 9, 0.6, event.y - 16);
      if (event.type === "spell" && event.card === "freeze") {
        for (const effect of ["freeze", "freeze-loop"] as const)
          this.destruction.burst(
            effect,
            new T.Vector3(event.x - 9, 0.2, event.y - 16),
            b.seed ^ event.id,
            event.team,
            eventAge,
          );
      }
      if (event.type === "spell" && event.card === "poison") {
        const origin = new T.Vector3(event.x - 9, 0.2, event.y - 16);
        this.destruction.burst(
          "poison",
          origin,
          b.seed ^ event.id,
          event.team,
          eventAge,
        );
        // The archived loop emitter lasts three seconds; repeat it across the
        // eight-second area. Negative age schedules later cycles on the same
        // clock and also reconstructs them after a late snapshot or seek.
        for (const [index, offset] of [0, 3, 6].entries())
          this.destruction.burst(
            "poison-loop",
            origin,
            b.seed ^ event.id ^ Math.imul(index, 0x9e3779b9),
            event.team,
            eventAge - offset,
          );
      }
      if (event.type === "spell" && event.card === "rage") {
        const origin = new T.Vector3(event.x - 9, 0.2, event.y - 16);
        this.destruction.burst(
          "rage",
          origin,
          b.seed ^ event.id,
          event.team,
          eventAge,
        );
        for (const [index, offset] of [0, 3].entries())
          this.destruction.burst(
            "rage-loop",
            origin,
            b.seed ^ event.id ^ Math.imul(index, 0x9e3779b9),
            event.team,
            eventAge - offset,
          );
      }
      if (event.type === "spell" && event.card === "tornado")
        this.destruction.burst(
          "tornado",
          new T.Vector3(event.x - 9, 0.2, event.y - 16),
          b.seed ^ event.id,
          event.team,
          eventAge,
        );
      if (event.type === "spell" && event.card === "graveyard")
        this.destruction.burst(
          "graveyard",
          new T.Vector3(event.x - 9, 0.2, event.y - 16),
          b.seed ^ event.id,
          event.team,
          eventAge,
        );
      if (event.type === "spell" && event.card === "clone")
        this.destruction.burst(
          "clone",
          new T.Vector3(event.x - 9, 0.2, event.y - 16),
          b.seed ^ event.id,
          event.team,
          eventAge,
        );
      if (event.type === "deploy" && event.effect === "graveyard-appear")
        this.destruction.burst(
          "graveyard-appear",
          new T.Vector3(event.x - 9, 0.2, event.y - 16),
          b.seed ^ event.id,
          event.team,
          eventAge,
        );
      if (event.type === "deploy" && event.effect === "clone-appear")
        this.destruction.burst(
          "clone-appear",
          new T.Vector3(event.x - 9, 0.35, event.y - 16),
          b.seed ^ event.id,
          event.team,
          eventAge,
        );
      if (event.type === "hit") {
        const impactPosition = new T.Vector3(
          event.x - 9,
          event.height ?? 0.6,
          event.y - 16,
        );
        if ((event.card === "tesla" || event.card === "electro-wizard") && event.origin) {
          const origin = new T.Vector3(
            event.origin.x - 9,
            event.origin.height,
            event.origin.y - 16,
          );
          const direction = impactPosition
            .clone()
            .sub(origin)
            .applyQuaternion(this.camera.quaternion.clone().invert());
          const electro = event.card === "electro-wizard";
          const name = electro ? "electro_wiz_beam" : "tesla_beam";
          const beam = this.impact(name, origin, electro ? 0.27 : 0.3, eventAge);
          if (beam) {
            const angle = Math.atan2(direction.y, direction.x);
            if (electro) {
              const bounds = (this.effects.asset!.data.clips[name] as unknown as { bounds: number[] }).bounds;
              const scale = Math.hypot(direction.x, direction.y) / ((bounds[2] - bounds[0]) / 30);
              const offset = new T.Vector3(
                Math.cos(angle) * -bounds[0] / 30 * scale,
                Math.sin(angle) * -bounds[0] / 30 * scale,
                0,
              ).applyQuaternion(this.camera.quaternion);
              beam.mesh.position.add(offset);
              beam.mesh.scale.set(scale, 1, 1);
            } else beam.mesh.scale.set(Math.hypot(direction.x, direction.y) / 2.7, 0.7, 1);
            beam.mesh.rotateZ(angle);
          }
        }
        const nativeImpact = event.effect ?? impactEffect(event.card ?? "");
        if (nativeImpact && this.effects.asset) {
          const offsets =
            event.card === "arrows" && event.arrowVolley
              ? arrowOffsets(
                  event.arrowVolley.projectileId,
                  event.arrowVolley.staggered,
                  event.team,
                )
              : [{ x: 0, y: 0 }];
          offsets.forEach((offset, i) =>
            this.destruction.burst(
              nativeImpact,
              new T.Vector3(
                event.x - 9 + offset.x,
                0.2,
                event.y - 16 + offset.y,
              ),
              b.seed ^ event.id ^ Math.imul(i, 0x9e3779b9),
              event.team,
              eventAge,
            ),
          );
          continue;
        }
        if ((event.card === "tesla" || event.card === "electro-wizard") && event.origin) {
          continue;
        } else if (event.card === "zap") {
          const bolt = this.impact(
            "zap_bolt1",
            impactPosition,
            11 / 30,
            eventAge,
          );
          if (bolt) bolt.mesh.scale.set(0.8, 0.22, 1);
          this.impact(
            "ExplosionGroundGlowBlue",
            pos,
            10 / 30,
            eventAge,
          )?.mesh.scale.setScalar(1.7);
        } else {
          const flash = this.impact(
            "effect_Hit1",
            impactPosition,
            5 / 60,
            eventAge,
          );
          if (flash)
            flash.mesh.scale.setScalar(
              event.card === "fireball"
                ? 2.6
                : event.card === "arrows"
                  ? 0.8
                  : 0.45,
            );
        }
        const spell =
          event.card === "fireball" ||
          event.card === "arrows" ||
          event.card === "zap";
        for (let i = 0; i < (spell ? 22 : 5); i++)
          this.particle(
            pos,
            event.card === "zap" ? 0xaff3ff : spell ? 0xffae3c : 0xffe8a1,
            spell ? 0.13 : 0.07,
            spell ? 0.7 : 0.3,
            spell ? 4 : 2,
          );
      }
      if (event.type === "death" && this.effects.asset) {
        const site = TOWER_SITES.find(
          (s) => s.team === event.team && s.x === event.x && s.y === event.y,
        );
        const effect = deathEffect(event.card ?? "", !!site?.king);
        if (effect)
          this.destruction.burst(
            effect,
            new T.Vector3(
              event.x - 9,
              event.card && event.card !== "tower" && CARD_MAP[event.card].air
                ? 2.2
                : 0.2,
              event.y - 16,
            ),
            b.seed ^ event.id,
            event.team,
            eventAge,
          );
      } else if (event.type === "death")
        for (let i = 0; i < (event.card === "tower" ? 55 : 9); i++)
          this.particle(
            pos,
            event.card === "tower" ? 0xc7c3a6 : 0xcc8ae6,
            event.card === "tower" ? 0.22 : 0.09,
            1,
            4,
          );
      if (event.type === "deploy" && !this.effects.asset)
        for (let i = 0; i < 12; i++) this.particle(pos, 0xf2d09e, 0.08, 0.7, 2);
      if (event.type === "crown") {
        this.crowns.burst(
          event.team,
          new T.Vector3(event.x - 9, 3, event.y - 16),
          event.value ?? 1,
          this.destruction.time,
          eventAge,
        );
        for (let i = 0; i < 24; i++)
          this.particle(
            new T.Vector3(event.x - 9, 3, event.y - 16),
            0xffcd4d,
            0.16,
            1.5,
            5,
          );
      }
    }
    for (const p of this.particles) {
      p.life -= dt;
      p.velocity.y -= dt * 5;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.scale.setScalar(Math.max(0, p.life / p.max));
    }
    const dead = this.particles.filter((p) => p.life <= 0);
    for (const p of dead) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    this.impacts = this.impacts.filter((impact) => {
      const age = this.destruction.time - impact.start;
      if (age >= impact.life) {
        this.scene.remove(impact.sprite.mesh);
        return false;
      }
      this.effects.animate(impact.sprite, age);
      return true;
    });
    this.crowns.update(
      this.destruction.time,
      this.camera,
      this.width,
      this.height,
      this.crownTarget,
    );
    for (const burst of this.deploymentEffects.consume(
      b.audioEvents,
      b.entities,
      b.seed,
      b.time,
    ))
      this.destruction.burst(
        burst.effect,
        new T.Vector3(burst.origin.x - 9, 0.2, burst.origin.y - 16),
        burst.seed,
        burst.team,
        burst.age,
      );
    for (const burst of this.launchEffects.consume(
      b.audioEvents,
      b.seed,
      b.time,
    ))
      this.destruction.burst(
        burst.effect,
        new T.Vector3(burst.origin.x - 9, 1.1, burst.origin.y - 16),
        burst.seed,
        burst.team,
        burst.age,
      );
    for (const burst of this.movementEffects.consume(
      b.entities,
      b.seed,
      b.time,
    )) {
      this.destruction.burst(
        burst.effect,
        new T.Vector3(burst.origin.x - 9, 0.06, burst.origin.y - 16),
        burst.seed,
        burst.team,
        burst.age,
      );
      if (burst.effect === "charge:prince") {
        this.chargeMarkers.burst(burst.actor, this.destruction.time, burst.age);
        this.chargeFilter.burst(burst.actor, this.destruction.time, burst.age);
        this.onCharge(burst);
      }
    }
    for (const burst of this.hogLandings.consume(b.entities, b.seed, b.time))
      this.destruction.burst(
        burst.effect,
        new T.Vector3(burst.origin.x - 9, 0.06, burst.origin.y - 16),
        burst.seed,
        burst.team,
        burst.age,
      );
    this.chargeMarkers.update(b.entities, this.destruction.time, this.width);
    this.deployFilter.update(b.entities, (id) => this.units.get(id)?.sprite);
    this.cloneFilter.update(b.entities, (id) => this.units.get(id)?.sprite);
    this.spellAreas.update(b.areas);
    this.chargeFilter.update(
      b.entities,
      this.destruction.time,
      (id) => this.units.get(id)?.sprite,
    );
    this.coldFilter.update(
      b.entities,
      this.destruction.time,
      (id) => this.units.get(id)?.sprite,
    );
    this.poisonFilter.update(
      b.entities,
      this.destruction.time,
      (id) => this.units.get(id)?.sprite,
    );
    this.rageFilter.update(
      b.entities,
      this.destruction.time,
      (id) => this.units.get(id)?.sprite,
    );
    this.coldStructures.update(b.entities, this.destruction.time, (id) =>
      this.coldStructureParts(id),
    );
    this.destruction.update(0, this.camera);
    this.deployment.render(time, this.camera);
    this.positionPlacementFeedback();
    this.renderer.render(this.scene, this.camera);
  }
  private impact(name: string, position: T.Vector3, life: number, age = 0) {
    if (this.impacts.length >= 120 || !this.battle || age >= life) return null;
    const sprite = this.effects.make(name);
    if (!sprite) return null;
    sprite.mesh.position.copy(position);
    sprite.mesh.quaternion.copy(this.camera.quaternion);
    this.scene.add(sprite.mesh);
    this.impacts.push({ sprite, start: this.destruction.time - age, life });
    return sprite;
  }
  private updateUnit(v: Visual, e: Entity, dt: number, time: number) {
    const o = v.object;
    const y = e.air ? 2.2 : 0.2;
    const jump = hogJumpHeight(e);
    const oldX = o.position.x,
      oldZ = o.position.z;
    o.position.x = T.MathUtils.damp(o.position.x, e.x - 9, 25, dt);
    o.position.z = T.MathUtils.damp(o.position.z, e.y - 16, 25, dt);
    if (e.age < 0.1 || e.kind === "tower") {
      o.position.x = e.x - 9;
      o.position.z = e.y - 16;
    }
    const moving =
      Math.abs(o.position.x - oldX) + Math.abs(o.position.z - oldZ) > 0.002;
    o.position.y =
      y +
      (e.air
        ? Math.sin(time * 4 + e.id) * 0.12
        : moving && e.kind === "troop"
          ? Math.abs(Math.sin(time * 9 + e.id)) * 0.05
          : 0);
    if (v.sprite) {
      v.sprite.mesh.position.y = jump;
      const target = this.battle?.entities.find((t) => t.id === e.target);
      this.sprites.update(v.sprite, e, target, moving, time, this.camera, {
        x: o.position.x - oldX,
        y: o.position.z - oldZ,
      });
    }
    if (v.building)
      this.buildings.update(
        v.building,
        e,
        this.battle?.entities.find((t) => t.id === e.target),
        this.camera,
        time,
      );
    if (v.archer) {
      const target = this.battle?.entities.find((t) => t.id === e.target);
      this.sprites.update(v.archer, e, target, false, time, this.camera);
      if (v.building?.princess) v.archer.mesh.quaternion.identity();
    }
    if (v.art) {
      v.art.quaternion.copy(this.camera.quaternion);
      v.art.renderOrder = 1;
    }
    if (v.nativeHealth) {
      const offset = this.health.data?.profiles[e.card]?.offsetY ?? 0;
      const height = e.burrow
        ? 0.65 + e.burrow.exposure * 2.05
        : v.sprite
          ? (v.sprite.asset.data.anchor[1] - v.sprite.asset.data.bounds[1]) *
              v.sprite.asset.scale +
            0.35 +
            offset * v.sprite.asset.scale * 0.5
          : 1.9;
      this.healthPosition.copy(o.position);
      this.healthPosition.y += height + jump;
      this.health.update(
        v.nativeHealth,
        e,
        this.camera,
        this.healthPosition,
        (this.camera.right - this.camera.left) / this.width,
      );
    }
    if (v.health && v.healthFill) {
      v.health.visible = e.hp < e.maxHp && e.deploy <= 0;
      v.health.position.set(
        0,
        jump +
          (e.burrow
            ? 0.65 + e.burrow.exposure * 2.05
            : e.card === "giant" || e.card === "pekka"
              ? 2.5
              : e.card === "balloon"
                ? 3.8
                : 1.9),
        0,
      );
      v.health.quaternion.copy(this.camera.quaternion);
      v.healthFill.scale.x = e.hp / e.maxHp;
      v.healthFill.position.x = -(1 - e.hp / e.maxHp) * 0.425;
    }
    if (e.kind !== "tower" && !v.sprite && !v.art && !v.building) {
      const target = this.battle?.entities.find((t) => t.id === e.target);
      const targetAngle = target
        ? Math.atan2(target.x - e.x, target.y - e.y)
        : e.team === "blue"
          ? Math.PI
          : 0;
      let diff = targetAngle - o.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      o.rotation.y += diff * Math.min(1, dt * 12);
      if (v.model) {
        const m = v.model;
        for (let i = 0; i < m.legs.length; i++)
          m.legs[i].rotation.x = moving
            ? Math.sin(time * 10 + e.id + i * Math.PI) * 0.55
            : 0;
        for (let i = 0; i < m.arms.length; i++)
          m.arms[i].rotation.x =
            e.attack > 0
              ? -Math.sin((e.attack / e.interval) * Math.PI) * 1.2
              : moving
                ? Math.sin(time * 10 + e.id + i * Math.PI) * 0.22
                : 0;
        for (let i = 0; i < m.wings.length; i++)
          m.wings[i].rotation.z =
            Math.sin(time * 9 + e.id) * (i === 0 ? -1 : 1) * 0.55;
        const scale =
          m.scale * (e.deploy > 0 ? Math.max(0.05, 1 - e.deploy) : 1);
        o.scale.setScalar(scale);
      }
    }
    if (e.kind === "tower" && e.team === "red" && !v.art && !v.building)
      o.rotation.y = Math.PI;
    if (v.label) {
      const native = this.health.tower(v.label, e);
      const p = this.screen(e.x, e.y, native && e.team === "blue" ? 0.25 : 4);
      const y = native ? Math.min(this.height - 48, Math.max(18, p.y)) : p.y;
      const transform = `translate(${p.x}px,${y}px) translate(-50%,-50%)`;
      if (v.labelTransform !== transform) {
        v.label.style.transform = transform;
        v.labelTransform = transform;
      }
      if (!native) {
        v.label.querySelector("span")!.textContent = Math.ceil(
          e.hp,
        ).toLocaleString();
        (v.label.querySelector("b") as HTMLElement).style.width =
          `${(e.hp / e.maxHp) * 100}%`;
      }
    }
  }
  private particle(
    pos: T.Vector3,
    color: number,
    size: number,
    life: number,
    speed: number,
  ) {
    if (this.particles.length > 400) return;
    const mesh = new T.Mesh(new T.IcosahedronGeometry(size, 0), mat(color));
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.particles.push({
      mesh,
      velocity: new T.Vector3(
        (Math.random() - 0.5) * speed,
        Math.random() * speed,
        (Math.random() - 0.5) * speed,
      ),
      life,
      max: life,
    });
  }
  private disposeObject(object: T.Object3D) {
    object.traverse((o) => {
      if (o instanceof T.Mesh && !o.geometry.userData.shared)
        o.geometry.dispose();
    });
  }
  destroy() {
    this.destroyed = true;
    this.observer.disconnect();
    this.scene.traverse((o) => {
      if (o instanceof T.Mesh && !o.geometry.userData.shared)
        o.geometry.dispose();
    });
    this.deployment.clear();
    this.destruction.clear();
    this.crowns.clear();
    this.chargeMarkers.destroy();
    this.chargeFilter.clear();
    this.deployFilter.clear();
    this.cloneFilter.clear();
    this.coldFilter.clear();
    this.poisonFilter.clear();
    this.rageFilter.clear();
    this.coldStructures.clear();
    this.infernoBeams.clear();
    this.spriteFilters.clear();
    this.spellAreas.clear();
    this.placementFeedback.remove();
    this.sprites.destroy();
    this.effects.destroy();
    this.buildings.destroy();
    this.health.destroy();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.remove();
  }
}
