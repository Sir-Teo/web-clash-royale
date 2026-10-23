import { NativeConnectionWarning } from "./ui/connection";
import "@fontsource/lilita-one/latin-400.css";
import "@fontsource/nunito-sans/latin-400.css";
import "@fontsource/nunito-sans/latin-600.css";
import "@fontsource/nunito-sans/latin-700.css";
import "@fontsource/nunito-sans/latin-800.css";
import "./style.css";
import "./ui/announcements.css";
import { NativeAnnouncements, battleClock } from "./ui/announcements";
import "./ui/rooms.css";
import "./ui/ending.css";
import { NativeEnding } from "./ui/ending";
import { NativeEmotes } from "./ui/emotes";
import { isEmote } from "./game/emotes";
import { endResult } from "./ui/ending-data";
import {
  network,
  peerNetwork,
  legacyNetwork,
  startupRoomRequested,
  flushStartupRoom,
} from "./network/session";
import { signalLink } from "./network/peer-signaling";
import { PROTOCOL } from "./network/protocol";
import { applySnapshot, snapshot } from "./network/perspective";
import { NativeIntro, INTRO_ACTION_TIME } from "./ui/intro";
import { NativeElixir, elixirMarkup } from "./ui/elixir";
import { NativeBattleHud } from "./ui/hud";
import "./ui/elixir.css";
import { NativeCards, nativeCardArt } from "./ui/cards";
import "./ui/cards.css";
import {
  createIcons,
  Crown,
  Swords,
  Layers2,
  History,
  Coins,
  Volume2,
  VolumeX,
  Shield,
  Pencil,
  Trophy,
  LockKeyhole,
  HardDriveDownload,
  ChevronDown,
  Settings2,
  ChevronRight,
  ShieldCheck,
  Smile,
  Pause,
  Play,
  ArrowUpRight,
  ScrollText,
  Droplet,
  Timer,
  ArrowRight,
  ExternalLink,
  X,
  PackageOpen,
  Plus,
  Check,
  RotateCcw,
  Target,
  CircleCheck,
  Heart,
  Scan,
  Crosshair,
  Users,
  Search,
  Equal,
  Music2,
  Maximize,
  Expand,
  MonitorX,
} from "lucide";
const icons = {
  Crown,
  Swords,
  Layers2,
  History,
  Coins,
  Volume2,
  VolumeX,
  Shield,
  Pencil,
  Trophy,
  LockKeyhole,
  HardDriveDownload,
  ChevronDown,
  Settings2,
  ChevronRight,
  ShieldCheck,
  Smile,
  Pause,
  Play,
  ArrowUpRight,
  ScrollText,
  Droplet,
  Timer,
  ArrowRight,
  ExternalLink,
  X,
  PackageOpen,
  Plus,
  Check,
  RotateCcw,
  Target,
  CircleCheck,
  Heart,
  Scan,
  Crosshair,
  Users,
  Search,
  Equal,
  Music2,
  Maximize,
  Expand,
  MonitorX,
};
import { Arena } from "./render/arena";
import { Battle, STEP } from "./game/engine";
import type { Mode, Point, Replay } from "./game/engine";
import { CARDS, CARD_MAP, PRESETS, averageCost, cardArt } from "./game/cards";
import type { CardId } from "./game/cards";
import {
  loadProfile,
  saveProfile,
  recordBattle,
  openChest,
  storageAvailable,
} from "./game/profile";
import type { RecordEntry } from "./game/profile";
import { GameAudio } from "./game/audio";
import { NativeDeathAudio } from "./game/death-audio";
import { NativeCombatAudio } from "./game/combat-audio";

