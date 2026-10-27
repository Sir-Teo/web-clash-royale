import { attackReach, minimumAttackDistance, NATIVE_RANGE_RADIUS_FACTOR } from "./attack-range";
import { areaRandom, areaRandomSeed } from "./area-random";
import { acquisitionSight, nativeSightRange } from "./sight-range";
import { electroExtraTarget } from "./electro-bolts";
import { advanceSummonClock, summonProfile, type SummonProfile } from "./summon-clock";
import { balloonBombProfile } from "./balloon-bomb";
import { chargeRange, chargedAttackDamage, resetMovement } from "./charge";
import { advanceMovement } from "./movement";
import { isPlayableCard } from "./playable-cards";
import { LOCAL_REPLAY_CARDS } from "./replay-family";
import { Battle as LegacyLocalBattle, type EngineOptions as LegacyLocalOptions } from "./legacy-local-engine";
import { CARD_MAP, LEGACY_BALLOON_STATS, LEGACY_BUILDING_STATS, LEGACY_CARD_SPLASH, LEGACY_CARD_STATS, LEGACY_CARD_VITALS, STARTER_DECK } from "./cards";
import type { CardId } from "./cards";
import { clonePosition, deploymentPositions, deploymentTime, deploymentVisualDelay, goblinGangCharacter } from "./deployment";
import { advanceAnimationClock } from "./animation-clock";
import { areaSpellTarget, isAreaSpell } from "./area-spell-targeting";
import { damageSpellTarget, isDamageSpell, type SpellTarget } from "./spell-targeting";
import { defensiveThreats } from "./defensive-threats";
import { buildingLureTarget } from "./building-lure";
import { meleeInterceptTarget } from "./melee-intercept";
import { finishesKingBefore } from "./king-spell-race";
import { createKingDefense } from "./king-defense";
import { attackFlight } from "./attack-flight";
import { launchedKingDeadline } from "./king-damage";
import { createMatchFinisher, MATCH_DAMAGE_HORIZON } from "./match-finisher";
import { selectLightningTarget } from "./lightning-strikes";
import { hasFriendlyLightning } from "./lightning-followup";
import { tornadoPull } from "./tornado-pull";
import {
  combatTraits,
  cardShieldHitpoints,
  COMBAT_STEP,
  directSpellFlight,
  FIREBALL_KNOCKBACK,
  ARROWS_WAVES,
  ARROWS_WAVE_GAP,
  KING_ACTIVATION_TIME,
  HEAL_PER_TICK,
} from "./combat";
import { TOWER_SITES } from "./arena-layout";
import { audioProfile } from "./combat-audio-events";
import flyingHeights from "./flight-heights.json" with { type: "json" };
import collisionRadii from "./archived-collision-radii.json" with { type: "json" };
import freeze from "./freeze-data.json" with { type: "json" };
import poison from "./poison-data.json" with { type: "json" };
import heal from "./heal-data.json" with { type: "json" };
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
import { advanceInfernoClock, infernoAttackRate, infernoDamage, infernoProfile } from "./inferno";
import { attackClockRate } from "./attack-clock";
import { barrelTargetScoreBias, comparePrimaryScores, primaryTargetScore } from "./primary-score";
import electroWizard from "./electro-wizard-data.json" with { type: "json" };
import miner from "./miner-data.json" with { type: "json" };
import bowler from "./bowler-data.json" with { type: "json" };
import darkPrince from "./dark-prince-data.json" with { type: "json" };
import battleRam from "./battle-ram-data.json" with { type: "json" };
import executioner from "./executioner-data.json" with { type: "json" };
import sparky from "./sparky-data.json" with { type: "json" };
import lumberjack from "./lumberjack-data.json" with { type: "json" };
import iceSpirit from "./ice-spirit-data.json" with { type: "json" };
import iceGolem from "./ice-golem-data.json" with { type: "json" };
import giantSkeleton from "./giant-skeleton-data.json" with { type: "json" };
import mortar from "./mortar-data.json" with { type: "json" };
import bombTower from "./bomb-tower-data.json" with { type: "json" };
import xBow from "./x-bow-data.json" with { type: "json" };
import elixirCollector from "./elixir-collector-data.json" with { type: "json" };
import goblinHut from "./goblin-hut-data.json" with { type: "json" };
import tombstone from "./tombstone-data.json" with { type: "json" };
import furnace from "./furnace-data.json" with { type: "json" };
import barbarianHut from "./barbarian-hut-data.json" with { type: "json" };
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
export const STEP = COMBAT_STEP;
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
  /** Rules 24: native own-radius contribution to maximum attack reach. */
  rangeRadiusFactor?: number;
  /** Rules 25: resolved source sight, including own collision radius. */
  sightRange?: number;
  /** Rules 26: source inner range, resolved against each target's body size. */
  minimumRange?: number;
  /** Rules 27: native extra-bolt scan and AllTargetsHit fallback. */
  nativeExtraTargets?: true;
  /** Rules 28: shared native integer attack-clock deltas. */
  nativeAttackClock?: true;
  /** Rules 29: nearby candidate ordering by adjusted squared center distance. */
  nativePrimaryScore?: true;
  /** Native source units squared; assigned to actual Barrel children. */
  targetScoreBias?: number;
  air: boolean;
  damage: number;
  range: number;
  cooldown: number;
  interval: number;
  speed: number;
  target: number | null;
  age: number;
  deploy: number;
  /** Optional native group filter offset; presentation only. */
  deployVisualDelay?: number;
  stun: number;
  clone?: boolean;
  poison?: { remaining: number; elapsed: number };
  heal?: { remaining: number; elapsed: number };
  rage?: { remaining: number };
  /** Optional deterministic loop clock after a movement buff or stun; presentation only. */
  animationTime?: number;
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
  /** Rules 17: own movement in tiles, excluding forced displacement. */
  chargeDistance?: number;
  king?: boolean;
  active: boolean;
  activation?: number;
  lane?: "left" | "right";
  lifetime?: number;
  spawnTimer: number;
  /** Rules 21: next child within a serial summon wave. */
  spawnIndex?: number;
  spawnBurst?: number;
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
    | "heal"
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
  /** Rules 24: Graveyard spawns retain their own deterministic random stream. */
  spawnRandomState?: number;
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
  rulesFamily?: "local" | "origin";
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29;
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
  readonly rulesFamily: "local" | "origin" = "origin";
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
  private readonly replayDuration?: number;
  private replayIndex = 0;
  constructor(options: EngineOptions = {}) {
    const family = options.replay?.rulesFamily;
    if (family !== undefined && family !== "local" && family !== "origin")
      throw new Error("Unknown replay rules family.");
    if (family === "local") {
      const replay = options.replay!;
      if (!Number.isInteger(replay.version) || replay.version < 1 || replay.version > 5)
        throw new Error("Local replay rules support versions 1 through 5.");
      if ([...replay.deck, ...replay.enemyDeck, ...replay.actions.map((action) => action.card)]
        .some((card) => !LOCAL_REPLAY_CARDS.has(card)))
        throw new Error("Local replay contains a card outside its historical roster.");
    }
    const r = options.replay;
    if (r?.actions.some((action) => !isPlayableCard(action.card)))
      throw new Error("Replay contains an unplayable card.");
    this.rulesVersion = r?.version ?? 29;
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
    this.replayDuration = r?.duration;
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
    // Constructors may return a compatible legacy instance. Initialize the
    // modern branch first so all shared fields retain definite initialization.
    if (r?.rulesFamily === "local")
      return new LegacyLocalBattle(options as unknown as LegacyLocalOptions) as unknown as Battle;
    if (this.replayDuration === 0) this.applyReplayActions();
  }
  private validateDeck(deck: CardId[]) {
    if (
      deck.length !== 8 ||
      new Set(deck).size !== 8 ||
      deck.some((id) => !isPlayableCard(id))
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
    // The archived King and Princess have 2,400 and 1,400 base HP.
    // Princess HP already uses the roster's 2.18 tower scale (3,052 / 1,400).
    const kingHp = this.rulesVersion >= 11 ? Math.round(2400 * 3052 / 1400) : 4824;
    const radius = this.rulesVersion >= 15
      ? collisionRadii.towers[king ? "king" : "princess"]
      : king ? 1.25 : 1.05;
    this.entities.push({
      id: this.nextId++,
      team,
      x,
      y,
      card: "tower",
      kind: "tower",
      hp: king ? kingHp : 3052,
      maxHp: king ? kingHp : 3052,
      radius,
      ...(this.rulesVersion >= 24 ? { rangeRadiusFactor: NATIVE_RANGE_RADIUS_FACTOR } : {}),
      ...(this.rulesVersion >= 25 ? { sightRange: nativeSightRange({ card: "tower", king, radius }) } : {}),
      ...(this.rulesVersion >= 28 ? { nativeAttackClock: true as const } : {}),
      ...(this.rulesVersion >= 29 ? { nativePrimaryScore: true as const } : {}),
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
    if (!isPlayableCard(id))
      return { ok: false, reason: "Unknown card." };
    const c = CARD_MAP[id];
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
      ? (resolved === "bomber" && this.rulesVersion < 6
          ? 2
          : CARD_MAP[resolved].cost) + (id === "mirror" ? mirror.surcharge : 0)
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
        id === "heal" ||
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
              : id === "heal"
                ? heal
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
                ? {
                    hitAt: graveyard.spawnInitialDelay,
                    ...(this.rulesVersion >= 24
                      ? { spawnRandomState: areaRandomSeed(this.seed, this.nextId - 1) }
                      : {}),
                  }
                : {}),
        });
        if (id === "poison" || id === "heal" || id === "rage")
          this.emitAudio("impact", team, id);
        return { ok: true, reason: "" };
      }
      const {
        origin,
        speed,
        duration: flightDuration,
      } = directSpellFlight(id, team, { x, y });
      const modern = this.rulesVersion >= 2;
      const duration =
        id === "zap"
          ? 0.15
          : modern
            ? flightDuration
            : id === "arrows"
              ? 0.65
              : 0.9;
      // The archived custom first arrow deals the spell's full damage; its
      // fourteen companions are visual only. Older replays keep three hits.
      const waves = modern && id === "arrows" && this.rulesVersion < 16
        ? ARROWS_WAVES : 1;
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
          splash: id === "arrows" && this.rulesVersion < 6 ? 3.6 : c.radius!,
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
                delay: id === "arrows" && this.rulesVersion >= 16
                  ? undefined : wave * ARROWS_WAVE_GAP,
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
                  : this.rulesVersion >= 12 &&
                    (id === "fireball" || id === "arrows" || id === "zap")
                    ? { towerDamageFraction: 0.4 }
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
      const positions = deploymentPositions(
        id,
        { x, y },
        team,
        this.rulesVersion < 6
          ? id === "goblins" ? 4 : id === "skeletons" ? 3 : undefined
          : undefined,
        this.rulesVersion,
      );
      for (const [index, point] of positions.entries())
        this.spawn(
          id === "goblin-gang"
            ? goblinGangCharacter(index, this.rulesVersion)
            : unitId,
          team,
          point.x,
          point.y,
          true,
          deploymentTime(id, this.rulesVersion),
          this.rulesVersion >= 18 ? deploymentVisualDelay(id, index, positions.length, this.rulesVersion) : 0,
        );
    }
    return { ok: true, reason: "" };
  }
  private spawn(id: CardId, team: Team, x: number, y: number, audio = true, deploy = 1, visualDelay = 0) {
    const c = CARD_MAP[id];
    const stats = this.rulesVersion < 7 ? LEGACY_CARD_STATS[id] ?? c : c;
    const legacyBuilding = this.rulesVersion < 8 ? LEGACY_BUILDING_STATS[id] : undefined;
    const legacyVitals = this.rulesVersion < 9 ? LEGACY_CARD_VITALS[id] : undefined;
    const legacyBalloon = this.rulesVersion < 10 && id === "balloon"
      ? LEGACY_BALLOON_STATS : undefined;
    const hp = legacyVitals?.hp ?? c.hp;
    const initialSummon = this.rulesVersion >= 21 ? summonProfile(id) : undefined;
    const shield = cardShieldHitpoints(id);
    const legacyRadius = c.kind === "building" ? 0.8 :
      hp > 3000 ? 0.55 : c.count > 2 ? 0.25 : 0.37;
    const radius = this.rulesVersion >= 15
      ? (collisionRadii.cards as Record<string, number>)[id]
      : legacyRadius;
    this.entities.push({
      id: this.nextId++,
      team,
      x,
      y,
      card: id,
      kind: c.kind === "building" ? "building" : "troop",
      hp,
      maxHp: hp,
      ...(shield ? { shield, maxShield: shield } : {}),
      radius,
      ...(this.rulesVersion >= 24 ? { rangeRadiusFactor: NATIVE_RANGE_RADIUS_FACTOR } : {}),
      ...(this.rulesVersion >= 25 ? { sightRange: nativeSightRange({ card: id, radius }) } : {}),
      ...(this.rulesVersion >= 26 && id === "mortar" ? { minimumRange: mortar.minimumRange } : {}),
      ...(this.rulesVersion >= 27 && id === "electro-wizard" ? { nativeExtraTargets: true as const } : {}),
      ...(this.rulesVersion >= 28 ? { nativeAttackClock: true as const } : {}),
      ...(this.rulesVersion >= 29 ? { nativePrimaryScore: true as const } : {}),
      air: !!c.air,
      damage: legacyBalloon?.damage ?? legacyVitals?.damage ?? c.damage,
      range: legacyBalloon?.range ?? stats.range,
      cooldown: id === "sparky" ? sparky.sourceLoadTime + deploy : 0.4,
      interval: legacyBalloon?.interval ?? legacyBuilding?.interval ?? stats.interval,
      speed: id === "balloon" && this.rulesVersion < 13
        ? LEGACY_CARD_STATS.balloon!.speed : stats.speed,
      target: null,
      age: 0,
      deploy,
      ...(visualDelay > 0 ? { deployVisualDelay: visualDelay } : {}),
      stun: 0,
      attack: 0,
      ...(id === "sparky" ? { sparkyCharge: 0 } : {}),
      move: 0,
      ...(this.rulesVersion >= 17 && Number.isFinite(chargeRange(id))
        ? { chargeDistance: 0 } : {}),
      active: true,
      lifetime: legacyBuilding?.lifetime ?? c.lifetime,
      ...(initialSummon ? { spawnIndex: 0 } : {}),
      spawnTimer: initialSummon?.start ?? (id === "night-witch" ? nightWitch.spawn.pause :
        id === "elixir-collector" ? elixirCollector.generateInterval :
        id === "goblin-hut" ? goblinHut.spawnPause :
        id === "tombstone" ? tombstone.spawnPause :
        id === "furnace" ? furnace.spawnPause :
        id === "barbarian-hut" ? barbarianHut.spawnPause : 4),
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
  private applyReplayActions() {
    if (this.winner || !this.replayActions) return;
    while (
      this.replayIndex < this.replayActions.length &&
      this.replayActions[this.replayIndex].tick === this.tick
    ) {
      const action = this.replayActions[this.replayIndex++];
      this.play(
        action.team,
        this.players[action.team].hand.indexOf(action.card),
        action.x,
        action.y,
      );
    }
  }
  step() {
    if (this.winner) return;
    this.applyReplayActions();
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
    // Consume actions accepted between steps at the final recorded tick.
    if (this.tick === this.replayDuration) this.applyReplayActions();
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
          const { x, y } = clonePosition(entity, area, area.team);
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
            ...(entity.chargeDistance !== undefined ? { chargeDistance: 0 } : {}),
            pendingAttack: undefined,
            clone: true,
          });
          // A new copy has no projectile-spawn ordinal of its own.
          if (this.rulesVersion >= 29) delete this.entities.at(-1)!.targetScoreBias;
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
          const random = () =>
            this.rulesVersion >= 24
              ? areaRandom(area, areaRandomSeed(this.seed, area.id))
              : this.random();
          const angle = random() * Math.PI * 2;
          const radius = Math.sqrt(random()) * area.radius;
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
          const target = selectLightningTarget(
            area.team,
            area,
            area.radius,
            this.entities,
            struck,
          );
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
            const position = tornadoPull(entity, area);
            if (position) {
              entity.x = position.x;
              entity.y = position.y;
              entity.move = 0;
            }
          }
          if (damage) this.hurt(entity, CARD_MAP.tornado.damage);
        }
        area.remaining = Math.max(0, area.remaining - STEP);
        if (area.remaining < 1e-8) area.remaining = 0;
        continue;
      }
      const periodic = area.card === "poison" || area.card === "heal" || area.card === "rage";
      const areaHit = periodic && age + 1e-8 >= (area.hitAt ?? 0);
      if (areaHit)
        area.hitAt =
          (area.hitAt ?? 0) +
          (area.card === "poison"
            ? poison.areaHitInterval
            : area.card === "heal"
              ? heal.areaHitInterval
            : rage.areaHitInterval);
      for (const entity of this.entities) {
        if (
          entity.hp <= 0 ||
          (area.card === "rage" || area.card === "heal"
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
        if (area.card === "heal") {
          entity.heal ??= { remaining: 0, elapsed: 0 };
          entity.heal.remaining = heal.buffDuration;
        }
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
      if (entity.heal) {
        const status = entity.heal;
        status.remaining = Math.max(0, status.remaining - STEP);
        status.elapsed += STEP;
        if (entity.hp > 0 && status.elapsed + 1e-8 >= heal.healInterval) {
          status.elapsed -= heal.healInterval;
          // The archived buff is 100 HP/s at its base Rare level. Match the
          // roster's level-11 Rare conversion used for other source values.
          entity.hp = Math.min(entity.maxHp, entity.hp + HEAL_PER_TICK);
        }
        if (status.remaining < 1e-8 || entity.hp <= 0)
          entity.heal = undefined;
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
  private attackSplash(card: CardId | "tower") {
    if (card === "tower") return 0;
    const current = CARD_MAP[card].splash ?? 0;
    return this.rulesVersion < 14 ? LEGACY_CARD_SPLASH[card] ?? current : current;
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
              true, deploymentTime("bats", this.rulesVersion),
            );
          }
        }
      }
      const card = e.card === "tower" ? null : CARD_MAP[e.card];
      const splash = this.attackSplash(e.card);
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
          resetMovement(e);
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
              splash,
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
          } else if (splash) {
            for (const v of this.entities)
              if (canAttack(v) && dist(v, e) <= splash + v.radius)
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
      (e.card !== "mortar" || dist(e, target) >= minimumAttackDistance(e, target, mortar.minimumRange))
    );
  }
  private inRange(e: Entity, target: Entity) {
    return dist(e, target) <= attackReach(e, target);
  }
  private acquireTarget(e: Entity) {
    const current = this.entities.find(
      (t) => t.id === e.target && this.validTarget(e, t),
    );
    // Keep an engaged target. A distant tower is only a movement destination;
    // nearby defenders or a newly deployed building can intercept that path.
    const sight = acquisitionSight(e);
    if (
      current &&
      (this.inRange(e, current) ||
        (current.kind === "troop" &&
          dist(e, current) <= sight + current.radius))
    )
      return current;
    let nearby: Entity | undefined;
    let nearbyDistance = Infinity;
    let structure: Entity | undefined;
    let structureDistance = Infinity;
    for (const candidate of this.entities) {
      if (!this.validTarget(e, candidate)) continue;
      const distance = dist(e, candidate);
      const edgeDistance = distance - candidate.radius;
      const nearbyScore = e.nativePrimaryScore ? primaryTargetScore(e, candidate) : edgeDistance;
      // Strictly smaller keeps the first entity on ties, matching stable sort.
      if (distance <= sight + candidate.radius && comparePrimaryScores(e, nearbyScore, nearbyDistance) < 0) {
        nearby = candidate;
        nearbyDistance = nearbyScore;
      }
      if (e.kind === "troop" && candidate.kind !== "troop" && edgeDistance < structureDistance) {
        structure = candidate;
        structureDistance = edgeDistance;
      }
    }
    const target = nearby ?? structure;
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
      if (this.rulesVersion >= 19) advanceAnimationClock(e, this.time);
      const hitSpeed =
        this.rulesVersion >= 23 && (e.card === "inferno-tower" || e.card === "inferno-dragon")
          ? infernoAttackRate(!!e.rage, !!e.slow)
          : attackClockRate(e, !!e.rage, !!e.slow);
      e.age += STEP;
      e.attack = Math.max(0, e.attack - STEP * hitSpeed);
      e.cooldown = Math.max(0, e.cooldown - STEP * hitSpeed);
      if (e.card === "bandit")
        e.dashCooldown = Math.max(0, (e.dashCooldown ?? 0) - STEP);
      e.stun = Math.max(0, e.stun - STEP);
      const summoner = this.rulesVersion >= 21 ? summonProfile(e.card) : undefined;
      if (e.deploy > 0) {
        e.deploy -= STEP;
        if (e.card === "electro-wizard" && e.deploy <= 1e-8) {
          e.deploy = 0;
          this.electroDeployZap(e);
        }
        // The native summoner guard can continue on deployment's expiry frame.
        if (summoner && e.deploy <= 1e-8) e.deploy = 0;
        else continue;
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
        resetMovement(e);
        continue;
      }
      if (!e.active) {
        this.cancelAttack(e);
        continue;
      }
      if (summoner) {
        const spawn = advanceSummonClock(e, summoner, STEP *
          (e.rage ? rage.spawnSpeedMultiplier : 1) *
          (e.slow ? iceWizard.spawnSpeedMultiplier : 1));
        if (spawn) this.emitSummon(e, summoner, spawn);
        if (e.kind === "building") continue;
      }
      if (e.card === "elixir-collector") {
        e.spawnTimer -= STEP;
        if (e.spawnTimer <= 1e-8) {
          e.spawnTimer += elixirCollector.generateInterval;
          e.attack = (elixirCollector.frames - elixirCollector.actionFrame - 1) /
            elixirCollector.fps;
          this.players[e.team].elixir = Math.min(10,
            this.players[e.team].elixir + elixirCollector.collectAmount);
          this.emitAudio("collect", e.team, "elixir-collector", e.id,
            undefined, { x: e.x, y: e.y });
        }
        continue;
      }
      if (e.card === "goblin-hut") {
        e.spawnTimer -= STEP * hitSpeed;
        if (e.spawnTimer <= 1e-8) {
          e.spawnTimer += goblinHut.spawnPause;
          this.spawn("spear-goblins", e.team, e.x,
            e.y + (e.team === "blue" ? -1 : 1) * goblinHut.spawnRadius,
            true, 1);
        }
        continue;
      }
      if (e.card === "tombstone") {
        e.spawnTimer -= STEP * hitSpeed;
        if (e.spawnTimer <= 1e-8) {
          e.spawnTimer += tombstone.spawnPause;
          this.spawn("skeletons", e.team, e.x,
            e.y + (e.team === "blue" ? -1 : 1) * tombstone.spawnRadius,
            true, 1);
        }
        continue;
      }
      if (e.card === "furnace" || e.card === "barbarian-hut") {
        const fire = e.card === "furnace";
        const rules = fire ? furnace : barbarianHut;
        const unit: CardId = fire ? "fire-spirits" : "barbarians";
        const deploy = (fire ? furnace.spiritDeployTime : barbarianHut.unitDeployTime) +
          (this.rulesVersion < 18
            ? fire ? furnace.spiritDeployDelay : barbarianHut.unitDeployDelay
            : 0);
        if (e.spawnBurst !== undefined) {
          e.spawnBurst -= STEP * hitSpeed;
          if (e.spawnBurst <= 1e-8) {
            e.spawnBurst = undefined;
            this.spawn(unit, e.team, e.x + 0.22,
              e.y + (e.team === "blue" ? -1 : 1) * rules.spawnRadius,
              true, deploy);
          }
        }
        e.spawnTimer -= STEP * hitSpeed;
        if (e.spawnTimer <= 1e-8) {
          e.spawnTimer += rules.spawnPause + rules.spawnInterval;
          e.spawnBurst = rules.spawnInterval;
          this.spawn(unit, e.team, e.x - 0.22,
            e.y + (e.team === "blue" ? -1 : 1) * rules.spawnRadius,
            true, deploy);
        }
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
      if (!summoner && e.card === "witch") {
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
      if (!summoner && e.card === "night-witch") {
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
              true, deploymentTime("bats", this.rulesVersion),
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
        resetMovement(e);
        continue;
      }
      if (e.card === "bandit" && (e.dashCooldown ?? 0) <= 1e-8 &&
          !e.pendingAttack && e.cooldown <= 1e-8) {
        const distance = dist(e, target) - target.radius;
        if (distance >= bandit.dash.minimum && distance <= bandit.dash.maximum) {
          e.dash = { target: target.id, elapsed: 0,
            remaining: bandit.dash.maximum / bandit.dash.speed + STEP };
          resetMovement(e);
          this.emitAudio("dash-start", e.team, "bandit", e.id);
          this.emitAudio("dash-travel", e.team, "bandit", e.id);
          this.emit("spell", e.team, e.x, e.y, "bandit", e.id,
            { effect: "dash-start:bandit" });
          continue;
        }
      }
      if (this.inRange(e, target)) {
        if (e.cooldown <= 1e-8) {
          const damage = chargedAttackDamage(e);
          resetMovement(e);
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
      resetMovement(e);
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
  /** Preserve existing child placement/art; only the source clock changes. */
  private emitSummon(e: Entity, profile: SummonProfile,
    wave: { index: number; count: number; startsWave: boolean }) {
    if (wave.startsWave && e.card === "witch")
      this.emitAudio("summon", e.team, audioProfile(e), e.id);
    if (wave.startsWave && e.card === "night-witch") {
      this.emitAudio("summon", e.team, "night-witch", e.id,
        undefined, { x: e.x, y: e.y });
      this.emit("spell", e.team, e.x, e.y, "night-witch", 0,
        { effect: "summon:night-witch" });
    }
    for (let i = 0; i < wave.count; i++) {
      const index = wave.index + i;
      let x = e.x, y = e.y;
      let deploy = 1;
      const direction = e.team === "blue" ? -1 : 1;
      if (e.card === "witch") {
        x = clamp(e.x + (index - 1) * 0.6, 0.6, 17.4);
        y = clamp(e.y + direction * 0.8, 0.8, 31.2);
      } else if (e.card === "night-witch") {
        x = clamp(e.x + (index - (profile.count - 1) / 2) * nightWitch.spawn.radius * 1.2, 0.6, 17.4);
        y = clamp(e.y + direction * 0.5, 0.8, 31.2);
        deploy = deploymentTime("bats", this.rulesVersion);
      } else {
        const rules = e.card === "goblin-hut" ? goblinHut : e.card === "tombstone" ? tombstone : e.card === "furnace" ? furnace : barbarianHut;
        y = e.y + direction * rules.spawnRadius;
        if (e.card === "furnace" || e.card === "barbarian-hut")
          x += index === 0 ? -0.22 : 0.22;
        if (e.card === "furnace") deploy = furnace.spiritDeployTime;
        if (e.card === "barbarian-hut") deploy = barbarianHut.unitDeployTime;
      }
      this.spawn(profile.child as CardId, e.team, x, y, true, deploy);
    }
  }
  private updateInferno(e: Entity, hitSpeed: number) {
    const card = e.card === "inferno-tower" ? "inferno-tower" : "inferno-dragon";
    const target = this.acquireTarget(e);
    if (!target || !this.inRange(e, target)) {
      this.cancelAttack(e);
      if (target) this.moveToward(e, target);
      else resetMovement(e);
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
    resetMovement(e);
    if (this.rulesVersion >= 23) {
      advanceInfernoClock(card, lock, STEP, !!e.rage, !!e.slow);
    } else {
      const source = infernoProfile(card);
      lock.elapsed += STEP;
      lock.stage = lock.elapsed >= source.stageDurations[0] + source.stageDurations[1]
        ? 2 : lock.elapsed >= source.stageDurations[0] ? 1 : 0;
      lock.hitTimer -= STEP * hitSpeed;
    }
    if (lock.hitTimer > 1e-8) return;
    lock.hitTimer += e.interval;
    e.attack = e.interval;
    const damage = infernoDamage(card, lock.stage);
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
      const { start, duration } = attackFlight(e, target)!;
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
      // The retained minimum and maximum travel values bound the endpoint;
      // the exact historical extension beyond the selected target is absent.
      const { start, end: turn, duration } = attackFlight(e, target)!;
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
      const {
        start: { x, y },
        end: { x: tx, y: ty },
        duration,
      } = attackFlight(e, target)!;
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
      if (e.nativeExtraTargets) {
        const strike = (victim: Entity) => {
          if (victim.hp <= 0) return;
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
        };
        strike(target);
        // Primary damage/death spawns precede the native additional-hit scan.
        const extra = electroExtraTarget(e, target, this.entities);
        if (extra && e.hp > 0 && !this.winner) strike(extra);
        return;
      }
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
    const splash = this.attackSplash(e.card);
    const traits = combatTraits(e);
    const p = traits.projectile;
    if (p || e.card === "balloon" || e.card === "tesla") {
      const {
        start: { x: launchX, y: launchY },
        speed,
        duration,
      } = attackFlight(e, target)!;
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
        splash,
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
    } else if (splash) {
      for (const v of this.entities)
        if (this.validTarget(e, v) && dist(v, e) <= splash + v.radius)
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
            if (this.rulesVersion >= 29)
              this.entities.at(-1)!.targetScoreBias = barrelTargetScoreBias(i);
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
            resetMovement(e);
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
    resetMovement(e);
  }
  private moveToward(e: Entity, target: Entity) {
    advanceMovement(e, target);
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
        const min = (a.radius + b.radius) * 0.86;
        // A full distance cannot overlap when either axis is already outside.
        // Keep the existing pair order and exact distance for possible overlaps.
        if (Math.abs(a.x - b.x) >= min || Math.abs(a.y - b.y) >= min) continue;
        const d = dist(a, b);
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
        const min = unit.radius + building.radius;
        if (Math.abs(unit.x - building.x) >= min || Math.abs(unit.y - building.y) >= min) continue;
        const d = dist(unit, building);
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
    if (e.card === "tombstone")
      for (let i = 0; i < tombstone.deathSpawnCount; i++) {
        const angle = (i * Math.PI * 2) / tombstone.deathSpawnCount;
        this.spawn("skeletons", e.team,
          clamp(e.x + Math.cos(angle) * tombstone.spawnRadius, 0.6, 17.4),
          clamp(e.y + Math.sin(angle) * tombstone.spawnRadius, 0.8, 31.2),
          true, 1);
      }
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
          false, deploymentTime("bats", this.rulesVersion),
        );
      }
    }
    if (e.card === "balloon") {
      const bomb = balloonBombProfile(this.rulesVersion);
      this.projectiles.push({
        id: this.nextId++,
        team: e.team,
        x: e.x,
        y: e.y,
        tx: e.x,
        ty: e.y,
        target: null,
        damage: bomb.damage,
        remaining: bomb.delay,
        duration: bomb.delay,
        splash: bomb.radius,
        air: bomb.air,
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
        id, slot,
        played: this.cardForPlay("red", id) ?? id,
        cost: this.cardCost("red", id),
        c: CARD_MAP[this.cardForPlay("red", id) ?? id],
      }))
      .filter((v) => v.cost !== null && v.cost <= p.elixir + 1e-6);
    if (!affordable.length) return;
    const kingDeadline = affordable.some(
      (a) => isDamageSpell(a.played) || a.played === "poison",
    )
      ? launchedKingDeadline("red", this.entities, this.projectiles, this.areas)
      : Infinity;
    const finisher =
      (this.time >= 180 ||
        this.remaining <= MATCH_DAMAGE_HORIZON ||
        hasFriendlyLightning("red", this.areas)) &&
      affordable.some(
        (a) => isDamageSpell(a.played) || a.played === "poison" ||
          a.played === "freeze" || a.played === "tornado",
      )
        ? createMatchFinisher(
            "red",
            this.entities,
            this.projectiles,
            this.areas,
            { blue: this.players.blue.crowns, red: this.players.red.crowns },
            this.remaining,
            this.time >= 180,
          )
        : undefined;
    const kingDefense = affordable.some(
      (a) => a.played === "freeze" || a.played === "tornado",
    )
      ? createKingDefense(
          "red", this.entities, this.projectiles, this.areas,
          finisher?.baseline?.step,
          this.rulesVersion,
        )
      : undefined;
    const spellTargets = new Map<CardId, SpellTarget | undefined>(
      affordable
        .filter((a) => a.c.kind === "spell")
        .map((a) => [
          a.id,
          isDamageSpell(a.played)
            ? damageSpellTarget(
                a.played,
                "red",
                this.entities,
                this.projectiles,
                this.areas,
                a.cost ?? a.c.cost,
                kingDeadline,
                finisher,
              )
            : areaSpellTarget(
                a.played,
                "red",
                this.entities,
                this.areas,
                this.projectiles,
                a.cost ?? a.c.cost,
                kingDeadline,
                finisher,
                kingDefense,
              ),
        ]),
    );
    const protection = affordable
      .filter((a) => a.played === "freeze" || a.played === "tornado")
      .map((a) => spellTargets.get(a.id))
      .filter((target): target is SpellTarget => !!target?.protectsKing)
      .sort((a, b) => b.score - a.score)[0];
    if (protection) {
      // A lethal hit can still lose the match when its flight ends too late.
      // Compare the known pending attack only when an affordable defense exists.
      const deadline = protection.kingThreatStep ?? Infinity;
      for (const a of affordable) {
        const target = spellTargets.get(a.id);
        const king =
          target?.lethalTower === undefined
            ? undefined
            : this.entities.find((e) => e.id === target.lethalTower && e.king);
        if (
          target &&
          (target.matchDecisionStep !== undefined
            ? target.matchDecisionStep >= deadline
            : king &&
              !finishesKingBefore(
                a.played,
                "red",
                king,
                target,
                this.projectiles,
                this.areas,
                deadline,
                this.entities,
              ))
        )
          spellTargets.set(a.id, {
            ...target,
            score: Math.min(target.score, protection.score - 1),
          });
      }
    }
    // Preserve the baseline policy for additional archive spells until they
    // have dedicated targeting heuristics. Mirror uses its resolved card.
    const optimizedSpell = (id: CardId) => isDamageSpell(id) || isAreaSpell(id);
    const hasSpellTarget = [...spellTargets.values()].some(Boolean);
    const threats = defensiveThreats("red", this.entities);
    let threat = threats[0];
    let buildingLures = new Map<CardId, Point | undefined>();
    for (const enemy of threats) {
      const lures = new Map(
        affordable
          .filter((a) => a.c.kind === "building")
          .map((a) => [
            a.id,
            buildingLureTarget(
              a.played,
              "red",
              enemy,
              this.entities,
              (point) => this.canPlace("red", a.played, point.x, point.y).ok,
            ),
          ]),
      );
      if (enemy === threat) buildingLures = lures;
      // Preserve useful spell choices and pressure order. Without a spell or
      // an affordable air response, defend the next supported push instead.
      if (
        hasSpellTarget ||
        affordable.some(
          (a) =>
            a.c.kind !== "spell" &&
            !a.c.buildingsOnly &&
            (!enemy.air || a.c.hitsAir),
        ) ||
        [...lures.values()].some(Boolean)
      ) {
        threat = enemy;
        buildingLures = lures;
        break;
      }
    }
    if (!threat && p.elixir < 6 && this.mode !== "training" && !hasSpellTarget)
      return;
    const scored = affordable
      .map((a) => {
        const jitter = this.random() * 2;
        let score = jitter;
        const target = spellTargets.get(a.id);
        if (a.c.kind === "spell") {
          if (optimizedSpell(a.played))
            score = target ? target.score + jitter * 0.1 : -Infinity;
          else if (threat) {
            const nearby = threats.filter((e) => dist(e, threat) < (a.c.radius ?? 2.5));
            score += nearby.length > 2 ? 6 : -5;
            if (threat.hp < a.c.damage) score += 2;
          } else score -= 7;
        }
        else if (buildingLures.get(a.id))
          // A distraction buys time, but a direct air counter is preferable.
          score = 0.5 + jitter * 0.1;
        else if (threat) {
          score += a.c.buildingsOnly ? -3 : 3;
          if (threat.air && !a.c.hitsAir) score -= 8;
          if (
            a.c.splash &&
            threats.filter(
              (enemy) =>
                (!enemy.air || a.c.hitsAir) &&
                dist(enemy, threat) <= a.c.splash! + enemy.radius,
            ).length >= 3
          )
            score += 3;
          if (a.c.kind === "building") score += 2;
        } else {
          if (a.c.kind !== "troop" && a.played !== "mortar") score -= 7;
          if (a.c.buildingsOnly) score += 2;
        }
        return { ...a, score, target };
      })
      .sort((a, b) => b.score - a.score);
    const a = scored[0];
    if (a.score < 0) return;
    const lane = threat ? threat.x : this.random() < 0.5 ? 4 : 14;
    let x = lane + (this.random() - 0.5) * 1.4,
      y = threat ? clamp(threat.y + 1.3, 4, 13.8) : a.c.buildingsOnly ? 3.5 : 9;
    if (a.c.kind === "spell") {
      const target = a.target ?? (!optimizedSpell(a.played)
        ? threat ?? this.entities.find((e) => e.team === "blue" && e.kind === "tower" && !e.king && e.hp > 0)
        : undefined);
      if (!target) return;
      x = target.x;
      y = target.y;
    }
    if (a.c.kind === "building") {
      const lure = buildingLures.get(a.id);
      x = lure?.x ?? (a.played === "mortar" ? lane : 9);
      y = lure?.y ?? (a.played === "mortar" ? 14 : 10);
    }
    const intercept =
      threat && a.c.kind === "troop"
        ? meleeInterceptTarget(
            a.played,
            "red",
            threat,
            this.entities,
            (point) => this.canPlace("red", a.played, point.x, point.y).ok,
            this.areas,
          )
        : undefined;
    if (intercept) {
      x = intercept.x;
      y = intercept.y;
    }
    if (a.c.kind !== "spell" && !intercept) {
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
        .find((point) => this.canPlace("red", a.played, point.x, point.y).ok);
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
      rulesFamily: "origin",
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
