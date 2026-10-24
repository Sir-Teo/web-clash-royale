import { CARD_MAP, STARTER_DECK } from "./cards";
import type { CardId } from "./cards";
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
import flyingHeights from "./flight-heights.json" with { type: "json" };
import freeze from "./freeze-data.json" with { type: "json" };
import poison from "./poison-data.json" with { type: "json" };
import rage from "./rage-data.json" with { type: "json" };
import rocket from "./rocket-data.json" with { type: "json" };
import lightning from "./lightning-data.json" with { type: "json" };
import log from "./log-data.json" with { type: "json" };
import tornado from "./tornado-data.json" with { type: "json" };
import goblinBarrel from "./goblin-barrel-data.json" with { type: "json" };
import graveyard from "./graveyard-data.json" with { type: "json" };
import clone from "./clone-data.json" with { type: "json" };
import mirror from "./mirror-data.json" with { type: "json" };
import iceWizard from "./ice-wizard-data.json" with { type: "json" };
import princess from "./princess-data.json" with { type: "json" };
import infernoDragon from "./inferno-dragon-data.json" with { type: "json" };
import electroWizard from "./electro-wizard-data.json" with { type: "json" };
import miner from "./miner-data.json" with { type: "json" };
import bowler from "./bowler-data.json" with { type: "json" };
import darkPrince from "./dark-prince-data.json" with { type: "json" };
import battleRam from "./battle-ram-data.json" with { type: "json" };
import executioner from "./executioner-data.json" with { type: "json" };
import sparky from "./sparky-data.json" with { type: "json" };
import lumberjack from "./lumberjack-data.json" with { type: "json" };
import bats from "./bats-data.json" with { type: "json" };
import eliteBarbarians from "./elite-barbarians-data.json" with { type: "json" };
import iceSpirit from "./ice-spirit-data.json" with { type: "json" };
import fireSpirits from "./fire-spirits-data.json" with { type: "json" };
import iceGolem from "./ice-golem-data.json" with { type: "json" };
import giantSkeleton from "./giant-skeleton-data.json" with { type: "json" };
import mortar from "./mortar-data.json" with { type: "json" };
import bombTower from "./bomb-tower-data.json" with { type: "json" };
import infernoTower from "./inferno-tower-data.json" with { type: "json" };
import xBow from "./x-bow-data.json" with { type: "json" };
import guards from "./guards-data.json" with { type: "json" };
import nightWitch from "./night-witch-data.json" with { type: "json" };
import bandit from "./bandit-data.json" with { type: "json" };
import golem from "./golem-data.json" with { type: "json" };
import lavaHound from "./lava-hound-data.json" with { type: "json" };
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
  shield?: number;
  maxShield?: number;
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
  clone?: boolean;
  poison?: { remaining: number; elapsed: number };
  rage?: { remaining: number };
  slow?: { remaining: number };
  inferno?: {
    target: number;
    elapsed: number;
    hitTimer: number;
    stage: 0 | 1 | 2;
  };
  sparkyCharge?: number;
  dash?: { target: number; elapsed: number; remaining: number };
  dashCooldown?: number;
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
  slow?: number;
  decorative?: boolean;
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
  towerDamageFraction?: number;
  rollHits?: number[];
  returning?: boolean;
  turn?: Point;
}
export interface AreaEffect extends Point {
  id: number;
  team: Team;
  card:
    | "freeze"
    | "poison"
    | "rage"
    | "lightning"
    | "tornado"
    | "graveyard"
    | "clone"
    | "ice-golem";
  radius: number;
  duration: number;
  remaining: number;
  hitAt?: number;
  damageAt?: number;
  struck?: number[];
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
  effect?: "balloon-bomb" | "giant-skeleton-bomb" | "log-die" | "graveyard-appear" | "clone-appear" | "miner-travel" | "hit:bowler" | "shield:dark-prince" | "shield:guards" | "axe-die" | "bottle:lumberjack" | "summon:night-witch" | "dash-start:bandit" | "dash-end:bandit" | "hit-special:bandit" | "ice-golem-slow";
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
  lastPlayed?: CardId;
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
export function entityVisualHeight(e: Pick<Entity, "card" | "air">): number {
  if (!e.air) return 0.2;
  return flyingHeights[e.card as keyof typeof flyingHeights]?.flyingHeight ?? 2.2;
}
export function entityProjectileStartHeight(e: Pick<Entity, "card" | "air">): number | null {
  if (!e.air) return null;
  const flight = flyingHeights[e.card as keyof typeof flyingHeights];
  return flight ? flight.flyingHeight + flight.projectileStartZ : null;
}
export function projectileHitHeight(e: Pick<Entity, "card" | "air" | "kind">): number {
  return e.air ? entityVisualHeight(e) + 0.1 : e.kind === "tower" ? 1.8 : 0.6;
}
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
      deck.some((id) => !CARD_MAP[id] || id === "golemite" || id === "lava-pup")
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
    const resolved = this.cardForPlay(team, id);
    if (!resolved)
      return { ok: false, reason: "Play another card before Mirror." };
    id = resolved;
    const c = CARD_MAP[id];
    if (!c) return { ok: false, reason: "Unknown card." };
    if (c.kind === "spell") {
      if (id === "log" && (team === "blue" ? y < 17.5 : y > 14.5))
        return {
          ok: false,
          reason: "Deploy The Log on your side of the arena.",
        };
      return { ok: true, reason: "" };
    }
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
      id !== "miner" &&
      ((team === "blue" && y < (enemyPrincess ? 17.8 : 11.5)) ||
        (team === "red" && y > (enemyPrincess ? 14.2 : 20.5)))
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
  cardForPlay(team: Team, id: CardId): CardId | null {
    return id === "mirror" ? (this.players[team].lastPlayed ?? null) : id;
  }
  cardCost(team: Team, id: CardId): number | null {
    const resolved = this.cardForPlay(team, id);
    return resolved
      ? CARD_MAP[resolved].cost + (id === "mirror" ? mirror.surcharge : 0)
      : null;
  }
  play(
    team: Team,
    slot: number,
    x: number,
    y: number,
  ): { ok: boolean; reason: string } {
    const p = this.players[team];
    const played = p.hand[slot];
    if (!played) return { ok: false, reason: "Select a card." };
    const id = this.cardForPlay(team, played);
    const cost = this.cardCost(team, played);
    if (!id || cost === null)
      return { ok: false, reason: "Play another card before Mirror." };
    const c = CARD_MAP[id];
    if (p.elixir + 1e-6 < cost)
      return { ok: false, reason: `You need ${cost} elixir.` };
    const allowed = this.canPlace(team, played, x, y);
    if (!allowed.ok) return allowed;
    if (
      this.entities.filter(
        (e) => e.kind === "troop" && e.team === team && e.hp > 0,
      ).length > 160
    )
      return { ok: false, reason: "Too many troops on the field." };
    p.elixir -= cost;
    p.hand[slot] = p.queue.shift()!;
    p.queue.push(played);
    if (this.rulesVersion >= 5) p.lastPlayed = id;
    this.actions.push({ tick: this.tick, team, card: played, x, y });
    if (id !== "miner")
      this.emit(
        c.kind === "spell" ? "spell" : "deploy",
        team,
        x,
        y,
        id,
        played === "mirror" ? cost : undefined,
      );
    if (played === "mirror") this.emitAudio("cast", team, "mirror");
    this.emitAudio("cast", team, id);
    if (c.kind === "spell") {
      if (id === "goblin-barrel") {
        const origin = { x: 9, y: team === "blue" ? 30 : 2 };
        const duration = Math.max(
          STEP,
          dist(origin, { x, y }) / goblinBarrel.speed,
        );
        this.projectiles.push({
          id: this.nextId++,
          team,
          x: origin.x,
          y: origin.y,
          tx: x,
          ty: y,
          target: null,
          damage: 0,
          remaining: duration,
          duration,
          splash: 0,
          air: false,
          style: id,
          stun: 0,
          source: 0,
          flight: { ...origin },
          speed: goblinBarrel.speed,
          elapsed: 0,
          fromHeight: 2.4,
          toHeight: 0.25,
          arc: 6,
        });
        this.audioProjectiles.set(this.projectiles.at(-1)!.id, id);
        return { ok: true, reason: "" };
      }
      if (id === "log") {
        const ty = y + (team === "blue" ? -1 : 1) * log.launchMinimumDistance;
        const duration = log.launchMinimumDistance / log.launchSpeed;
        this.projectiles.push({
          id: this.nextId++,
          team,
          x,
          y,
          tx: x,
          ty,
          target: null,
          damage: c.damage,
          remaining: duration,
          duration,
          splash: 0,
          air: false,
          style: "log-launch",
          stun: 0,
          source: 0,
          flight: { x, y },
          speed: log.launchSpeed,
          elapsed: 0,
          fromHeight: 2.1,
          toHeight: 0.35,
          arc: 1.2,
        });
        return { ok: true, reason: "" };
      }
      if (
        id === "freeze" ||
        id === "poison" ||
        id === "rage" ||
        id === "lightning" ||
        id === "tornado" ||
        id === "graveyard" ||
        id === "clone"
      ) {
        const rules =
          id === "freeze"
            ? freeze
            : id === "poison"
              ? poison
              : id === "rage"
                ? rage
                : id === "lightning"
                  ? lightning
                  : id === "tornado"
                    ? tornado
                    : id === "graveyard"
                      ? graveyard
                      : clone;
        this.areas.push({
          id: this.nextId++,
          team,
          card: id,
          x,
          y,
          radius: rules.radius,
          duration: rules.duration,
          remaining: rules.duration,
          ...(id === "lightning"
            ? { hitAt: lightning.strikeInterval, struck: [] }
            : id === "tornado"
              ? { hitAt: 0, damageAt: tornado.damageInterval }
              : id === "graveyard"
                ? { hitAt: graveyard.spawnInitialDelay }
                : {}),
        });
        if (id === "poison" || id === "rage")
          this.emitAudio("impact", team, id);
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
                  ? { towerDamageFraction: rocket.crownTowerDamageFraction }
                  : {}),
              }
            : {}),
        });
        this.audioProjectiles.set(this.projectiles.at(-1)!.id, id);
      }
    } else if (id === "miner") {
      const origin = { x: 9, y: team === "blue" ? 29 : 3 };
      const duration = Math.max(STEP, dist(origin, { x, y }) / miner.travelSpeed);
      this.projectiles.push({
        id: this.nextId++, team, x: origin.x, y: origin.y, tx: x, ty: y,
        target: null, damage: 0, remaining: duration, duration,
        splash: 0, air: false, style: "miner-travel", stun: 0, source: 0,
        flight: { ...origin }, speed: miner.travelSpeed, elapsed: 0,
      });
      this.emit("spell", team, origin.x, origin.y, "miner", 0, { effect: "miner-travel" });
    } else {
      const unitId: CardId =
        id === "minion-horde"
          ? "minions"
          : id === "three-musketeers"
            ? "musketeer"
            : id;
      for (const [index, point] of deploymentPositions(
        id,
        { x, y },
        team,
      ).entries())
        this.spawn(
          id === "goblin-gang"
            ? index < 3
              ? "goblins"
              : "spear-goblins"
            : unitId,
          team,
          point.x,
          point.y,
          true,
          id === "bats" ? 1 + bats.deployDelay :
            id === "elite-barbarians" ? 1 + eliteBarbarians.deployDelay :
          id === "guards" ? guards.sourceDeployTime + guards.deployDelay :
            id === "ice-spirit" ? 1 + iceSpirit.deployDelay :
            id === "fire-spirits" ? 1 + fireSpirits.deployDelay :
            id === "golem" ? golem.golem.sourceDeployTime :
            id === "mortar" ? mortar.deployTime :
            id === "x-bow" ? xBow.deployTime : 1,
        );
    }
    return { ok: true, reason: "" };
  }
  private spawn(id: CardId, team: Team, x: number, y: number, audio = true, deploy = 1) {
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
      ...(id === "dark-prince" ? {
        shield: Math.round(darkPrince.sourceShieldHitpoints * 1.1 ** 5),
        maxShield: Math.round(darkPrince.sourceShieldHitpoints * 1.1 ** 5),
      } : id === "guards" ? {
        shield: Math.round(guards.sourceShieldHitpoints * 1.1 ** 5),
        maxShield: Math.round(guards.sourceShieldHitpoints * 1.1 ** 5),
      } : {}),
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
      cooldown: id === "sparky" ? sparky.sourceLoadTime + deploy : 0.4,
      interval: c.interval,
      speed: c.speed,
      target: null,
      age: 0,
      deploy,
      stun: 0,
      attack: 0,
      ...(id === "sparky" ? { sparkyCharge: 0 } : {}),
      move: 0,
      active: true,
      lifetime: c.lifetime,
      spawnTimer: id === "night-witch" ? nightWitch.spawn.pause : 4,
      ...(id === "tesla" && this.rulesVersion >= 3
        ? { burrow: { exposure: 0, idle: 0, phase: "hidden" as const } }
        : {}),
    });
    if (audio)
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
      ...(actor !== undefined
        ? (() => {
            const entity = this.entities.find((entry) => entry.id === actor);
            const pitchMultiplier =
              (entity?.rage ? rage.audioPitchMultiplier : 1) *
              (entity?.slow ? iceWizard.audioPitchMultiplier : 1);
            return pitchMultiplier === 1 ? {} : { pitchMultiplier };
          })()
        : {}),
      ...(origin ? { origin } : {}),
    };
    this.audioEvents.push(event);
    if (this.audioEvents.length > 256)
      this.audioEvents.splice(0, this.audioEvents.length - 256);
    return event.id;
  }
  private emitImpactAudio(e: Entity, damage: number) {
    this.emitAudio(
      (e.card === "prince" || e.card === "dark-prince") && damage > e.damage
        ? "impact-special" : "impact",
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
    if (p.decorative) return;
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
        p.style === "bomb" || p.style === "rage-bottle" ? "death-impact" : "impact",
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
      if (area.card === "ice-golem") {
        for (const entity of this.entities) {
          if (entity.hp <= 0 || entity.team === area.team || entity.dash ||
              dist(entity, area) >= area.radius + entity.radius) continue;
          entity.slow ??= { remaining: 0 };
          entity.slow.remaining = Math.max(entity.slow.remaining,
            iceGolem.slowDuration);
        }
        area.remaining = Math.max(0, area.remaining - STEP);
        continue;
      }
      if (area.card === "clone") {
        const cloned = (area.struck ??= []);
        for (const entity of [...this.entities]) {
          if (
            entity.hp <= 0 ||
            entity.team !== area.team ||
            entity.kind !== "troop" ||
            entity.clone ||
            cloned.includes(entity.id) ||
            dist(entity, area) >= area.radius + entity.radius
          )
            continue;
          cloned.push(entity.id);
          // The archived area selects friendly troops but does not retain the
          // native clone offset. Keep a small forward separation in this arena.
          const x = clamp(
            entity.x + (entity.x < area.x ? -0.25 : 0.25),
            0.5,
            17.5,
          );
          const y = clamp(
            entity.y + (area.team === "blue" ? -0.65 : 0.65),
            0.7,
            31.3,
          );
          this.entities.push({
            ...structuredClone(entity),
            id: this.nextId++,
            x,
            y,
            hp: 1,
            maxHp: 1,
            shield: 0,
            maxShield: 0,
            target: null,
            age: 0,
            deploy: clone.buffDuration,
            cooldown: 0.4,
            attack: 0,
            move: 0,
            pendingAttack: undefined,
            clone: true,
          });
          this.emit("deploy", area.team, x, y, entity.card, 0, {
            effect: "clone-appear",
          });
        }
        area.remaining = Math.max(0, area.remaining - STEP);
        if (area.remaining < 1e-8) area.remaining = 0;
        continue;
      }
      if (area.card === "graveyard") {
        if (age + 1e-8 >= (area.hitAt ?? graveyard.spawnInitialDelay)) {
          area.hitAt =
            (area.hitAt ?? graveyard.spawnInitialDelay) +
            graveyard.spawnInterval;
          // The source specifies a radius and cadence but leaves individual
          // spawn coordinates to its native runtime. Use a seeded uniform
          // area distribution so peers and replays agree on every Skeleton.
          const angle = this.random() * Math.PI * 2;
          const radius = Math.sqrt(this.random()) * area.radius;
          const x = clamp(area.x + Math.cos(angle) * radius, 0.5, 17.5);
          const y = clamp(area.y + Math.sin(angle) * radius, 0.7, 31.3);
          this.spawn("skeletons", area.team, x, y, false);
          this.entities.at(-1)!.deploy = graveyard.spawnDeployTime;
          this.emit("deploy", area.team, x, y, "skeletons", 0, {
            effect: "graveyard-appear",
          });
          this.emitAudio("summon", area.team, "graveyard");
        }
        area.remaining = Math.max(0, area.remaining - STEP);
        if (area.remaining < 1e-8) area.remaining = 0;
        continue;
      }
      if (area.card === "lightning") {
        if (age + 1e-8 >= (area.hitAt ?? lightning.strikeInterval)) {
          area.hitAt =
            (area.hitAt ?? lightning.strikeInterval) + lightning.strikeInterval;
          const struck = (area.struck ??= []);
          const target = this.entities
            .filter(
              (entity) =>
                entity.hp > 0 &&
                entity.team !== area.team &&
                !this.isHidden(entity) &&
                !struck.includes(entity.id) &&
                dist(entity, area) < area.radius + entity.radius,
            )
            .sort((a, b) => b.hp - a.hp || a.id - b.id)[0];
          if (target) {
            struck.push(target.id);
            const damage =
              CARD_MAP.lightning.damage *
              (target.kind === "tower"
                ? lightning.crownTowerDamageFraction
                : 1);
            this.hurt(target, damage);
            if (target.hp > 0 && !target.dash) {
              target.stun = Math.max(target.stun, lightning.stunDuration);
              target.move = 0;
              this.cancelAttack(target);
            }
            this.emit(
              "hit",
              area.team,
              target.x,
              target.y,
              "lightning",
              damage,
              {
                height: projectileHitHeight(target),
              },
            );
            this.emitAudio("impact", area.team, "lightning");
          }
        }
        area.remaining = Math.max(0, area.remaining - STEP);
        if (area.remaining < 1e-8) area.remaining = 0;
        continue;
      }
      if (area.card === "tornado") {
        const pull = age + 1e-8 >= (area.hitAt ?? 0);
        if (pull) area.hitAt = (area.hitAt ?? 0) + tornado.areaHitInterval;
        const damage = age + 1e-8 >= (area.damageAt ?? tornado.damageInterval);
        if (damage)
          area.damageAt =
            (area.damageAt ?? tornado.damageInterval) + tornado.damageInterval;
        for (const entity of this.entities) {
          if (
            entity.hp <= 0 ||
            entity.team === area.team ||
            entity.kind !== "troop" ||
            this.isHidden(entity) ||
            dist(entity, area) >= area.radius + entity.radius
          )
            continue;
          if (pull) {
            const dx = area.x - entity.x;
            const dy = area.y - entity.y;
            const distance = Math.hypot(dx, dy);
            if (distance > 0.001) {
              const travel = Math.min(
                distance,
                entity.speed *
                  tornado.attractPercentage *
                  tornado.areaHitInterval,
              );
              entity.x = clamp(entity.x + (dx / distance) * travel, 0.5, 17.5);
              entity.y = clamp(entity.y + (dy / distance) * travel, 0.6, 31.4);
              entity.move = 0;
            }
          }
          if (damage) this.hurt(entity, CARD_MAP.tornado.damage);
        }
        area.remaining = Math.max(0, area.remaining - STEP);
        if (area.remaining < 1e-8) area.remaining = 0;
        continue;
      }
      const periodic = area.card === "poison" || area.card === "rage";
      const areaHit = periodic && age + 1e-8 >= (area.hitAt ?? 0);
      if (areaHit)
        area.hitAt =
          (area.hitAt ?? 0) +
          (area.card === "poison"
            ? poison.areaHitInterval
            : rage.areaHitInterval);
      for (const entity of this.entities) {
        if (
          entity.hp <= 0 ||
          (area.card === "rage"
            ? entity.team !== area.team || entity.kind !== "troop"
            : entity.team === area.team) ||
          (periodic && !areaHit) ||
          (area.card === "poison" && this.isHidden(entity)) ||
          dist(entity, area) >= area.radius + entity.radius
        )
          continue;
        if (area.card === "freeze" && !entity.dash)
          entity.stun = Math.max(entity.stun, STEP * 2);
        else if (area.card === "poison")
          entity.poison ??= { remaining: 0, elapsed: 0 };
        if (area.card === "poison" && entity.poison)
          entity.poison.remaining = poison.buffDuration;
        if (area.card === "rage") {
          entity.rage ??= { remaining: 0 };
          entity.rage.remaining = Math.max(
            entity.rage.remaining,
            Math.min(rage.buffDuration, area.remaining),
          );
        }
      }
      area.remaining = Math.max(0, area.remaining - STEP);
      if (area.remaining < 1e-8) area.remaining = 0;
    }
    this.areas = this.areas.filter((area) => area.remaining > 0);
    for (const entity of this.entities) {
      if (entity.rage) {
        entity.rage.remaining = Math.max(0, entity.rage.remaining - STEP);
        if (entity.rage.remaining < 1e-8) entity.rage = undefined;
      }
      if (entity.slow) {
        entity.slow.remaining = Math.max(0, entity.slow.remaining - STEP);
        if (entity.slow.remaining < 1e-8) entity.slow = undefined;
      }
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
      if (e.card === "night-witch") {
        e.spawnTimer -=
          STEP *
          (e.rage ? rage.spawnSpeedMultiplier : 1) *
          (e.slow ? iceWizard.spawnSpeedMultiplier : 1);
        if (e.spawnTimer <= 1e-8) {
          e.spawnTimer += nightWitch.spawn.pause;
          this.emitAudio("summon", e.team, "night-witch", e.id,
            undefined, { x: e.x, y: e.y });
          this.emit("spell", e.team, e.x, e.y, "night-witch", 0,
            { effect: "summon:night-witch" });
          for (let i = 0; i < nightWitch.spawn.count; i++) {
            const side = i - (nightWitch.spawn.count - 1) / 2;
            this.spawn(
              "bats", e.team,
              clamp(e.x + side * nightWitch.spawn.radius * 1.2, 0.6, 17.4),
              clamp(e.y + (e.team === "blue" ? -0.5 : 0.5), 0.8, 31.2),
              true, 1 + bats.deployDelay,
            );
          }
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
              p.damage * (p.source === 0 && e.kind === "tower" ? 0.3 : 1),
            );
            if (!e.dash) {
              e.stun = Math.max(e.stun, p.stun);
              if (p.stun) e.cooldown = e.interval;
            }
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
      (!card?.buildingsOnly || target.kind !== "troop") &&
      (e.card !== "mortar" || dist(e, target) >= mortar.minimumRange)
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
    e.inferno = undefined;
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
      const hitSpeed =
        (e.rage ? rage.hitSpeedMultiplier : 1) *
        (e.slow ? iceWizard.hitSpeedMultiplier : 1);
      e.age += STEP;
      e.attack = Math.max(0, e.attack - STEP * hitSpeed);
      e.cooldown = Math.max(0, e.cooldown - STEP * hitSpeed);
      if (e.card === "bandit")
        e.dashCooldown = Math.max(0, (e.dashCooldown ?? 0) - STEP);
      e.stun = Math.max(0, e.stun - STEP);
      if (e.deploy > 0) {
        e.deploy -= STEP;
        if (e.card === "electro-wizard" && e.deploy <= 1e-8) {
          e.deploy = 0;
          this.electroDeployZap(e);
        }
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
      if (e.card === "bandit" && e.dash) {
        this.advanceBanditDash(e);
        continue;
      }
      if (e.stun > 0) {
        this.cancelAttack(e);
        if (e.card === "sparky") {
          e.sparkyCharge = 0;
          e.cooldown = sparky.sourceLoadTime;
        }
        e.move = 0;
        continue;
      }
      if (!e.active) {
        this.cancelAttack(e);
        continue;
      }
      if (e.card === "sparky") {
        const before = e.sparkyCharge ?? 0;
        e.sparkyCharge = Math.min(sparky.sourceLoadTime,
          before + STEP * hitSpeed);
        for (const [index, phase] of ["load-1", "load-2", "load-3", "load-ready"].entries()) {
          const threshold = sparky.sourceLoadTime * (index + 1) / 4;
          if (before < threshold && e.sparkyCharge >= threshold)
            this.emitAudio(phase as "load-1" | "load-2" | "load-3" | "load-ready",
              e.team, "sparky", e.id);
        }
      }
      if (e.burrow && !this.updateTesla(e)) continue;
      if (e.card === "inferno-dragon" || e.card === "inferno-tower") {
        this.updateInferno(e, hitSpeed);
        continue;
      }
      if (e.card === "witch") {
        e.spawnTimer -=
          STEP *
          (e.rage ? rage.spawnSpeedMultiplier : 1) *
          (e.slow ? iceWizard.spawnSpeedMultiplier : 1);
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
      if (e.card === "night-witch") {
        e.spawnTimer -=
          STEP *
          (e.rage ? rage.spawnSpeedMultiplier : 1) *
          (e.slow ? iceWizard.spawnSpeedMultiplier : 1);
        if (e.spawnTimer <= 1e-8) {
          e.spawnTimer += nightWitch.spawn.pause;
          this.emitAudio("summon", e.team, "night-witch", e.id,
            undefined, { x: e.x, y: e.y });
          this.emit("spell", e.team, e.x, e.y, "night-witch", 0,
            { effect: "summon:night-witch" });
          for (let i = 0; i < nightWitch.spawn.count; i++) {
            const side = i - (nightWitch.spawn.count - 1) / 2;
            this.spawn(
              "bats", e.team,
              clamp(e.x + side * nightWitch.spawn.radius * 1.2, 0.6, 17.4),
              clamp(e.y + (e.team === "blue" ? -0.5 : 0.5), 0.8, 31.2),
              true, 1 + bats.deployDelay,
            );
          }
        }
      }
      if (e.pendingAttack) {
        const pending = e.pendingAttack;
        const target = this.entities.find(
          (t) => t.id === pending.target && this.validTarget(e, t),
        );
        if (!target || !this.inRange(e, target)) this.cancelAttack(e);
        else {
          pending.remaining -= STEP * hitSpeed;
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
      if (e.card === "bandit" && (e.dashCooldown ?? 0) <= 1e-8 &&
          !e.pendingAttack && e.cooldown <= 1e-8) {
        const distance = dist(e, target) - target.radius;
        if (distance >= bandit.dash.minimum && distance <= bandit.dash.maximum) {
          e.dash = { target: target.id, elapsed: 0,
            remaining: bandit.dash.maximum / bandit.dash.speed + STEP };
          e.move = 0;
          this.emitAudio("dash-start", e.team, "bandit", e.id);
          this.emitAudio("dash-travel", e.team, "bandit", e.id);
          this.emit("spell", e.team, e.x, e.y, "bandit", e.id,
            { effect: "dash-start:bandit" });
          continue;
        }
      }
      if (this.inRange(e, target)) {
        if (e.cooldown <= 1e-8) {
          const damage = e.card === "battle-ram" && e.move >= battleRam.chargeRange
            ? Math.round((battleRam.sourceChargeDamage * 218) / 100)
            : e.card === "dark-prince" && e.move >= darkPrince.chargeRange
            ? Math.round(darkPrince.sourceChargeDamage * 1.1 ** 5)
            : e.damage * (e.card === "prince" && e.move >= 2.3 ? 2 : 1);
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
  private advanceBanditDash(e: Entity) {
    const dash = e.dash!;
    const target = this.entities.find((entry) =>
      entry.id === dash.target && this.validTarget(e, entry));
    const contact = target && this.inRange(e, target);
    if (!target || contact || dash.remaining <= 1e-8) {
      e.dash = undefined;
      e.dashCooldown = bandit.dash.cooldown;
      e.cooldown = e.interval;
      e.move = 0;
      this.emitAudio("dash-end", e.team, "bandit", e.id);
      this.emit("spell", e.team, e.x, e.y, "bandit", e.id,
        { effect: "dash-end:bandit" });
      if (target && contact) {
        const damage = Math.round(bandit.dash.damage * 1.1 ** 2);
        this.hurt(target, damage);
        this.emit("hit", e.team, target.x, target.y, "bandit", damage,
          { effect: "hit-special:bandit" });
        this.emitAudio("impact-special", e.team, "bandit", e.id);
      }
      return;
    }
    const dx = target.x - e.x, dy = target.y - e.y;
    const distance = Math.hypot(dx, dy) || 1;
    const travel = Math.min(distance, bandit.dash.speed * STEP);
    e.x = clamp(e.x + dx / distance * travel, 0.5, 17.5);
    e.y = clamp(e.y + dy / distance * travel, 0.6, 31.4);
    dash.elapsed += STEP;
    dash.remaining -= STEP;
    if (this.inRange(e, target)) this.advanceBanditDash(e);
  }
  private updateInferno(e: Entity, hitSpeed: number) {
    const source = e.card === "inferno-tower" ? infernoTower : infernoDragon;
    const target = this.acquireTarget(e);
    if (!target || !this.inRange(e, target)) {
      this.cancelAttack(e);
      if (target) this.moveToward(e, target);
      else e.move = 0;
      return;
    }
    if (!e.inferno || e.inferno.target !== target.id) {
      this.cancelAttack(e);
      e.inferno = {
        target: target.id,
        elapsed: 0,
        hitTimer: e.interval,
        stage: 0,
      };
      this.beginAudio(e);
    }
    const lock = e.inferno;
    e.move = 0;
    lock.elapsed += STEP;
    lock.stage =
      lock.elapsed >= source.stageDurations[0] + source.stageDurations[1]
        ? 2
        : lock.elapsed >= source.stageDurations[0]
          ? 1
          : 0;
    lock.hitTimer -= STEP * hitSpeed;
    if (lock.hitTimer > 1e-8) return;
    lock.hitTimer += e.interval;
    e.attack = e.interval;
    const damage = Math.round(source.sourceDamage[lock.stage] *
      (e.card === "inferno-tower" ? 1152 / 450 : 1.1 ** 2));
    this.hurt(target, damage);
    this.emit("hit", e.team, target.x, target.y, e.card, damage, {
      height: projectileHitHeight(target),
    });
    this.emitImpactAudio(e, damage);
    if (target.hp <= 0) this.cancelAttack(e);
  }
  private electroDeployZap(e: Entity) {
    // The archived spawn references Zap at level index 8. The historical
    // Common upgrade curve is reconstructed as 10% per index.
    const damage = Math.round(
      electroWizard.deployZap.sourceDamage *
      1.1 ** electroWizard.deployZap.levelIndex,
    );
    for (const target of this.entities) {
      if (!this.validTarget(e, target) ||
          dist(e, target) >= electroWizard.deployZap.radius + target.radius)
        continue;
      this.hurt(target, damage * (target.kind === "tower" ? 0.4 : 1));
      if (target.hp > 0 && !target.dash) {
        target.stun = Math.max(target.stun, electroWizard.deployZap.stun);
        this.cancelAttack(target);
        target.move = 0;
      }
    }
    this.emit("hit", e.team, e.x, e.y, "zap", damage);
    this.emitAudio("impact", e.team, "zap");
  }
  private releaseAttack(e: Entity, target: Entity, damage: number) {
    this.audioAttacks.delete(e.id);
    if (e.card === "sparky") {
      e.sparkyCharge = 0;
      const dx = target.x - e.x, dy = target.y - e.y;
      const length = Math.hypot(dx, dy) || 1;
      const start = {
        x: e.x + dx / length * sparky.projectileStart.radius,
        y: e.y + dy / length * sparky.projectileStart.radius,
      };
      const duration = Math.max(STEP, dist(start, target) / sparky.projectile.speed);
      this.projectiles.push({
        id: this.nextId++, team: e.team, x: e.x, y: e.y,
        tx: target.x, ty: target.y, target: target.id, damage,
        remaining: duration, duration, splash: sparky.projectile.radius,
        air: false, style: "sparky", stun: 0, source: e.id,
        knockback: sparky.pushback,
        flight: start, speed: sparky.projectile.speed,
        elapsed: 0, homing: true,
        fromHeight: sparky.projectileStart.height,
        toHeight: target.kind === "tower" ? 1.8 : 0.6, arc: 0,
      });
      this.audioProjectiles.set(this.projectiles.at(-1)!.id, audioProfile(e));
      this.emitAudio("launch", e.team, "sparky", e.id, undefined,
        { x: e.x, y: e.y });
      return;
    }
    if (e.card === "executioner") {
      const dx = target.x - e.x, dy = target.y - e.y;
      const distance = Math.hypot(dx, dy) || 1;
      const ux = dx / distance, uy = dy / distance;
      // The retained minimum and maximum travel values bound the endpoint;
      // the exact historical extension beyond the selected target is absent.
      const reach = clamp(distance + 2, executioner.projectile.minDistance,
        executioner.projectile.range);
      const start = { x: e.x + ux * 0.6, y: e.y + uy * 0.6 };
      const turn = {
        x: clamp(e.x + ux * reach, 0.5, 17.5),
        y: clamp(e.y + uy * reach, 0.6, 31.4),
      };
      const duration = Math.hypot(turn.x - start.x, turn.y - start.y) /
        executioner.projectile.speed;
      this.projectiles.push({
        id: this.nextId++, team: e.team, x: e.x, y: e.y,
        tx: turn.x, ty: turn.y, turn, target: null, damage,
        remaining: duration, duration, splash: 0, air: true,
        style: "executioner", stun: 0, source: e.id,
        flight: start, speed: executioner.projectile.speed,
        elapsed: 0, homing: false,
        fromHeight: executioner.projectile.height,
        toHeight: executioner.projectile.height,
        arc: 0, rollHits: [], returning: false,
      });
      this.audioProjectiles.set(this.projectiles.at(-1)!.id, audioProfile(e));
      this.emitAudio("launch", e.team, audioProfile(e), e.id, undefined, { x: e.x, y: e.y });
      return;
    }
    if (e.card === "battle-ram") {
      this.hurt(target, damage);
      this.emit("hit", e.team, target.x, target.y, "battle-ram", damage);
      this.emitImpactAudio(e, damage);
      this.hurt(e, e.hp);
      return;
    }
    if (e.card === "dark-prince") {
      for (const victim of this.entities) {
        if (!this.validTarget(e, victim) ||
            dist(victim, target) > darkPrince.splash + victim.radius) continue;
        this.hurt(victim, damage);
        this.emit("hit", e.team, victim.x, victim.y, "dark-prince", damage);
        this.emitImpactAudio(e, damage);
      }
      return;
    }
    if (e.card === "bowler") {
      const dx = target.x - e.x, dy = target.y - e.y;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length, uy = dy / length;
      const x = e.x + ux, y = e.y + uy;
      const tx = clamp(x + ux * bowler.projectile.range, 0.5, 17.5);
      const ty = clamp(y + uy * bowler.projectile.range, 0.6, 31.4);
      const duration = Math.hypot(tx - x, ty - y) / bowler.projectile.speed;
      const p: Projectile = {
        id: this.nextId++, team: e.team, x, y, tx, ty, target: null,
        damage, remaining: duration, duration, splash: 0, air: false,
        style: "bowler", stun: 0, source: e.id, flight: { x, y },
        speed: bowler.projectile.speed, elapsed: 0, homing: false,
        fromHeight: 0.9, toHeight: 0.9, arc: 0,
        knockback: bowler.projectile.knockback, rollHits: [],
      };
      this.projectiles.push(p);
      this.audioProjectiles.set(p.id, audioProfile(e));
      this.emitAudio("launch", e.team, audioProfile(e), e.id, undefined, { x: e.x, y: e.y });
      return;
    }
    if (e.card === "electro-wizard") {
      const targets = [
        target,
        ...this.entities
          .filter((candidate) =>
            candidate.id !== target.id &&
            this.validTarget(e, candidate) &&
            this.inRange(e, candidate),
          )
          .sort((a, b) => dist(e, a) - dist(e, b))
          .slice(0, electroWizard.targets - 1),
      ];
      for (const victim of targets) {
        this.hurt(victim, damage);
        if (victim.hp > 0 && !victim.dash) {
          victim.stun = Math.max(victim.stun, electroWizard.stun);
          this.cancelAttack(victim);
          victim.move = 0;
        }
        this.emit("hit", e.team, victim.x, victim.y, "electro-wizard", damage, {
          origin: { x: e.x, y: e.y, height: 1.5 },
          height: projectileHitHeight(victim),
        });
        this.emitImpactAudio(e, damage);
      }
      return;
    }
    const card = e.card === "tower" ? null : CARD_MAP[e.card];
    const traits = combatTraits(e);
    const p = traits.projectile;
    if (p || e.card === "balloon" || e.card === "tesla") {
      const speed = p?.speed ?? (e.card === "tesla" ? 1000 : undefined);
      const muzzleDistance = e.card === "x-bow" ? xBow.projectileStartRadius : 0;
      const targetDistance = dist(e, target) || 1;
      const launchX = e.x + (target.x - e.x) / targetDistance * muzzleDistance;
      const launchY = e.y + (target.y - e.y) / targetDistance * muzzleDistance;
      const duration = speed
        ? Math.max(STEP, dist({ x: launchX, y: launchY }, target) / speed)
        : 0.35;
      const defaultFromHeight =
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
                : e.card === "mortar"
                  ? 1
                  : e.card === "bomb-tower"
                    ? 4.5
                  : e.card === "x-bow"
                    ? xBow.projectileStartHeight
                : e.air
                  ? 2.3
                  : 0.8;
      const fromHeight = entityProjectileStartHeight(e) ?? defaultFromHeight;
      this.projectiles.push({
        id: this.nextId++,
        team: e.team,
        x: launchX,
        y: launchY,
        tx: target.x,
        ty: target.y,
        target: target.id,
        damage,
        remaining: duration,
        duration,
        splash: card?.splash ?? 0,
        air: e.kind === "tower" || !!card?.hitsAir,
        style: e.kind === "tower" ? (e.king ? "cannonball" : "arrow") : e.card,
        stun: e.card === "ice-spirit" ? iceSpirit.freezeDuration : 0,
        source: e.id,
        ...(e.card === "ice-wizard" ? { slow: iceWizard.slowDuration } : {}),
        flight: { x: launchX, y: launchY },
        speed,
        elapsed: 0,
        homing: p?.homing ?? true,
        fromHeight,
        toHeight: projectileHitHeight(target),
        arc:
          e.card === "balloon" || e.card === "tesla"
            ? 0
            : (p?.gravity ?? 0) / 100,
      });
      this.audioProjectiles.set(this.projectiles.at(-1)!.id, audioProfile(e));
      if (e.card === "ice-spirit" || e.card === "fire-spirits")
        this.hurt(e, e.hp);
      if (e.card === "princess") {
        // The archived character fires one damaging custom first projectile
        // and four copies of PrincessProjectileDeco without damage.
        const first = this.projectiles.at(-1)!;
        for (const offset of [-2, -1, 1, 2]) {
          const tx = clamp(target.x + offset * 0.38, 0.5, 17.5);
          const ty = clamp(target.y + Math.abs(offset) * 0.14, 0.6, 31.4);
          const duration = Math.max(
            STEP,
            dist(e, { x: tx, y: ty }) / (speed ?? 1),
          );
          this.projectiles.push({
            ...first,
            id: this.nextId++,
            tx,
            ty,
            target: null,
            damage: 0,
            splash: 0,
            remaining: duration,
            duration,
            flight: { x: e.x, y: e.y },
            decorative: true,
          });
        }
      }
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
      const dealt = e.card === "miner" && target.kind === "tower"
        ? Math.round(damage * miner.crownTowerDamageFraction)
        : damage;
      this.hurt(target, dealt);
      this.emit("hit", e.team, target.x, target.y, e.card, dealt);
      this.emitImpactAudio(e, dealt);
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
      const previousFlight = p.style === "log" || p.style === "bowler" ||
        p.style === "executioner"
        ? { ...p.flight! } : null;
      if (p.homing && target) {
        p.tx = target.x;
        p.ty = target.y;
        p.toHeight = projectileHitHeight(target);
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
      if (p.style === "miner-travel") {
        if (p.remaining <= 1e-8) {
          this.spawn("miner", p.team, p.tx, p.ty);
          this.emit("deploy", p.team, p.tx, p.ty, "miner");
        }
        continue;
      }
      if (p.style === "rage-bottle") {
        if (p.remaining <= 1e-8) {
          p.remaining = 0;
          this.areas.push({
            id: this.nextId++, team: p.team, card: "rage",
            x: p.tx, y: p.ty,
            radius: lumberjack.deathBottle.radius,
            duration: lumberjack.deathBottle.duration,
            remaining: lumberjack.deathBottle.duration,
          });
          this.emit("hit", p.team, p.tx, p.ty, "lumberjack", 0,
            { effect: "bottle:lumberjack" });
          this.emit("spell", p.team, p.tx, p.ty, "rage");
          this.projectileAudio(p);
        }
        continue;
      }
      if (p.style === "log-launch") {
        if (p.remaining <= 1e-8) {
          const range = Math.min(
            log.rollingRange,
            p.team === "blue" ? p.ty - 0.6 : 31.4 - p.ty,
          );
          const ty = p.ty + (p.team === "blue" ? -range : range);
          const duration = range / log.rollingSpeed;
          this.projectiles.push({
            id: this.nextId++,
            team: p.team,
            x: p.tx,
            y: p.ty,
            tx: p.tx,
            ty,
            target: null,
            damage: p.damage,
            remaining: duration,
            duration,
            splash: 0,
            air: false,
            style: "log",
            stun: 0,
            source: 0,
            flight: { x: p.tx, y: p.ty },
            speed: log.rollingSpeed,
            elapsed: 0,
            fromHeight: 0.45,
            toHeight: 0.45,
            arc: 0,
            knockback: log.knockback,
            towerDamageFraction: log.crownTowerDamageFraction,
            rollHits: [],
          });
          this.emitAudio("launch", p.team, "log");
          p.remaining = 0;
        }
        continue;
      }
      if (p.style === "log") {
        if (
          Math.floor((p.elapsed ?? 0) * 2) >
          Math.floor(((p.elapsed ?? 0) - STEP) * 2)
        )
          this.emitAudio("launch", p.team, "log");
        const oldY = previousFlight?.y ?? p.y;
        const newY = p.flight?.y ?? p.ty;
        for (const e of this.entities) {
          if (
            e.hp <= 0 ||
            e.team === p.team ||
            e.air ||
            this.isHidden(e) ||
            p.rollHits!.includes(e.id) ||
            Math.abs(e.x - p.x) >= log.collisionHalfWidth + e.radius ||
            e.y < Math.min(oldY, newY) - log.collisionRadius - e.radius ||
            e.y > Math.max(oldY, newY) + log.collisionRadius + e.radius
          )
            continue;
          p.rollHits!.push(e.id);
          this.hurt(
            e,
            p.damage * (e.kind === "tower" ? log.crownTowerDamageFraction : 1),
          );
          this.emit("hit", p.team, e.x, e.y, "log", p.damage);
          this.emitAudio("impact", p.team, "log");
          if (e.hp > 0 && e.kind === "troop") {
            this.knockback(
              e,
              { x: e.x, y: e.y + (p.team === "blue" ? 1 : -1) },
              log.knockback,
            );
          }
        }
        if (p.remaining <= 1e-8) {
          this.emit("hit", p.team, p.tx, p.ty, "log", 0, { effect: "log-die" });
          this.emitAudio("impact-special", p.team, "log");
          p.remaining = 0;
        }
        continue;
      }
      if (p.style === "bowler") {
        const from = previousFlight!;
        const to = p.flight!;
        const dx = to.x - from.x, dy = to.y - from.y;
        const segment = dx * dx + dy * dy;
        for (const victim of this.entities) {
          if (victim.hp <= 0 || victim.team === p.team || victim.air ||
              this.isHidden(victim) || p.rollHits!.includes(victim.id)) continue;
          const progress = segment > 0
            ? clamp(((victim.x - from.x) * dx + (victim.y - from.y) * dy) / segment, 0, 1)
            : 0;
          const nearestX = from.x + dx * progress;
          const nearestY = from.y + dy * progress;
          if (Math.hypot(victim.x - nearestX, victim.y - nearestY) >
              bowler.projectile.radius + victim.radius) continue;
          p.rollHits!.push(victim.id);
          this.hurt(victim, p.damage);
          this.emit("hit", p.team, victim.x, victim.y, "bowler", p.damage);
          this.emitAudio("impact", p.team, "bowler", p.source);
          if (victim.hp > 0 && victim.kind === "troop")
            this.knockback(victim, {
              x: victim.x - (p.tx - p.x) / p.duration / bowler.projectile.speed,
              y: victim.y - (p.ty - p.y) / p.duration / bowler.projectile.speed,
            }, p.knockback ?? 0);
        }
        if (p.remaining <= 1e-8) {
          this.emit("hit", p.team, p.tx, p.ty, "bowler", 0, { effect: "hit:bowler" });
          this.projectileAudio(p);
        }
        continue;
      }
      if (p.style === "executioner") {
        const from = previousFlight!, to = p.flight!;
        const dx = to.x - from.x, dy = to.y - from.y;
        const segment = dx * dx + dy * dy;
        for (const victim of this.entities) {
          if (victim.hp <= 0 || victim.team === p.team || this.isHidden(victim) ||
              p.rollHits!.includes(victim.id)) continue;
          const progress = segment > 0
            ? clamp(((victim.x - from.x) * dx + (victim.y - from.y) * dy) / segment, 0, 1)
            : 0;
          const nearestX = from.x + dx * progress;
          const nearestY = from.y + dy * progress;
          if (Math.hypot(victim.x - nearestX, victim.y - nearestY) >
              executioner.projectile.radius + victim.radius) continue;
          p.rollHits!.push(victim.id);
          this.hurt(victim, p.damage);
          this.emit("hit", p.team, victim.x, victim.y, "executioner", p.damage);
          this.emitAudio("impact", p.team, "executioner", p.source);
        }
        if (p.remaining <= 1e-8) {
          if (!p.returning) {
            p.returning = true;
            p.rollHits = [];
            p.tx = p.x;
            p.ty = p.y;
            p.remaining = Math.hypot(p.flight!.x - p.x, p.flight!.y - p.y) /
              executioner.projectile.speed;
            p.duration = p.elapsed! + p.remaining;
          } else {
            this.emit("hit", p.team, p.x, p.y, "executioner", 0,
              { effect: "axe-die" });
            p.remaining = 0;
          }
        }
        continue;
      }
      if (p.style === "goblin-barrel") {
        if (p.remaining <= 1e-8) {
          for (let i = 0; i < goblinBarrel.spawnCount; i++) {
            const angle =
              -Math.PI / 2 + (i * Math.PI * 2) / goblinBarrel.spawnCount;
            const spread = goblinBarrel.landingRadius / 3;
            this.spawn(
              goblinBarrel.spawnCard as CardId,
              p.team,
              clamp(p.tx + Math.cos(angle) * spread, 0.6, 17.4),
              clamp(p.ty + Math.sin(angle) * spread, 0.8, 31.2),
            );
            this.entities.at(-1)!.deploy = goblinBarrel.spawnDeployTime;
          }
          this.emit("hit", p.team, p.tx, p.ty, "goblin-barrel", 0);
          this.projectileAudio(p);
          p.remaining = 0;
        }
        continue;
      }
      if (p.remaining > 1e-8) continue;
      p.remaining = 0;
      const point = { x: p.tx, y: p.ty };
      if (p.splash > 0) {
        // A death-triggered spawn begins after this impact. Do not include
        // newborn troops in the same damage packet that killed their parent.
        for (const e of [...this.entities]) {
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
                ? (p.towerDamageFraction ?? 0.3)
                : 1),
          );
          if (e.hp <= 0) continue;
          if (p.stun && !e.dash) {
            e.stun = Math.max(e.stun, p.stun);
            this.cancelAttack(e);
            e.move = 0;
          }
          if (p.slow) {
            e.slow ??= { remaining: 0 };
            e.slow.remaining = Math.max(e.slow.remaining, p.slow);
          }
          if (p.knockback) this.knockback(e, point, p.knockback);
        }
      } else if (target) this.hurt(target, p.damage);
      this.emit(
        "hit",
        p.team,
        point.x,
        point.y,
        ["arrow", "cannonball", "bomb", "giant-skeleton-bomb"].includes(p.style)
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
          ...(p.style === "giant-skeleton-bomb"
            ? { effect: "giant-skeleton-bomb" as const } : {}),
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
      if (p.style === "giant-skeleton-bomb")
        this.emitAudio("death-impact", p.team, "giant-skeleton", p.source,
          undefined, point);
      else this.projectileAudio(p);
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
      (e.rage ? rage.speedMultiplier : 1) *
      (e.slow ? iceWizard.speedMultiplier : 1) *
      (e.card === "prince" && e.move > 2.3 ? 1.8 :
        e.card === "dark-prince" && e.move > darkPrince.chargeRange
          ? darkPrince.chargeSpeedMultiplier :
        e.card === "battle-ram" && e.move > battleRam.chargeRange
          ? battleRam.chargeSpeedMultiplier : 1);
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
        // The archived ram has IgnorePushback: it must pass through defenders
        // rather than become trapped behind one in front of its building.
        if (a.card === "battle-ram" || b.card === "battle-ram" || a.dash || b.dash) continue;
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
      if (unit.air || unit.dash) continue;
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
    if (e.hp <= 0 || (!decay && (this.isHidden(e) || e.dash))) return;
    if (e.shield && !decay) {
      e.shield = Math.max(0, e.shield - amount);
      if (e.shield === 0) {
        this.emit("hit", e.team, e.x, e.y, e.card, 0, {
          effect: e.card === "guards" ? "shield:guards" : "shield:dark-prince",
        });
        this.emitAudio("shield-lost", e.team, audioProfile(e), e.id,
          undefined, { x: e.x, y: e.y });
      }
      return;
    }
    e.hp -= amount;
    if (e.king) this.activateKing(e);
    if (e.hp > 0) return;
    e.hp = 0;
    this.cancelAudio(e);
    this.emitAudio("death", e.team, audioProfile(e), e.id);
    this.emit("death", e.team, e.x, e.y, e.card);
    if (e.card === "giant-skeleton") {
      this.projectiles.push({
        id: this.nextId++, team: e.team, x: e.x, y: e.y,
        tx: e.x, ty: e.y, target: null,
        damage: Math.round(giantSkeleton.bomb.sourceDamage * 1.1 ** 5),
        remaining: giantSkeleton.bomb.deployTime,
        duration: giantSkeleton.bomb.deployTime,
        splash: giantSkeleton.bomb.radius,
        air: giantSkeleton.bomb.hitsAir,
        style: "giant-skeleton-bomb", stun: 0,
        source: e.id, flight: { x: e.x, y: e.y }, elapsed: 0,
        fromHeight: 0.2, toHeight: 0.2, arc: 0,
        knockback: giantSkeleton.bomb.pushback,
      });
      this.emitAudio("death-spawn", e.team, "giant-skeleton", e.id,
        undefined, { x: e.x, y: e.y });
    }
    if (e.card === "ice-golem") {
      this.areas.push({
        id: this.nextId++, team: e.team, card: "ice-golem", x: e.x, y: e.y,
        radius: iceGolem.deathRadius,
        duration: iceGolem.deathAreaDuration,
        remaining: iceGolem.deathAreaDuration,
      });
      this.emit("spell", e.team, e.x, e.y, "ice-golem", 0,
        { effect: "ice-golem-slow" });
      const damage = Math.round((iceGolem.deathDamage * 218) / 100);
      for (const victim of [...this.entities]) {
        if (victim.hp <= 0 || victim.team === e.team ||
            dist(victim, e) >= iceGolem.deathRadius + victim.radius) continue;
        this.hurt(victim, damage);
        if (victim.hp > 0 && !victim.dash) {
          victim.slow ??= { remaining: 0 };
          victim.slow.remaining = Math.max(victim.slow.remaining,
            iceGolem.slowDuration);
        }
      }
    }
    if (e.card === "golem" || e.card === "golemite") {
      const profile = e.card === "golem" ? golem.golem : golem.golemite;
      const death = profile.death;
      const damage = Math.round(death.damage * 1.1 ** 5);
      // Snapshot victims before a chained death can add fresh Golemites.
      for (const victim of [...this.entities]) {
        if (victim.hp <= 0 || victim.team === e.team ||
            (!death.hitsAir && victim.air) ||
            dist(victim, e) >= death.radius + victim.radius) continue;
        this.hurt(victim, damage);
        if (victim.hp > 0 && !victim.dash)
          this.knockback(victim, e, death.pushback);
      }
      if (e.card === "golem")
        for (let i = 0; i < golem.golem.deathSpawn.count; i++) {
          const side = i - (golem.golem.deathSpawn.count - 1) / 2;
          this.spawn("golemite", e.team,
            clamp(e.x + side * golem.golem.deathSpawn.radius, 0.6, 17.4),
            clamp(e.y, 0.8, 31.2), true, golem.golemite.sourceDeployTime);
        }
    }
    if (e.card === "lava-hound")
      for (let i = 0; i < lavaHound.hound.deathSpawn.count; i++) {
        const angle = (i * Math.PI * 2) / lavaHound.hound.deathSpawn.count;
        const radius = lavaHound.hound.deathSpawn.radius;
        this.spawn("lava-pup", e.team,
          clamp(e.x + Math.cos(angle) * radius, 0.6, 17.4),
          clamp(e.y + Math.sin(angle) * radius, 0.8, 31.2),
          true, lavaHound.pup.sourceDeployTime);
      }
    if (e.card === "battle-ram") {
      this.emitAudio("death-spawn", e.team, "battle-ram", e.id);
      for (let i = 0; i < battleRam.deathSpawnCount; i++) {
        const side = i - (battleRam.deathSpawnCount - 1) / 2;
        this.spawn(
          "barbarians", e.team,
          clamp(e.x + side * battleRam.deathSpawnRadius, 0.6, 17.4),
          clamp(e.y, 0.8, 31.2), false, battleRam.deathSpawnDeployTime,
        );
      }
    }
    if (e.card === "lumberjack") {
      this.projectiles.push({
        id: this.nextId++, team: e.team,
        x: e.x, y: e.y, tx: e.x, ty: e.y,
        target: null, damage: 0,
        remaining: 0.5, duration: 0.5,
        splash: 0, air: false, style: "rage-bottle", stun: 0,
        source: e.id, flight: { x: e.x, y: e.y },
        elapsed: 0, fromHeight: 0.2, toHeight: 0.2, arc: 0,
      });
      this.audioProjectiles.set(this.projectiles.at(-1)!.id, "lumberjack");
      this.emitAudio("death-spawn", e.team, "lumberjack", e.id);
    }
    if (e.card === "night-witch") {
      this.emitAudio("death-spawn", e.team, "night-witch", e.id);
      for (let i = 0; i < nightWitch.deathSpawn.count; i++) {
        const angle = (i * 360 / nightWitch.deathSpawn.count +
          nightWitch.deathSpawn.angleShift) * Math.PI / 180;
        this.spawn(
          "bats", e.team,
          clamp(e.x + Math.cos(angle) * nightWitch.deathSpawn.radius, 0.6, 17.4),
          clamp(e.y + Math.sin(angle) * nightWitch.deathSpawn.radius, 0.8, 31.2),
          false, 1 + bats.deployDelay,
        );
      }
    }
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
      .map((id, slot) => ({
        id,
        slot,
        cost: this.cardCost("red", id),
        c: CARD_MAP[this.cardForPlay("red", id) ?? id],
      }))
      .filter((v) => v.cost !== null && v.cost <= p.elixir);
    if (!affordable.length) return;
    const threats = this.entities
      .filter((e) => e.team === "blue" && e.kind === "troop" && e.y < 15)
      .sort((a, b) => a.y - b.y);
    const threat = threats[0];
    if (!threat && p.elixir < 6 && this.mode !== "training") return;
    const scored = affordable
      .map((a) => {
        let score = this.random() * 2;
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
          if (a.c.kind !== "troop" && a.id !== "mortar") score -= 7;
          if (a.c.buildingsOnly) score += 2;
        }
        return { ...a, score };
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
        threat ??
        this.entities.find(
          (e) => e.team === "blue" && e.kind === "tower" && !e.king,
        );
      if (!target) return;
      x = target.x;
      y = target.y;
    }
    if (a.c.kind === "building") {
      x = a.id === "mortar" ? lane : 9;
      y = a.id === "mortar" ? 14 : 10;
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