const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
const icon = (name: string, cls = "") =>
  `<i data-lucide="${name}" class="${cls}"></i>`;
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const fmt = (n: number) => n.toLocaleString();
const clock = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)}:${Math.floor(
    Math.max(0, seconds) % 60,
  )
    .toString()
    .padStart(2, "0")}`;
const profile = loadProfile(),
  audio = new GameAudio();
const deathAudio = new NativeDeathAudio(audio);
const combatAudio = new NativeCombatAudio(audio);
audio.enabled = profile.sound;
audio.musicEnabled = profile.music;
let initialized = false;
let multiplayer = false;
let networkReplay: Replay | undefined;
let replaySource: Battle | null = null;
let endingBattle: Battle | null = null;
let endingFrameTime = 0;
let roomError = "";
let connectionStatus = "";
let lanOrigin = "";
let networkBattleCode = "";
let opponentName = "Royal Trainer";
let arena: Arena;
let battle: Battle;
let screen: "lobby" | "battle" | "replay" = "lobby";
let mode: Mode = "classic";
let selected = -1;
let paused = false;
let soundPaused = false;
let modalPausedBattle = false;
let speed = 1;
let accumulator = 0;
let frameTime = performance.now();
let frameHandle: number | undefined;
let lastRenderTime = frameTime;
let lastFpsTime = frameTime;
let fpsFrames = 0;
let animationTime = 0;
let eventCursor = 0;
let resultShown = false;
let pendingResult: { battle: Battle; time: number; show: () => void } | null =
  null;
let replayData: Replay | null = null;
let replayRecord: RecordEntry | null = null;
let lastUi = 0;
let hover: Point | null = null;
let modalKey = "";
let editSlot = -1;
let filter = "all";
let search = "";
let dragging = false;
let pointerDown = false;
let activePointerId: number | null = null;
let pointerStart = { x: 0, y: 0 };
let activeSlot = -1;
let toastTimer = 0;
let frameCount = 0;
let fps = 60;

const modeNames: Record<Mode, string> = {
  classic: "Classic 1v1",
  training: "Training camp",
  double: "Double elixir",
};
const cardHTML = (id: CardId, attrs = "", extra = "") => {
  const c = CARD_MAP[id];
  return `<button class="game-card ${c.rarity.toLowerCase()} ${extra}" data-native-card="${id}" data-card-variant="${extra.includes("hand-card") ? "hand" : "deck"}" ${attrs} aria-label="${c.name}, ${c.cost} elixir"><span class="cost">${c.cost}</span><img src="${cardArt(id)}" alt="${c.name}" draggable="false"/>${nativeCardArt}<span class="card-level">Level 11</span><span class="card-name">${c.name}</span></button>`;
};

$("#app").innerHTML = `
 <div class="app-shell">
  <header class="topbar">
   <a class="brand" href="#" aria-label="Clash Royale home"><span class="brand-shield">${icon("crown")}</span><span><b>CLASH <em>ROYALE</em></b><small>BROWSER ARENA</small></span></a>
   <nav class="primary-nav" aria-label="Main navigation"><button data-nav="battle" class="active">${icon("swords")}<span>Battle</span></button><button data-nav="cards">${icon("layers-2")}<span>Cards</span><b>${CARDS.length}</b></button><button data-nav="history">${icon("history")}<span>Battle log</span></button></nav>
   <div class="top-actions"><div class="gold-wallet" title="Gold earned from battles and chests"><span class="coin">${icon("coins")}</span><b id="gold">${fmt(profile.gold)}</b><span class="wallet-label">GOLD</span></div><button class="icon-button sound-toggle" aria-label="Toggle sound">${icon(profile.sound ? "volume-2" : "volume-x")}</button><button class="avatar" data-settings aria-label="Player settings">T<span></span></button></div>
  </header>
  <div class="workspace">
   <aside class="left-sidebar">
    <section class="player-card"><div class="player-insignia">${icon("shield")}<span>1</span></div><div><span class="eyebrow">YOUR KINGDOM</span><h2 class="player-name">${esc(profile.name)}</h2><span class="player-status"><i></i> Ready for battle</span></div><button class="small-icon" data-settings aria-label="Edit profile">${icon("pencil")}</button></section>
    <section class="journey panel"><div class="section-heading"><h3>Trophy road</h3>${icon("trophy")}</div><div class="trophy-total">${icon("trophy")}<b id="trophies">${fmt(profile.trophies)}</b><span>TROPHIES</span></div><div class="road-line"><span id="road-progress"></span><b>1</b><b>2</b></div><div class="road-caption"><span>Goblin Stadium</span><b id="road-count">0 / 300</b></div><div class="next-arena"><img src="${import.meta.env.BASE_URL}assets/arenas/arena2.png" alt="Bone Pit arena"/><div><small>NEXT MILESTONE</small><b>Bone Pit</b><span>300 trophies</span></div>${icon("lock-keyhole")}</div></section>
    <section class="feature-card"><div class="feature-glow"></div><span class="eyebrow">A CROWN IS EARNED</span><h3>Small cards.<br>Big plays.</h3><p>Every elixir counts.<br>Make your next move matter.</p><img src="${import.meta.env.BASE_URL}assets/characters/knight.png" alt="Knight raising his sword"/><span class="feature-mark">${icon("swords")}</span></section>
    <div class="local-save">${icon("hard-drive-download")}<div><b>YOUR PROGRESS, SAVED</b><span>Stored on this browser</span></div><i></i></div>
   </aside>
   <main class="arena-panel">
    <div class="arena-heading"><div><span class="eyebrow">ARENA 1</span><h1>Goblin Stadium</h1></div><button class="mode-select">${icon("swords")}<span id="mode-name">Classic 1v1</span>${icon("chevron-down")}</button><button class="icon-button" id="arena-settings" aria-label="Battle settings">${icon("settings-2")}</button></div>
    <div class="arena-stage" id="arena-stage"><div class="arena-vignette"></div><div class="arena-canvas" id="arena-canvas"></div>
     <div class="arena-corner top-left"></div><div class="arena-corner bottom-right"></div>
     <div class="lobby-badge"><span class="live-dot"></span> THE ARENA IS YOURS</div>
     <div class="lobby-bottom"><div class="battle-button-wrap"><span class="battle-flare"></span><button id="battle-button" class="battle-button">${icon("swords")} BATTLE ${icon("chevron-right")}</button></div><button id="friend-button" class="friend-button">${icon("users")} Play with a friend</button><span class="battle-caption">${icon("shield-check")} Level 11 cards <span>·</span> Offline AI opponent</span></div>
     <div class="match-top hidden"><div class="competitor enemy"><span class="mini-shield red">${icon("shield")}</span><div><b>Royal Trainer</b><span>Training guild</span></div></div><div class="match-timer"><span id="phase-label">TIME LEFT</span><b id="match-clock">3:00</b></div></div>
     <div class="match-crowns hidden"><div class="red">${icon("crown")}<b id="red-crowns">0</b></div><span>:</span><div class="blue"><b id="blue-crowns">0</b>${icon("crown")}</div></div>
     <div class="match-bottom hidden"><div class="competitor"><span class="mini-shield blue">${icon("shield")}</span><div><b class="player-name">${esc(profile.name)}</b><span>Browser kingdom</span></div></div><div class="battle-tools"><button id="emote-button" class="small-icon" aria-label="King emotes">${icon("smile")}</button><button id="pause-button" class="small-icon" aria-label="Pause battle">${icon("pause")}</button></div></div>
     <div id="connection-status" class="connection-status hidden" role="status"></div><div id="deploy-hint" class="deploy-hint hidden">Select a card to deploy</div>
     <div class="battle-announcements hidden" id="battle-announcements" role="img" aria-label="Battle announcement"></div>
     <div class="battle-intro hidden" id="battle-intro" role="img" aria-label="Battle introduction"></div>
     <section class="battle-ending hidden" id="battle-ending" aria-label="Battle ended"></section>
     <div class="pause-cover hidden"><span class="eyebrow">TAKE A BREATHER</span><h2>Battle paused</h2><button class="primary-button" id="resume-button">${icon("play")} Resume battle</button><button class="text-button" id="surrender-button">Leave battle</button></div>
     <div id="emote-layer"></div><div id="connection-warning"></div>
    </div>
    <div id="lobby-footer" class="chest-tray"><div class="chest-heading"><span>VICTORY CHESTS</span><b id="chest-count">0 / 4</b></div><div class="chest-slots" id="chest-slots"></div></div>
    <div id="battle-tray" class="battle-tray hidden"><div class="hand-row"><div class="next-card"><span>NEXT</span><div class="next-card-picture" data-native-card="" data-card-variant="thumbnail"><img id="next-card-img" alt="Next card"/>${nativeCardArt}</div><div class="native-next-cost" data-native-card="" data-card-variant="cost"><b id="next-card-cost"></b>${nativeCardArt}</div></div><div class="hand" id="hand"></div></div><div class="elixir-row">${elixirMarkup}</div><div class="tray-caption"><span id="hand-caption">Select a card, then tap your side of the arena</span><span><kbd>1</kbd>–<kbd>4</kbd> SELECT</span></div></div>
    <div class="replay-controls hidden"><button id="replay-play" class="icon-button" aria-label="Pause replay">${icon("pause")}</button><span id="replay-clock">0:00</span><input id="replay-seek" aria-label="Replay timeline" type="range" min="0" max="100" step="0.01" value="0"/><button id="replay-speed" class="text-button">1×</button><button id="replay-exit" class="text-button">Exit</button></div>
   </main>
   <aside class="right-sidebar"><section class="deck-panel panel"><div class="section-heading"><div><span class="eyebrow">YOUR WINNING EIGHT</span><h3>Battle deck</h3></div><span class="deck-number">01</span></div><div class="deck-tabs" id="deck-tabs"></div><div class="deck-grid" id="deck-preview"></div><div class="deck-summary"><span><i class="tiny-drop"></i> Average elixir <b id="average-elixir">3.5</b></span><span>8 / 8</span></div><button id="edit-deck" class="secondary-button">${icon("layers-2")} Edit deck ${icon("arrow-up-right")}</button></section>
    <section class="battle-brief panel"><div class="section-heading"><h3>Battle brief</h3>${icon("scroll-text")}</div><div class="brief-item"><span>${icon("crown")}</span><div><b>Take the crown</b><p>Destroy more towers. Take the King Tower for an instant win.</p></div></div><div class="brief-item"><span class="purple">${icon("droplet")}</span><div><b>Spend wisely</b><p>Elixir refills over time. Save some to defend your side.</p></div></div><div class="brief-item"><span class="blue">${icon("timer")}</span><div><b>Three minutes. One winner.</b><p>Tied? Two-minute sudden death. Elixir speeds up as time runs out.</p></div></div><button id="how-to-play" class="text-button">How to play ${icon("arrow-right")}</button></section>
   </aside>
  </div>
  <footer class="app-footer"><span><i></i> BUILT FOR THE BROWSER. MADE FOR THE CROWN.</span><button id="about-button">Independent fan project ${icon("external-link")}</button><span class="fps-label">WEB ARENA · v0.1</span></footer>
 </div><div id="modal-root"></div><div class="toast" id="toast" role="status"></div><div id="drag-card" class="drag-card hidden"></div>`;

const nativeCards = new NativeCards();
const matchHud = new NativeBattleHud($(".match-timer"), $(".match-crowns"));
const crownCounts = () => ({
  blue: battle.players.blue.crowns,
  red: battle.players.red.crowns,
});
const announcements = new NativeAnnouncements($("#battle-announcements"));
const intro = new NativeIntro($("#battle-intro"));
const elixir = new NativeElixir($("#elixir-hud"));
const ending = new NativeEnding($("#battle-ending"));
const connectionWarning = new NativeConnectionWarning($("#connection-warning"));
const emotes = new NativeEmotes(
  $("#emote-layer"),
  $("#emote-button") as HTMLButtonElement,
  profile.emotesMuted,
);
emotes.onCue = (file, volume) => audio.play(file, volume);
emotes.onMute = (muted) => {
  profile.emotesMuted = muted;
  saveProfile(profile);
};
emotes.onSend = (kind) => {
  if (screen !== "battle" || paused || battle.winner || intro.clock.blocking)
    return false;
  if (multiplayer)
    return (
      network.connected &&
      network.send(
        isEmote(kind)
          ? { type: "emote", kind }
          : { type: "quick-chat", phrase: kind },
      )
    );
  return emotes.show("blue", kind);
};
ending.onContinue = () => {
  if (pendingResult && arena.effectTime >= pendingResult.time) ending.skip();
};
function resetEnding() {
  deathAudio.reset();
  combatAudio.reset();
  connectionWarning.reset();
  emotes.reset();
  ending.reset();
  endingBattle = null;
}
function startEnding(hold = false) {
  if (endingBattle === battle || !battle.winner) return;
  emotes.reset();
  endingBattle = battle;
  endingFrameTime = arena.effectTime;
  const player = multiplayer
    ? (network.room?.players.find((p) => p.team === network.team)?.name ??
      profile.name)
    : profile.name;
  ending.start(endResult(battle, player, opponentName), hold);
}
$(".match-timer").append($("#elixir-rate"));
announcements.onCue = (file, volume) => audio.play(file, volume);

function refreshIcons() {
  nativeCards.hydrate();
  createIcons({ icons, attrs: { "stroke-width": 1.8 } });
}
function toast(message: string) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(
    () => $("#toast").classList.remove("visible"),
    3000,
  );
}
function modal(title: string, body: string, key = "generic", wide = false) {
  if (
    !multiplayer &&
    !modalKey &&
    screen !== "lobby" &&
    !paused &&
    !battle.winner
  ) {
    paused = true;
    modalPausedBattle = true;
    audio.stopMusic();
    audio.stopEffects();
  }
  modalKey = key;
  $("#modal-root").innerHTML =
    `<div class="modal-backdrop"><section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-heading"><div><span class="eyebrow">BROWSER ARENA</span><h2 id="modal-title">${title}</h2></div><button class="icon-button close-modal" aria-label="Close dialog">${icon("x")}</button></div>${body}</section></div>`;
  refreshIcons();
  $(".close-modal").addEventListener("click", closeModal);
  $(".modal-backdrop").addEventListener("click", (e) => {
    if (e.target === $(".modal-backdrop")) closeModal();
  });
  $(".close-modal").focus();
}
function closeModal() {
  const wasResult = modalKey === "result";
  modalKey = "";
  $("#modal-root").innerHTML = "";
  if (modalPausedBattle) {
    modalPausedBattle = false;
    paused = false;
    accumulator = 0;
    if (screen === "battle" && !battle.winner) audio.startMusic();
  }
  if (wasResult && screen === "battle" && battle.winner) {
    lobby();
    return;
  }
  if (screen === "battle" && !paused)
    arena.renderer.domElement.focus({ preventScroll: true });
}
function refreshProfile() {
  $("#gold").textContent = fmt(profile.gold);
  $("#trophies").textContent = fmt(profile.trophies);
  document
    .querySelectorAll(".player-name")
    .forEach((e) => (e.textContent = profile.name));
  $("#road-progress").style.width =
    `${Math.min(100, (profile.trophies / 300) * 100)}%`;
  $("#road-count").textContent = `${Math.min(profile.trophies, 300)} / 300`;
  $("#chest-count").textContent = `${profile.chests.length} / 4`;
  $("#chest-slots").innerHTML = Array.from({ length: 4 }, (_, i) => {
    const type = profile.chests[i];
    return type
      ? `<button class="chest-slot filled ${type}" data-chest="${i}"><img src="${import.meta.env.BASE_URL}assets/chests/${type}.png" alt="${type} chest"/><span>OPEN CHEST</span><b>${type}</b></button>`
      : `<div class="chest-slot empty">${icon(i === 0 ? "package-open" : "plus")}<b>${i === 0 ? "Win a battle" : "Empty slot"}</b><span>${i === 0 ? "Earn your next chest" : "Ready for a reward"}</span></div>`;
  }).join("");
  document
    .querySelectorAll<HTMLButtonElement>("[data-chest]")
    .forEach((e) => (e.onclick = () => claimChest(Number(e.dataset.chest))));
  refreshDeck();
  refreshIcons();
}
function refreshDeck() {
  $("#deck-tabs").innerHTML =
    profile.decks
      .map(
        (_, i) =>
          `<button class="${i === profile.activeDeck ? "active" : ""}" data-deck="${i}" ${screen !== "lobby" ? "disabled" : ""}>${i + 1}</button>`,
      )
      .join("") + `<span>${PRESETS[profile.activeDeck].name}</span>`;
  document.querySelectorAll<HTMLButtonElement>("[data-deck]").forEach(
    (e) =>
      (e.onclick = () => {
        if (screen !== "lobby") return;
        profile.decks[profile.activeDeck] = [...profile.deck];
        profile.activeDeck = Number(e.dataset.deck);
        profile.deck = [...profile.decks[profile.activeDeck]];
        saveProfile(profile);
        refreshDeck();
        audio.play("button_click_02");
      }),
  );
  $("#deck-preview").innerHTML = profile.deck
    .map((id) => cardHTML(id, `data-card-info="${id}"`))
    .join("");
  $("#average-elixir").textContent = averageCost(profile.deck).toFixed(1);
  $(".deck-number").textContent = `0${profile.activeDeck + 1}`;
  document
    .querySelectorAll<HTMLButtonElement>("[data-card-info]")
    .forEach((e) => (e.onclick = () => showCard(e.dataset.cardInfo as CardId)));
  ($("#edit-deck") as HTMLButtonElement).disabled = screen !== "lobby";
  refreshIcons();
}
function claimChest(index: number) {
  const reward = openChest(profile, index);
  if (!reward) return;
  audio.play("gold_chest_open_01");
  refreshProfile();
  modal(
    "Victory tastes golden.",
    `<div class="chest-reward"><div class="reward-rays"></div><img class="reward-chest" src="${import.meta.env.BASE_URL}assets/chests/${reward.type}.png" alt="Opened ${reward.type} chest"/><h3>${reward.type} chest</h3><p>A little something for your next victory.</p><div class="reward-items"><span>${icon("coins")}<b>+${reward.gold}</b><small>GOLD</small></span><span>${icon("crown")}<b>Well played!</b><small>REWARD CLAIMED</small></span></div><button class="primary-button" id="claim-done">Collect rewards ${icon("check")}</button></div>`,
    "chest",
  );
  $("#claim-done").onclick = closeModal;
}

