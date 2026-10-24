import { CARD_MAP, STARTER_DECK } from "./cards";
import type { CardId } from "./cards";
import { damageSpellTarget, isDamageSpell } from "./spell-targeting";
import { deploymentPositions } from "./deployment";
import {
  combatTraits,
  FIREBALL_SPEED,
  FIREBALL_KNOCKBACK,
  ARROWS_SPEED,
  ARROWS_WAVES,
  ARROWS_WAVE_GAP,
  KING_ACTIVATION_TIME,
} from "./combat";
import { TOWER_SITES } from "./arena-layout";
import { audioProfile } from "./combat-audio-events";
import freeze from "./freeze-data.json" with { type: "json" };
import poison from "./poison-data.json" with { type: "json" };
import rocket from "./rocket-data.json" with { type: "json" };
import rage from "./rage-data.json" with { type: "json" };
import type {
  AudioProfile,
  CombatAudioEvent,
  CombatAudioPhase,
} from "./combat-audio-events";
export type Team = "blue" | "red";
export type Mode = "classic" | "training" | "double";
export const STEP = 1 / 30;
export const other = (t: Team): Team => (t === "blue" ? "red" : "blue");
export interface Point {
  x: number;
  y: number;
}
export interface Entity extends Point {
  id: number;
  team: Team;
  card: CardId | "tower";
  kind: "troop" | "building" | "tower";
  hp: number;
  maxHp: number;
  radius: number;
  air: boolean;
  damage: number;
  range: number;
  cooldown: number;
  interval: number;
  speed: number;
  target: number | null;
  age: number;
  deploy: number;
  stun: number;
  poison?: { remaining: number; elapsed: number };
  rage?: { remaining: number };
  animationTime?: number;
  attack: number;
  move: number;
  king?: boolean;
  active: boolean;
  activation?: number;
  lane?: "left" | "right";
  lifetime?: number;
  spawnTimer: number;
  pendingAttack?: { target: number; remaining: number; damage: number };
  burrow?: {
    exposure: number;
    idle: number;
    phase: "hidden" | "rising" | "exposed" | "sinking";
  };
}
export interface Projectile extends Point {
  id: number;
  team: Team;
  tx: number;
  ty: number;
  target: number | null;
  damage: number;
  remaining: number;
  duration: number;
  splash: number;
  air: boolean;
  style: string;
  stun: number;
  source: number;
  flight?: Point;
  speed?: number;
  homing?: boolean;
  elapsed?: number;
  delay?: number;
  fromHeight?: number;
  toHeight?: number;
  arc?: number;
  knockback?: number;
  crownTowerDamageFraction?: number;
}
export interface AreaEffect extends Point {
  id: number;
  team: Team;
  card: "freeze" | "poison" | "rage";
  radius: number;
  duration: number;
  remaining: number;
  hitAt?: number;
}
export interface BattleEvent extends Point {
  id: number;
  time: number;
  type: "deploy" | "hit" | "death" | "crown" | "spell" | "phase" | "finish";
  team: Team;
  card?: CardId | "tower";
  value?: number;
  origin?: Point & { height: number };
  height?: number;
  effect?: "balloon-bomb";
  arrowVolley?: { projectileId: number; staggered: boolean };
}
export interface Action extends Point {
  tick: number;
  team: Team;
  card: CardId;
}
export interface Replay {
  perspective?: Team;
  version: 1 | 2 | 3 | 4 | 5;
  seed: number;
  mode: Mode;
  deck: CardId[];
  enemyDeck: CardId[];
  actions: Action[];
  duration: number;
}
export interface PlayerState {
  elixir: number;
  hand: CardId[];
  queue: CardId[];
  crowns: number;
}
export interface EngineOptions {
  seed?: number;
  mode?: Mode;
  deck?: CardId[];
  enemyDeck?: CardId[];
  replay?: Replay;
  ai?: boolean;
}
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
export class Battle {
  readonly seed: number;
  readonly mode: Mode;
  readonly deck: CardId[];
  readonly enemyDeck: CardId[];
  readonly rulesVersion: Replay["version"];
  tick = 0;
  entities: Entity[] = [];
  projectiles: Projectile[] = [];
  areas: AreaEffect[] = [];
  events: BattleEvent[] = [];
  // Presentation IDs never consume simulation/entity IDs or the battle RNG.
  audioEvents: CombatAudioEvent[] = [];
  private nextAudioId = 1;
  private audioAttacks = new Map<number, number>();
  private audioProjectiles = new Map<number, AudioProfile>();
  actions: Action[] = [];
  players: Record<Team, PlayerState>;
  winner: Team | "draw" | null = null;
  reason = "";
  private randomState: number;
  private nextId = 1;
  private aiTimer = 2.5;
  private ai: boolean;
  private replayActions: Action[] | null;
  private replayIndex = 0;
  constructor(options: EngineOptions = {}) {
    const r = options.replay;
    this.rulesVersion = r?.version ?? 5;
    this.seed = r?.seed ?? options.seed ?? Date.now() % 2147483647;
    this.randomState = this.seed || 1;
    this.mode = r?.mode ?? options.mode ?? "classic";
    this.deck = [...(r?.deck ?? options.deck ?? STARTER_DECK)];
    this.enemyDeck = [
      ...(r?.enemyDeck ??
        options.enemyDeck ?? [
          "giant",
          "archers",
          "knight",
          "bomber",
          "minions",
          "fireball",
          "mini-pekka",
          "arrows",
        ]),
    ];
    this.validateDeck(this.deck);
    this.validateDeck(this.enemyDeck);
    this.ai = !r && (options.ai ?? true);
    this.replayActions = r?.actions ?? null;
    const player = (deck: CardId[]): PlayerState => {
      const shuffled = [...deck];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return {
        elixir: 5,
        hand: shuffled.slice(0, 4),
        queue: shuffled.slice(4),
        crowns: 0,
      };
    };
    this.players = { blue: player(this.deck), red: player(this.enemyDeck) };
    for (const site of TOWER_SITES)
      this.makeTower(site.team, site.x, site.y, site.king, site.lane);
  }
  private validateDeck(deck: CardId[]) {
    if (
      deck.length !== 8 ||
      new Set(deck).size !== 8 ||
      deck.some((id) => typeof id !== "string" || !Object.hasOwn(CARD_MAP, id))
    )
      throw new Error("A deck must contain eight unique valid cards.");
  }
  random() {
    this.randomState =
      (Math.imul(1664525, this.randomState) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }
  get time() {
    return this.tick * STEP;
  }
  get phase() {
    return this.time >= 240
      ? "triple"
      : this.time >= 180
        ? "overtime"
        : this.time >= 120
          ? "double"
          : "normal";
  }
  get multiplier() {
    return this.mode === "double"
      ? this.time >= 240
        ? 3
        : 2
      : this.time >= 240
        ? 3
        : this.time >= 120
          ? 2
          : 1;
  }
  get remaining() {
    return Math.max(0, (this.time >= 180 ? 300 : 180) - this.time);
  }
  private makeTower(
    team: Team,
    x: number,
    y: number,
    king: boolean,
    lane?: "left" | "right",
  ) {
    this.entities.push({
      id: this.nextId++,
      team,
      x,
      y,
      card: "tower",
      kind: "tower",
      hp: king ? 4824 : 3052,
      maxHp: king ? 4824 : 3052,
      radius: king ? 1.25 : 1.05,
      air: false,
      damage: king ? 109 : 109,
      range: king ? 7 : 7.5,
      cooldown: 0,
      interval: king ? 1 : 0.8,
      speed: 0,
      target: null,
      age: 0,
      deploy: 0,
      stun: 0,
      attack: 0,
      move: 0,
      king,
      lane,
      active: !king,
      spawnTimer: 0,
      ...(king && this.rulesVersion >= 4 ? { activation: 0 } : {}),
    });
  }
  canPlace(
    team: Team,
    id: CardId,
    x: number,
    y: number,
  ): { ok: boolean; reason: string } {
    if (this.winner) return { ok: false, reason: "The battle has ended." };
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0.5 ||
      x > 17.5 ||
      y < 0.7 ||
      y > 31.3
    )
      return { ok: false, reason: "Place your card inside the arena." };
    if (typeof id !== "string" || !Object.hasOwn(CARD_MAP, id))
      return { ok: false, reason: "Unknown card." };
    const c = CARD_MAP[id];
    if (c.kind === "spell") return { ok: true, reason: "" };
    const lane = x < 9 ? "left" : "right";
    const enemyPrincess = this.entities.some(
      (e) =>
        e.team !== team &&
        e.kind === "tower" &&
        !e.king &&
        e.lane === lane &&
        e.hp > 0,
    );
    if (
      (team === "blue" && y < (enemyPrincess ? 17.8 : 11.5)) ||
      (team === "red" && y > (enemyPrincess ? 14.2 : 20.5))
    )
      return { ok: false, reason: "Deploy troops on your side of the arena." };
    if (y > 14.5 && y < 17.5)
      return { ok: false, reason: "Troops cannot be deployed in the river." };
    if (
      this.entities.some(
        (e) =>
          e.hp > 0 &&
          e.kind !== "troop" &&
          dist(e, { x, y }) < e.radius + (c.kind === "building" ? 1.05 : 0.35),
      )
    )
      return { ok: false, reason: "That space is occupied by a building." };
    return { ok: true, reason: "" };
  }
  play(
    team: Team,
    slot: number,
    x: number,
    y: number,
  ): { ok: boolean; reason: string } {
    const p = this.players[team];
    const id = p.hand[slot];
    if (!id) return { ok: false, reason: "Select a card." };
    const c = CARD_MAP[id];
    if (p.elixir + 1e-6 < c.cost)
      return { ok: false, reason: `You need ${c.cost} elixir.` };
    const allowed = this.canPlace(team, id, x, y);
    if (!allowed.ok) return allowed;
    if (
      this.entities.filter(
        (e) => e.kind === "troop" && e.team === team && e.hp > 0,
      ).length > 160
    )
      return { ok: false, reason: "Too many troops on the field." };
    p.elixir -= c.cost;
    p.hand[slot] = p.queue.shift()!;
    p.queue.push(id);
    this.actions.push({ tick: this.tick, team, card: id, x, y });
    this.emit(c.kind === "spell" ? "spell" : "deploy", team, x, y, id);
    this.emitAudio("cast", team, id);
    if (c.kind === "spell") {
      if (id === "freeze" || id === "poison" || id === "rage") {
        const rules =
          id === "freeze" ? freeze : id === "poison" ? poison : rage;
        this.areas.push({
          id: this.nextId++,
          team,
          card: id,
          x,
          y,
          radius: rules.radius,
          duration: rules.duration,
          remaining: rules.duration,
        });
        if (id !== "freeze") this.emitAudio("impact", team, id);
        return { ok: true, reason: "" };
      }
      const origin = { x: 9, y: team === "blue" ? 30 : 2 };
      const modern = this.rulesVersion >= 2;
      const speed =
        id === "rocket"
          ? rocket.speed
          : id === "fireball"
            ? FIREBALL_SPEED
            : ARROWS_SPEED;
      const duration =
        id === "zap"
          ? 0.15
          : modern
            ? Math.max(STEP, dist(origin, { x, y }) / speed)
            : id === "arrows"
              ? 0.65
              : 0.9;
      const waves = modern && id === "arrows" ? ARROWS_WAVES : 1;
      for (let wave = 0; wave < waves; wave++) {
        this.projectiles.push({
          id: this.nextId++,
          team,
          x: team === "blue" ? 9 : 9,
          y: team === "blue" ? 30 : 2,
          tx: x,
          ty: y,
          target: null,
          damage: c.damage / waves,
          remaining: duration,
          duration,
          splash: c.radius!,
          air: true,
          style: id,
          stun: c.stun ?? 0,
          source: 0,
          ...(modern
            ? {
                flight: id === "zap" ? { x, y } : { ...origin },
                speed: id === "zap" ? undefined : speed,
                homing: false,
                elapsed: 0,
                delay: wave * ARROWS_WAVE_GAP,
                fromHeight: id === "zap" ? 7 : 2.4,
                toHeight: 0.2,
                arc: id === "arrows" ? 9 : id === "zap" ? 0 : 6,
                knockback:
                  id === "rocket"
                    ? rocket.knockback
                    : id === "fireball"
                      ? FIREBALL_KNOCKBACK
                      : 0,
                ...(id === "rocket"
                  ? {
                      crownTowerDamageFraction: rocket.crownTowerDamageFraction,
                    }
                  : {}),
              }
            : {}),
        });
        this.audioProjectiles.set(this.projectiles.at(-1)!.id, id);
      }
    } else {
      for (const point of deploymentPositions(id, { x, y }))
        this.spawn(id, team, point.x, point.y);
    }
    return { ok: true, reason: "" };
  }
  private spawn(id: CardId, team: Team, x: number, y: number) {
    const c = CARD_MAP[id];
    this.entities.push({
      id: this.nextId++,
      team,
      x,
      y,
      card: id,
      kind: c.kind === "building" ? "building" : "troop",
      hp: c.hp,
      maxHp: c.hp,
      radius:
        c.kind === "building"
          ? 0.8
          : c.hp > 3000
            ? 0.55
            : c.count > 2
              ? 0.25
              : 0.37,
      air: !!c.air,
      damage: c.damage,
      range: c.range,
      cooldown: 0.4,
      interval: c.interval,
      speed: c.speed,
      target: null,
      age: 0,
      deploy: 1,
      stun: 0,
      attack: 0,
      move: 0,
      active: true,
      lifetime: c.lifetime,
      spawnTimer: 4,
      ...(id === "tesla" && this.rulesVersion >= 3
        ? { burrow: { exposure: 0, idle: 0, phase: "hidden" as const } }
        : {}),
    });
    this.emitAudio("spawn", team, id, this.entities.at(-1)!.id, undefined, {
      x,
      y,
    });
  }
  private emit(
    type: BattleEvent["type"],
    team: Team,
    x: number,
    y: number,
    card?: CardId | "tower",
    value?: number,
    details: Pick<
      BattleEvent,
      "origin" | "height" | "effect" | "arrowVolley"
    > = {},
  ) {
    this.events.push({
      id: this.nextId++,
      time: this.time,
      type,
      team,
      x,
      y,
      card,
      value,
      ...details,
    });
    if (this.events.length > 160)
      this.events.splice(0, this.events.length - 160);
  }
  private emitAudio(
    phase: CombatAudioPhase,
    team: Team,
    profile: AudioProfile,
    actor?: number,
    attack?: number,
    origin?: Point,
  ) {
    const event: CombatAudioEvent = {
      id: this.nextAudioId++,
      time: this.time,
      phase,
      team,
      profile,
      actor,
      attack,
      ...(origin ? { origin } : {}),
    };
    if (
      actor !== undefined &&
      this.entities.find((e) => e.id === actor)?.rage
    ) {
      event.pitch = rage.audioPitchMultiplier;
      if (phase === "attack") event.rate = rage.hitSpeedMultiplier;
    }
    this.audioEvents.push(event);
    if (this.audioEvents.length > 256)
      this.audioEvents.splice(0, this.audioEvents.length - 256);
    return event.id;
  }
  private emitImpactAudio(e: Entity, damage: number) {
    this.emitAudio(
      e.card === "prince" && damage > e.damage ? "impact-special" : "impact",
      e.team,
      audioProfile(e),
      e.id,
    );
  }
  private beginAudio(e: Entity) {
    this.audioAttacks.set(
      e.id,
      this.emitAudio("attack", e.team, audioProfile(e), e.id),
    );
  }
  private cancelAudio(e: Entity) {
    const attack = this.audioAttacks.get(e.id);
    if (attack !== undefined)
      this.emitAudio("cancel", e.team, audioProfile(e), e.id, attack);
    this.audioAttacks.delete(e.id);
  }
  private projectileAudio(p: Projectile) {
    const source = this.entities.find((e) => e.id === p.source);
    const profile =
      this.audioProjectiles.get(p.id) ??
      (source
        ? audioProfile(source)
        : p.style === "arrow"
          ? "princess-tower"
          : p.style === "cannonball"
            ? "king-tower"
            : p.style === "bomb"
              ? "balloon"
              : Object.hasOwn(CARD_MAP, p.style)
                ? (p.style as CardId)
                : null);
    if (profile)
      this.emitAudio(
        p.style === "bomb" ? "death-impact" : "impact",
        p.team,
        profile,
        p.source || undefined,
      );
    this.audioProjectiles.delete(p.id);
  }
  step() {
    if (this.winner) return;
    if (this.replayActions) {
      while (
        this.replayIndex < this.replayActions.length &&
        this.replayActions[this.replayIndex].tick === this.tick
      ) {
        const a = this.replayActions[this.replayIndex++];
        this.play(a.team, this.players[a.team].hand.indexOf(a.card), a.x, a.y);
      }
    }
    if (this.ai) {
      this.aiTimer -= STEP;
      if (this.aiTimer <= 0) {
        this.think();
        this.aiTimer =
          (this.mode === "training" ? 2.5 : 1.1) + this.random() * 1.3;
      }
    }
    const beforePhase = this.phase;
    this.tick++;
    for (const t of ["blue", "red"] as Team[])
      this.players[t].elixir = Math.min(
        10,
        this.players[t].elixir + (STEP / 2.8) * this.multiplier,
      );
    this.updateAreas();
    if (this.rulesVersion === 1) this.updateLegacyCombat();
    else this.updateCombat();
    // Buff lifetime is real time, independent of accelerated combat clocks.
    for (const entity of this.entities) {
      if (!entity.rage) continue;
      entity.rage.remaining = Math.max(0, entity.rage.remaining - STEP);
      if (entity.rage.remaining < 1e-8) entity.rage = undefined;
    }
    if (this.rulesVersion >= 5) this.resolveKingLosses();
    this.separate();
    this.entities = this.entities.filter((e) => e.hp > 0);
    if (beforePhase !== this.phase) this.emit("phase", "blue", 9, 16);
    if (
      this.time >= 180 &&
      this.players.blue.crowns !== this.players.red.crowns
    )
      this.finish(
        this.players.blue.crowns > this.players.red.crowns ? "blue" : "red",
        this.rulesVersion >= 5 && this.time > 180
          ? "Sudden death"
          : "More crowns",
      );
    if (this.time >= 300 && !this.winner) {
      const lowest = (team: Team) =>
        Math.min(
          ...this.entities
            .filter((e) => e.team === team && e.kind === "tower")
            .map((e) => e.hp),
        );
      const blue = lowest("blue"),
        red = lowest("red");
      this.finish(
        Math.abs(blue - red) < 0.01 ? "draw" : blue > red ? "blue" : "red",
        "Tiebreaker",
      );
    }
  }
  private updateAreas() {
    for (const area of this.areas) {
      const age = area.duration - area.remaining;
      if (area.card === "rage") {
        if (age + 1e-8 >= (area.hitAt ?? 0)) {
          area.hitAt = (area.hitAt ?? 0) + rage.areaHitInterval;
          for (const entity of this.entities) {
            if (
              entity.hp <= 0 ||
              entity.team !== area.team ||
              this.isHidden(entity) ||
              dist(entity, area) >= area.radius + entity.radius
            )
              continue;
            const remaining = Math.min(rage.buffDuration, area.remaining);
            entity.rage = {
              remaining: Math.max(entity.rage?.remaining ?? 0, remaining),
            };
          }
        }
        area.remaining = Math.max(0, area.remaining - STEP);
        if (area.remaining < 1e-8) area.remaining = 0;
        continue;
      }
      const poisonHit =
        area.card === "poison" && age + 1e-8 >= (area.hitAt ?? 0);
      if (poisonHit) area.hitAt = (area.hitAt ?? 0) + poison.areaHitInterval;
      for (const entity of this.entities) {
        if (
          entity.hp <= 0 ||
          entity.team === area.team ||
          (area.card === "poison" && !poisonHit) ||
          (area.card === "poison" && this.isHidden(entity)) ||
          dist(entity, area) >= area.radius + entity.radius
        )
          continue;
        if (area.card === "freeze")
          entity.stun = Math.max(entity.stun, STEP * 2);
        else entity.poison ??= { remaining: 0, elapsed: 0 };
        if (area.card === "poison" && entity.poison)
          entity.poison.remaining = poison.buffDuration;
      }
      area.remaining = Math.max(0, area.remaining - STEP);
      if (area.remaining < 1e-8) area.remaining = 0;
    }
    this.areas = this.areas.filter((area) => area.remaining > 0);
    for (const entity of this.entities) {
      const status = entity.poison;
      if (!status || entity.hp <= 0) continue;
      status.remaining = Math.max(0, status.remaining - STEP);
      status.elapsed += STEP;
      if (status.elapsed + 1e-8 >= poison.damageInterval) {
        status.elapsed -= poison.damageInterval;
        const damage =
          CARD_MAP.poison.damage *
          (entity.kind === "tower" ? poison.crownTowerDamageFraction : 1);
        this.hurt(entity, damage);
      }
      if (status.remaining < 1e-8) entity.poison = undefined;
    }
  }
  private resolveKingLosses() {
    const fallenKings = this.entities.filter((e) => e.king && e.hp <= 0);
    if (!fallenKings.length) return;
    // Finish after every impact in this step, so projectile order cannot
    // choose a winner when both Kings fall together.
    const defeated = new Set(fallenKings.map((e) => e.team));
    for (const tower of this.entities) {
      if (tower.kind !== "tower" || tower.hp <= 0 || !defeated.has(tower.team))
        continue;
      tower.hp = 0;
      this.cancelAttack(tower);
      this.emit("death", tower.team, tower.x, tower.y, "tower");
    }
    this.finish(
      defeated.size === 2 ? "draw" : other(fallenKings[0].team),
      defeated.size === 2
        ? "Both King Towers destroyed"
        : "King Tower destroyed",
    );
  }
  // Frozen rules for saved v1 battles. New matches use updateCombat below.
  private updateLegacyCombat() {
    for (const e of [...this.entities]) {
      if (e.hp <= 0) continue;
      e.age += STEP;
      e.attack = Math.max(0, e.attack - STEP);
      e.stun = Math.max(0, e.stun - STEP);
      if (e.deploy > 0) {
        e.deploy -= STEP;
        continue;
      }
      if (e.lifetime) {
        this.hurt(e, (e.maxHp / e.lifetime) * STEP);
        if (e.hp <= 0) continue;
      }
      if (e.stun > 0) continue;
      e.cooldown = Math.max(0, e.cooldown - STEP);
      if (!e.active) continue;
      if (e.card === "witch") {
        e.spawnTimer -= STEP;
        if (e.spawnTimer <= 0) {
          e.spawnTimer = 7;
          this.emitAudio("summon", e.team, audioProfile(e), e.id);
          for (let i = 0; i < 3; i++)
            this.spawn(
              "skeletons",
              e.team,
              clamp(e.x + (i - 1) * 0.6, 0.6, 17.4),
              clamp(e.y + (e.team === "blue" ? -0.8 : 0.8), 0.8, 31.2),
            );
        }
      }
      const card = e.card === "tower" ? null : CARD_MAP[e.card];
      const canAttack = (v: Entity) =>
        v.hp > 0 &&
        v.team !== e.team &&
        (!v.air || e.kind === "tower" || card?.hitsAir) &&
        (!card?.buildingsOnly || v.kind !== "troop");
      let target = this.entities.find((v) => v.id === e.target && canAttack(v));
      if (
        target &&
        target.kind === "troop" &&
        dist(e, target) > Math.max(6.5, e.range + 2)
      )
        target = undefined;
      if (!target) {
        const inSight = this.entities.filter(
          (v) => canAttack(v) && dist(e, v) < Math.max(5.5, e.range + v.radius),
        );
        target = inSight.sort(
          (a, b) => dist(e, a) - a.radius - (dist(e, b) - b.radius),
        )[0];
        if (!target && e.kind === "troop")
          target = this.entities
            .filter((v) => canAttack(v) && v.kind !== "troop")
            .sort((a, b) => dist(e, a) - a.radius - (dist(e, b) - b.radius))[0];
        e.target = target?.id ?? null;
      }
      if (!target) continue;
      const distance = dist(e, target);
      if (distance <= e.range + target.radius + e.radius * 0.35) {
        if (e.cooldown <= 0) {
          const damage =
            e.damage * (e.card === "prince" && e.move >= 2.3 ? 2 : 1);
          e.move = 0;
          e.cooldown = e.interval;
          e.attack = e.interval;
          this.beginAudio(e);
          this.audioAttacks.delete(e.id);
          if (e.range > 2 || e.kind === "tower" || e.card === "balloon") {
            const duration = Math.max(0.1, distance / 18);
            this.projectiles.push({
              id: this.nextId++,
              team: e.team,
              x: e.x,
              y: e.y,
              tx: target.x,
              ty: target.y,
              target: target.id,
              damage,
              remaining: duration,
              duration,
              splash: card?.splash ?? 0,
              air: e.kind === "tower" || !!card?.hitsAir,
              style: e.kind === "tower" ? "arrow" : e.card,
              stun: 0,
              source: e.id,
            });
            this.audioProjectiles.set(
              this.projectiles.at(-1)!.id,
              audioProfile(e),
            );
            this.emitAudio("launch", e.team, audioProfile(e), e.id, undefined, {
              x: e.x,
              y: e.y,
            });
          } else if (card?.splash) {
            for (const v of this.entities)
              if (canAttack(v) && dist(v, e) <= card.splash + v.radius)
                this.hurt(v, damage);
            this.emit("hit", e.team, e.x, e.y, e.card);
            this.emitImpactAudio(e, damage);
          } else {
            this.hurt(target, damage);
            this.emit("hit", e.team, target.x, target.y, e.card, damage);
            this.emitImpactAudio(e, damage);
          }
        }
      } else if (e.kind === "troop") this.moveToward(e, target);
    }
    for (const p of this.projectiles) {
      p.remaining -= STEP;
      if (p.remaining > 0) continue;
      const target = this.entities.find((e) => e.id === p.target && e.hp > 0);
      const point = target ?? { x: p.tx, y: p.ty };
      if (p.splash > 0) {
        for (const e of this.entities)
          if (
            e.hp > 0 &&
            e.team !== p.team &&
            (!e.air || p.air) &&
            dist(e, point) < p.splash + e.radius
          ) {
            this.hurt(
              e,
              p.damage *
                (p.source === 0 && e.kind === "tower"
                  ? (p.crownTowerDamageFraction ?? 0.3)
                  : 1),
            );
            e.stun = Math.max(e.stun, p.stun);
            if (p.stun) e.cooldown = e.interval;
          }
      } else if (target) this.hurt(target, p.damage);
      this.emit(
        "hit",
        p.team,
        point.x,
        point.y,
        p.style === "arrow" || p.style === "bomb"
          ? undefined
          : (p.style as CardId),
        p.damage,
        p.style === "bomb"
          ? { effect: "balloon-bomb" }
          : p.style === "arrows"
            ? { arrowVolley: { projectileId: p.id, staggered: false } }
            : {},
      );
      this.projectileAudio(p);
    }
    this.projectiles = this.projectiles.filter((p) => p.remaining > 0);
  }
  private validTarget(e: Entity, target: Entity) {
    const card = e.card === "tower" ? null : CARD_MAP[e.card];
    return (
      target.hp > 0 &&
      !this.isHidden(target) &&
      target.team !== e.team &&
      (!target.air || e.kind === "tower" || !!card?.hitsAir) &&
      (!card?.buildingsOnly || target.kind !== "troop")
    );
  }
  private inRange(e: Entity, target: Entity) {
    return dist(e, target) <= e.range + target.radius + e.radius * 0.35;
  }
  private acquireTarget(e: Entity) {
    const current = this.entities.find(
      (t) => t.id === e.target && this.validTarget(e, t),
    );
    // Keep an engaged target. A distant tower is only a movement destination;
    // nearby defenders or a newly deployed building can intercept that path.
    const sight = Math.max(combatTraits(e).sight, e.range);
    if (
      current &&
      (this.inRange(e, current) ||
        (current.kind === "troop" &&
          dist(e, current) <= sight + current.radius))
    )
      return current;
    const legal = this.entities.filter((t) => this.validTarget(e, t));
    const closest = (a: Entity, b: Entity) =>
      dist(e, a) - a.radius - (dist(e, b) - b.radius);
    const nearby = legal
      .filter((t) => dist(e, t) <= sight + t.radius)
      .sort(closest)[0];
    const target =
      nearby ??
      (e.kind === "troop"
        ? legal.filter((t) => t.kind !== "troop").sort(closest)[0]
        : undefined);
    e.target = target?.id ?? null;
    return target;
  }
  private cancelAttack(e: Entity) {
    this.cancelAudio(e);
    e.pendingAttack = undefined;
    e.attack = 0;
    e.cooldown = 0;
  }
  private isHidden(e: Entity) {
    return e.deploy <= 0 && e.burrow?.phase === "hidden";
  }
  private updateTesla(e: Entity) {
    const state = e.burrow!;
    const threat = this.entities.some(
      (target) => this.validTarget(e, target) && this.inRange(e, target),
    );
    if (threat) {
      state.idle = 0;
      if (state.exposure < 1) {
        if (state.phase !== "rising")
          this.emitAudio("appear", e.team, audioProfile(e), e.id);
        state.phase = "rising";
        state.exposure = Math.min(1, state.exposure + STEP / 0.8);
        if (state.exposure >= 1 - 1e-8) state.exposure = 1;
        this.cancelAttack(e);
      }
      if (state.exposure === 1) {
        state.phase = "exposed";
        return true;
      }
    } else {
      state.idle += STEP;
      this.cancelAttack(e);
      e.target = null;
      if (state.idle >= 0.8 && state.exposure > 0) {
        if (state.phase !== "sinking")
          this.emitAudio("hide", e.team, audioProfile(e), e.id);
        state.phase = "sinking";
        state.exposure = Math.max(0, state.exposure - STEP / 0.8);
        if (state.exposure < 1e-8) state.exposure = 0;
      }
      if (state.exposure === 0) state.phase = "hidden";
    }
    return false;
  }
  private updateCombat() {
    for (const e of [...this.entities]) {
      if (e.hp <= 0) continue;
      const rate = e.rage ? rage.hitSpeedMultiplier : 1;
      if (e.rage || e.animationTime !== undefined)
        e.animationTime =
          (e.animationTime ?? e.age) +
          STEP * (e.rage ? rage.speedMultiplier : 1);
      e.age += STEP;
      e.attack = Math.max(0, e.attack - STEP * rate);
      e.cooldown = Math.max(0, e.cooldown - STEP * rate);
      e.stun = Math.max(0, e.stun - STEP);
      if (e.deploy > 0) {
        e.deploy -= STEP;
        continue;
      }
      if (e.lifetime) {
        this.hurt(e, (e.maxHp / e.lifetime) * STEP, true);
        if (e.hp <= 0) continue;
      }
      if ((e.activation ?? 0) > 0) {
        e.activation = Math.max(0, e.activation! - STEP);
        if (e.activation < 1e-8) e.activation = 0;
        this.cancelAttack(e);
        continue;
      }
      if (e.stun > 0) {
        this.cancelAttack(e);
        e.move = 0;
        continue;
      }
      if (!e.active) {
        this.cancelAttack(e);
        continue;
      }
      if (e.burrow && !this.updateTesla(e)) continue;
      if (e.card === "witch") {
        e.spawnTimer -= STEP * (e.rage ? rage.spawnSpeedMultiplier : 1);
        if (e.spawnTimer <= 0) {
          e.spawnTimer = 7;
          this.emitAudio("summon", e.team, audioProfile(e), e.id);
          for (let i = 0; i < 3; i++)
            this.spawn(
              "skeletons",
              e.team,
              clamp(e.x + (i - 1) * 0.6, 0.6, 17.4),
              clamp(e.y + (e.team === "blue" ? -0.8 : 0.8), 0.8, 31.2),
            );
        }
      }
      if (e.pendingAttack) {
        const pending = e.pendingAttack;
        const target = this.entities.find(
          (t) => t.id === pending.target && this.validTarget(e, t),
        );
        if (!target || !this.inRange(e, target)) this.cancelAttack(e);
        else {
          pending.remaining -= STEP * rate;
          if (pending.remaining > 1e-8) continue;
          e.pendingAttack = undefined;
          this.releaseAttack(e, target, pending.damage);
        }
      }
      const target = this.acquireTarget(e);
      if (!target) {
        e.move = 0;
        continue;
      }
      if (this.inRange(e, target)) {
        if (e.cooldown <= 1e-8) {
          const damage =
            e.damage * (e.card === "prince" && e.move >= 2.3 ? 2 : 1);
          e.move = 0;
          e.cooldown = e.interval;
          e.attack = e.interval;
          e.pendingAttack = {
            target: target.id,
            remaining: Math.max(
              STEP,
              Math.min(e.interval, combatTraits(e).windup),
            ),
            damage,
          };
          this.beginAudio(e);
        }
      } else if (e.kind === "troop") this.moveToward(e, target);
    }
    this.updateProjectiles();
  }
  private releaseAttack(e: Entity, target: Entity, damage: number) {
    this.audioAttacks.delete(e.id);
    const card = e.card === "tower" ? null : CARD_MAP[e.card];
    const traits = combatTraits(e);
    const p = traits.projectile;
    if (p || e.card === "balloon" || e.card === "tesla") {
      const speed = p?.speed ?? (e.card === "tesla" ? 1000 : undefined);
      const duration = speed ? Math.max(STEP, dist(e, target) / speed) : 0.35;
      const fromHeight =
        e.kind === "tower"
          ? e.king
            ? 3.1
            : 3.5
          : e.card === "balloon"
            ? 3.8
            : e.card === "tesla"
              ? 1.8
              : e.card === "cannon"
                ? 1.1
                : e.air
                  ? 2.3
                  : 0.8;
      this.projectiles.push({
        id: this.nextId++,
        team: e.team,
        x: e.x,
        y: e.y,
        tx: target.x,
        ty: target.y,
        target: target.id,
        damage,
        remaining: duration,
        duration,
        splash: card?.splash ?? 0,
        air: e.kind === "tower" || !!card?.hitsAir,
        style: e.kind === "tower" ? (e.king ? "cannonball" : "arrow") : e.card,
        stun: 0,
        source: e.id,
        flight: { x: e.x, y: e.y },
        speed,
        elapsed: 0,
        homing: p?.homing ?? true,
        fromHeight,
        toHeight: target.air ? 2.3 : target.kind === "tower" ? 1.8 : 0.6,
        arc:
          e.card === "balloon" || e.card === "tesla"
            ? 0
            : (p?.gravity ?? 0) / 100,
      });
      this.audioProjectiles.set(this.projectiles.at(-1)!.id, audioProfile(e));
      this.emitAudio("launch", e.team, audioProfile(e), e.id, undefined, {
        x: e.x,
        y: e.y,
      });
    } else if (card?.splash) {
      for (const v of this.entities)
        if (this.validTarget(e, v) && dist(v, e) <= card.splash + v.radius)
          this.hurt(v, damage);
      this.emit("hit", e.team, e.x, e.y, e.card, damage);
      this.emitImpactAudio(e, damage);
    } else {
      this.hurt(target, damage);
      this.emit("hit", e.team, target.x, target.y, e.card, damage);
      this.emitImpactAudio(e, damage);
    }
  }
  private updateProjectiles() {
    for (const p of [...this.projectiles]) {
      if (p.delay && p.delay > 1e-8) {
        p.delay = Math.max(0, p.delay - STEP);
        continue;
      }
      const target = this.entities.find(
        (e) => e.id === p.target && e.hp > 0 && !this.isHidden(e),
      );
      if (p.homing && target) {
        p.tx = target.x;
        p.ty = target.y;
        p.toHeight = target.air ? 2.3 : target.kind === "tower" ? 1.8 : 0.6;
      }
      p.elapsed = (p.elapsed ?? 0) + STEP;
      if (p.speed && p.flight) {
        const dx = p.tx - p.flight.x,
          dy = p.ty - p.flight.y,
          distance = Math.hypot(dx, dy);
        const travel = Math.min(distance, p.speed * STEP);
        if (distance > 0) {
          p.flight.x += (dx / distance) * travel;
          p.flight.y += (dy / distance) * travel;
        }
        p.remaining = Math.max(0, (distance - travel) / p.speed);
        p.duration = p.elapsed + p.remaining;
      } else {
        p.remaining = Math.max(0, p.remaining - STEP);
        if (p.flight) {
          const progress = Math.min(1, p.elapsed / p.duration);
          p.flight.x = p.x + (p.tx - p.x) * progress;
          p.flight.y = p.y + (p.ty - p.y) * progress;
        }
      }
      if (p.remaining > 1e-8) continue;
      p.remaining = 0;
      const point = { x: p.tx, y: p.ty };
      if (p.splash > 0) {
        for (const e of this.entities) {
          if (
            e.hp <= 0 ||
            this.isHidden(e) ||
            e.team === p.team ||
            (e.air && !p.air) ||
            dist(e, point) >= p.splash + e.radius
          )
            continue;
          this.hurt(
            e,
            p.damage *
              (p.source === 0 && e.kind === "tower"
                ? (p.crownTowerDamageFraction ?? 0.3)
                : 1),
          );
          if (e.hp <= 0) continue;
          if (p.stun) {
            e.stun = Math.max(e.stun, p.stun);
            this.cancelAttack(e);
            e.move = 0;
          }
          if (p.knockback) this.knockback(e, point, p.knockback);
        }
      } else if (target) this.hurt(target, p.damage);
      this.emit(
        "hit",
        p.team,
        point.x,
        point.y,
        ["arrow", "cannonball", "bomb"].includes(p.style)
          ? undefined
          : (p.style as CardId),
        p.damage,
        {
          origin:
            p.style === "tesla"
              ? { x: p.x, y: p.y, height: p.fromHeight ?? 1.5 }
              : undefined,
          height: p.toHeight ?? 0.6,
          ...(p.style === "bomb" ? { effect: "balloon-bomb" as const } : {}),
          ...(p.style === "arrows"
            ? {
                arrowVolley: {
                  projectileId: p.id,
                  staggered: p.delay !== undefined,
                },
              }
            : {}),
        },
      );
      this.projectileAudio(p);
    }
    this.projectiles = this.projectiles.filter((p) => p.remaining > 0);
  }
  private knockback(e: Entity, origin: Point, distance: number) {
    if (e.kind !== "troop" || combatTraits(e).ignoresKnockback) return;
    const dx = e.x - origin.x,
      dy = e.y - origin.y,
      length = Math.hypot(dx, dy);
    const x = clamp(
      e.x + (length > 0.001 ? dx / length : 0) * distance,
      0.5,
      17.5,
    );
    let y = clamp(
      e.y +
        (length > 0.001 ? dy / length : e.team === "blue" ? 1 : -1) * distance,
      0.6,
      31.4,
    );
    if (
      !e.air &&
      e.card !== "hog-rider" &&
      y > 14.8 &&
      y < 17.2 &&
      Math.min(Math.abs(x - 4), Math.abs(x - 14)) > 0.95
    )
      y = e.y < 16 ? 14.8 : 17.2;
    e.x = x;
    e.y = y;
    this.cancelAttack(e);
    e.move = 0;
  }
  private moveToward(e: Entity, target: Entity) {
    let x = target.x,
      y = target.y;
    const crossing =
      (e.y < 14.8 && target.y > 16) ||
      (e.y > 17.2 && target.y < 16) ||
      (e.y >= 14.8 && e.y <= 17.2);
    if (crossing && !e.air && e.card !== "hog-rider") {
      const bridge = e.x < 9 ? 4 : 14;
      x = bridge;
      y =
        target.y < e.y
          ? e.y > 17.2
            ? 17.15
            : 14.6
          : e.y < 14.8
            ? 14.85
            : 17.4;
    }
    const dx = x - e.x,
      dy = y - e.y,
      d = Math.hypot(dx, dy);
    if (d < 0.001) return;
    const speed =
      e.speed *
      (e.card === "prince" && e.move > 2.3 ? 1.8 : 1) *
      (e.rage ? rage.speedMultiplier : 1);
    const move = Math.min(d, speed * STEP);
    e.x = clamp(e.x + (dx / d) * move, 0.5, 17.5);
    e.y = clamp(e.y + (dy / d) * move, 0.6, 31.4);
    e.move += STEP;
  }
  private separate() {
    const units = this.entities.filter(
      (e) => e.kind === "troop" && e.hp > 0 && e.deploy <= 0,
    );
    for (let i = 0; i < units.length; i++)
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i],
          b = units[j];
        if (a.air !== b.air) continue;
        const d = dist(a, b),
          min = (a.radius + b.radius) * 0.86;
        if (d < min && d > 0.001) {
          const push = (min - d) * 0.18,
            dx = ((a.x - b.x) / d) * push,
            dy = ((a.y - b.y) / d) * push;
          a.x = clamp(a.x + dx, 0.5, 17.5);
          b.x = clamp(b.x - dx, 0.5, 17.5);
          a.y = clamp(a.y + dy, 0.6, 31.4);
          b.y = clamp(b.y - dy, 0.6, 31.4);
        }
      }
    const buildings = this.entities.filter(
      (e) => e.kind !== "troop" && e.hp > 0 && !this.isHidden(e),
    );
    for (const unit of units) {
      if (unit.air) continue;
      for (const building of buildings) {
        const d = dist(unit, building),
          min = unit.radius + building.radius;
        if (d > 0.001 && d < min) {
          unit.x = building.x + ((unit.x - building.x) / d) * min;
          unit.y = building.y + ((unit.y - building.y) / d) * min;
        }
      }
      if (unit.card !== "hog-rider" && unit.y > 14.8 && unit.y < 17.2) {
        const bridge = unit.x < 9 ? 4 : 14;
        unit.x = clamp(unit.x, bridge - 0.95, bridge + 0.95);
      }
    }
  }
  private hurt(e: Entity, amount: number, decay = false) {
    if (e.hp <= 0 || (!decay && this.isHidden(e))) return;
    e.hp -= amount;
    if (e.king) this.activateKing(e);
    if (e.hp > 0) return;
    e.hp = 0;
    this.cancelAudio(e);
    this.emitAudio("death", e.team, audioProfile(e), e.id);
    this.emit("death", e.team, e.x, e.y, e.card);
    if (e.card === "balloon") {
      this.projectiles.push({
        id: this.nextId++,
        team: e.team,
        x: e.x,
        y: e.y,
        tx: e.x,
        ty: e.y,
        target: null,
        damage: 240,
        remaining: 0.8,
        duration: 0.8,
        splash: 2.2,
        air: false,
        style: "bomb",
        stun: 0,
        source: e.id,
        ...(this.rulesVersion >= 2
          ? {
              flight: { x: e.x, y: e.y },
              elapsed: 0,
              fromHeight: 3.8,
              toHeight: 0.2,
              arc: 0,
            }
          : {}),
      });
      this.audioProjectiles.set(this.projectiles.at(-1)!.id, "balloon");
      this.emitAudio("death-spawn", e.team, "balloon", e.id);
    }
    if (e.kind === "tower") {
      const enemy = other(e.team);
      const previousCrowns = this.players[enemy].crowns;
      const crowns = e.king ? 3 : previousCrowns + 1;
      this.players[enemy].crowns =
        this.rulesVersion >= 5 ? Math.min(3, crowns) : crowns;
      const earned = this.players[enemy].crowns - previousCrowns;
      if (earned > 0 || this.rulesVersion < 5)
        this.emit("crown", enemy, e.x, e.y, "tower", earned);
      for (const king of this.entities.filter(
        (t) => t.team === e.team && t.king,
      ))
        this.activateKing(king);
      if (this.rulesVersion < 5) {
        if (e.king) this.finish(enemy, "King Tower destroyed");
        else if (this.time >= 180) this.finish(enemy, "Sudden death");
      }
    }
  }
  private activateKing(king: Entity) {
    if (this.rulesVersion < 4) {
      king.active = true;
      return;
    }
    if (king.active || king.hp <= 0) return;
    king.active = true;
    king.activation = KING_ACTIVATION_TIME;
    this.cancelAttack(king);
  }
  private think() {
    const p = this.players.red;
    const affordable = p.hand
      .map((id, slot) => ({ id, slot, c: CARD_MAP[id] }))
      .filter((v) => v.c.cost <= p.elixir);
    if (!affordable.length) return;
    const threats = this.entities
      .filter(
        (e) => e.team === "blue" && e.kind === "troop" && e.hp > 0 && e.y < 15,
      )
      .sort((a, b) => a.y - b.y);
    const threat = threats[0];
    const allies = affordable.some((a) => a.id === "rage")
      ? this.entities.filter(
          (e) =>
            e.team === "red" && e.kind === "troop" && e.hp > 0 && e.deploy <= 0,
        )
      : [];
    const push = allies
      .map((entity) => ({
        entity,
        value: allies
          .filter((friend) => dist(friend, entity) < rage.radius)
          .reduce(
            (value, friend) =>
              value +
              (friend.card === "tower" ? 0 : CARD_MAP[friend.card].cost),
            0,
          ),
      }))
      .sort((a, b) => b.value - a.value)[0];
    const spellTargets = new Map(
      affordable
        .filter((a) => isDamageSpell(a.id))
        .map((a) => [
          a.id,
          damageSpellTarget(a.id, "red", this.entities, this.projectiles),
        ]),
    );
    if (
      !threat &&
      p.elixir < 6 &&
      this.mode !== "training" &&
      ![...spellTargets.values()].some(Boolean)
    )
      return;
    const scored = affordable
      .map((a) => {
        const jitter = this.random() * 2;
        let score = jitter;
        if (threat) {
          if (a.c.kind === "spell") {
            const nearby = threats.filter(
              (e) => dist(e, threat) < (a.c.radius ?? 2.5),
            );
            score += nearby.length > 2 ? 6 : -5;
            if (threat.hp < a.c.damage) score += 2;
          } else {
            score += a.c.buildingsOnly ? -3 : 3;
            if (threat.air && !a.c.hitsAir) score -= 8;
            if (a.c.splash && threats.length >= 3) score += 3;
            if (a.c.kind === "building") score += 2;
          }
        } else {
          if (a.c.kind !== "troop") score -= 7;
          if (a.c.buildingsOnly) score += 2;
        }
        if (a.id === "rage") score += push && push.value >= 5 ? 12 : -20;
        const target = spellTargets.get(a.id);
        if (isDamageSpell(a.id))
          score = target ? target.score + jitter * 0.1 : -Infinity;
        return { ...a, score, target };
      })
      .sort((a, b) => b.score - a.score);
    const a = scored[0];
    if (a.score < 0) return;
    const lane = threat
      ? threat.x < 9
        ? 4
        : 14
      : this.random() < 0.5
        ? 4
        : 14;
    let x = lane + (this.random() - 0.5) * 1.4,
      y = threat ? clamp(threat.y + 1.3, 8, 13.8) : a.c.buildingsOnly ? 3.5 : 9;
    if (a.c.kind === "spell") {
      const target =
        a.target ??
        (a.id === "rage" ? push?.entity : threat) ??
        this.entities.find(
          (e) => e.team === "blue" && e.kind === "tower" && !e.king,
        );
      if (!target) return;
      x = target.x;
      y = target.y;
    }
    if (a.c.kind === "building") {
      x = 9;
      y = 10;
    }
    if (a.c.kind !== "spell") {
      // A building can still occupy the preferred tile when the deck cycles.
      // Try nearby legal tiles instead of wasting every subsequent decision.
      const point = [
        [0, 0],
        [-2.5, 0],
        [2.5, 0],
        [0, -2.5],
        [-2.5, -2.5],
        [2.5, -2.5],
      ]
        .map(([dx, dy]) => ({
          x: clamp(x + dx, 0.5, 17.5),
          y: clamp(y + dy, 0.8, 14.2),
        }))
        .find((point) => this.canPlace("red", a.id, point.x, point.y).ok);
      if (!point) return;
      x = point.x;
      y = point.y;
    }
    this.play("red", a.slot, x, y);
  }
  finish(winner: Team | "draw", reason: string) {
    if (this.winner) return;
    this.winner = winner;
    this.reason = reason;
    this.emit("finish", winner === "draw" ? "blue" : winner, 9, 16);
  }
  exportReplay(): Replay {
    return {
      version: this.rulesVersion,
      seed: this.seed,
      mode: this.mode,
      deck: [...this.deck],
      enemyDeck: [...this.enemyDeck],
      actions: this.actions.map((a) => ({ ...a })),
      duration: this.tick,
    };
  }
}