function lobby() {
  resetEnding();
  if (initialized && (network.room || multiplayer)) network.leave();
  multiplayer = false;
  networkBattleCode = "";
  networkReplay = undefined;
  replaySource = null;
  $("#connection-status").classList.add("hidden");
  $("#pause-button").setAttribute("aria-label", "Pause battle");
  screen = "lobby";
  selected = -1;
  paused = false;
  resultShown = false;
  replayData = null;
  replayRecord = null;
  accumulator = 0;
  audio.stopMusic();
  audio.stopEffects();
  announcements.reset();
  intro.skip();
  document.body.classList.remove("in-battle", "in-replay");
  arena.showPlacement(null, null);
  closeModal();
  battle = new Battle({ ai: false, seed: 1, deck: profile.deck });
  arena.setBattle(battle);
  $(".lobby-badge").classList.remove("hidden");
  $(".lobby-bottom").classList.remove("hidden");
  $("#lobby-footer").classList.remove("hidden");
  $("#battle-tray").classList.add("hidden");
  $(".pause-cover").classList.add("hidden");
  $(".replay-controls").classList.add("hidden");
  document
    .querySelectorAll(".match-top,.match-bottom,.match-crowns")
    .forEach((e) => e.classList.add("hidden"));
  $("#deploy-hint").classList.add("hidden");
  $(".mode-select").classList.remove("hidden");
  refreshProfile();
}
function startBattle(online = false) {
  resetEnding();
  if (!online) network.leave();
  multiplayer = online;
  networkReplay = undefined;
  replaySource = null;
  closeModal();
  screen = "battle";
  paused = false;
  speed = 1;
  audio.setRate(1);
  audio.stopEffects();
  announcements.reset();
  selected = -1;
  accumulator = 0;
  resultShown = false;
  replayData = null;
  eventCursor = 0;
  document.body.classList.add("in-battle");
  window.scrollTo(0, 0);
  document.body.classList.remove("in-replay");
  battle = new Battle({
    deck: profile.deck,
    mode: online ? (network.room?.mode ?? mode) : mode,
    ai: !online,
    seed: Math.floor(Math.random() * 2147483646) + 1,
  });
  arena.setBattle(battle);
  opponentName = online
    ? (network.room?.players.find((p) => p.team !== network.team)?.name ??
      "Opponent")
    : "Royal Trainer";
  $(".competitor.enemy b").textContent = opponentName;
  $(".competitor.enemy div > span").textContent = online
    ? "Friendly battle"
    : "Training guild";
  $("#pause-button").setAttribute(
    "aria-label",
    online ? "Battle options" : "Pause battle",
  );
  $("#connection-status").classList.toggle("hidden", !online);
  $(".lobby-badge").classList.add("hidden");
  $(".lobby-bottom").classList.add("hidden");
  $("#lobby-footer").classList.add("hidden");
  $("#battle-tray").classList.remove("hidden");
  $(".pause-cover").classList.add("hidden");
  document
    .querySelectorAll(".match-top,.match-bottom,.match-crowns")
    .forEach((e) => e.classList.remove("hidden"));
  $(".mode-select").classList.add("hidden");
  $("#deploy-hint").classList.remove("hidden");
  $(".replay-controls").classList.add("hidden");
  refreshDeck();
  intro.start(profile.name, battle.mode, opponentName);
  elixir.reset(battle.time, battle.players.blue.elixir, battle.multiplier);
  nativeCards.reset(battle.time, battle.players.blue.hand);
  matchHud.reset(arena.effectTime, crownCounts());
  updateBattleUI(true);
  audio.startMusic();
  if (!profile.seenTutorial) {
    profile.seenTutorial = true;
    saveProfile(profile);
  }
}
let lastHand = "";
function updateBattleUI(force = false) {
  refreshPlacement();
  const timer = battleClock(battle);
  const text = (selector: string, value: string) => {
    const node = $(selector);
    if (node.textContent !== value) node.textContent = value;
  };
  text("#match-clock", clock(Math.ceil(timer.remaining)));
  text("#phase-label", timer.overtime ? "SUDDEN DEATH" : "TIME LEFT");
  $(".match-timer").classList.toggle("urgent", timer.remaining <= 30);
  text("#blue-crowns", String(battle.players.blue.crowns));
  text("#red-crowns", String(battle.players.red.crowns));
  const p = battle.players.blue,
    key = p.hand.join(",");
  if (force || key !== lastHand) {
    lastHand = key;
    $("#hand").innerHTML = p.hand
      .map((id, i) =>
        cardHTML(
          id,
          `data-slot="${i}"`,
          `hand-card ${selected === i ? "selected" : ""}`,
        ),
      )
      .join("");
    document.querySelectorAll<HTMLButtonElement>("[data-slot]").forEach((e) => {
      e.addEventListener("click", (event) => {
        if (event.detail === 0 && screen === "battle" && !paused)
          selectCard(Number(e.dataset.slot));
      });
      e.addEventListener("pointerdown", (event) => {
        if (screen !== "battle" || paused || intro.clock.blocking) return;
        if (!event.isPrimary || pointerDown) return;
        activeSlot = Number(e.dataset.slot);
        pointerDown = true;
        activePointerId = event.pointerId;
        pointerStart = { x: event.clientX, y: event.clientY };
        selectCard(activeSlot);
        event.preventDefault();
      });
    });
  }
  const next = CARD_MAP[p.queue[0]];
  $("#next-card-img").setAttribute("src", cardArt(next.id));
  $("#next-card-img").setAttribute("alt", `Next card: ${next.name}`);
  $("#next-card-cost").textContent = String(
    battle.cardCost("blue", next.id) ?? "?",
  );
  document
    .querySelectorAll<HTMLElement>(".next-card [data-native-card]")
    .forEach((e) => {
      e.dataset.nativeCard = next.id;
      e.dataset.cardCost = String(battle.cardCost("blue", next.id) ?? "?");
      e.dataset.mirrorCard = next.id === "mirror" ? (p.lastPlayed ?? "") : "";
      nativeCards.draw(e);
    });
  document.querySelectorAll<HTMLElement>("[data-slot]").forEach((e, i) => {
    const id = p.hand[i];
    const cost = battle.cardCost("blue", id);
    e.dataset.cardCost = String(cost ?? "?");
    e.dataset.mirrorCard = id === "mirror" ? (p.lastPlayed ?? "") : "";
    e.querySelector<HTMLElement>(".cost")!.textContent = String(cost ?? "?");
    e.setAttribute(
      "aria-label",
      `${CARD_MAP[id].name}, ${cost ?? "unknown"} elixir${id === "mirror" && p.lastPlayed ? `, repeats ${CARD_MAP[p.lastPlayed].name}` : ""}`,
    );
    (e as HTMLButtonElement).disabled =
      intro.clock.blocking ||
      cost === null ||
      (multiplayer &&
        (!network.connected || network.pending || !!network.room?.paused));
    e.classList.toggle("unaffordable", cost === null || cost > p.elixir);
    e.classList.toggle("selected", selected === i);
    e.setAttribute("aria-pressed", String(selected === i));
  });
  nativeCards.updateHand($("#hand"), battle.time);
  if (screen === "replay" && replayData) {
    $("#replay-clock").textContent = clock(battle.time);
    ($("#replay-seek") as HTMLInputElement).value = String(
      (battle.tick / Math.max(1, replayData.duration)) * 100,
    );
  }
  if (screen === "battle" && battle.winner && !resultShown) showResult();
  if (screen === "replay" && replayData && battle.tick >= replayData.duration) {
    paused = true;
    if (replayRecord && !battle.winner) {
      battle.finish(replayRecord.winner, "Replay complete");
      if (!force) {
        audio.stopEffects();
        announcements.cue("Gameend Horn");
      }
    }
  }
  if (screen === "replay") syncReplayControl();
}
function selectCard(slot: number) {
  if (screen !== "battle" || paused || battle.winner || intro.clock.blocking)
    return;
  selected = selected === slot ? -1 : slot;
  audio.play("button_click_02", 0.2);
  if (selected < 0) {
    $("#hand-caption").textContent =
      "Select a card, then tap your side of the arena";
    $("#deploy-hint").textContent = "Select a card to deploy";
    arena.showPlacement(null, null);
  } else {
    const id = battle.players.blue.hand[selected];
    const repeated = battle.cardForPlay("blue", id);
    const c = CARD_MAP[repeated ?? id];
    const cost = battle.cardCost("blue", id);
    $("#hand-caption").textContent =
      cost === null
        ? "Play another card before Mirror"
        : `${id === "mirror" ? `Mirror → ${c.name}` : c.name} · ${cost} elixir · ${c.kind === "spell" ? "Target anywhere" : "Deploy on the blue half"}`;
    $("#deploy-hint").textContent =
      cost === null
        ? "Play another card before Mirror"
        : c.kind === "spell"
          ? `${c.name} · Target anywhere`
          : `${c.name} · Deploy on your side`;
    refreshPlacement();
  }
  updateBattleUI();
}
function refreshPlacement() {
  if (
    screen !== "battle" ||
    paused ||
    selected < 0 ||
    battle.winner ||
    intro.clock.blocking
  ) {
    arena.showPlacement(null, null);
    return;
  }
  const id = battle.players.blue.hand[selected],
    cost = battle.cardCost("blue", id),
    repeated = battle.cardForPlay("blue", id);
  const place = hover
    ? battle.canPlace("blue", id, hover.x, hover.y)
    : repeated
      ? { ok: true, reason: "" }
      : { ok: false, reason: "Play another card before Mirror." };
  const affordable = cost !== null && battle.players.blue.elixir + 1e-6 >= cost;
  arena.showPlacement(
    repeated ?? id,
    hover,
    place.ok && affordable,
    !place.ok ? place.reason : !affordable ? `You need ${cost} elixir` : "",
  );
}
function deploy(point: Point) {
  if (
    selected < 0 ||
    screen !== "battle" ||
    paused ||
    battle.winner ||
    intro.clock.blocking
  )
    return;
  const id = battle.players.blue.hand[selected];
  const result = multiplayer
    ? {
        ok: network.play(id, point.x, point.y),
        reason: "Waiting for the server",
      }
    : battle.play("blue", selected, point.x, point.y);
  if (result.ok) {
    selected = -1;
    arena.showPlacement(null, null);
    $("#hand-caption").textContent =
      "Select a card, then tap your side of the arena";
    $("#deploy-hint").textContent = "Select a card to deploy";
    updateBattleUI(true);
  } else {
    hover = point;
    refreshPlacement();
    audio.play("bad_drop_03", 0.2);
  }
}
function togglePause() {
  if (screen === "lobby" || battle.winner) return;
  if (multiplayer) {
    modal(
      "Battle continues",
      `<p class="room-note">Online battles keep running while this menu is open.</p><button class="primary-button" id="online-resume">Back to battle</button><button class="text-button" id="online-surrender">Surrender</button>`,
      "online-options",
    );
    $("#online-resume").onclick = closeModal;
    $("#online-surrender").onclick = () => {
      network.send({ type: "surrender" });
      closeModal();
    };
    return;
  }
  paused = !paused;
  if (paused) {
    cancelPointer();
    audio.stopEffects();
  }
  accumulator = 0;
  if (screen === "battle") {
    $(".pause-cover").classList.toggle("hidden", !paused);
    if (paused) audio.stopMusic();
    else audio.startMusic();
  } else {
    syncReplayControl();
  }
}
function syncReplayControl() {
  const action =
    replayData && battle.tick >= replayData.duration
      ? "restart"
      : paused
        ? "play"
        : "pause";
  const button = $("#replay-play");
  if (button.dataset.action === action) return;
  button.dataset.action = action;
  button.innerHTML = icon(action === "restart" ? "rotate-ccw" : action);
  button.setAttribute(
    "aria-label",
    action === "restart"
      ? "Restart replay"
      : action === "play"
        ? "Resume replay"
        : "Pause replay",
  );
  refreshIcons();
}
function showResult() {
  deathAudio.reset();
  combatAudio.skip(battle.audioEvents);
  startEnding();
  const completedBattle = battle;
  resultShown = true;
  audio.stopMusic();
  audio.stopEffects();
  announcements.cue("Gameend Horn");
  const wasMultiplayer = multiplayer;
  const reward = recordBattle(
      profile,
      battle,
      wasMultiplayer
        ? {
            friendly: true,
            opponent: opponentName,
            matchId: networkBattleCode,
            replay: networkReplay
              ? { ...networkReplay, perspective: network.team }
              : undefined,
          }
        : undefined,
    ),
    win = battle.winner === "blue",
    draw = battle.winner === "draw";
  refreshProfile();
  arena.showPlacement(null, null);
  $("#deploy-hint").classList.add("hidden");
  pendingResult = {
    battle: completedBattle,
    time: arena.effectTime + 1.4,
    show: () => {
      if (screen !== "battle" || battle !== completedBattle) return;
      ending.reset();
      audio.play(win ? "win_tour_01" : "lose_tour_01", 0.45);
      modal(
        draw
          ? "A worthy battle."
          : win
            ? "Victory is yours!"
            : "A crown to chase.",
        `<div class="result-content ${win ? "victory" : "defeat"}"><div class="result-crown">${icon("crown")}</div><span class="eyebrow">${esc(battle.reason)}</span><div class="result-score"><span class="blue">${icon("crown")} ${battle.players.blue.crowns}</span><b>–</b><span class="red">${battle.players.red.crowns} ${icon("crown")}</span></div><p>${win ? "Your kingdom stands tall. Well played." : draw ? "An even battle. A rematch awaits." : "Every great king learns from a battle."}</p><div class="result-rewards"><div>${icon("trophy")}<b>${reward.trophies > 0 ? "+" : ""}${reward.trophies}</b><small>TROPHIES</small></div><div>${icon("coins")}<b>+${reward.gold}</b><small>GOLD</small></div>${reward.chest ? `<div><img src="${import.meta.env.BASE_URL}assets/chests/${reward.chest}.png" alt="${reward.chest} chest"/><b>+1</b><small>${reward.chest.toUpperCase()} CHEST</small></div>` : ""}</div><button class="primary-button" id="rematch">${icon("swords")} Battle again</button><div class="result-links"><button class="text-button" id="watch-replay">${icon("play")} Watch replay</button><button class="text-button" id="return-home">Back to arena ${icon("arrow-right")}</button></div></div>`,
        "result",
      );
      if (wasMultiplayer)
        $(".result-rewards").innerHTML =
          "<p>Friendly battle · no trophies or rewards</p>";
      $("#rematch").onclick = () => {
        if (wasMultiplayer) {
          lobby();
          showMultiplayer();
        } else startBattle();
      };
      $("#return-home").onclick = lobby;
      $("#watch-replay").onclick = () => playReplay(profile.history[0]);
    },
  };
}
function playReplay(record: RecordEntry) {
  resetEnding();
  if (network.room) network.leave();
  multiplayer = false;
  $("#connection-status").classList.add("hidden");
  opponentName = record.opponent ?? "Royal Trainer";
  $(".competitor.enemy b").textContent = opponentName;
  $(".competitor.enemy div > span").textContent = record.opponent
    ? "Friendly battle replay"
    : "Training guild";
  closeModal();
  screen = "replay";
  replayRecord = record;
  replayData = record.replay;
  resultShown = true;
  paused = false;
  speed = 1;
  audio.setRate(1);
  audio.stopEffects();
  announcements.reset();
  selected = -1;
  accumulator = 0;
  eventCursor = 0;
  document.body.classList.add("in-battle", "in-replay");
  window.scrollTo(0, 0);
  createReplayBattle(replayData);
  arena.setBattle(battle);
  arena.showPlacement(null, null);
  $(".lobby-badge").classList.add("hidden");
  $(".lobby-bottom").classList.add("hidden");
  $("#lobby-footer").classList.add("hidden");
  $("#battle-tray").classList.remove("hidden");
  $(".pause-cover").classList.add("hidden");
  document
    .querySelectorAll(".match-top,.match-bottom,.match-crowns")
    .forEach((e) => e.classList.remove("hidden"));
  $(".mode-select").classList.add("hidden");
  $("#deploy-hint").classList.add("hidden");
  $(".replay-controls").classList.remove("hidden");
  syncReplayControl();
  $("#replay-speed").textContent = "1×";
  refreshDeck();
  intro.start(profile.name, battle.mode, opponentName);
  elixir.reset(battle.time, battle.players.blue.elixir, battle.multiplier);
  nativeCards.reset(battle.time, battle.players.blue.hand);
  matchHud.reset(arena.effectTime, crownCounts());
  updateBattleUI(true);
  refreshIcons();
}
function createReplayBattle(replay: Replay) {
  replaySource = replay.perspective === "red" ? new Battle({ replay }) : null;
  battle = replaySource
    ? new Battle({
        seed: replay.seed,
        ai: false,
        mode: replay.mode,
        deck: replay.enemyDeck,
        enemyDeck: replay.deck,
      })
    : new Battle({ replay });
  if (replaySource) applySnapshot(battle, snapshot(replaySource), "red");
}
function stepReplay() {
  if (replaySource) {
    replaySource.step();
    applySnapshot(battle, snapshot(replaySource), "red");
  } else battle.step();
}
function updateConnection() {
  connectionWarning.setActive(
    screen === "battle" && multiplayer && !network.connected && !battle.winner,
  );
  const opponent = network.room?.players.find((p) => p.team !== network.team);
  const status = $("#connection-status");
  const message = !network.connected
    ? peerNetwork
      ? "Reconnecting… battle paused"
      : "Reconnecting… battle continues"
    : opponent && !opponent.connected
      ? peerNetwork
        ? "Friend disconnected · battle paused"
        : "Opponent reconnecting · 30s grace"
      : network.room?.paused
        ? "Battle paused · return to both game tabs"
        : `FRIENDLY · ${network.latency ? `${network.latency} ms` : "Connected"}`;
  if (status.textContent !== message) status.textContent = message;
  status.classList.toggle(
    "reconnecting",
    !network.connected ||
      !!network.room?.paused ||
      (!!opponent && !opponent.connected),
  );
}
function roomLink(code: string) {
  return `${lanOrigin || location.origin}/?room=${code}`;
}
function showMultiplayer(code = "") {
  if (screen !== "lobby") return;
  if (peerNetwork) {
    showPeerMultiplayer();
    return;
  }
  const room = network.room;
  if (room) {
    modal(
      "Friendly battle",
      `<div class="room-banner">${icon("swords")}<span>${modeNames[room.mode]} · Level 11</span></div><p class="room-note">Share this room with a friend. Both players must open the same server.</p><div class="room-code" aria-label="Room code">${room.code}</div><div class="room-players">${(
        ["blue", "red"] as const
      )
        .map((team) => {
          const p = room.players.find((p) => p.team === team);
          return `<div class="room-player ${team}">${icon("shield")}<div><b>${esc(p?.name ?? "Waiting for a friend…")}</b><span>${!p ? "Share the link below" : !p.connected ? "Reconnecting…" : p.ready ? "Ready for battle" : "Preparing deck"}</span></div><span class="room-ready">${p?.ready ? icon("check") : icon("swords")}</span></div>`;
        })
        .join(
          "",
        )}</div><label class="field-label" for="room-link">INVITE LINK</label><input id="room-link" class="name-input room-link" readonly value="${esc(roomLink(room.code))}"/><button class="secondary-button" id="copy-room">Copy invite link</button><p class="room-error" role="status">${esc(roomError)}</p><button class="primary-button" id="room-ready">${room.players.find((p) => p.team === network.team)?.ready ? "Cancel ready" : "Ready for battle"}</button><button class="text-button" id="leave-room">Leave room</button>`,
      "room",
    );
    $("#room-ready").onclick = () =>
      network.send({
        type: "ready",
        ready: !network.room?.players.find((p) => p.team === network.team)
          ?.ready,
      });
    $("#leave-room").onclick = () => {
      network.leave();
      closeModal();
    };
    $("#copy-room").onclick = async () => {
      const field = $<HTMLInputElement>("#room-link");
      try {
        await navigator.clipboard.writeText(field.value);
        toast("Invite link copied.");
      } catch {
        field.focus();
        field.select();
        toast("Select and copy the invite link.");
      }
    };
    return;
  }
  modal(
    "Play with a friend",
    `<div class="room-banner">${icon("users")}<span>Two players. One crown.</span></div><p class="room-note">Play on the same Wi-Fi, or open a hosted game link to battle from anywhere.</p>${network.saved ? '<button class="secondary-button" id="resume-room">Reconnect to your room</button>' : ""}<button class="primary-button" id="create-room">Create a room</button><div class="room-divider">OR JOIN A FRIEND</div><form id="join-room-form"><label class="field-label" for="join-code">ROOM CODE</label><div class="room-join"><input id="join-code" class="name-input" maxlength="6" minlength="6" pattern="[A-Za-z2-9]{6}" placeholder="ABC123" value="${esc(code)}" autocapitalize="characters" autocomplete="off" spellcheck="false" required/><button class="secondary-button" type="submit">Join room</button></div></form><p class="room-error" role="status">${esc(roomError || connectionStatus)}</p><p class="modal-footnote">${lanOrigin ? `On your Wi-Fi, open <a href="${esc(lanOrigin)}">${esc(lanOrigin)}</a> on the other phone.` : "Open this same address on both devices. Room codes work on the server that created them."}<br>Friendly battles keep running if you switch apps. Rejoin within 30 seconds after losing connection.</p>`,
    "room",
  );
  $("#create-room").onclick = () => {
    roomError = "";
    legacyNetwork!.connect({
      type: "create",
      version: PROTOCOL,
      name: profile.name,
      deck: profile.deck,
      mode: mode === "double" ? "double" : "classic",
    });
  };
  $("#join-room-form").onsubmit = (e) => {
    e.preventDefault();
    roomError = "";
    legacyNetwork!.connect({
      type: "join",
      version: PROTOCOL,
      name: profile.name,
      deck: profile.deck,
      code: $<HTMLInputElement>("#join-code").value.trim().toUpperCase(),
    });
  };
  document
    .querySelector<HTMLButtonElement>("#resume-room")
    ?.addEventListener("click", () => legacyNetwork!.resume());
}
let peerDraft = new URLSearchParams(location.hash.slice(1)).get("battle") ?? "";
let peerReply = "";
async function peerAction(action: () => Promise<void>) {
  roomError = "";
  try {
    await action();
  } catch (error) {
    roomError =
      error instanceof Error
        ? error.message
        : "Could not connect. Try a new invite.";
    if (screen === "lobby" && modalKey === "room") showPeerMultiplayer();
  }
}
function legacyCopyPeer(value: string) {
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("aria-hidden", "true");
  field.style.cssText =
    "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;font-size:16px";
  document.body.append(field);
  field.focus({ preventScroll: true });
  field.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    // The visible source field remains available for manual selection.
  }
  field.remove();
  return copied;
}
async function copyPeerValue(field: HTMLTextAreaElement) {
  if (navigator.clipboard?.writeText)
    try {
      await navigator.clipboard.writeText(field.value);
      return true;
    } catch {
      // Some browsers expose the API but reject it on an HTTP LAN origin.
    }
  if (legacyCopyPeer(field.value)) return true;
  field.focus();
  field.select();
  return false;
}
function showPeerMultiplayer() {
  const peer = peerNetwork!;
  const room = peer.room;
  const footnote =
    '<p class="modal-footnote">Keep both game tabs open. Battles pause when either player switches apps. Some remote networks block direct play; try the same Wi-Fi if connecting fails.</p>';
  let content = "";
  if (room) {
    content = `<div class="room-banner">${icon("swords")}<span>${modeNames[room.mode]} · Level 11</span></div><p class="room-note">Connected directly. Ready when you are.</p><div class="room-players">${room.players.map((p) => `<div class="room-player ${p.team}">${icon("shield")}<div><b>${esc(p.name)}</b><span>${p.ready ? "Ready for battle" : "Preparing deck"}</span></div>${icon(p.ready ? "check" : "swords")}</div>`).join("")}</div><button id="room-ready" class="primary-button" ${!peer.connected ? "disabled" : ""}>${room.players.find((p) => p.team === peer.team)?.ready ? "Cancel ready" : "Ready for battle"}</button>`;
  } else if (peer.setup === "gathering" || peer.setup === "connecting") {
    content = `<div class="room-banner">${icon("users")}<span>${peer.setup === "gathering" ? "Preparing your connection…" : "Connecting to your friend…"}</span></div><p class="room-note" role="status">${peer.setup === "gathering" ? "This usually takes a few seconds." : "Keep this tab open on both devices."}</p>`;
  } else if (peer.setup === "offer" || peer.setup === "answer") {
    const hosting = peer.setup === "offer";
    const localHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      location.hostname,
    );
    const shareValue = hosting
      ? localHost
        ? peer.signal
        : signalLink(peer.signal)
      : peer.signal;
    content = `<div class="room-banner">${icon("users")}<span>${hosting ? "1. Send your invite" : "2. Send your reply"}</span></div><p class="room-note">${hosting ? (localHost ? "On the other phone, open this game at your computer's Wi-Fi address, then paste this invite code." : "Send this invite to your friend. They can open it or paste it into Play with a friend.") : "Send this reply back to the player who invited you. Keep this tab open while they paste it."}</p><label class="field-label" for="peer-share">${hosting ? (localHost ? "INVITE CODE" : "INVITE LINK") : "CONNECTION REPLY"}</label><textarea id="peer-share" class="name-input peer-code" readonly rows="2" spellcheck="false">${esc(shareValue)}</textarea><div class="peer-share-actions"><button class="secondary-button" id="copy-peer">${hosting ? "Copy invite" : "Copy reply"}</button>${typeof navigator.share === "function" ? `<button class="secondary-button" id="share-peer">${hosting ? "Share invite" : "Share reply"}</button>` : ""}</div>${hosting ? `<div class="room-divider">2. CONNECT YOUR FRIEND</div><form id="peer-accept-form"><label class="field-label" for="peer-reply">PASTE THEIR REPLY</label><textarea id="peer-reply" class="name-input peer-code" rows="2" placeholder="CR1.…" spellcheck="false" required>${esc(peerReply)}</textarea><button class="primary-button" type="submit">Connect friend</button></form>` : '<p class="room-note" role="status">Waiting for your friend to connect…</p>'}`;
  } else {
    content = `<div class="room-banner">${icon("users")}<span>Two players. One crown.</span></div><p class="room-note">Play directly between two browsers on Wi-Fi or online. Create an invite, then exchange one reply to connect.</p><button class="primary-button" id="create-peer">Create an invite</button><div class="room-divider">OR JOIN A FRIEND</div><form id="peer-join-form"><label class="field-label" for="peer-invite">PASTE THEIR INVITE</label><textarea id="peer-invite" class="name-input peer-code" rows="2" placeholder="Invite link or CR1.…" spellcheck="false" required>${esc(peerDraft)}</textarea><button class="secondary-button" type="submit">Join friend</button></form>`;
  }
  modal(
    "Play with a friend",
    `${content}<p class="room-error" role="status">${esc(roomError)}</p>${footnote}${peer.setup !== "idle" ? '<button id="cancel-peer" class="text-button">Leave connection</button>' : ""}`,
    "room",
  );
  const player = () => ({ name: profile.name, deck: profile.deck });
  document
    .querySelector<HTMLButtonElement>("#create-peer")
    ?.addEventListener("click", () => {
      peerReply = "";
      void peerAction(() =>
        peer.offer(player(), mode === "double" ? "double" : "classic"),
      );
    });
  document
    .querySelector<HTMLTextAreaElement>("#peer-invite")
    ?.addEventListener("input", (e) => {
      peerDraft = (e.target as HTMLTextAreaElement).value;
    });
  document
    .querySelector<HTMLTextAreaElement>("#peer-reply")
    ?.addEventListener("input", (e) => {
      peerReply = (e.target as HTMLTextAreaElement).value;
    });
  document
    .querySelector<HTMLFormElement>("#peer-join-form")
    ?.addEventListener("submit", (e) => {
      e.preventDefault();
      void peerAction(() => peer.answer(peerDraft, player()));
    });
  document
    .querySelector<HTMLFormElement>("#peer-accept-form")
    ?.addEventListener("submit", (e) => {
      e.preventDefault();
      void peerAction(() => peer.accept(peerReply));
    });
  document
    .querySelector<HTMLButtonElement>("#copy-peer")
    ?.addEventListener("click", async () => {
      const field = $<HTMLTextAreaElement>("#peer-share");
      toast(
        (await copyPeerValue(field))
          ? "Copied. Send it to your friend."
          : "Selected. Use your browser’s Copy action.",
      );
    });
  document
    .querySelector<HTMLButtonElement>("#share-peer")
    ?.addEventListener("click", async () => {
      const value = $<HTMLTextAreaElement>("#peer-share").value;
      try {
        await navigator.share(
          value.startsWith("http")
            ? { title: "Clash Royale browser battle", url: value }
            : { title: "Clash Royale browser battle", text: value },
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        toast("Could not share. Copy the invite instead.");
      }
    });
  document
    .querySelector<HTMLButtonElement>("#cancel-peer")
    ?.addEventListener("click", () => {
      peer.leave();
      roomError = "";
      showPeerMultiplayer();
    });
  document
    .querySelector<HTMLButtonElement>("#room-ready")
    ?.addEventListener("click", () =>
      peer.send({
        type: "ready",
        ready: !peer.room?.players.find((p) => p.team === peer.team)?.ready,
      }),
    );
}
if (peerNetwork)
  peerNetwork.onSetup = () => {
    if (screen === "lobby" && modalKey === "room") showPeerMultiplayer();
  };
network.onConnection = (status) => {
  connectionStatus =
    status === "connecting"
      ? "Connecting…"
      : status === "reconnecting"
        ? "Reconnecting…"
        : "";
  if (multiplayer) updateConnection();
  else if (modalKey === "room") {
    $(".room-error").textContent = connectionStatus;
    document
      .querySelectorAll<HTMLButtonElement>(
        "#create-room,#join-room-form button",
      )
      .forEach((b) => (b.disabled = status === "connecting"));
  }
};
network.onMessage = (message) => {
  if (message.type === "room") {
    if (screen === "lobby" && modalKey === "room") showMultiplayer();
    if (multiplayer) updateConnection();
  }
  if (message.type === "state") {
    const joining = networkBattleCode !== network.room?.code || !multiplayer;
    if (joining) {
      networkBattleCode = network.room!.code;
      startBattle(true);
    }
    if (message.replay) networkReplay = message.replay;
    applySnapshot(battle, message.state, network.team);
    if (message.countdownMs > 0)
      intro.clock.time = Math.max(
        0,
        INTRO_ACTION_TIME - message.countdownMs / 1000,
      );
    else if (intro.clock.blocking) intro.clock.time = INTRO_ACTION_TIME;
    if (joining) {
      arena.setBattle(battle);
      if (battle.tick > 0) {
        eventCursor = battle.events.at(-1)?.id ?? 0;
        combatAudio.skip(battle.audioEvents);
        intro.skip();
      }
      elixir.reset(battle.time, battle.players.blue.elixir, battle.multiplier);
      nativeCards.reset(battle.time, battle.players.blue.hand);
      matchHud.reset(arena.effectTime, crownCounts());
      updateBattleUI(true);
    } else if (document.hidden) {
      eventCursor = battle.events.at(-1)?.id ?? eventCursor;
      combatAudio.skip(battle.audioEvents);
    }
    if (!document.hidden && !battle.winner) {
      // Consume before another state replaces this snapshot or a graphics frame
      // delays presentation. The independent audio cursor prevents duplicates.
      combatAudio.consume(battle.audioEvents, battle.seed, battle.time);
      updateCombatAudio();
    }
  }
  if (message.type === "ack" && !message.ok) toast(message.reason);
  if (message.type === "error") {
    roomError = message.message;
    if (multiplayer) {
      if (message.fatal) {
        lobby();
        showMultiplayer();
      } else toast(message.message);
    } else if (modalKey === "room") showMultiplayer();
  }
  if (message.type === "emote" && screen === "battle" && !battle.winner)
    emotes.show(
      message.team === network.team ? "blue" : "red",
      message.kind ?? "laugh",
    );
  if (message.type === "quick-chat" && screen === "battle" && !battle.winner)
    emotes.show(message.team === network.team ? "blue" : "red", message.phrase);
};

function showModes() {
  if (screen !== "lobby") return;
  modal(
    "Choose your battle",
    `<div class="mode-list">${(["classic", "double", "training"] as Mode[]).map((m) => `<button class="mode-option ${m === mode ? "chosen" : ""}" data-mode="${m}"><span class="mode-icon">${icon(m === "double" ? "droplet" : m === "training" ? "target" : "swords")}</span><div><h3>${modeNames[m]}</h3><p>${m === "classic" ? "The classic arena experience. Earn trophies and victory chests." : m === "double" ? "Double elixir from the start. Bigger pushes, faster battles." : "A relaxed AI opponent. Practice new cards without risking trophies."}</p></div>${icon(m === mode ? "circle-check" : "chevron-right")}</button>`).join("")}</div>`,
    "modes",
  );
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(
    (e) =>
      (e.onclick = () => {
        mode = e.dataset.mode as Mode;
        $("#mode-name").textContent = modeNames[mode];
        closeModal();
        audio.play("button_click_02");
      }),
  );
}
function showCard(id: CardId) {
  const c = CARD_MAP[id];
  modal(
    c.name,
    `<div class="card-detail"><div class="detail-art ${c.rarity.toLowerCase()}" data-native-card="${id}" data-card-variant="deck">${nativeCardArt}<img src="${cardArt(id)}" alt="${c.name}"/><span class="cost">${c.cost}</span></div><div><span class="rarity-label ${c.rarity.toLowerCase()}">${c.rarity} · ${c.kind}</span><p>${c.description}</p><span class="level-pill">TOURNAMENT STANDARD · LEVEL 11</span></div></div><div class="stat-grid">${[
      [
        c.kind === "spell" ? "Area damage" : "Hitpoints",
        c.kind === "spell" ? c.damage : c.hp,
        "heart",
      ],
      ["Damage", c.damage, "swords"],
      [
        c.kind === "spell" ? "Radius" : "Range",
        `${c.radius ?? c.range} tiles`,
        "scan",
      ],
      [
        "Targets",
        c.buildingsOnly ? "Buildings" : c.hitsAir ? "Air & ground" : "Ground",
        "crosshair",
      ],
      ["Count", c.kind === "spell" ? "Area" : c.count, "users"],
      ["Elixir", c.cost, "droplet"],
    ]
      .map(
        ([a, b, i]) =>
          `<div>${icon(String(i))}<small>${a}</small><b>${b}</b></div>`,
      )
      .join(
        "",
      )}</div>${screen === "lobby" ? `<button class="secondary-button" id="card-edit-deck">${icon("layers-2")} Open deck builder</button>` : ""}`,
    "card",
  );
  if (screen === "lobby") $("#card-edit-deck").onclick = showDeckBuilder;
}
function showDeckBuilder() {
  if (screen !== "lobby") {
    toast("Finish your battle to edit your deck.");
    return;
  }
  editSlot = -1;
  filter = "all";
  search = "";
  renderDeckBuilder();
}
function renderDeckBuilder() {
  modal(
    "Build your winning eight",
    `<div class="builder-top"><p>Choose a deck card, then select its replacement below.</p><span><i class="tiny-drop"></i> ${averageCost(profile.deck).toFixed(1)} average</span></div><div class="builder-deck">${profile.deck.map((id, i) => cardHTML(id, `data-edit-slot="${i}"`, editSlot === i ? "selected" : "")).join("")}</div><div class="builder-controls"><div class="collection-label"><h3>Card collection</h3><span>${CARDS.length} / ${CARDS.length} unlocked</span></div><label class="search-input">${icon("search")}<input id="card-search" placeholder="Find a card…" value="${esc(search)}" aria-label="Search cards"/></label><div class="filter-row">${["all", "troop", "spell", "building"].map((f) => `<button class="${filter === f ? "active" : ""}" data-filter="${f}">${f === "all" ? "All cards" : f === "troop" ? "Troops" : f === "spell" ? "Spells" : "Buildings"}</button>`).join("")}</div></div><div class="collection-grid" id="collection-grid"></div><div class="builder-footer"><span id="builder-hint">${editSlot < 0 ? "Select one of your eight cards to replace it." : `Replacing ${CARD_MAP[profile.deck[editSlot]].name} · Choose a card below.`}</span><button class="primary-button" id="deck-done">${icon("check")} Done</button></div>`,
    "deck",
    true,
  );
  document.querySelectorAll<HTMLButtonElement>("[data-edit-slot]").forEach(
    (e) =>
      (e.onclick = () => {
        editSlot = Number(e.dataset.editSlot);
        renderDeckBuilder();
      }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach(
    (e) =>
      (e.onclick = () => {
        filter = e.dataset.filter!;
        renderDeckBuilder();
      }),
  );
  $("#card-search").addEventListener("input", () => {
    search = ($("#card-search") as HTMLInputElement).value;
    renderCollection();
  });
  $("#deck-done").onclick = () => {
    saveProfile(profile);
    refreshDeck();
    closeModal();
  };
  renderCollection();
}
function renderCollection() {
  const matches = CARDS.filter(
    (c) =>
      (filter === "all" || c.kind === filter) &&
      c.name.toLowerCase().includes(search.toLowerCase()),
  );
  $("#collection-grid").innerHTML = matches.length
    ? matches
        .map(
          (c) =>
            cardHTML(
              c.id,
              `data-collection="${c.id}"`,
              profile.deck.includes(c.id) ? "in-deck" : "",
            ) +
            `<span class="collection-card-label">${c.name}${profile.deck.includes(c.id) ? " <b>IN DECK</b>" : ""}</span>`,
        )
        .map((s) => `<div>${s}</div>`)
        .join("")
    : '<p class="empty-state">No cards match your search.</p>';
  document.querySelectorAll<HTMLButtonElement>("[data-collection]").forEach(
    (e) =>
      (e.onclick = () => {
        const id = e.dataset.collection as CardId;
        if (editSlot < 0) {
          toast("Choose a card in your deck to replace first.");
          return;
        }
        if (profile.deck.includes(id)) {
          toast("That card is already in your deck.");
          return;
        }
        profile.deck[editSlot] = id;
        profile.decks[profile.activeDeck] = [...profile.deck];
        saveProfile(profile);
        refreshDeck();
        audio.play("button_click_02");
        editSlot = -1;
        renderDeckBuilder();
      }),
  );
}
function showHistory() {
  modal(
    "Your battle log",
    `<div class="history-summary"><div>${icon("swords")}<b>${profile.battles}</b><span>BATTLES</span></div><div>${icon("trophy")}<b>${profile.wins}</b><span>VICTORIES</span></div><div>${icon("crown")}<b>${profile.crowns}</b><span>CROWNS</span></div></div><div class="history-list">${profile.history.length ? profile.history.map((r, i) => `<div class="history-entry"><span class="history-outcome ${r.winner === "blue" ? "win" : "loss"}">${icon(r.winner === "blue" ? "trophy" : r.winner === "draw" ? "equal" : "swords")}</span><div><b>${r.winner === "blue" ? "Victory" : r.winner === "draw" ? "Draw" : "Defeat"} <small>vs ${esc(r.opponent ?? "Royal Trainer")}</small></b><span>${modeNames[r.mode] ?? "Classic 1v1"} · ${new Date(r.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div><strong>${r.crowns[0]} – ${r.crowns[1]}</strong><button class="secondary-button" data-replay="${i}">${icon("play")} Replay</button></div>`).join("") : `<div class="empty-history">${icon("swords")}<h3>Your story starts in the arena.</h3><p>Play a battle to see your results and replays here.</p><button class="primary-button" id="history-battle">Let's battle ${icon("arrow-right")}</button></div>`}</div><p class="modal-footnote">Your latest 10 battles are saved locally, with playable replays.</p>`,
    "history",
    true,
  );
  document
    .querySelectorAll<HTMLButtonElement>("[data-replay]")
    .forEach(
      (e) =>
        (e.onclick = () =>
          playReplay(profile.history[Number(e.dataset.replay)])),
    );
  if (document.querySelector("#history-battle"))
    $("#history-battle").onclick = () => {
      closeModal();
    };
}
function showSettings() {
  modal(
    "Make yourself at home",
    `<form id="settings-form"><label class="field-label" for="player-name">PLAYER NAME</label><input class="name-input" id="player-name" maxlength="18" value="${esc(profile.name)}" required/><div class="setting-row"><div>${icon("volume-2")}<span><b>Sound effects</b><small>Deploys, spells, and a familiar king laugh</small></span></div><label class="switch"><input type="checkbox" id="sound-setting" ${profile.sound ? "checked" : ""}/><span></span></label></div><div class="setting-row"><div>${icon("music-2")}<span><b>Battle music</b><small>The soundtrack to your next victory</small></span></div><label class="switch"><input type="checkbox" id="music-setting" ${profile.music ? "checked" : ""}/><span></span></label></div><div class="setting-row"><div>${icon("maximize")}<span><b>More room for the arena</b><small>Toggle fullscreen mode</small></span></div><button type="button" class="icon-button" id="fullscreen">${icon("expand")}</button></div><div class="save-note">${icon("shield-check")} Progress saves automatically on this browser.</div><button type="submit" class="primary-button">Save settings ${icon("check")}</button></form>`,
    "settings",
  );
  $("#settings-form").onsubmit = (e) => {
    e.preventDefault();
    profile.name =
      ($("#player-name") as HTMLInputElement).value.trim().slice(0, 18) ||
      "Sir Teo";
    profile.sound = ($("#sound-setting") as HTMLInputElement).checked;
    profile.music = ($("#music-setting") as HTMLInputElement).checked;
    audio.setEnabled(profile.sound);
    audio.musicEnabled = profile.music;
    if (screen === "battle" && !paused) audio.startMusic();
    if (!profile.music) audio.stopMusic();
    saveProfile(profile);
    refreshProfile();
    refreshSound();
    closeModal();
    toast("Settings saved.");
  };
  $("#fullscreen").onclick = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else
      void document.documentElement
        .requestFullscreen()
        .catch(() => toast("Fullscreen is unavailable in this browser."));
  };
}
function refreshSound() {
  $(".sound-toggle").innerHTML = icon(profile.sound ? "volume-2" : "volume-x");
  $(".sound-toggle").setAttribute(
    "aria-label",
    profile.sound ? "Mute sound" : "Enable sound",
  );
  refreshIcons();
}
function showHelp() {
  modal(
    "Your first crown starts here.",
    `<div class="help-steps"><div><b>1</b><span><h3>Pick your eight.</h3><p>Your deck has eight unique cards. Four are in your hand; playing one draws the next card.</p></span></div><div><b>2</b><span><h3>Make your move.</h3><p>Select a card and click your half of the arena. Or drag a card straight onto the battlefield. Spells can target anywhere.</p></span></div><div><b>3</b><span><h3>Protect your kingdom.</h3><p>Troops fight automatically. Use tanks to soak up damage, ranged support to back them up, and spells to clear swarms.</p></span></div><div><b>4</b><span><h3>Take the crown.</h3><p>Destroy more towers in three minutes. Ties go to sudden death, then a lowest-tower-health tiebreaker. Destroying the King Tower wins instantly.</p></span></div></div><div class="keyboard-help"><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd> Select card</span><span><kbd>Esc</kbd> Cancel / pause</span><span><kbd>Space</kbd> Pause</span></div><button class="primary-button" id="help-done">Ready for the arena ${icon("swords")}</button>`,
    "help",
  );
  $("#help-done").onclick = closeModal;
}

function updateCombatAudio() {
  combatAudio.update(
    battle.time,
    paused || (multiplayer && !!network.room?.paused),
    new Set(
      battle.entities
        .filter((entity) => entity.hp > 0)
        .map((entity) => entity.id),
    ),
  );
}
function processEvents() {
  combatAudio.consume(battle.audioEvents, battle.seed, battle.time);
  for (const ev of battle.events) {
    if (ev.id <= eventCursor) continue;
    eventCursor = ev.id;
    deathAudio.queue(ev, battle.seed, battle.time);
    if (
      ev.team === "blue" &&
      (ev.type === "deploy" || ev.type === "spell") &&
      ev.card &&
      ev.card !== "tower"
    )
      elixir.spend(
        ev.value ?? CARD_MAP[ev.card].cost,
        ev.time,
        battle.players.blue.elixir,
      );
    if (ev.type === "crown") {
      audio.play("1st_crown_01", 0.35);
    }
    if (ev.type === "finish") {
      deathAudio.reset();
      combatAudio.skip(battle.audioEvents);
    }
    if (ev.type === "finish" && screen === "replay") {
      audio.stopEffects();
      announcements.cue("Gameend Horn");
    }
  }
}

try {
  arena = new Arena($("#arena-canvas"));
  arena.crownTarget = (team) => {
    const target =
      matchHud.target(team) ?? $(`#${team}-crowns`).getBoundingClientRect();
    if (!target.width) return null;
    const host = arena.host.getBoundingClientRect();
    return {
      x: target.left + target.width / 2 - host.left,
      y: target.top + target.height / 2 - host.top,
    };
  };
  arena.onContextLost = () => {
    if (screen !== "lobby" && !paused) togglePause();
    toast("Graphics paused. Reload if the arena does not recover.");
  };
  arena.onCharge = (burst) => {
    if (
      screen === "lobby" ||
      paused ||
      (multiplayer && network.room?.paused) ||
      battle.winner
    )
      return;
    combatAudio.queueCharge(
      burst.seed,
      burst.team,
      battle.time - burst.age,
      burst.age,
    );
    // A slow render may advance match time before the next frame. Flush the
    // newly observed cue with its visible charge animation now.
    updateCombatAudio();
  };
} catch (error) {
  $("#arena-canvas").innerHTML =
    `<div class="webgl-error">${icon("monitor-x")}<h2>We need a little graphics power.</h2><p>Enable hardware acceleration or open this game in a browser with WebGL support.</p></div>`;
  refreshIcons();
  throw error;
}
arena.renderer.domElement.tabIndex = 0;
arena.host.addEventListener("pointermove", (e) => {
  if (!e.isPrimary) return;
  hover = arena.point(e.clientX, e.clientY);
  refreshPlacement();
});
arena.host.addEventListener("pointerleave", () => {
  if (!dragging) {
    hover = null;
    refreshPlacement();
  }
});
arena.host.addEventListener("pointerdown", (e) => {
  if (!e.isPrimary) return;
  if (screen !== "battle" || selected < 0 || paused || pointerDown) return;
  const p = arena.point(e.clientX, e.clientY);
  if (p) deploy(p);
});
document.addEventListener("pointermove", (e) => {
  if (!pointerDown || e.pointerId !== activePointerId) return;
  if (
    !dragging &&
    Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) > 8
  ) {
    dragging = true;
    if (selected !== activeSlot) selectCard(activeSlot);
  }
  if (!dragging) return;
  const id = battle.players.blue.hand[activeSlot];
  $("#drag-card").classList.remove("hidden");
  if ($("#drag-card").dataset.nativeCard !== id) {
    $("#drag-card").innerHTML =
      `<img src="${cardArt(id)}" alt=""/>${nativeCardArt}`;
    $("#drag-card").dataset.nativeCard = id;
    $("#drag-card").dataset.cardVariant = "hand";
    $("#drag-card").classList.remove("native-card-ready");
    nativeCards.draw($("#drag-card"));
  }
  $("#drag-card").style.transform =
    `translate(${e.clientX}px,${e.clientY - 45}px) translate(-50%,-50%)`;
  hover = arena.point(e.clientX, e.clientY);
  if (hover && hover.x >= 0 && hover.x <= 18 && hover.y >= 0 && hover.y <= 32)
    $("#drag-card").classList.add("hidden");
  refreshPlacement();
});
document.addEventListener("pointerup", (e) => {
  if (!pointerDown || e.pointerId !== activePointerId) return;
  const wasDragging = dragging;
  pointerDown = false;
  activePointerId = null;
  dragging = false;
  $("#drag-card").classList.add("hidden");
  if (wasDragging) {
    const rect = arena.host.getBoundingClientRect();
    if (
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    ) {
      const p = arena.point(e.clientX, e.clientY);
      if (p) deploy(p);
    } else {
      hover = null;
      refreshPlacement();
    }
  }
});
function cancelPointer() {
  pointerDown = false;
  activePointerId = null;
  dragging = false;
  hover = null;
  $("#drag-card").classList.add("hidden");
  arena.showPlacement(null, null);
}
document.addEventListener("pointercancel", (e) => {
  if (e.pointerId === activePointerId) cancelPointer();
});
$("#battle-button").onclick = () => startBattle();
$("#friend-button").onclick = () => showMultiplayer();
$(".mode-select").onclick = showModes;
$("#arena-settings").onclick = showSettings;
$("#edit-deck").onclick = showDeckBuilder;
$("#how-to-play").onclick = showHelp;
document
  .querySelectorAll<HTMLButtonElement>("[data-settings]")
  .forEach((e) => (e.onclick = showSettings));
$(".brand").onclick = (e) => {
  e.preventDefault();
  if (screen === "lobby" || battle.winner) lobby();
  else toast("Finish or leave your battle to return home.");
};
document.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach(
  (e) =>
    (e.onclick = () => {
      const nav = e.dataset.nav;
      if (nav === "cards") showDeckBuilder();
      if (nav === "history") {
        if (screen === "battle" && !battle.winner) {
          toast("Finish your battle to view replays.");
          return;
        }
        showHistory();
      }
      if (nav === "battle") {
        if (screen === "lobby") closeModal();
        else if (screen === "replay") lobby();
      }
    }),
);
$(".sound-toggle").onclick = () => {
  profile.sound = !profile.sound;
  audio.setEnabled(profile.sound);
  if (profile.sound && screen === "battle" && !paused) audio.startMusic();
  saveProfile(profile);
  refreshSound();
  audio.play("button_click_02");
};
$("#pause-button").onclick = togglePause;
$("#resume-button").onclick = togglePause;
$("#surrender-button").onclick = () => {
  paused = false;
  $(".pause-cover").classList.add("hidden");
  if (multiplayer) network.send({ type: "surrender" });
  else battle.finish("red", "Surrender");
  updateBattleUI();
};
$("#replay-play").onclick = () => {
  if (replayData && battle.tick >= replayData.duration && replayRecord)
    playReplay(replayRecord);
  else togglePause();
};
$("#replay-speed").onclick = () => {
  speed =
    speed === 1
      ? 2
      : speed === 2
        ? 4
        : speed === 4
          ? 0.5
          : speed === 0.5
            ? 0.25
            : 1;
  audio.setRate(speed);
  $("#replay-speed").textContent = `${speed}×`;
};
$("#replay-exit").onclick = lobby;
$("#replay-seek").addEventListener("input", () => {
  if (!replayData) return;
  resetEnding();
  announcements.reset();
  intro.skip();
  audio.stopEffects();
  const target = Math.floor(
    (Number(($("#replay-seek") as HTMLInputElement).value) / 100) *
      replayData.duration,
  );
  createReplayBattle(replayData);
  for (let i = 0; i < target && !battle.winner; i++) stepReplay();
  arena.setBattle(battle);
  eventCursor = battle.events.at(-1)?.id ?? 0;
  combatAudio.skip(battle.audioEvents);
  elixir.reset(battle.time, battle.players.blue.elixir, battle.multiplier);
  nativeCards.reset(battle.time, battle.players.blue.hand);
  matchHud.reset(arena.effectTime, crownCounts());
  accumulator = 0;
  updateBattleUI(true);
  if (battle.winner) startEnding(true);
});
$("#about-button").onclick = () =>
  modal(
    "Made for the love of the game.",
    `<div class="about-content"><span class="about-crown">${icon("crown")}</span><p>An independent browser fan project. Built with TypeScript and Three.js, with local saves and a deterministic battle simulation.</p><p>This project is not affiliated with, endorsed, sponsored, or specifically approved by Supercell. Clash Royale artwork, audio, and trademarks belong to Supercell.</p><p>Card art, renders, and audio sourced from <a href="https://github.com/RoyaleAPI/cr-api-assets" target="_blank" rel="noreferrer">RoyaleAPI's asset collection</a>. Original troop and building animations, projectile effects and scenery are reconstructed from archived game assets. Surrounding 3D geometry, particles and fallback models were created for this project.</p><small>${CARDS.length} curated cards · Classic rules · Level 11 standard · AI battles<br>Not a live balance replica. Direct browser-to-browser friendly battles over Wi-Fi or compatible remote networks. No official game account connection.</small></div>`,
    "about",
  );
document.addEventListener("keydown", (e) => {
  if (pointerDown) {
    if (e.key === "Escape") {
      cancelPointer();
      selected = -1;
      updateBattleUI();
    }
    return;
  }
  if (e.key === "Escape" && modalKey) {
    e.preventDefault();
    closeModal();
    return;
  }
  if ((e.target as HTMLElement).matches("input,textarea,select")) return;
  if (e.key === "Escape") {
    if (modalKey) {
      closeModal();
      return;
    }
    if (selected >= 0) {
      selected = -1;
      arena.showPlacement(null, null);
      updateBattleUI();
      return;
    }
    togglePause();
  }
  if (modalKey) {
    if (e.key === "Tab") {
      const focusables = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".modal button:not(:disabled),.modal input,.modal a",
        ),
      );
      const first = focusables[0],
        last = focusables.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        last?.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    }
    return;
  }
  if (["1", "2", "3", "4"].includes(e.key)) {
    selectCard(Number(e.key) - 1);
    e.preventDefault();
  }
  if (e.code === "Space" && screen !== "lobby") {
    e.preventDefault();
    togglePause();
  }
});
function suspendFrameLoop() {
  deathAudio.reset();
  combatAudio.skip(battle.audioEvents);
  connectionWarning.suspend();
  cancelPointer();
  emotes.suspend();
  if (!multiplayer && screen !== "lobby" && !paused && !battle.winner)
    togglePause();
  audio.stopMusic();
  audio.stopEffects();
  if (frameHandle !== undefined) cancelAnimationFrame(frameHandle);
  frameHandle = undefined;
  accumulator = 0;
}
function resumeFrameLoop() {
  if (document.hidden || frameHandle !== undefined) return;
  frameTime = performance.now();
  lastRenderTime = lastFpsTime = frameTime;
  fpsFrames = 0;
  accumulator = 0;
  frameHandle = requestAnimationFrame(frame);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) suspendFrameLoop();
  else resumeFrameLoop();
});
window.addEventListener("pagehide", suspendFrameLoop);
window.addEventListener("pageshow", resumeFrameLoop);
window.addEventListener("beforeunload", () => saveProfile(profile));

lobby();
initialized = true;
refreshIcons();
const invitedRoom = new URL(location.href).searchParams.get("room");
if (startupRoomRequested) {
  showMultiplayer();
  flushStartupRoom();
} else if (peerNetwork && peerDraft) {
  showPeerMultiplayer();
} else if (invitedRoom && /^[a-z2-9]{6}$/i.test(invitedRoom)) {
  showMultiplayer(invitedRoom.toUpperCase());
}
if (legacyNetwork && ["localhost", "127.0.0.1"].includes(location.hostname)) {
  void fetch("/api/lan")
    .then((r) => r.json())
    .then((data) => {
      lanOrigin = data.origins?.[0] ?? "";
    })
    .catch(() => {});
}
if (!storageAvailable)
  toast("Browser storage is unavailable. Progress lasts for this session.");
function frame(now: number) {
  frameHandle = undefined;
  if (document.hidden) return;
  const elapsed = (now - frameTime) / 1000;
  const delta = Math.min(0.5, elapsed);
  frameTime = now;
  if (screen !== "lobby" && !paused && !battle.winner) {
    const wasOpening = intro.clock.blocking;
    accumulator += intro.clock.advance(
      multiplayer && network.room?.paused ? 0 : delta * speed,
    );
    if (wasOpening && !intro.clock.blocking) {
      announcements.cue("match start");
      updateBattleUI(true);
    }
    let ticks = 0;
    while (!multiplayer && accumulator >= STEP && ticks < 15) {
      if (
        screen === "replay" &&
        replayData &&
        battle.tick >= replayData.duration
      )
        break;
      if (screen === "replay") stepReplay();
      else battle.step();
      accumulator -= STEP;
      ticks++;
    }
    if (ticks === 15 || multiplayer) accumulator = 0;
    if (!multiplayer) processEvents();
  }
  if (multiplayer) processEvents();
  const presentationPaused = paused || (multiplayer && !!network.room?.paused);
  if (presentationPaused && !soundPaused) audio.stopEffects();
  soundPaused = presentationPaused;
  if (screen !== "lobby" && !battle.winner) {
    updateCombatAudio();
    deathAudio.update(battle.time, presentationPaused);
  }
  const idle = screen === "lobby" || presentationPaused || !!battle.winner;
  if (!idle || now - lastRenderTime >= 1000 / 30 - 0.5) {
    const renderElapsed = Math.max(0, (now - lastRenderTime) / 1000);
    const renderDelta = Math.min(renderElapsed, 0.1);
    lastRenderTime = now;
    animationTime = screen === "lobby" ? now / 1000 : battle.time;
    arena.render(
      screen === "lobby" || battle.winner
        ? renderDelta
        : presentationPaused
          ? 0
          : renderDelta * speed,
      animationTime,
      screen === "lobby" || battle.winner
        ? renderElapsed
        : presentationPaused
          ? 0
          : renderElapsed * speed,
    );
    frameCount++;
    fpsFrames++;
    if (now - lastFpsTime >= 1000) {
      fps = Math.round((fpsFrames * 1000) / (now - lastFpsTime));
      fpsFrames = 0;
      lastFpsTime = now;
    }
  }
  if (now - lastUi > 90 && screen !== "lobby") {
    updateBattleUI();
    if (multiplayer) updateConnection();
    lastUi = now;
  }
  announcements.update(battle, screen !== "lobby");
  intro.update(screen !== "lobby" && !battle.winner);
  if (screen !== "lobby") {
    nativeCards.updateHand($("#hand"), battle.time);
    // Crown feedback and its flights share one continuous clock through victory.
    // Switching from match time here would reset the final award after a seek.
    matchHud.update(battle, crownCounts(), arena.effectTime);
  }
  if (screen !== "lobby")
    elixir.update(
      battle.time,
      battle.players.blue.elixir,
      battle.multiplier,
      selected >= 0
        ? battle.cardCost("blue", battle.players.blue.hand[selected])
        : null,
    );
  if (screen === "replay" && battle.winner) startEnding();
  ending.update(
    Math.max(0, arena.effectTime - endingFrameTime),
    !!pendingResult && arena.effectTime >= pendingResult.time,
  );
  endingFrameTime = arena.effectTime;
  connectionWarning.update(now / 1000);
  emotes.update(
    paused ? 0 : delta,
    screen === "battle" &&
      !paused &&
      !battle.winner &&
      !intro.clock.blocking &&
      (!multiplayer || network.connected),
  );
  if (pendingResult) {
    if (pendingResult.battle !== battle || screen !== "battle")
      pendingResult = null;
    else if (arena.effectTime >= pendingResult.time && ending.clock.finished) {
      const show = pendingResult.show;
      pendingResult = null;
      show();
    }
  }
  frameHandle = requestAnimationFrame(frame);
}
resumeFrameLoop();
// A read-only diagnostics surface for browser checks and performance inspection.
Object.defineProperty(window, "__arena", {
  value: {
    get state() {
      return {
        screen,
        paused,
        selected,
        time: battle.time,
        rulesVersion: battle.rulesVersion,
        winner: battle.winner,
        reason: battle.reason,
        loadedEmotes: emotes.loaded,
        emotes: emotes.state,
        elixir: battle.players.blue.elixir,
        hand: [...battle.players.blue.hand],
        lastPlayed: battle.players.blue.lastPlayed ?? null,
        handCosts: battle.players.blue.hand.map((id) =>
          battle.cardCost("blue", id),
        ),
        troops: battle.entities.filter((e) => e.kind === "troop").length,
        actions: multiplayer ? network.actionCount : battle.actions.length,
        multiplayer: multiplayer
          ? {
              team: network.team,
              code: network.room?.code,
              connected: network.connected,
              phase: network.room?.phase,
              latency: network.latency,
              transport: network.transport,
            }
          : null,
        units: battle.entities.map((e) => ({
          id: e.id,
          team: e.team,
          x: e.x,
          y: e.y,
          hp: e.hp,
          card: e.card,
        })),
        fps,
        renderedFrames: frameCount,
        animationTime,
        frameLoopRunning: frameHandle !== undefined,
        drawCalls: arena.renderer.info.render.calls,
        loadedEffects: arena.loadedEffects,
        projectileArtwork: arena.projectileState,
        infernoBeams: arena.infernoBeamState,
        loadedAnnouncements: announcements.loaded,
        loadedIntros: intro.loaded,
        loadedElixir: elixir.loaded,
        loadedCards: nativeCards.loaded,
        loadedHealth: arena.loadedHealth,
        loadedHud: matchHud.loaded,
        loadedConnectionWarnings: connectionWarning.loaded,
        connectionWarning: connectionWarning.state,
        loadedEndings: ending.loaded,
        ending: ending.state,
        hud: matchHud.state,
        health: arena.healthState,
        intro: intro.state,
        announcement: announcements.state,
        loadedBuildings: arena.loadedBuildings,
        destruction: arena.destructionState,
        chargeFilter: arena.chargeFilterState,
        deployFilter: arena.deployFilterState,
        coldFilter: arena.coldFilterState,
        coldStructures: arena.coldStructureState,
        freezeAreas: arena.freezeAreaState,
        poisonAreas: arena.poisonAreaState,
        poisonFilter: arena.poisonFilterState,
        rageAreas: arena.rageAreaState,
        tornadoAreas: arena.tornadoAreaState,
        graveyardAreas: arena.graveyardAreaState,
        cloneAreas: arena.cloneAreaState,
        cloneFilter: arena.cloneFilterState,
        graveyardBirths: battle.events.filter(
          (event) => event.effect === "graveyard-appear",
        ).length,
        lightningAreas: battle.areas
          .filter((area) => area.card === "lightning")
          .map((area) => ({
            team: area.team,
            x: area.x,
            y: area.y,
            remaining: area.remaining,
            struck: area.struck?.length ?? 0,
          })),
        lightningHits: battle.events.filter(
          (event) => event.type === "hit" && event.card === "lightning",
        ).length,
        rageFilter: arena.rageFilterState,
        poisonStructures: arena.poisonStructureState,
        shake: arena.shakeState,
        placement: arena.placementState,
        loadedAnimations: arena.loadedAnimations,
        nativeTowerPrincesses: arena.nativeTowerPrincesses,
        nativePrincessTowers: arena.nativePrincessTowers,
        crownFlights: arena.crownState,
      };
    },
    project: (x: number, y: number) => {
      const p = arena.screen(x, y),
        r = arena.host.getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    },
    pick: (x: number, y: number) => arena.point(x, y),
  },
  writable: false,
});

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const install = () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => {});
  };
  if (document.readyState === "complete") install();
  else window.addEventListener("load", install, { once: true });
}
