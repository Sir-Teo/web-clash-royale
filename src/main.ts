import "./ui/battle-controls.css";
import { exportFileName } from "./game/export-name";
import { NativeConnectionWarning } from "./ui/connection";
import { OfflineUpdates } from "./ui/offline-updates";
import { ModalFocus } from "./ui/modal-focus";
import { cardDetails } from "./ui/card-details";
import { DeckEditHistory, copyDeckSelection } from "./ui/deck-edit-history";
import { collectionCards } from "./ui/card-collection";
import type { CollectionKind, CollectionOrder } from "./ui/card-collection";
import { historyMatches, type HistoryQuery } from "./ui/battle-history";
import "@fontsource/lilita-one/latin-400.css";
import "@fontsource/nunito-sans/latin-400.css";
import "@fontsource/nunito-sans/latin-600.css";
import "@fontsource/nunito-sans/latin-700.css";
import "@fontsource/nunito-sans/latin-800.css";
import "./style.css";
import "./ui/keyboard-deployment.css";
import {
  DEFAULT_KEYBOARD_TARGET,
  moveKeyboardTarget,
} from "./ui/keyboard-deployment";
import "./ui/match-details.css";
import "./ui/practice-opponents.css";
import "./ui/battle-history.css";
import "./ui/replay-files.css";
import "./ui/replay-controls.css";
import "./ui/deck-codes.css";
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
  Copy,
  History,
  Coins,
  Volume2,
  VolumeX,
  Shield,
  Pencil,
  Trophy,
  LockKeyhole,
  HardDriveDownload,
  Upload,
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
  ArrowLeftRight,
  ExternalLink,
  X,
  PackageOpen,
  Plus,
  Check,
  RotateCcw,
  RotateCw,
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
  Copy,
  History,
  Coins,
  Volume2,
  VolumeX,
  Shield,
  Pencil,
  Trophy,
  LockKeyhole,
  HardDriveDownload,
  Upload,
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
  ArrowLeftRight,
  ExternalLink,
  X,
  PackageOpen,
  Plus,
  Check,
  RotateCcw,
  RotateCw,
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
import {
  completeRecordedReplay,
  replayComplete,
} from "./game/replay-completion";
import { Battle, STEP } from "./game/engine";
import { createReplayPlayback } from "./replay-playback";
import { ReplaySeekQueue } from "./ui/replay-seek-queue";
import {
  continuedPracticeChoices,
  practiceDeckChoices,
  practiceOpponents,
  practiceRoster,
  swapPracticeDecks,
} from "./ui/practice-opponents";
import { latestPracticeRecord, practiceResults } from "./ui/practice-results";
import { replayView } from "./ui/replay-view";
import {
  buildReplayPlays,
  adjacentReplayPlay,
  type ReplayPlay,
} from "./ui/replay-plays";
import {
  SOLO_OPPONENTS,
  previousSoloOpponent,
  soloOpponent,
} from "./game/opponents";
import {
  recordedDecks,
  recordedPractice,
  restoreDeckSelection,
  useRecordedDeck,
  useDeck,
  isActiveDeck,
  type PracticeOpponent,
  type PracticeSourceDeck,
} from "./game/match-decks";
import {
  decodeDeckCode,
  encodeDeckCode,
  MAX_DECK_CODE_BYTES,
} from "./game/deck-code";
import type { DeckSelection } from "./game/match-decks";
import type { Mode, Point, Replay } from "./game/engine";
import { CARDS, CARD_MAP, PRESETS, averageCost, cardArt } from "./game/cards";
import type { CardId } from "./game/cards";
import {
  loadProfile,
  readSavedProfile,
  PROFILE_STORAGE_KEY,
  applySettingsDraft,
  saveProfile as persistProfile,
  saveBattleResult,
  saveEmotePreference,
  refreshProfileForDeckEdit,
  markTutorialSeen,
  claimSavedChest,
  saveSoundPreference,
  selectSavedDeck,
  storageAvailable,
  exportProgress,
  importProgress,
  MAX_BACKUP_BYTES,
} from "./game/profile";
import {
  exportReplayFile,
  replayFileName,
  importReplayFile,
  MAX_REPLAY_BYTES,
  type SharedReplay,
} from "./game/replay-file";
import type { Profile, RecordEntry } from "./game/profile";
import { GameAudio } from "./game/audio";
import { NativeDeathAudio } from "./game/death-audio";
import { NativeCombatAudio } from "./game/combat-audio";
import { DeploymentFeedback } from "./ui/deployment-feedback";
import { setAttribute, setText } from "./ui/dom";

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
function saveProfile(value: Profile) {
  persistProfile(value);
  peerNetwork?.updatePlayer({ name: value.name, deck: value.deck });
}
let battlePlayerName = profile.name;
const deathAudio = new NativeDeathAudio(audio);
const combatAudio = new NativeCombatAudio(audio);
const deploymentFeedback = new DeploymentFeedback();
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
let practiceMatch: PracticeOpponent | null = null;
let practiceOpponentIndex = 0;
let practiceOpponentSearch = "";
let practiceDeckChoice: string | null = null;
let practicePreviousDeck: PracticeSourceDeck | undefined;
let practiceSetupBack: { label: string; restore: () => void } | null = null;
let practiceMode: Mode = "training";
let repeatPracticeOpening = true;
let practiceSpeed = 1;
let arena: Arena;
let battle: Battle;
let screen: "lobby" | "battle" | "replay" = "lobby";
let mode: Mode = "classic";
let selected = -1;
let paused = false;
let fullscreenPending = false;
let graphicsAvailable = true;
let soundPaused = false;
let modalPausedBattle = false;
let speed = 1;
let accumulator = 0;
let frameTime = performance.now();
let frameHandle: number | undefined;
let lastRenderTime = frameTime;
let renderedBattle: Battle | undefined;
let renderedTick = -1;
let renderedFrozen = false;
let lastFpsTime = frameTime;
let fpsFrames = 0;
let animationTime = 0;
let eventCursor = 0;
let resultShown = false;
let pendingResult: { battle: Battle; time: number; show: () => void } | null =
  null;
let replayData: Replay | null = null;
let replayRecord: RecordEntry | null = null;
let replayOwnerName: string | null = null;
let replayRecordedName: string | null = null;
let replayOpponentView = false;
let replayReturn: { restore: () => void; label: string } | null = null;
let replayPlays: ReplayPlay[] = [];
const replaySeeks = new ReplaySeekQueue((tick) => seekReplay(tick));
let replayScrubPointer: number | null = null;
let lastUi = 0;
let hover: Point | null = null;
let keyboardTarget: Point | null = null;
let keyboardAiming = false;
let modalKey = "";
let editSlot = -1;
let filter: CollectionKind = "all";
let search = "";
let collectionCost: number | "all" = "all";
let collectionOrder: CollectionOrder = "collection";
const historyQuery: HistoryQuery = {
  search: "",
  result: "all",
  mode: "all",
  type: "all",
};
let historyReturn: {
  records: RecordEntry[];
  panel: number;
  list: number;
  focus: string;
} | null = null;
// Rows belong to their builder grid, including during a read-only inspection.
const collectionRows = new WeakMap<HTMLElement, Map<CardId, HTMLDivElement>>();
const deckEdits = new DeckEditHistory();
let deckEditNotice = "";
const deckPreviewConflictNotice = "Saved decks changed in another tab. Review the current selection before changing decks.";
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
   <div class="top-actions"><div class="gold-wallet" title="Gold earned from battles and chests"><span class="coin">${icon("coins")}</span><b id="gold">${fmt(profile.gold)}</b><span class="wallet-label">GOLD</span></div><button class="icon-button sound-toggle" aria-label="Toggle sound effects" aria-keyshortcuts="m" title="Sound effects (M)">${icon(profile.sound ? "volume-2" : "volume-x")}</button><button class="avatar" data-settings aria-label="Player settings">T<span></span></button></div>
  </header>
  <div class="workspace">
   <aside class="left-sidebar">
    <section class="player-card"><div class="player-insignia">${icon("shield")}<span>1</span></div><div><span class="eyebrow">YOUR KINGDOM</span><h2 class="player-name">${esc(profile.name)}</h2><span class="player-status"><i></i> Ready for battle</span></div><button class="small-icon" data-settings aria-label="Edit profile">${icon("pencil")}</button></section>
    <section class="journey panel"><div class="section-heading"><h3>Trophy road</h3>${icon("trophy")}</div><div class="trophy-total">${icon("trophy")}<b id="trophies">${fmt(profile.trophies)}</b><span>TROPHIES</span></div><div class="road-line"><span id="road-progress"></span><b>1</b><b>2</b></div><div class="road-caption"><span>Goblin Stadium</span><b id="road-count">0 / 300</b></div><div class="next-arena"><img src="${import.meta.env.BASE_URL}assets/arenas/arena2.png" alt="Bone Pit arena"/><div><small>NEXT MILESTONE</small><b>Bone Pit</b><span>300 trophies</span></div>${icon("lock-keyhole")}</div></section>
    <section class="feature-card"><div class="feature-glow"></div><span class="eyebrow">A CROWN IS EARNED</span><h3>Small cards.<br>Big plays.</h3><p>Every elixir counts.<br>Make your next move matter.</p><img src="${import.meta.env.BASE_URL}assets/characters/knight.png" alt="Knight raising his sword"/><span class="feature-mark">${icon("swords")}</span></section>
    <div class="local-save">${icon("hard-drive-download")}<div><b>YOUR PROGRESS, SAVED</b><span>Stored on this browser</span></div><i></i></div>
   </aside>
   <main class="arena-panel">
    <div class="arena-heading"><div><span class="eyebrow">ARENA 1</span><h1>Goblin Stadium</h1></div><button class="mode-select">${icon("swords")}<span id="mode-name">Classic 1v1</span>${icon("chevron-down")}</button><button class="icon-button hidden" id="replay-side" aria-label="View opponent side" aria-pressed="false" aria-controls="arena-canvas" title="View opponent side">${icon("arrow-left-right")}</button><button class="icon-button" id="arena-settings" aria-label="Battle settings">${icon("settings-2")}</button></div>
    <div class="arena-stage" id="arena-stage"><div class="arena-vignette"></div><div class="arena-canvas" id="arena-canvas"></div><p class="keyboard-deployment-a11y" id="keyboard-deployment-instructions">Battle controls: keys 1 through 4 select a card. Arrow keys aim in half-tile steps. Hold Shift for two-tile steps. Enter deploys. Escape cancels a selection or pauses. Space pauses. M toggles sound effects. Tab leaves the battlefield.</p><p class="keyboard-deployment-a11y" id="keyboard-deployment-status" role="status" aria-live="polite" aria-atomic="true"></p>
     <div class="arena-corner top-left"></div><div class="arena-corner bottom-right"></div>
     <div class="lobby-badge"><span class="live-dot"></span> THE ARENA IS YOURS</div>
     <div class="lobby-bottom"><div class="battle-button-wrap"><span class="battle-flare"></span><button id="battle-button" class="battle-button">${icon("swords")} BATTLE ${icon("chevron-right")}</button></div><button id="friend-button" class="friend-button">${icon("users")} Play with a friend</button><span class="battle-caption">${icon("shield-check")} Level 11 cards <span>·</span> Offline AI opponent</span></div>
     <div class="match-top hidden"><div class="competitor enemy"><span class="mini-shield red">${icon("shield")}</span><div><b>Royal Trainer</b><span>Training guild</span></div></div><div class="match-timer"><span id="phase-label">TIME LEFT</span><b id="match-clock">3:00</b></div></div>
     <div class="match-crowns hidden"><div class="red">${icon("crown")}<b id="red-crowns">0</b></div><span>:</span><div class="blue"><b id="blue-crowns">0</b>${icon("crown")}</div></div>
     <div class="match-bottom hidden"><div class="competitor"><span class="mini-shield blue">${icon("shield")}</span><div><b class="player-name">${esc(profile.name)}</b><span>Browser kingdom</span></div></div><div class="battle-tools"><button id="battle-sound-button" class="small-icon" aria-label="${profile.sound ? "Mute sound effects" : "Enable sound effects"}" aria-keyshortcuts="m" title="Sound effects (M)">${icon(profile.sound ? "volume-2" : "volume-x")}</button><button id="emote-button" class="small-icon" aria-label="King emotes">${icon("smile")}</button><button id="pause-button" class="small-icon" aria-label="Pause battle">${icon("pause")}</button></div></div>
     <div id="connection-status" class="connection-status hidden" role="status"></div><div id="deploy-hint" class="deploy-hint hidden">Select a card to deploy</div>
     <div class="battle-announcements hidden" id="battle-announcements" role="img" aria-label="Battle announcement"></div>
     <div class="battle-intro hidden" id="battle-intro" role="img" aria-label="Battle introduction"></div>
     <section class="battle-ending hidden" id="battle-ending" aria-label="Battle ended"></section>
     <div id="emote-layer"></div><div id="connection-warning"></div><p id="graphics-warning" class="graphics-warning" role="status" aria-live="polite" aria-atomic="true" hidden></p>
    </div>
    <div id="lobby-footer" class="chest-tray"><div class="chest-heading"><span>VICTORY CHESTS</span><b id="chest-count">0 / 4</b></div><div class="chest-slots" id="chest-slots"></div></div>
    <div id="battle-tray" class="battle-tray hidden"><div class="hand-row"><div class="next-card"><span>NEXT</span><div class="next-card-picture" data-native-card="" data-card-variant="thumbnail"><img id="next-card-img" alt="Next card"/>${nativeCardArt}</div><div class="native-next-cost" data-native-card="" data-card-variant="cost"><b id="next-card-cost"></b>${nativeCardArt}</div></div><div class="hand" id="hand"></div></div><div class="elixir-row">${elixirMarkup}</div><div class="tray-caption"><span id="hand-caption">Select a card, then tap your side of the arena</span><span><kbd>1</kbd>–<kbd>4</kbd> SELECT</span></div></div>
    <div class="replay-controls hidden" role="group" aria-label="Replay controls"><div class="replay-position"><span id="replay-clock">0:00 / 0:00</span><input id="replay-seek" aria-label="Replay timeline" aria-describedby="replay-keyboard-help" type="range" min="0" max="100" step="0.01" value="0"/></div><div class="replay-actions"><button id="replay-back" class="icon-button replay-jump" aria-label="Back 10 seconds" title="Back 10 seconds (Left arrow)">${icon("rotate-ccw")}<span>10</span></button><button id="replay-play" class="icon-button" aria-label="Pause replay">${icon("pause")}</button><button id="replay-forward" class="icon-button replay-jump" aria-label="Forward 10 seconds" title="Forward 10 seconds (Right arrow)">${icon("rotate-cw")}<span>10</span></button><button id="replay-speed" class="text-button" aria-label="Playback speed: 1×">1×</button><label class="text-button replay-plays" title="Jump to a recorded card play"><span aria-hidden="true">Plays</span><select id="replay-plays" aria-label="Card plays"><option value="">No recorded plays</option></select></label><button id="replay-exit" class="text-button">Exit</button></div><span id="replay-keyboard-help" class="sr-only">Outside controls: Left or Right arrow skips ten seconds; hold Shift for one-second steps. Home goes to the beginning and End to the end. Square brackets jump to the previous or next card play. Minus slows playback; Plus or Equals speeds it up. M toggles sound effects. Space pauses, resumes or restarts a completed replay. Keys 1 through 4 inspect hand cards. Tab to a hand card and press Enter or Space to inspect its current stats.</span></div>
   </main>
   <aside class="right-sidebar"><section class="deck-panel panel"><div class="section-heading"><div><span class="eyebrow">YOUR WINNING EIGHT</span><h3>Battle deck</h3></div><span class="deck-number">01</span></div><div class="deck-tabs" id="deck-tabs"></div><div class="deck-grid" id="deck-preview"></div><div class="deck-summary"><span><i class="tiny-drop"></i> Average elixir <b id="average-elixir">3.5</b></span><span>8 / 8</span></div><button id="edit-deck" class="secondary-button">${icon("layers-2")} Edit deck ${icon("arrow-up-right")}</button></section>
    <section class="battle-brief panel"><div class="section-heading"><h3>Battle brief</h3>${icon("scroll-text")}</div><div class="brief-item"><span>${icon("crown")}</span><div><b>Take the crown</b><p>Destroy more towers. Take the King Tower for an instant win.</p></div></div><div class="brief-item"><span class="purple">${icon("droplet")}</span><div><b>Spend wisely</b><p>Elixir refills over time. Save some to defend your side.</p></div></div><div class="brief-item"><span class="blue">${icon("timer")}</span><div><b>Three minutes. One winner.</b><p>Tied? Two-minute sudden death. Elixir speeds up as time runs out.</p></div></div><button id="how-to-play" class="text-button">How to play ${icon("arrow-right")}</button></section>
   </aside>
  </div>
  <footer class="app-footer"><span><i></i> BUILT FOR THE BROWSER. MADE FOR THE CROWN.</span><button id="about-button">Independent fan project ${icon("external-link")}</button><span class="fps-label">WEB ARENA · v0.1</span></footer>
 </div><div id="modal-root"></div><div class="toast" id="toast" role="status"></div><div id="drag-card" class="drag-card hidden"></div>`;

const nativeCards = new NativeCards();
const updateHost = document.createElement("aside");
updateHost.className = "offline-update";
updateHost.setAttribute("role", "status");
updateHost.setAttribute("aria-label", "Game update");
document.body.append(updateHost);
const modalFocus = new ModalFocus(
  $("#modal-root"),
  [$(".app-shell"), updateHost],
  () => $("#battle-button"),
);
const offlineUpdates = new OfflineUpdates(
  updateHost,
  () => screen === "lobby" && !modalKey && !network.room,
  (busy) => {
    $("#app").inert = busy;
  },
);
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
  saveEmotePreference(profile, muted);
  applyProfilePreferences();
  refreshProfile();
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
  const player =
    screen === "battle" ? battlePlayerName : (replayOwnerName ?? profile.name);
  ending.start(endResult(battle, player, opponentName), hold);
}
$(".match-timer").append($("#elixir-rate"));
announcements.onCue = (file, volume) => {
  if (graphicsAvailable) audio.play(file, volume);
};

function refreshIcons() {
  nativeCards.hydrate();
  createIcons({ icons, attrs: { "stroke-width": 1.8 } });
}
function toast(message: string, announce = true) {
  $("#toast").setAttribute("aria-hidden", String(!announce));
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(
    () => $("#toast").classList.remove("visible"),
    3000,
  );
}
function syncGraphicsStatus() {
  const warning = $("#graphics-warning");
  const message =
    screen === "lobby"
      ? "Graphics interrupted. Waiting for the arena to recover. Reload if it does not recover."
      : multiplayer && !peerNetwork
        ? "Graphics interrupted. Online battle continues. Recover graphics or surrender."
        : "Graphics interrupted. Battle paused while the arena recovers. Reload if it does not recover.";
  if (warning.hidden !== graphicsAvailable) warning.hidden = graphicsAvailable;
  if (warning.textContent !== message) warning.textContent = message;
  const battleButton = $<HTMLButtonElement>("#battle-button");
  if (battleButton.disabled !== !graphicsAvailable)
    battleButton.disabled = !graphicsAvailable;
  const replaySide = $<HTMLButtonElement>("#replay-side");
  if (replaySide.disabled !== !graphicsAvailable)
    replaySide.disabled = !graphicsAvailable;
  const ready = document.querySelector<HTMLButtonElement>("#room-ready");
  if (ready && !graphicsAvailable && !ready.disabled) ready.disabled = true;
  const resume = document.querySelector<HTMLButtonElement>("#resume-button");
  const restart = document.querySelector<HTMLButtonElement>("#restart-practice");
  if (restart && restart.disabled !== !graphicsAvailable)
    restart.disabled = !graphicsAvailable;
  if (resume) {
    if (resume.disabled !== !graphicsAvailable)
      resume.disabled = !graphicsAvailable;
    let note = document.querySelector<HTMLElement>("#graphics-pause-note");
    if (!graphicsAvailable && !note) {
      note = document.createElement("p");
      note.id = "graphics-pause-note";
      note.className = "room-note";
      note.setAttribute("role", "status");
      resume.after(note);
    }
    if (note) {
      const text = graphicsAvailable
        ? "Graphics restored. Resume when ready."
        : message;
      if (note.textContent !== text) note.textContent = text;
    }
  }
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
  modalFocus.render(key, () => {
    $("#modal-root").innerHTML =
      `<div class="modal-backdrop"><section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-heading"><div><span class="eyebrow">BROWSER ARENA</span><h2 id="modal-title">${title}</h2></div><button class="icon-button close-modal" aria-label="Close dialog">${icon("x")}</button></div>${body}</section></div>`;
  });
  refreshIcons();
  $(".close-modal").addEventListener("click", closeModal);
  $(".modal-backdrop").addEventListener("click", (e) => {
    if (e.target === $(".modal-backdrop")) closeModal();
  });
  syncGraphicsStatus();
}
function closeModal() {
  const wasResult = modalKey === "result";
  const wasPause = modalKey === "pause";
  modalKey = "";
  if (screen === "lobby") {
    practiceSetupBack = null;
    queueMicrotask(syncIdleProfile);
  }
  modalFocus.close();
  if (modalPausedBattle || wasPause) {
    modalPausedBattle = false;
    paused = false;
    accumulator = 0;
    if (graphicsAvailable && screen !== "lobby" && !battle.winner)
      audio.startMusic(battle.time);
  }
  if (wasResult && screen === "battle" && battle.winner) {
    lobby();
    return;
  }
  if (screen === "battle" && !paused)
    arena.renderer.domElement.focus({ preventScroll: true });
}
function returnToModal(opener: HTMLElement) {
  const key = modalKey;
  const view = $("#modal-root").firstElementChild!;
  const panel = view.querySelector<HTMLElement>(".modal")!;
  const scroll = panel.scrollTop;
  return () => {
    modalKey = key;
    modalFocus.render(key, () => $("#modal-root").replaceChildren(view));
    nativeCards.hydrate(view);
    syncGraphicsStatus();
    panel.scrollTop = scroll;
    opener.focus({ preventScroll: true });
  };
}
function refreshProfile() {
  $("#gold").textContent = fmt(profile.gold);
  $("#trophies").textContent = fmt(profile.trophies);
  document
    .querySelectorAll(".player-name")
    .forEach(
      (e) =>
        (e.textContent = e.closest(".match-bottom")
          ? screen === "replay"
            ? (replayOwnerName ?? profile.name)
            : screen === "battle"
              ? battlePlayerName
              : profile.name
          : profile.name),
    );
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
function applyProfilePreferences() {
  audio.setEnabled(profile.sound);
  audio.musicEnabled = profile.music;
  emotes.setMuted(profile.emotesMuted, false);
  refreshSound();
}
function syncIdleProfile() {
  if (
    !initialized ||
    screen !== "lobby" ||
    modalKey ||
    network.room ||
    !storageAvailable
  )
    return;
  const saved = readSavedProfile();
  if (!saved || JSON.stringify(saved) === JSON.stringify(profile)) return;
  const active =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const attribute = ["data-deck", "data-card-info", "data-chest"].find((name) =>
    active?.hasAttribute(name),
  );
  const selector = active?.id
    ? `#${CSS.escape(active.id)}`
    : attribute
      ? `[${attribute}="${CSS.escape(active!.getAttribute(attribute)!)}"]`
      : null;
  Object.assign(profile, saved);
  applyProfilePreferences();
  refreshProfile();
  if (active && !active.isConnected) {
    const replacement = selector
      ? document.querySelector<HTMLElement>(selector)
      : null;
    (replacement ?? $("#battle-button")).focus({ preventScroll: true });
  }
}
function refreshDeck() {
  $("#deck-tabs").innerHTML =
    profile.decks
      .map(
        (_, i) =>
          `<button class="${i === profile.activeDeck ? "active" : ""}" data-deck="${i}" ${screen !== "lobby" ? "disabled" : ""}>${i + 1}</button>`,
      )
      .join("") +
    `<span>${PRESETS.find((preset) => profile.deck.every((id) => preset.deck.includes(id)))?.name ?? "Custom deck"}</span>`;
  document.querySelectorAll<HTMLButtonElement>("[data-deck]").forEach(
    (e) =>
      (e.onclick = () => {
        if (screen !== "lobby") return;
        if (!selectSavedDeck(profile, Number(e.dataset.deck))) return;
        peerNetwork?.updatePlayer({ name: profile.name, deck: profile.deck });
        applyProfilePreferences();
        refreshProfile();
        $(`[data-deck="${profile.activeDeck}"]`).focus({ preventScroll: true });
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
  const result = claimSavedChest(profile, index);
  applyProfilePreferences();
  refreshProfile();
  if (result.status === "changed") {
    toast("Chest slots changed in another tab. Choose a current chest.");
    return;
  }
  const reward = result.reward;
  if (!reward) return;
  audio.play("gold_chest_open_01");
  modal(
    "Victory tastes golden.",
    `<div class="chest-reward"><div class="reward-rays"></div><img class="reward-chest" src="${import.meta.env.BASE_URL}assets/chests/${reward.type}.png" alt="Opened ${reward.type} chest"/><h3>${reward.type} chest</h3><p>A little something for your next victory.</p><div class="reward-items"><span>${icon("coins")}<b>+${reward.gold}</b><small>GOLD</small></span><span>${icon("crown")}<b>Well played!</b><small>REWARD CLAIMED</small></span></div><button class="primary-button" id="claim-done">Collect rewards ${icon("check")}</button></div>`,
    "chest",
  );
  $("#claim-done").onclick = closeModal;
}

function lobby() {
  enterLobby(false);
}
function enterLobby(keepPeerConnection: boolean) {
  cancelReplaySeeks();
  deploymentFeedback.reset();
  practiceMatch = null;
  practiceDeckChoice = null;
  practicePreviousDeck = undefined;
  practiceOpponentSearch = "";
  clearKeyboardAim(true);
  resetEnding();
  if (!keepPeerConnection && initialized && (network.room || multiplayer))
    network.leave();
  multiplayer = false;
  networkBattleCode = "";
  networkReplay = undefined;
  replaySource = null;
  $("#connection-status").classList.add("hidden");
  $("#pause-button").setAttribute("aria-label", "Pause battle");
  screen = "lobby";
  syncKeyboardArena();
  selected = -1;
  paused = false;
  speed = 1;
  audio.setRate(speed);
  $(".match-bottom .competitor div > span").textContent = "Browser kingdom";
  resultShown = false;
  replayData = null;
  replayRecord = null;
  replayOwnerName = null;
  replayRecordedName = null;
  replayOpponentView = false;
  replayReturn = null;
  practiceSetupBack = null;
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
  $(".replay-controls").classList.add("hidden");
  $("#replay-side").classList.add("hidden");
  document
    .querySelectorAll(".match-top,.match-bottom,.match-crowns")
    .forEach((e) => e.classList.add("hidden"));
  $("#deploy-hint").classList.add("hidden");
  $(".mode-select").classList.remove("hidden");
  refreshProfile();
}
function startBattle(
  online = false,
  practice: PracticeOpponent | null = null,
  openingSeed?: number,
) {
  if (!online && !graphicsAvailable) {
    toast("Wait for the arena graphics to recover before starting a battle.");
    return;
  }
  cancelReplaySeeks();
  deploymentFeedback.reset();
  clearKeyboardAim(true);
  replayOwnerName = null;
  replayRecordedName = null;
  replayOpponentView = false;
  replayReturn = null;
  practiceSetupBack = null;
  const loadout = online ? peerNetwork?.loadout : null;
  battlePlayerName = online
    ? (loadout?.name ??
      network.room?.players.find((p) => p.team === network.team)?.name ??
      profile.name)
    : profile.name;
  $(".match-bottom .player-name").textContent = battlePlayerName;
  resetEnding();
  if (!online) network.leave();
  multiplayer = online;
  networkReplay = undefined;
  replaySource = null;
  closeModal();
  practiceMatch =
    !online && practice
      ? {
          ...practice,
          deck: [...practice.deck],
          playerDeck: [...(practice.playerDeck ?? profile.deck)],
          ...(practice.selection
            ? {
                selection: {
                  ...practice.selection,
                  ...(practice.selection.previousDeck
                    ? {
                        previousDeck: {
                          ...practice.selection.previousDeck,
                          deck: [...practice.selection.previousDeck.deck],
                        },
                      }
                    : {}),
                },
              }
            : {}),
        }
      : null;
  screen = "battle";
  paused = false;
  speed = practiceMatch ? practiceSpeed : 1;
  audio.setRate(speed);
  syncPracticeSpeedCaption();
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
  const seed = openingSeed ?? Math.floor(Math.random() * 2147483646) + 1;
  const opponent = online
    ? undefined
    : (practiceMatch ??
      soloOpponent(seed, mode, previousSoloOpponent(profile.history)));
  battle = new Battle({
    deck: loadout?.deck ?? practiceMatch?.playerDeck ?? profile.deck,
    enemyDeck: opponent?.deck,
    mode: online ? (network.room?.mode ?? mode) : (practiceMatch?.mode ?? mode),
    ai: !online,
    seed,
  });
  arena.setBattle(battle);
  opponentName = online
    ? (network.room?.players.find((p) => p.team !== network.team)?.name ??
      "Opponent")
    : opponent!.name;
  $(".competitor.enemy b").textContent = opponentName;
  $(".competitor.enemy div > span").textContent = online
    ? "Friendly battle"
    : practiceMatch
      ? `${practiceMatch.style} · ${modeNames[practiceMatch.mode]} · Practice AI`
      : `${opponent!.style} · AI opponent`;
  $("#pause-button").setAttribute(
    "aria-label",
    online ? "Battle options" : "Pause battle",
  );
  $("#connection-status").classList.toggle("hidden", !online);
  $(".lobby-badge").classList.add("hidden");
  $(".lobby-bottom").classList.add("hidden");
  $("#lobby-footer").classList.add("hidden");
  $("#battle-tray").classList.remove("hidden");
  $("#hand-caption").textContent =
    "Select a card, then tap your side of the arena";
  document
    .querySelectorAll(".match-top,.match-bottom,.match-crowns")
    .forEach((e) => e.classList.remove("hidden"));
  $(".mode-select").classList.add("hidden");
  $("#deploy-hint").classList.remove("hidden");
  $(".replay-controls").classList.add("hidden");
  $("#replay-side").classList.add("hidden");
  refreshDeck();
  intro.start(battlePlayerName, battle.mode, opponentName);
  elixir.reset(battle.time, battle.players.blue.elixir, battle.multiplier);
  nativeCards.reset(battle.time, battle.players.blue.hand);
  matchHud.reset(arena.effectTime, crownCounts());
  updateBattleUI(true);
  if (!profile.seenTutorial) {
    markTutorialSeen(profile);
    applyProfilePreferences();
    refreshProfile();
  }
  if (graphicsAvailable) audio.startMusic(battle.time);
}
let lastHand = "";
function updateBattleUI(force = false) {
  refreshPlacement();
  syncKeyboardArena();
  const timer = battleClock(battle);
  const text = (selector: string, value: string) => {
    setText($(selector), value);
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
    const hand = $("#hand");
    // Forced cost/selection refreshes still retain unchanged slots and artwork.
    const template = document.createElement("template");
    p.hand.forEach((id, i) => {
      const previous = hand.children.item(i) as HTMLButtonElement | null;
      if (previous?.dataset.nativeCard === id) return;
      template.innerHTML = cardHTML(
        id, `data-slot="${i}" aria-keyshortcuts="${i + 1}"`,
        `hand-card ${selected === i ? "selected" : ""}`,
      );
      const e = template.content.firstElementChild as HTMLButtonElement;
      if (previous) previous.replaceWith(e);
      else hand.append(e);
      e.addEventListener("click", (event) => {
        if (screen === "replay") {
          inspectReplayCard(Number(e.dataset.slot));
          return;
        }
        if (event.detail === 0 && screen === "battle" && !paused)
          selectCard(Number(e.dataset.slot), true);
      });
      e.addEventListener("pointerdown", (event) => {
        if (
          !graphicsAvailable ||
          screen !== "battle" ||
          paused ||
          intro.clock.blocking
        )
          return;
        if (!event.isPrimary || pointerDown) return;
        clearKeyboardAim();
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
  setAttribute($("#next-card-img"), "src", cardArt(next.id));
  setAttribute($("#next-card-img"), "alt", `Next card: ${next.name}`);
  text("#next-card-cost", String(battle.cardCost("blue", next.id) ?? "?"));
  document
    .querySelectorAll<HTMLElement>(".next-card [data-native-card]")
    .forEach((e) => {
      setAttribute(e, "data-native-card", next.id);
      setAttribute(e, "data-card-cost",
        String(battle.cardCost("blue", next.id) ?? "?"));
      setAttribute(e, "data-mirror-card",
        next.id === "mirror" ? (p.lastPlayed ?? "") : "");
      nativeCards.draw(e);
    });
  document.querySelectorAll<HTMLElement>("[data-slot]").forEach((e, i) => {
    const id = p.hand[i];
    const cost = battle.cardCost("blue", id);
    setAttribute(e, "data-card-cost", String(cost ?? "?"));
    setAttribute(e, "data-mirror-card",
      id === "mirror" ? (p.lastPlayed ?? "") : "");
    setText(e.querySelector<HTMLElement>(".cost")!, String(cost ?? "?"));
    setAttribute(
      e,
      "aria-label",
      `${screen === "replay" ? "Inspect " : ""}${CARD_MAP[id].name}, ${cost ?? "unknown"} elixir${id === "mirror" && p.lastPlayed ? `, repeats ${CARD_MAP[p.lastPlayed].name}` : ""}`,
    );
    const disabled =
      !graphicsAvailable ||
      (screen !== "replay" &&
        (intro.clock.blocking ||
          cost === null ||
          (multiplayer &&
            (!network.connected || network.pending || !!network.room?.paused))));
    if ((e as HTMLButtonElement).disabled !== disabled)
      (e as HTMLButtonElement).disabled = disabled;
    e.classList.toggle("unaffordable", cost === null || cost > p.elixir);
    e.classList.toggle("selected", selected === i);
    if (screen === "replay") e.removeAttribute("aria-pressed");
    else setAttribute(e, "aria-pressed", String(selected === i));
  });
  nativeCards.updateHand($("#hand"), battle.time);
  if (screen === "replay" && replayData) {
    text("#hand-caption", "Tap a hand card or press 1–4 to inspect");
    const position = `${clock(battle.time)} / ${clock(replayData.duration * STEP)}`;
    text("#replay-clock", position);
    setAttribute(
      $("#replay-seek"),
      "aria-valuetext",
      `${clock(battle.time)} of ${clock(replayData.duration * STEP)}${replayComplete(battle, replayData) ? ", replay complete" : ""}`,
    );
    ($("#replay-seek") as HTMLInputElement).value = String(
      replayComplete(battle, replayData)
        ? 100
        : (battle.tick / Math.max(1, replayData.duration)) * 100,
    );
  }
  if (screen === "battle" && battle.winner && !resultShown) showResult();
  if (screen === "replay" && replayData && replayComplete(battle, replayData)) {
    paused = true;
    if (
      replayRecord &&
      completeRecordedReplay(
        replaySource ?? battle,
        replayRecord.replay,
        replayRecord.winner,
      )
    ) {
      if (replaySource) applySnapshot(battle, snapshot(replaySource), "red");
      if (!force) {
        audio.stopEffects();
        announcements.cue("Gameend Horn");
      }
    }
  }
  if (screen === "replay") syncReplayControl();
}
function syncKeyboardArena() {
  const canvas = arena.renderer.domElement;
  const live = screen === "battle" && !battle.winner;
  const replay = screen === "replay";
  setAttribute(canvas, "role", live || replay ? "application" : "img");
  setAttribute(
    canvas,
    "aria-label",
    replay
      ? "Battle replay arena."
      : live
        ? "Battle arena. Select a card to deploy."
        : screen === "battle"
          ? "Completed battle arena."
          : "Goblin Stadium arena preview.",
  );
  if (live || replay) {
    setAttribute(
      canvas,
      "aria-describedby",
      replay ? "replay-keyboard-help" : "keyboard-deployment-instructions",
    );
    setAttribute(
      canvas,
      "aria-keyshortcuts",
      replay
        ? "1 2 3 4 ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight Home End [ ] - = Shift+= m Space"
        : "1 2 3 4 ArrowUp ArrowDown ArrowLeft ArrowRight Enter Escape m Space",
    );
  } else {
    for (const attribute of ["aria-describedby", "aria-keyshortcuts"])
      if (canvas.hasAttribute(attribute)) canvas.removeAttribute(attribute);
  }
}
function clearKeyboardAim(reset = false) {
  if (keyboardAiming) hover = null;
  keyboardAiming = false;
  if (reset) keyboardTarget = null;
  $("#keyboard-deployment-status").textContent = "";
}
function beginKeyboardAim() {
  keyboardAiming = true;
  keyboardTarget = { ...(keyboardTarget ?? DEFAULT_KEYBOARD_TARGET) };
  hover = { ...keyboardTarget };
}
function placementHint(id: CardId) {
  if (id === "log") return "Deploy on your side";
  if (id === "miner") return "Deploy on either half";
  return CARD_MAP[id].kind === "spell"
    ? "Target anywhere"
    : "Deploy on your side or opened territory";
}
function selectCard(slot: number, keyboard = false) {
  if (
    !graphicsAvailable ||
    screen !== "battle" ||
    paused ||
    battle.winner ||
    intro.clock.blocking
  )
    return;
  selected = selected === slot ? -1 : slot;
  clearKeyboardAim();
  if (keyboard && selected >= 0) {
    beginKeyboardAim();
    arena.renderer.domElement.focus({ preventScroll: true });
  }
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
        : `${id === "mirror" ? `Mirror → ${c.name}` : c.name} · ${cost} elixir · ${placementHint(c.id)}`;
    $("#deploy-hint").textContent =
      cost === null
        ? "Play another card before Mirror"
        : `${c.name} · ${placementHint(c.id)}`;
    refreshPlacement();
  }
  updateBattleUI();
}
function refreshPlacement() {
  if (
    !graphicsAvailable ||
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
  const c = CARD_MAP[id];
  const playedCard = CARD_MAP[repeated ?? id];
  const name =
    id === "mirror" && repeated ? `Mirror → ${playedCard.name}` : c.name;
  const caption = `${name} · ${cost ?? "?"} elixir · ${keyboardAiming ? "Arrows aim · Shift moves farther · Enter deploys" : placementHint(playedCard.id)}`;
  if ($("#hand-caption").textContent !== caption)
    $("#hand-caption").textContent = caption;
  if (keyboardAiming && hover) {
    const message = `${name}, ${cost ?? "unknown"} elixir. Target column ${Number(hover.x.toFixed(1))}, row ${Number(hover.y.toFixed(1))}. ${!place.ok ? place.reason : !affordable ? `You need ${cost} elixir.` : "Placement valid. Enter deploys."}`;
    if ($("#keyboard-deployment-status").textContent !== message)
      $("#keyboard-deployment-status").textContent = message;
  }
  arena.showPlacement(
    repeated ?? id,
    hover,
    place.ok && affordable,
    !place.ok ? place.reason : !affordable ? `You need ${cost} elixir` : "",
  );
}
function deploy(point: Point) {
  if (
    !graphicsAvailable ||
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
    const fromKeyboard = keyboardAiming;
    clearKeyboardAim();
    if (multiplayer || fromKeyboard)
      $("#keyboard-deployment-status").textContent = multiplayer
        ? deploymentFeedback.submit(network.playSequence, id)
        : `${CARD_MAP[id].name} deployed.`;
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
    if (paused) {
      audio.stopMusic();
      showBattlePause();
    } else closeModal();
  } else {
    syncReplayControl();
    if (paused) audio.stopMusic();
    else if (graphicsAvailable && !battle.winner) audio.startMusic(battle.time);
  }
}
function practiceSpeedHTML() {
  const options = [
    [0.5, "0.5× · Slow motion"],
    [1, "1× · Normal speed"],
    [2, "2× · Fast practice"],
  ] as const;
  return `<label class="practice-choice" for="practice-speed">Practice speed<span><select id="practice-speed" aria-describedby="practice-speed-note">${options.map(([value, label]) => `<option value="${value}" ${practiceSpeed === value ? "selected" : ""}>${label}</option>`).join("")}</select>${icon("chevron-down")}</span></label><p class="room-note" id="practice-speed-note">Slow down to study placements or speed up a retry. Your choice stays selected for this session.</p>`;
}
function bindPracticeSpeed() {
  const select = document.querySelector<HTMLSelectElement>("#practice-speed");
  if (!select) return;
  select.onchange = () => {
    const value = Number(select.value);
    if (![0.5, 1, 2].includes(value)) return;
    practiceSpeed = value;
    if (screen === "battle" && practiceMatch && !multiplayer) {
      speed = value;
      audio.setRate(speed);
      accumulator = 0;
      syncPracticeSpeedCaption();
    }
  };
}
function syncPracticeSpeedCaption() {
  $(".match-bottom .competitor div > span").textContent = practiceMatch
    ? `Practice · ${practiceSpeed}× speed`
    : "Browser kingdom";
}
function showBattlePause() {
  // All pause subviews share the same resume behavior when closed.
  modalPausedBattle = true;
  modal(
    "Battle paused",
    `<div class="pause-actions"><button class="primary-button" id="resume-button">${icon("play")} Resume battle</button>${practiceMatch ? `${practiceSpeedHTML()}<label class="practice-choice" for="practice-opening">Opening shuffle<span><select id="practice-opening" aria-describedby="practice-restart-note"><option value="repeat" ${repeatPracticeOpening ? "selected" : ""}>Repeat opening shuffle</option><option value="fresh" ${repeatPracticeOpening ? "" : "selected"}>Fresh opening shuffle</option></select>${icon("chevron-down")}</span></label><button class="secondary-button" id="restart-practice" aria-describedby="practice-restart-note">${icon("rotate-ccw")} Restart practice</button><button class="secondary-button" id="change-paused-practice" aria-describedby="practice-restart-note">${icon("target")} Change practice matchup</button><p class="room-note" id="practice-restart-note">Restart with the same decks and pace, or change the matchup. This attempt won’t be saved.</p>` : ""}<button class="secondary-button" id="inspect-battle-deck">${icon("layers-2")} Inspect battle deck</button><button class="text-button" id="surrender-button">Leave battle</button></div>`,
    "pause",
  );
  $(".modal-backdrop").classList.add("pause-cover");
  $("#resume-button").onclick = closeModal;
  $("#inspect-battle-deck").onclick = () => showBattleDeck();
  if (practiceMatch) {
    const practice = practiceMatch;
    bindPracticeSpeed();
    $("#change-paused-practice").onclick = () =>
      changePracticeMatchup(practice);
    $("#practice-opening").onchange = () => {
      repeatPracticeOpening =
        $<HTMLSelectElement>("#practice-opening").value === "repeat";
    };
    $("#restart-practice").onclick = () =>
      startBattle(
        false,
        practice,
        repeatPracticeOpening ? battle.seed : undefined,
      );
  }
  $("#surrender-button").onclick = () => {
    battle.finish("red", "Surrender");
    closeModal();
    updateBattleUI();
  };
  $(graphicsAvailable ? "#resume-button" : "#surrender-button").focus();
}
function showBattleDeck(side: "yours" | "opponent" = "yours") {
  if (screen !== "battle" || multiplayer || !paused || battle.winner) return;
  const opponent = side === "opponent" && !!practiceMatch;
  const deck = opponent ? battle.enemyDeck : battle.deck;
  const title = opponent ? "Opponent practice deck" : "Your battle deck";
  modal(
    title,
    `<p class="room-note">${practiceMatch ? "The starting cards captured for this practice." : "Your starting cards for this battle."} Inspecting them leaves the battle paused.</p>${practiceMatch ? `<label class="practice-choice" for="battle-inspect-side">Deck to inspect<span><select id="battle-inspect-side"><option value="yours" ${opponent ? "" : "selected"}>Your battle deck</option><option value="opponent" ${opponent ? "selected" : ""}>Opponent practice deck</option></select>${icon("chevron-down")}</span></label>` : ""}<section class="match-deck-panel" aria-label="${opponent ? "Opponent starting practice deck" : "Your starting battle deck"}"><div class="match-deck-heading"><h3>${esc(opponent ? opponentName : battlePlayerName)}</h3><span><i class="tiny-drop"></i> ${averageCost(deck).toFixed(1)} average</span></div>${deckCompositionHTML(deck)}<div class="match-deck-grid">${deck.map((id, index) => cardHTML(id, `data-battle-card="${index}"`)).join("")}</div></section><div class="match-details-actions"><button class="text-button" id="battle-deck-code">${icon("copy")} Share deck code</button><button class="secondary-button" id="battle-deck-back">${icon("arrow-right")} Back to pause menu</button></div>`,
    "battle-deck",
  );
  $("#battle-deck-back").onclick = showBattlePause;
  const share = $("#battle-deck-code");
  share.onclick = () => showDeckCode(deck, title, returnToModal(share));
  const select = document.querySelector<HTMLSelectElement>(
    "#battle-inspect-side",
  );
  if (select)
    select.onchange = () => {
      if (select.value === "yours" || select.value === "opponent")
        showBattleDeck(select.value);
    };
  document
    .querySelectorAll<HTMLButtonElement>("[data-battle-card]")
    .forEach((button) => {
      button.onclick = () =>
        showCard(
          deck[Number(button.dataset.battleCard)],
          returnToModal(button),
          "Back to battle deck",
        );
    });
}

function showDeckCode(
  deck: readonly CardId[],
  title: string,
  onBack: () => void,
  backLabel = "Back to deck inspection",
) {
  modal(
    `${title} code`,
    `<div class="deck-codes"><p id="battle-code-note">Share these eight cards. Paste the code into Cards → Deck codes to preview or try them.</p><label class="field-label" for="battle-deck-code-value">Deck code</label><textarea class="name-input deck-code-text" id="battle-deck-code-value" readonly rows="4" spellcheck="false" aria-describedby="battle-code-note">${esc(encodeDeckCode(deck))}</textarea><button class="secondary-button" id="copy-battle-deck-code">Copy deck code</button><p id="battle-code-status" role="status" aria-live="polite"></p><div class="deck-code-footer"><button class="text-button" id="battle-code-back">${esc(backLabel)}</button></div></div>`,
    "battle-deck-code",
  );
  const field = $<HTMLTextAreaElement>("#battle-deck-code-value");
  const copy = $("#copy-battle-deck-code");
  copy.onclick = async () => {
    const copied = await copyTextValue(field);
    if (document.querySelector("#battle-deck-code-value") !== field) return;
    $("#battle-code-status").textContent = copied
      ? "Deck code copied."
      : "Select and copy the code above.";
    if (copied) copy.focus();
  };
  $("#battle-code-back").onclick = onBack;
}
function deckCompositionHTML(deck: readonly CardId[]) {
  const counts = { troop: 0, spell: 0, building: 0 };
  for (const id of deck) counts[CARD_MAP[id].kind]++;
  return `<p class="deck-composition">${Object.entries(counts).map(([kind, count]) => `${count} ${kind}${count === 1 ? "" : "s"}`).join(" · ")}</p>`;
}
function deckCodeButton(side: "yours" | "opponent") {
  return `<button class="text-button" data-share-deck-code="${side}" aria-label="Share ${side === "yours" ? "player" : "opponent"} deck code">${icon("copy")} Share deck code</button>`;
}
function bindDeckCodeButtons(
  decks: Record<"yours" | "opponent", readonly CardId[]>,
  backLabel: string,
) {
  document
    .querySelectorAll<HTMLButtonElement>("[data-share-deck-code]")
    .forEach((button) => {
      const side = button.dataset.shareDeckCode;
      if (side !== "yours" && side !== "opponent") return;
      button.onclick = () =>
        showDeckCode(
          decks[side],
          side === "yours" ? "Player deck" : "Opponent deck",
          returnToModal(button),
          backLabel,
        );
    });
}
function syncReplayControl() {
  const action =
    replayData && replayComplete(battle, replayData)
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
  const completedMatchId = networkBattleCode;
  const completedPractice = practiceMatch;
  resultShown = true;
  audio.stopMusic();
  audio.stopEffects();
  if (graphicsAvailable) announcements.cue("Gameend Horn");
  const wasMultiplayer = multiplayer;
  const reward = saveBattleResult(
      profile,
      battle,
      wasMultiplayer
        ? {
            friendly: true,
            playerName: battlePlayerName,
            opponent: opponentName,
            opponentType: "friend",
            matchId: networkBattleCode,
            replay: networkReplay
              ? { ...networkReplay, perspective: network.team }
              : undefined,
          }
        : {
            practice: !!completedPractice,
            playerName: battlePlayerName,
            opponent: opponentName,
            opponentType: "ai",
          },
    ),
    win = battle.winner === "blue",
    draw = battle.winner === "draw";
  applyProfilePreferences();
  refreshProfile();
  arena.showPlacement(null, null);
  $("#deploy-hint").classList.add("hidden");
  pendingResult = {
    battle: completedBattle,
    time: arena.effectTime + 1.4,
    show: () => {
      if (screen !== "battle" || battle !== completedBattle) return;
      ending.reset();
      if (graphicsAvailable)
        audio.play(win ? "win_tour_01" : "lose_tour_01", 0.45);
      modal(
        draw
          ? "A worthy battle."
          : win
            ? "Victory is yours!"
            : "A crown to chase.",
        `<div class="result-content ${win ? "victory" : "defeat"}"><div class="result-crown">${icon("crown")}</div><span class="eyebrow">${esc(battle.reason)}</span><div class="result-score"><span class="blue">${icon("crown")} ${battle.players.blue.crowns}</span><b>–</b><span class="red">${battle.players.red.crowns} ${icon("crown")}</span></div><p>${win ? "Your kingdom stands tall. Well played." : draw ? "An even battle. A rematch awaits." : "Every great king learns from a battle."}</p><div class="result-rewards"><div>${icon("trophy")}<b>${reward.trophies > 0 ? "+" : ""}${reward.trophies}</b><small>TROPHIES</small></div><div>${icon("coins")}<b>+${reward.gold}</b><small>GOLD</small></div>${reward.chest ? `<div><img src="${import.meta.env.BASE_URL}assets/chests/${reward.chest}.png" alt="${reward.chest} chest"/><b>+1</b><small>${reward.chest.toUpperCase()} CHEST</small></div>` : ""}</div>${completedPractice ? `<p class="practice-result-note">Practice AI · no trophies or rewards</p>` : ""}${wasMultiplayer && peerNetwork ? `<p id="rematch-status" role="status"></p>` : ""}<button class="primary-button" id="rematch">${icon("swords")} ${completedPractice ? "Practice again" : "Battle again"}</button>${completedPractice ? `<button class="secondary-button practice-change-matchup" id="change-practice-matchup">${icon("target")} Change practice matchup</button>` : ""}<div class="result-links"><button class="text-button" id="watch-replay">${icon("play")} Watch replay</button><button class="text-button" id="return-home">Back to arena ${icon("arrow-right")}</button></div></div>`,
        "result",
      );
      if (wasMultiplayer)
        $(".result-rewards").innerHTML =
          "<p>Friendly battle · no trophies or rewards</p>";
      $("#rematch").onclick = () => {
        if (wasMultiplayer) {
          const peer = peerNetwork;
          if (
            peer?.connected &&
            peer.room?.phase === "finished" &&
            peer.room.players.every((p) => p.connected)
          ) {
            peer.send({
              type: "rematch",
              matchId: completedMatchId,
              ready: !peer.room.players.find((p) => p.team === peer.team)
                ?.rematch,
            });
          } else {
            lobby();
            showMultiplayer();
          }
        } else startBattle(false, completedPractice);
      };
      syncPeerRematch();
      if (completedPractice)
        $("#change-practice-matchup").onclick = () =>
          changePracticeMatchup(completedPractice);
      $("#return-home").onclick = lobby;
      $("#watch-replay").onclick = () => playReplay(profile.history[0]);
    },
  };
}
function syncPeerRematch() {
  const peer = peerNetwork;
  if (!peer || !multiplayer || modalKey !== "result") return;
  const status = document.querySelector<HTMLElement>("#rematch-status");
  if (!status) return;
  const own = peer.room?.players.find((p) => p.team === peer.team);
  const friend = peer.room?.players.find((p) => p.team !== peer.team);
  const connected = peer.connected && friend?.connected !== false;
  const label = !connected
    ? "Create a new invite"
    : own?.rematch
      ? "Cancel rematch request"
      : "Play again with friend";
  const message = !connected
    ? "Your friend disconnected. Create a new invite to play again."
    : own?.rematch
      ? `Waiting for ${friend?.name ?? "your friend"} to play again.`
      : friend?.rematch
        ? `${friend.name} wants another battle.`
        : "Both players must agree. You can change decks before the next battle.";
  const button = $("#rematch");
  if (button.textContent !== label) button.textContent = label;
  if (status.textContent !== message) status.textContent = message;
}
function playReplay(
  record: RecordEntry,
  ownerName?: string,
  opponentView = false,
  playbackSpeed = 1,
) {
  if (!graphicsAvailable) {
    toast("Wait for the arena graphics to recover before watching a replay.");
    return;
  }
  const returnTo =
    screen === "replay" && replayRecord === record ? replayReturn : null;
  cancelReplaySeeks();
  deploymentFeedback.reset();
  clearKeyboardAim(true);
  const playerName = ownerName ?? record.playerName ?? profile.name;
  resetEnding();
  if (network.room) network.leave();
  multiplayer = false;
  $("#connection-status").classList.add("hidden");
  $(".competitor.enemy div > span").textContent = record.practice
    ? "Practice AI replay"
    : record.opponentType === "ai"
      ? "AI battle replay"
      : record.opponent
        ? "Friendly battle replay"
        : "Training guild";
  closeModal();
  screen = "replay";
  replayRecord = record;
  replayReturn = returnTo;
  const replay = setReplayView(record, playerName, opponentView);
  resultShown = true;
  paused = false;
  $(".match-bottom .competitor div > span").textContent = "Replay";
  setReplaySpeed(playbackSpeed);
  audio.stopEffects();
  announcements.reset();
  selected = -1;
  accumulator = 0;
  eventCursor = 0;
  document.body.classList.add("in-battle", "in-replay");
  window.scrollTo(0, 0);
  createReplayBattle(replay);
  arena.setBattle(battle);
  arena.showPlacement(null, null);
  $(".lobby-badge").classList.add("hidden");
  $(".lobby-bottom").classList.add("hidden");
  $("#lobby-footer").classList.add("hidden");
  $("#battle-tray").classList.remove("hidden");
  document
    .querySelectorAll(".match-top,.match-bottom,.match-crowns")
    .forEach((e) => e.classList.remove("hidden"));
  $(".mode-select").classList.add("hidden");
  $("#deploy-hint").classList.add("hidden");
  $(".replay-controls").classList.remove("hidden");
  $("#replay-side").classList.remove("hidden");
  syncReplayExit();
  syncReplayControl();
  refreshDeck();
  intro.start(replayOwnerName ?? profile.name, battle.mode, opponentName);
  elixir.reset(battle.time, battle.players.blue.elixir, battle.multiplier);
  nativeCards.reset(battle.time, battle.players.blue.hand);
  matchHud.reset(arena.effectTime, crownCounts());
  updateBattleUI(true);
  audio.startMusic(battle.time);
  refreshIcons();
}
function watchPreviewReplay(
  record: RecordEntry,
  opener: HTMLElement,
  label: string,
  ownerName?: string,
) {
  const restore = screen === "lobby" ? returnToModal(opener) : null;
  playReplay(record, ownerName);
  if (restore && screen === "replay" && replayRecord === record) {
    replayReturn = { restore, label };
    syncReplayExit();
  }
}
function setReplaySpeed(value: number) {
  speed = value;
  audio.setRate(speed);
  const button = $("#replay-speed");
  button.textContent = `${speed}×`;
  const label = `Playback speed: ${speed}×`;
  button.setAttribute("aria-label", label);
  button.title = `${label}. Minus: slower; Plus or Equals: faster.`;
}
function syncReplayExit() {
  const label = replayReturn?.label ?? "Exit";
  const button = $("#replay-exit");
  button.textContent = replayReturn ? "Back" : "Exit";
  button.setAttribute("aria-label", label);
  button.title = label;
}

function inspectReplayCard(slot: number) {
  if (screen !== "replay" || !graphicsAvailable || modalKey) return;
  replaySeeks.flush();
  const id = battle.players.blue.hand[slot];
  if (!id) return;
  // A seek can replace this slot. Retain focus on its current button.
  ($("#hand").children.item(slot) as HTMLElement | null)?.focus({
    preventScroll: true,
  });
  showCard(id, closeModal, "Back to replay");
}
function setReplayView(
  record: RecordEntry,
  playerName: string,
  opponentView: boolean,
) {
  const view = replayView(record, playerName, opponentView);
  replayRecordedName = playerName;
  replayOpponentView = opponentView;
  replayOwnerName = view.playerName;
  opponentName = view.opponentName;
  replayData = view.replay;
  $(".match-bottom .player-name").textContent = view.playerName;
  $(".competitor.enemy b").textContent = view.opponentName;
  $("#replay-side").setAttribute("aria-pressed", String(opponentView));
  $("#replay-side").setAttribute(
    "title",
    opponentView ? "View recorded player side" : "View opponent side",
  );
  replayPlays = buildReplayPlays(view.replay);
  const plays = $<HTMLSelectElement>("#replay-plays");
  plays.replaceChildren(
    new Option(replayPlays.length ? "Jump to a play" : "No recorded plays", ""),
    ...replayPlays.map((play) => new Option(play.label, String(play.tick))),
  );
  plays.disabled = replayPlays.length === 0;
  plays.parentElement!.toggleAttribute("data-empty", plays.disabled);
  return view.replay;
}
function createReplayBattle(replay: Replay, targetTick = 0) {
  const playback = createReplayPlayback(replay, targetTick);
  battle = playback.battle;
  replaySource = playback.source;
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
function legacyCopyValue(value: string) {
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
async function copyTextValue(field: HTMLTextAreaElement) {
  if (navigator.clipboard?.writeText)
    try {
      await navigator.clipboard.writeText(field.value);
      return true;
    } catch {
      // Some browsers expose the API but reject it on an HTTP LAN origin.
    }
  // A delayed permission rejection must not move focus out of a newer view.
  if (!field.isConnected) return false;
  if (legacyCopyValue(field.value)) return true;
  field.focus();
  field.select();
  return false;
}
function showPeerMultiplayer() {
  const peer = peerNetwork!;
  const room = peer.room;
  const loadout = peer.loadout;
  const footnote =
    '<p class="modal-footnote">Keep both game tabs open. Battles pause when either player switches apps. Some remote networks block direct play; try the same Wi-Fi if connecting fails.</p>';
  let content = "";
  if (room) {
    content = `<div class="room-banner">${icon("swords")}<span>${modeNames[room.mode]} · Level 11</span></div><p class="room-note">Connected directly. Deck or name changes clear both Ready checks.</p><div class="room-players">${room.players.map((p) => `<div class="room-player ${p.team}">${icon("shield")}<div><b>${esc(p.name)}</b><span>${p.ready ? "Ready for battle" : "Preparing deck"}</span></div>${icon(p.ready ? "check" : "swords")}</div>`).join("")}</div>${loadout ? `<section class="room-deck" data-peer-deck="${loadout.deck.join(",")}" aria-label="Your confirmed battle deck"><h3>Your battle deck</h3><div class="match-deck-grid">${loadout.deck.map((id) => cardHTML(id, `data-peer-card="${id}"`)).join("")}</div></section>` : ""}<button id="room-ready" class="primary-button" ${!peer.connected ? "disabled" : ""}>${room.players.find((p) => p.team === peer.team)?.ready ? "Cancel ready" : "Ready for battle"}</button>`;
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
    .querySelectorAll<HTMLButtonElement>("[data-peer-card]")
    .forEach((button) => {
      button.onclick = () =>
        showCard(
          button.dataset.peerCard as CardId,
          showPeerMultiplayer,
          "Back to friend lobby",
        );
    });
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
        (await copyTextValue(field))
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
    ?.addEventListener("click", () => {
      const ready = !peer.room?.players.find((p) => p.team === peer.team)
        ?.ready;
      if (ready && !graphicsAvailable) return;
      if (ready && !peer.updatePlayer(player())) {
        roomError =
          "Could not confirm your deck. Check your name and connection, then try Ready again.";
        showPeerMultiplayer();
        return;
      }
      roomError = "";
      peer.send({ type: "ready", ready });
    });
}
// Room packets can arrive while a friend presses Ready. Keep the button node
// and its click listener in place so a simultaneous status update cannot drop
// that press between pointer-down and click (notably across Chrome/WebKit).
function refreshPeerRoom() {
  const peer = peerNetwork;
  const room = peer?.room;
  const ready = document.querySelector<HTMLButtonElement>("#room-ready");
  const list = document.querySelector<HTMLElement>(".room-players");
  if (!peer || !room || !ready || !list) return false;
  const rows = room.players.map((player) => ({
    player,
    row: list.querySelector<HTMLElement>(`.room-player.${player.team}`),
  }));
  if (rows.some(({ row }) => !row)) return false;
  for (const { player, row } of rows) {
    const name = row!.querySelector<HTMLElement>("b");
    const status = row!.querySelector<HTMLElement>("div > span");
    const symbol = row!.lastElementChild;
    if (!name || !status || !symbol) return false;
    name.textContent = player.name;
    status.textContent = player.ready ? "Ready for battle" : "Preparing deck";
    symbol.outerHTML = icon(player.ready ? "check" : "swords");
  }
  ready.textContent = room.players.find((player) => player.team === peer.team)
    ?.ready
    ? "Cancel ready"
    : "Ready for battle";
  ready.disabled = !graphicsAvailable || !peer.connected;
  const deck = document.querySelector<HTMLElement>(".room-deck");
  const loadout = peer.loadout;
  if (loadout && deck && deck.dataset.peerDeck !== loadout.deck.join(",")) {
    deck.dataset.peerDeck = loadout.deck.join(",");
    deck.querySelector<HTMLElement>(".match-deck-grid")!.innerHTML =
      loadout.deck.map((id) => cardHTML(id, `data-peer-card="${id}"`)).join("");
    deck
      .querySelectorAll<HTMLButtonElement>("[data-peer-card]")
      .forEach((button) => {
        button.onclick = () =>
          showCard(
            button.dataset.peerCard as CardId,
            showPeerMultiplayer,
            "Back to friend lobby",
          );
      });
  }
  refreshIcons();
  syncGraphicsStatus();
  return true;
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
  if (multiplayer) {
    updateConnection();
    syncPeerRematch();
  } else if (modalKey === "room") {
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
    if (
      peerNetwork &&
      screen === "battle" &&
      battle.winner &&
      message.room.phase === "waiting" &&
      message.room.matchId !== networkBattleCode
    ) {
      enterLobby(true);
      showMultiplayer();
    }
    syncPeerRematch();
    if (screen === "lobby" && message.room.phase === "waiting")
      peerNetwork?.updatePlayer({ name: profile.name, deck: profile.deck });
    if (screen === "lobby" && modalKey === "room" && !refreshPeerRoom())
      showMultiplayer();
    if (multiplayer) updateConnection();
  }
  if (message.type === "state") {
    const matchId = message.matchId ?? network.room?.code;
    const joining = networkBattleCode !== matchId || !multiplayer;
    if (joining) {
      networkBattleCode = matchId!;
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
    if (graphicsAvailable && !document.hidden && !battle.winner) {
      // Consume before another state replaces this snapshot or a graphics frame
      // delays presentation. The independent audio cursor prevents duplicates.
      combatAudio.consume(battle.audioEvents, battle.seed, battle.time);
      updateCombatAudio();
    }
  }
  if (message.type === "ack") {
    const receipt = deploymentFeedback.acknowledge(message);
    const status = $("#keyboard-deployment-status");
    const ownsStatus =
      !!receipt &&
      multiplayer &&
      screen === "battle" &&
      !battle.winner &&
      status.textContent === receipt.submitted;
    if (ownsStatus) status.textContent = receipt!.announcement;
    if (!message.ok)
      toast(receipt?.announcement ?? message.reason, !ownsStatus);
  }
  if (message.type === "error") {
    roomError = message.message;
    if (multiplayer) {
      if (message.fatal) {
        lobby();
        showMultiplayer();
      } else toast(message.message);
    } else if (modalKey === "room") showMultiplayer();
  }
  if (
    message.type === "emote" &&
    graphicsAvailable &&
    screen === "battle" &&
    !battle.winner
  )
    emotes.show(
      message.team === network.team ? "blue" : "red",
      message.kind ?? "laugh",
    );
  if (
    message.type === "quick-chat" &&
    graphicsAvailable &&
    screen === "battle" &&
    !battle.winner
  )
    emotes.show(message.team === network.team ? "blue" : "red", message.phrase);
};

function showModes() {
  if (screen !== "lobby") return;
  modal(
    "Choose your battle",
    `<div class="mode-list">${(["classic", "double", "training"] as Mode[]).map((m) => `<button class="mode-option ${m === mode ? "chosen" : ""}" data-mode="${m}"><span class="mode-icon">${icon(m === "double" ? "droplet" : m === "training" ? "target" : "swords")}</span><div><h3>${modeNames[m]}</h3><p>${m === "classic" ? "The classic arena experience. Earn trophies and victory chests." : m === "double" ? "Double elixir from the start. Bigger pushes, faster battles." : "A relaxed AI opponent. Practice new cards without risking trophies."}</p></div>${icon(m === mode ? "circle-check" : "chevron-right")}</button>`).join("")}<button class="mode-option" id="choose-practice-opponent" aria-label="Choose a practice opponent"><span class="mode-icon">${icon("layers-2")}</span><div><h3>Practice a deck</h3><p>Choose from ${SOLO_OPPONENTS.length} opponents and inspect their starting cards.</p></div>${icon("chevron-right")}</button></div>`,
    "modes",
  );
  $("#choose-practice-opponent").onclick = showPracticeOpponents;
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
function practiceOptionsHTML() {
  return `<div class="practice-pace"><label class="practice-choice" for="practice-pace">Practice pace<span><select id="practice-pace" aria-describedby="practice-pace-help">${(["training", "classic", "double"] as const).map((pace) => `<option value="${pace}" ${pace === practiceMode ? "selected" : ""}>${modeNames[pace]}</option>`).join("")}</select>${icon("chevron-down")}</span></label><p class="practice-pace-help" id="practice-pace-help">Training uses relaxed AI. Classic and Double elixir use regular AI; Double elixir refills twice as fast from the start.</p></div>${practiceSpeedHTML()}`;
}
function recordModeName(record: RecordEntry) {
  return `${modeNames[record.mode]}${record.practice ? " · Practice" : ""}`;
}
function bindPracticeOptions(onChange?: () => void) {
  bindPracticeSpeed();
  const select = document.querySelector<HTMLSelectElement>("#practice-pace");
  if (!select) return;
  select.onchange = () => {
    const value = select.value;
    if (value === "training" || value === "classic" || value === "double") {
      practiceMode = value;
      onChange?.();
    }
  };
}
function tryPracticeDeck(
  source: PracticeSourceDeck,
  opener: HTMLElement,
  backLabel: string,
) {
  if (screen !== "lobby") return;
  const restore = returnToModal(opener);
  practiceSetupBack = {
    label: backLabel,
    restore: () => {
      restore();
      const pace = document.querySelector<HTMLSelectElement>("#practice-pace");
      if (pace) pace.value = practiceMode;
      const rate = document.querySelector<HTMLSelectElement>("#practice-speed");
      if (rate) rate.value = String(practiceSpeed);
    },
  };
  practicePreviousDeck = { ...source, deck: [...source.deck] };
  practiceDeckChoice = "previous";
  practiceOpponentIndex = SOLO_OPPONENTS.length + profile.activeDeck;
  practiceOpponentSearch = "";
  showPracticeOpponents();
}
function changePracticeMatchup(practice: PracticeOpponent) {
  const selection = continuedPracticeChoices(
    practice,
    profile.decks,
    profile.activeDeck,
  );
  lobby();
  practiceDeckChoice = selection.playerChoice;
  practiceOpponentIndex = selection.opponentIndex;
  practicePreviousDeck = selection.previousDeck;
  practiceMode = practice.mode;
  showPracticeOpponents();
}
function showPracticeOpponents() {
  if (screen !== "lobby") return;
  const savedDecks = profile.decks.map((deck, index) =>
    index === profile.activeDeck ? profile.deck : deck,
  );
  const roster = practiceRoster(savedDecks, practicePreviousDeck);
  const choices = practiceDeckChoices(savedDecks, practicePreviousDeck);
  const playerChoice =
    choices.find(
      (choice) =>
        choice.value === (practiceDeckChoice ?? String(profile.activeDeck)),
    ) ?? choices[profile.activeDeck];
  const yourDeck = playerChoice.deck;
  let opponent = roster[practiceOpponentIndex] ?? roster[0];
  let matchingOpponents = practiceOpponents(practiceOpponentSearch, roster);
  const groupFor = (choice: {
    savedSlot?: number;
    previous?: true;
    category?: string;
  }) =>
    choice.previous
      ? (choice.category ?? "Previous practice")
      : choice.savedSlot !== undefined
        ? "Your saved decks"
        : "Curated decks";
  const playerOptions = [
    "Your saved decks",
    "Curated decks",
    practicePreviousDeck?.category ?? "Previous practice",
  ]
    .map((group) => {
      const entries = choices.filter((choice) => groupFor(choice) === group);
      return entries.length
        ? `<optgroup label="${group}">${entries.map((choice) => `<option value="${choice.value}" ${choice.value === playerChoice.value ? "selected" : ""}>${esc(choice.name)}${choice.savedSlot === profile.activeDeck ? " (active)" : ""}</option>`).join("")}</optgroup>`
        : "";
    })
    .join("");
  const deckPanel = (side: "yours" | "opponent", deck: readonly CardId[]) =>
    `<section class="match-deck-panel" data-practice-side="${side}" aria-label="${side === "yours" ? "Your practice deck" : "Practice opponent deck"}"><div class="match-deck-heading"><div><h3>${side === "yours" ? "Your practice deck" : "Opponent deck"}</h3><p>${esc(side === "yours" ? playerChoice.name : opponent.name)}</p></div><span><i class="tiny-drop"></i> ${averageCost([...deck]).toFixed(1)} average</span></div>${side === "yours" ? `<label class="practice-choice" for="practice-deck">Your practice deck<span><select id="practice-deck" aria-describedby="practice-deck-note">${playerOptions}</select>${icon("chevron-down")}</span></label>` : ""}${deckCompositionHTML(deck)}<div class="match-deck-grid">${deck.map((id, index) => cardHTML(id, `data-practice-card="${side}-${index}"`)).join("")}</div>${deckCodeButton(side)}</section>`;
  modal(
    "Choose a practice opponent",
    `<p class="practice-intro" id="practice-opponent-note">Choose saved or curated decks for both sides at your chosen pace. No trophies or rewards.</p><div class="practice-search"><label class="field-label" for="practice-search">Find a matchup</label><input type="search" class="name-input" id="practice-search" placeholder="Opponent, style or card" maxlength="100" autocomplete="off" aria-describedby="practice-search-help" value="${esc(practiceOpponentSearch)}"/><p id="practice-search-help">Search names, play styles or cards. Multiple words narrow the decks.</p><div class="practice-search-status"><p id="practice-search-count" role="status" aria-live="polite" aria-atomic="true"></p><button class="text-button" id="clear-practice-search">Clear search</button></div></div><label class="practice-choice">Practice opponent<span><select id="practice-opponent" aria-describedby="practice-opponent-note practice-search-count"></select>${icon("chevron-down")}</span></label>${practiceOptionsHTML()}<div class="practice-record" id="practice-record" role="status" aria-live="polite" aria-atomic="true"><p></p><small>From your current battle log.</small></div><button class="secondary-button practice-review" id="review-practice" aria-describedby="practice-record" hidden>${icon("play")} Review latest practice</button><div class="practice-swap"><button class="secondary-button" id="swap-practice-decks" aria-describedby="practice-swap-help">${icon("arrow-left-right")} Swap decks</button><p id="practice-swap-help">Try the matchup from the other side. Swapping clears the opponent search.</p></div><div class="match-decks">${deckPanel("yours", yourDeck)}<div id="practice-opponent-preview"></div></div><p class="practice-deck-note" id="practice-deck-note">Tap a card to inspect it. Your practice deck applies to this matchup and Practice again; your active battle deck stays the same. Edit saved decks in Cards.</p><div class="match-details-actions"><button class="text-button" id="practice-back">${esc(practiceSetupBack?.label ?? "Back to battle modes")}</button><button class="primary-button" id="start-practice" aria-describedby="practice-opponent-note practice-search-count">${icon("target")} Start practice</button></div>`,
    "practice-opponents",
    true,
  );
  const recordSummary = $("#practice-record");
  const review = $<HTMLButtonElement>("#review-practice");
  let latestRecord: RecordEntry | undefined;
  bindPracticeOptions(updatePracticeRecord);
  $("#practice-deck").onchange = () => {
    const value = $<HTMLSelectElement>("#practice-deck").value;
    if (!choices.some((choice) => choice.value === value)) return;
    practiceDeckChoice = value;
    showPracticeOpponents();
  };
  $("#practice-opponent").onchange = () => {
    const index = Number($<HTMLSelectElement>("#practice-opponent").value);
    if (!matchingOpponents.some((entry) => entry.index === index)) return;
    practiceOpponentIndex = index;
    updateOpponent();
  };
  $("#practice-search").oninput = () => {
    practiceOpponentSearch = $<HTMLInputElement>("#practice-search").value;
    updateOpponent();
  };
  $("#clear-practice-search").onclick = () => {
    practiceOpponentSearch = "";
    $<HTMLInputElement>("#practice-search").value = "";
    updateOpponent();
    $("#practice-search").focus();
  };
  $("#swap-practice-decks").onclick = () => {
    if (matchingOpponents.length === 0) return;
    const swapped = swapPracticeDecks(
      choices,
      playerChoice.value,
      practiceOpponentIndex,
    );
    if (!swapped) return;
    practiceDeckChoice = swapped.playerChoice;
    practiceOpponentIndex = swapped.opponentIndex;
    practiceOpponentSearch = "";
    showPracticeOpponents();
  };
  $("#practice-back").onclick = () => {
    if (practiceSetupBack) {
      const back = practiceSetupBack;
      practiceSetupBack = null;
      back.restore();
      return;
    }
    showModes();
    $("#choose-practice-opponent").focus();
  };
  review.onclick = () => {
    if (screen !== "lobby" || !latestRecord) return;
    const record = latestRecord;
    const restore = returnToModal(review);
    const selection = {
      playerChoice: playerChoice.value,
      opponentIndex: practiceOpponentIndex,
      mode: practiceMode,
      search: practiceOpponentSearch,
      previousDeck: practicePreviousDeck,
      setupBack: practiceSetupBack,
    };
    playReplay(record);
    if (replayRecord !== record) return;
    replayReturn = {
      label: "Back to practice",
      restore: () => {
        practiceDeckChoice = selection.playerChoice;
        practiceOpponentIndex = selection.opponentIndex;
        practiceMode = selection.mode;
        practiceOpponentSearch = selection.search;
        practicePreviousDeck = selection.previousDeck;
        practiceSetupBack = selection.setupBack;
        restore();
      },
    };
    syncReplayExit();
  };
  $("#start-practice").onclick = () => {
    if (screen !== "lobby" || matchingOpponents.length === 0) return;
    startBattle(false, {
      ...opponent,
      mode: practiceMode,
      deck: [...opponent.deck],
      playerDeck: [...yourDeck],
      selection: {
        playerChoice: playerChoice.value,
        opponentIndex: practiceOpponentIndex,
        ...(practicePreviousDeck ? { previousDeck: practicePreviousDeck } : {}),
      },
    });
  };
  function updateOpponent() {
    matchingOpponents = practiceOpponents(practiceOpponentSearch, roster);
    const match =
      matchingOpponents.find(
        (entry) => entry.index === practiceOpponentIndex,
      ) ?? matchingOpponents[0];
    if (match) {
      practiceOpponentIndex = match.index;
      opponent = match.opponent;
    }
    const select = $<HTMLSelectElement>("#practice-opponent");
    select.innerHTML = matchingOpponents.length
      ? [
          "Curated decks",
          "Your saved decks",
          practicePreviousDeck?.category ?? "Previous practice",
        ]
          .map((group) => {
            const entries = matchingOpponents.filter(
              ({ opponent }) => groupFor(opponent) === group,
            );
            return entries.length
              ? `<optgroup label="${group === "Curated decks" ? "AI opponents" : group}">${entries.map(({ opponent: entry, index }) => `<option value="${index}" ${index === practiceOpponentIndex ? "selected" : ""}>${esc(entry.name)} · ${esc(entry.style)}</option>`).join("")}</optgroup>`
              : "";
          })
          .join("")
      : '<option value="">No matching opponents</option>';
    select.disabled = !match;
    $<HTMLButtonElement>("#start-practice").disabled = !match;
    $<HTMLButtonElement>("#swap-practice-decks").disabled = !match;
    $("#clear-practice-search").hidden = !practiceOpponentSearch;
    setText(
      $("#practice-search-count"),
      match
        ? `${matchingOpponents.length} of ${roster.length} opponents`
        : "No opponents match. Try another name or card, or clear the search.",
    );
    const preview = $("#practice-opponent-preview");
    // Preserve the existing cards when a search still selects the same opponent.
    if (preview.dataset.opponent !== String(match?.index)) {
      preview.dataset.opponent = String(match?.index);
      preview.innerHTML = match ? deckPanel("opponent", opponent.deck) : "";
      nativeCards.hydrate(preview);
      refreshIcons();
    }
    updatePracticeRecord();
    bindPracticeCards();
  }
  function updatePracticeRecord() {
    if (!recordSummary.isConnected) return;
    recordSummary.hidden = matchingOpponents.length === 0;
    if (recordSummary.hidden) {
      latestRecord = undefined;
      review.hidden = true;
      return;
    }
    latestRecord = latestPracticeRecord(
      profile.history,
      yourDeck,
      opponent.deck,
      practiceMode,
    );
    review.hidden = !latestRecord;
    const result = practiceResults(
      profile.history,
      yourDeck,
      opponent.deck,
      practiceMode,
    );
    const total = result.wins + result.losses + result.draws;
    setText(
      recordSummary.querySelector<HTMLElement>("p")!,
      total
        ? `Saved ${modeNames[practiceMode]} practice: ${result.wins} ${result.wins === 1 ? "win" : "wins"} · ${result.losses} ${result.losses === 1 ? "loss" : "losses"} · ${result.draws} ${result.draws === 1 ? "draw" : "draws"}.`
        : "No saved practice for these decks at this pace.",
    );
  }
  function bindPracticeCards() {
    bindDeckCodeButtons(
      { yours: yourDeck, opponent: opponent.deck },
      "Back to practice setup",
    );
    document
      .querySelectorAll<HTMLButtonElement>("[data-practice-card]")
      .forEach((button) => {
        button.onclick = () => {
          const view = $("#modal-root").firstElementChild!;
          const panel = view.querySelector<HTMLElement>(".modal")!;
          const scroll = panel.scrollTop;
          showCard(
            button.dataset.nativeCard as CardId,
            () => {
              modalKey = "practice-opponents";
              modalFocus.render("practice-opponents", () =>
                $("#modal-root").replaceChildren(view),
              );
              nativeCards.hydrate(view);
              syncGraphicsStatus();
              panel.scrollTop = scroll;
              button.focus({ preventScroll: true });
            },
            "Back to practice decks",
          );
        };
      });
  }
  updateOpponent();
}
function showCard(
  id: CardId,
  back?: () => void,
  backLabel = "Back to battle details",
) {
  const c = CARD_MAP[id];
  const details = cardDetails(id);
  modal(
    c.name,
    `<div class="card-detail"><div class="detail-art ${c.rarity.toLowerCase()}" data-native-card="${id}" data-card-variant="deck">${nativeCardArt}<img src="${cardArt(id)}" alt="${c.name}"/><span class="cost">${c.cost}</span></div><div><span class="rarity-label ${c.rarity.toLowerCase()}">${c.rarity} · ${c.kind}</span><p>${c.description}</p><span class="level-pill">CURRENT ARENA STATS · LEVEL 11</span></div></div><div class="stat-grid">${details.stats.map((row) => `<div data-card-stat="${esc(row.label)}">${icon(row.icon)}<small>${esc(row.label)}</small><b>${esc(row.value)}</b></div>`).join("")}</div>${details.note ? `<p class="card-rule-note">${esc(details.note)}</p>` : ""}${back ? `<button class="secondary-button" id="card-back">${icon("arrow-right")} ${esc(backLabel)}</button>` : screen === "lobby" ? `<button class="secondary-button" id="card-edit-deck">${icon("layers-2")} Open deck builder</button>` : ""}`,
    "card",
  );
  if (back) $("#card-back").onclick = back;
  else if (screen === "lobby") $("#card-edit-deck").onclick = showDeckBuilder;
}
function showDeckBuilder() {
  if (screen !== "lobby") {
    toast("Finish your battle to edit your deck.");
    return;
  }
  editSlot = -1;
  filter = "all";
  search = "";
  collectionCost = "all";
  collectionOrder = "collection";
  deckEdits.reset(profile);
  deckEditNotice = "";
  renderDeckBuilder();
}
function prepareDeckChange(onConflict: () => void) {
  const change = refreshProfileForDeckEdit(profile);
  if (change === "none") return true;
  applyProfilePreferences();
  refreshProfile();
  if (change !== "decks") return true;
  onConflict();
  return false;
}
function prepareDeckEdit() {
  return prepareDeckChange(() => {
    deckEdits.reset(profile);
    editSlot = -1;
    deckEditNotice =
      "Saved decks changed in another tab. Review your deck before editing.";
    renderDeckBuilder();
    $('[data-edit-slot="0"]').focus();
  });
}
function moveDeckCard(step: -1 | 1, focusCard = false, source = editSlot) {
  const destination = source + step;
  if (
    screen !== "lobby" ||
    source < 0 ||
    destination < 0 ||
    destination >= profile.deck.length
  )
    return;
  if (!prepareDeckEdit()) return;
  const id = profile.deck[source];
  const before = copyDeckSelection(profile);
  [profile.deck[source], profile.deck[destination]] = [
    profile.deck[destination],
    id,
  ];
  profile.decks[profile.activeDeck] = [...profile.deck];
  deckEditNotice = `Moved ${CARD_MAP[id].name} to slot ${destination + 1}.`;
  deckEdits.record(before, profile, {
    label: deckEditNotice,
    beforeFocus: source,
    afterFocus: destination,
  });
  editSlot = destination;
  saveProfile(profile);
  refreshDeck();
  renderDeckBuilder();
  const button = $<HTMLButtonElement>(
    step < 0 ? "#deck-move-earlier" : "#deck-move-later",
  );
  const focus =
    focusCard || button.disabled ? $(`[data-edit-slot="${editSlot}"]`) : button;
  focus.focus();
  audio.play("button_click_02");
}
function restoreDeckEdit(direction: "undo" | "redo", keyboard = false) {
  if (screen !== "lobby" || modalKey !== "deck") return;
  if (!prepareDeckEdit()) return;
  const edit = deckEdits[direction](profile);
  if (!edit) {
    renderDeckBuilder();
    return;
  }
  restoreDeckSelection(profile, edit.selection);
  editSlot = -1;
  deckEditNotice = `${direction === "undo" ? "Undid" : "Redid"}: ${edit.label}`;
  saveProfile(profile);
  refreshDeck();
  renderDeckBuilder();
  const button = $<HTMLButtonElement>(`#deck-${direction}`);
  const opposite = $<HTMLButtonElement>(
    `#deck-${direction === "undo" ? "redo" : "undo"}`,
  );
  (keyboard
    ? $(`[data-edit-slot="${edit.focusSlot}"]`)
    : !button.disabled
      ? button
      : !opposite.disabled
        ? opposite
        : $(`[data-edit-slot="${edit.focusSlot}"]`)
  ).focus();
  audio.play("button_click_02");
}
function renderDeckBuilder() {
  if (deckEdits.sync(profile))
    deckEditNotice =
      "Deck updated. Earlier edits are no longer available to undo.";
  const orderDescription = `deck-order-position deck-order-help${storageAvailable ? "" : " deck-order-save"}`;
  modal(
    "Build your winning eight",
    `<div class="builder-top"><p>Inspect a collection card, or select a deck card to move or replace.</p><span><i class="tiny-drop"></i> ${averageCost(profile.deck).toFixed(1)} average</span></div>${deckCompositionHTML(profile.deck)}<div class="builder-deck">${profile.deck.map((id, i) => cardHTML(id, `data-edit-slot="${i}" aria-pressed="${editSlot === i}" aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight" aria-describedby="${orderDescription}"`, editSlot === i ? "selected" : "")).join("")}</div><div class="builder-order" role="group" aria-label="Deck order"><div><b id="deck-order-position">${editSlot < 0 ? "Arrange your deck" : `${CARD_MAP[profile.deck[editSlot]].name} · Slot ${editSlot + 1} of 8`}</b><p id="deck-order-help">${editSlot < 0 ? "Select a deck card to move it." : "Move this card with the buttons or Alt + Left / Right."}</p>${storageAvailable ? "" : '<p id="deck-order-save" role="status">Changes are available for this session. Browser storage is unavailable.</p>'}</div><div class="builder-order-actions"><button class="secondary-button" id="deck-move-earlier" aria-describedby="${orderDescription}" ${editSlot <= 0 ? "disabled" : ""}>Earlier</button><button class="secondary-button" id="deck-move-later" aria-describedby="${orderDescription}" ${editSlot < 0 || editSlot >= 7 ? "disabled" : ""}>Later</button></div></div><div class="builder-history" role="group" aria-label="Deck edit history"><div><p id="deck-edit-status" role="status" aria-live="polite">${esc(deckEditNotice || "Undo and redo deck edits made during this visit.")}</p><small>Undo: Ctrl/Cmd + Z · Redo: Ctrl/Cmd + Shift + Z</small></div><div class="builder-history-actions"><button class="secondary-button" id="deck-undo" aria-describedby="deck-edit-status" aria-keyshortcuts="Control+z Meta+z" title="${esc(deckEdits.undoLabel ? `Undo: ${deckEdits.undoLabel}` : "No deck edit to undo")}" ${deckEdits.undoLabel ? "" : "disabled"}>Undo</button><button class="secondary-button" id="deck-redo" aria-describedby="deck-edit-status" aria-keyshortcuts="Control+Shift+z Meta+Shift+z Control+y" title="${esc(deckEdits.redoLabel ? `Redo: ${deckEdits.redoLabel}` : "No deck edit to redo")}" ${deckEdits.redoLabel ? "" : "disabled"}>Redo</button></div></div><div class="builder-sharing"><button class="secondary-button" id="deck-codes">Deck codes</button><p>Copy your deck or preview a shared code.</p></div><div class="builder-controls"><div class="collection-label"><h3>Card collection</h3><span>${CARDS.length} / ${CARDS.length} unlocked</span></div><label class="search-input">${icon("search")}<input id="card-search" placeholder="Find a card…" value="${esc(search)}" aria-label="Search cards"/></label><div class="filter-row" role="group" aria-label="Card type">${["all", "troop", "spell", "building"].map((f) => `<button class="${filter === f ? "active" : ""}" data-filter="${f}" aria-pressed="${filter === f}">${f === "all" ? "All cards" : f === "troop" ? "Troops" : f === "spell" ? "Spells" : "Buildings"}</button>`).join("")}</div><div class="collection-options"><div><label for="collection-cost">Elixir cost</label><div class="match-deck-choice"><select id="collection-cost"><option value="all" ${collectionCost === "all" ? "selected" : ""}>Any elixir</option>${[
      ...new Set(CARDS.map((c) => c.cost)),
    ]
      .sort((a, b) => a - b)
      .map(
        (cost) =>
          `<option value="${cost}" ${collectionCost === cost ? "selected" : ""}>${cost} elixir</option>`,
      )
      .join(
        "",
      )}</select>${icon("chevron-down")}</div></div><div><label for="collection-order">Sort cards</label><div class="match-deck-choice"><select id="collection-order">${(
      [
        ["collection", "Collection order"],
        ["cost-asc", "Elixir: low to high"],
        ["cost-desc", "Elixir: high to low"],
        ["name", "Name: A to Z"],
      ] as const
    )
      .map(
        ([value, label]) =>
          `<option value="${value}" ${collectionOrder === value ? "selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select>${icon("chevron-down")}</div></div></div></div><p id="collection-results" role="status" aria-live="polite"></p><div class="collection-grid" id="collection-grid"></div><div class="builder-footer"><span id="builder-hint">${editSlot < 0 ? "Choose a collection card to inspect its stats." : `${CARD_MAP[profile.deck[editSlot]].name} selected · Choose a replacement below, or select it again to cancel.`}</span><button class="primary-button" id="deck-done">${icon("check")} Done</button></div>`,
    "deck",
    true,
  );
  document
    .querySelectorAll<HTMLButtonElement>("[data-edit-slot]")
    .forEach((e) => {
      e.onclick = () => {
        const slot = Number(e.dataset.editSlot);
        editSlot = editSlot === slot ? -1 : slot;
        renderDeckBuilder();
      };
      e.onkeydown = (event) => {
        if (
          event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          (event.key === "ArrowLeft" || event.key === "ArrowRight")
        ) {
          event.preventDefault();
          moveDeckCard(
            event.key === "ArrowLeft" ? -1 : 1,
            true,
            Number(e.dataset.editSlot),
          );
        }
      };
    });
  $("#deck-undo").onclick = () => restoreDeckEdit("undo");
  $("#deck-redo").onclick = () => restoreDeckEdit("redo");
  $("#deck-move-earlier").onclick = () => moveDeckCard(-1);
  $("#deck-move-later").onclick = () => moveDeckCard(1);
  const filterButtons = document.querySelectorAll<HTMLButtonElement>("[data-filter]");
  filterButtons.forEach(
    (e) =>
      (e.onclick = () => {
        filter = e.dataset.filter as CollectionKind;
        for (const button of filterButtons) {
          const active = button.dataset.filter === filter;
          if (button.classList.contains("active") !== active)
            button.classList.toggle("active", active);
          setAttribute(button, "aria-pressed", String(active));
        }
        renderCollection();
      }),
  );
  $("#card-search").addEventListener("input", () => {
    search = ($("#card-search") as HTMLInputElement).value;
    renderCollection();
  });
  $("#collection-cost").onchange = () => {
    const value = $<HTMLSelectElement>("#collection-cost").value;
    collectionCost = value === "all" ? "all" : Number(value);
    renderCollection();
  };
  $("#collection-order").onchange = () => {
    collectionOrder = $<HTMLSelectElement>("#collection-order")
      .value as CollectionOrder;
    renderCollection();
  };
  $("#deck-codes").onclick = () => showDeckCodes();
  $("#deck-done").onclick = () => {
    if (!storageAvailable) saveProfile(profile);
    refreshDeck();
    closeModal();
  };
  renderCollection();
}
interface DeckCodeView {
  code: string;
  slot: number;
  preview?: CardId[];
  undo?: DeckSelection;
  notice?: string;
}
function showDeckCodes(state: Partial<DeckCodeView> = {}) {
  if (screen !== "lobby") return;
  const view: DeckCodeView = { code: "", slot: profile.activeDeck, ...state };
  const prepareChange = () =>
    prepareDeckChange(() => {
      showDeckCodes({
        ...view,
        undo: undefined,
        notice: deckPreviewConflictNotice,
      });
      (
        document.querySelector<HTMLElement>("#code-deck-slot") ??
        $("#shared-deck-code")
      ).focus();
    });
  modal(
    "Deck codes",
    `<div class="deck-codes"><section><label class="field-label" for="current-deck-code">YOUR CURRENT DECK</label><textarea class="name-input deck-code-text" id="current-deck-code" readonly rows="3" spellcheck="false">${esc(encodeDeckCode(profile.deck))}</textarea><button class="secondary-button" id="copy-deck-code">Copy deck code</button><p id="deck-code-copy-status" role="status" aria-live="polite"></p></section><form id="deck-code-form"><label class="field-label" for="shared-deck-code">PASTE A SHARED DECK CODE</label><textarea class="name-input deck-code-text" id="shared-deck-code" rows="3" maxlength="${MAX_DECK_CODE_BYTES}" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="BRA-DECK-1:knight,…">${esc(view.code)}</textarea><button class="secondary-button" type="submit">Preview deck</button><p id="deck-code-error" class="deck-code-error" role="alert" hidden></p></form>${view.preview ? `<section id="shared-deck-preview" class="match-deck-panel"><div class="match-deck-heading"><h3>Shared deck</h3><span><i class="tiny-drop"></i> ${averageCost(view.preview).toFixed(1)} average</span></div>${deckCompositionHTML(view.preview)}<div class="match-deck-grid">${view.preview.map((id) => cardHTML(id, `data-code-card="${id}"`)).join("")}</div><div class="code-practice">${practiceOptionsHTML()}<button class="secondary-button" id="practice-code-deck" aria-describedby="practice-code-note">${icon("target")} Practice against this deck</button><p id="practice-code-note">AI uses these shared cards against your active battle deck. No trophies or rewards.</p><button class="secondary-button" id="try-code-deck" aria-describedby="try-code-note">${icon("swords")} Try this deck in practice</button><p id="try-code-note">Choose a matchup with these shared cards as your deck. Your saved slots stay the same.</p></div><div class="match-copy-target"><label for="code-deck-slot">Destination battle deck</label><div class="match-deck-choice"><select id="code-deck-slot" aria-describedby="code-deck-note">${profile.decks.map((_, slot) => `<option value="${slot}" ${slot === view.slot ? "selected" : ""}>Battle deck ${slot + 1}${slot === profile.activeDeck ? " (active)" : ""}</option>`).join("")}</select>${icon("chevron-down")}</div><p id="code-deck-note">Replaces battle deck ${view.slot + 1} and selects it.</p></div><button class="primary-button" id="use-code-deck">Use this deck</button></section>` : ""}${view.notice ? `<div class="deck-code-notice" role="status"><span>${esc(view.notice)}</span>${view.undo ? '<button class="text-button" id="undo-code-deck">Undo deck change</button>' : ""}</div>` : ""}<div class="deck-code-footer"><button class="text-button" id="deck-code-back">Back to deck builder</button></div></div>`,
    "deck-codes",
    true,
  );
  const current = $<HTMLTextAreaElement>("#current-deck-code");
  $("#copy-deck-code").onclick = async () => {
    const copied = await copyTextValue(current);
    if (document.querySelector("#current-deck-code") !== current) return;
    $("#deck-code-copy-status").textContent = copied
      ? "Deck code copied."
      : "Select and copy the code above.";
    if (copied) $("#copy-deck-code").focus();
  };
  const input = $<HTMLTextAreaElement>("#shared-deck-code");
  input.oninput = () => {
    view.code = input.value;
    view.preview = undefined;
    $("#deck-code-error").hidden = true;
    const old = document.querySelector<HTMLElement>("#shared-deck-preview");
    if (old) old.hidden = true;
  };
  $("#deck-code-form").onsubmit = (event) => {
    event.preventDefault();
    view.code = input.value;
    try {
      view.preview = decodeDeckCode(view.code);
      showDeckCodes(view);
      $("#use-code-deck").focus();
    } catch (cause) {
      const error = $("#deck-code-error");
      error.textContent =
        cause instanceof Error
          ? cause.message
          : "Couldn’t read this deck code.";
      error.hidden = false;
    }
  };
  $("#deck-code-back").onclick = renderDeckBuilder;
  if (view.preview) {
    bindPracticeOptions();
    $("#try-code-deck").onclick = () => {
      if (!view.preview) return;
      tryPracticeDeck(
        {
          name: "Shared deck",
          style: "Deck code",
          deck: view.preview,
          category: "Shared deck",
        },
        $("#try-code-deck"),
        "Back to shared deck",
      );
    };
    $("#practice-code-deck").onclick = () => {
      if (screen !== "lobby" || !view.preview) return;
      startBattle(false, {
        name: "Shared deck",
        style: "Deck code",
        mode: practiceMode,
        deck: [...view.preview],
      });
    };
    $("#code-deck-slot").onchange = () => {
      view.slot = Number($<HTMLSelectElement>("#code-deck-slot").value);
      $("#code-deck-note").textContent =
        `Replaces battle deck ${view.slot + 1} and selects it.`;
    };
    $("#use-code-deck").onclick = () => {
      if (screen !== "lobby" || !view.preview) return;
      if (!prepareChange()) return;
      const undo =
        view.undo && isActiveDeck(profile, view.preview, view.slot)
          ? view.undo
          : useDeck(profile, view.preview, view.slot);
      saveProfile(profile);
      refreshDeck();
      showDeckCodes({
        ...view,
        undo,
        notice: storageAvailable
          ? `Battle deck ${view.slot + 1} selected and saved.`
          : `Battle deck ${view.slot + 1} selected for this session. Browser storage is unavailable.`,
      });
      $("#undo-code-deck").focus();
    };
    document
      .querySelectorAll<HTMLButtonElement>("[data-code-card]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            showCard(
              button.dataset.codeCard as CardId,
              returnToModal(button),
              "Back to deck codes",
            )),
      );
  }
  if (view.undo) {
    $("#undo-code-deck").onclick = () => {
      if (screen !== "lobby" || !view.undo) return;
      if (!prepareChange()) return;
      restoreDeckSelection(profile, view.undo);
      saveProfile(profile);
      refreshDeck();
      showDeckCodes({
        ...view,
        undo: undefined,
        notice: storageAvailable
          ? "Previous decks restored."
          : "Previous decks restored for this session. Browser storage is unavailable.",
      });
    };
  }
}
function renderCollection() {
  const grid = $("#collection-grid");
  setAttribute(grid, "data-collection-mode", editSlot < 0 ? "inspect" : "replace");
  let rows = collectionRows.get(grid);
  if (!rows) collectionRows.set(grid, rows = new Map());
  const matches = collectionCards({
    kind: filter,
    search,
    cost: collectionCost,
    order: collectionOrder,
  });
  setText($("#collection-results"), `Showing ${matches.length} of ${CARDS.length} cards.`);
  const children = matches.map(c => {
    let row = rows.get(c.id);
    if (!row) {
      row = document.createElement("div");
      row.innerHTML = cardHTML(c.id, `data-collection="${c.id}" aria-describedby="builder-hint"`,
        profile.deck.includes(c.id) ? "in-deck" : "") +
        `<span class="collection-card-label">${c.name}${profile.deck.includes(c.id) ? " <b>IN DECK</b>" : ""}</span>`;
      rows.set(c.id, row);
    }
    return row;
  });
  if (children.length) {
    if (grid.children.length !== children.length || children.some((row, i) => grid.children[i] !== row))
      grid.replaceChildren(...children);
  } else if (!grid.querySelector(".empty-state")) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No cards match these filters.";
    grid.replaceChildren(empty);
  }
  nativeCards.hydrate(grid);
  grid.querySelectorAll<HTMLButtonElement>("[data-collection]").forEach(
    (e) =>
      (e.onclick = () => {
        const id = e.dataset.collection as CardId;
        if (editSlot < 0) {
          const view = $("#modal-root").firstElementChild!;
          const panel = view.querySelector<HTMLElement>(".modal")!;
          const scroll = panel.scrollTop;
          showCard(
            id,
            () => {
              modalKey = "deck";
              modalFocus.render("deck", () => $("#modal-root").replaceChildren(view));
              nativeCards.hydrate(view);
              syncGraphicsStatus();
              panel.scrollTop = scroll;
              view
                .querySelector<HTMLElement>(`[data-collection="${id}"]`)
                ?.focus();
            },
            "Back to collection",
          );
          return;
        }
        if (!prepareDeckEdit()) return;
        if (profile.deck.includes(id)) {
          toast("That card is already in your deck.");
          return;
        }
        const before = copyDeckSelection(profile);
        const previous = profile.deck[editSlot];
        profile.deck[editSlot] = id;
        profile.decks[profile.activeDeck] = [...profile.deck];
        deckEditNotice = `Replaced ${CARD_MAP[previous].name} with ${CARD_MAP[id].name} in slot ${editSlot + 1}.`;
        deckEdits.record(before, profile, {
          label: deckEditNotice,
          beforeFocus: editSlot,
          afterFocus: editSlot,
        });
        saveProfile(profile);
        refreshDeck();
        audio.play("button_click_02");
        editSlot = -1;
        renderDeckBuilder();
      }),
  );
}
function rememberHistoryPosition(focus: string) {
  if (modalKey !== "history") return;
  historyReturn = {
    records: [...profile.history],
    panel: $(".modal").scrollTop,
    list: $(".history-list").scrollTop,
    focus,
  };
}
function renderHistoryMatches() {
  if (!profile.history.length) return;
  const matches = historyMatches(profile.history, historyQuery);
  $("#history-count").textContent =
    `Showing ${matches.length} of ${profile.history.length} saved ${profile.history.length === 1 ? "battle" : "battles"}.`;
  $<HTMLButtonElement>("#clear-history-filters").disabled =
    !historyQuery.search &&
    historyQuery.result === "all" &&
    historyQuery.mode === "all" &&
    historyQuery.type === "all";
  $(".history-list").innerHTML = matches.length
    ? matches
        .map(
          ({ record: r, index: i }) =>
            `<div class="history-entry" data-history-index="${i}"><span class="history-outcome ${r.winner === "blue" ? "win" : r.winner === "draw" ? "draw" : "loss"}">${icon(r.winner === "blue" ? "trophy" : r.winner === "draw" ? "equal" : "swords")}</span><div><b>${r.winner === "blue" ? "Victory" : r.winner === "draw" ? "Draw" : "Defeat"} <small>vs ${esc(r.opponent ?? "Royal Trainer")}</small></b><span class="history-record-meta"><span>${recordModeName(r)}</span><span><time datetime="${esc(r.date)}">${new Date(r.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time> · <span class="history-duration">${clock(r.replay.duration * STEP)} played</span></span></span></div><strong aria-label="Your crowns ${r.crowns[0]}, opponent crowns ${r.crowns[1]}">${r.crowns[0]} – ${r.crowns[1]}</strong><div class="history-actions"><button class="secondary-button" data-match-details="${i}" aria-label="View battle details against ${esc(r.opponent ?? "Royal Trainer")}">${icon("layers-2")} Details</button><button class="secondary-button" data-replay="${i}" aria-label="Replay battle against ${esc(r.opponent ?? "Royal Trainer")}">${icon("play")} Replay</button></div></div>`,
        )
        .join("")
    : `<div class="history-no-results"><h3>No battles match these filters.</h3><p>Try another opponent or card, or clear the filters.</p></div>`;
  $(".history-list").scrollTop = 0;
  document
    .querySelectorAll<HTMLButtonElement>("[data-replay]")
    .forEach((button) => {
      button.onclick = () => {
        rememberHistoryPosition(`[data-replay="${button.dataset.replay}"]`);
        playReplay(profile.history[Number(button.dataset.replay)]);
      };
    });
  document
    .querySelectorAll<HTMLButtonElement>("[data-match-details]")
    .forEach((button) => {
      button.onclick = () => {
        rememberHistoryPosition(
          `[data-match-details="${button.dataset.matchDetails}"]`,
        );
        showMatchDetails(Number(button.dataset.matchDetails));
      };
    });
  refreshIcons();
}
function showHistory() {
  const modeOptions = Object.entries(modeNames)
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");
  const filters = profile.history.length
    ? `<div class="history-filters"><label>Search battles<input type="search" id="history-search" placeholder="Player, opponent or card" maxlength="100" autocomplete="off" aria-describedby="history-search-help" value="${esc(historyQuery.search)}"/></label><label>Result<span class="history-select"><select id="history-result"><option value="all">All results</option><option value="blue">Victory</option><option value="red">Defeat</option><option value="draw">Draw</option></select>${icon("chevron-down")}</span></label><label>Mode<span class="history-select"><select id="history-mode"><option value="all">All modes</option>${modeOptions}</select>${icon("chevron-down")}</span></label><label>Battle type<span class="history-select"><select id="history-type"><option value="all">All battles</option><option value="practice">Practice</option><option value="ai">AI battles</option><option value="friend">Friends</option></select>${icon("chevron-down")}</span></label><p class="history-search-help" id="history-search-help">Search recorded player names, opponents and cards in either starting deck.</p></div><div class="history-filter-status"><p id="history-count" role="status" aria-live="polite" aria-atomic="true"></p><button class="text-button" id="clear-history-filters">Clear filters</button></div>`
    : "";
  modal(
    "Your battle log",
    `${screen === "lobby" ? `<div class="replay-file-toolbar"><button class="secondary-button" id="open-replay-file">${icon("upload")} Open replay file</button><input id="replay-file" type="file" accept=".json,application/json" aria-label="Choose replay file" hidden/><p>Open or drop one replay file to watch it. Your progress stays the same.</p><p class="replay-file-error" role="alert" hidden></p></div>` : ""}<div class="history-summary"><div>${icon("swords")}<b>${profile.battles}</b><span>BATTLES</span></div><div>${icon("trophy")}<b>${profile.wins}</b><span>VICTORIES</span></div><div>${icon("crown")}<b>${profile.crowns}</b><span>CROWNS</span></div></div>${filters}<div class="history-list">${profile.history.length ? "" : `<div class="empty-history">${icon("swords")}<h3>Your story starts in the arena.</h3><p>Play a battle to see your results and replays here.</p><button class="primary-button" id="history-battle">Let's battle ${icon("arrow-right")}</button></div>`}</div><p class="modal-footnote">Your latest 10 battles are saved locally, with playable replays.</p>`,
    "history",
    true,
  );
  if (profile.history.length) {
    const search = $<HTMLInputElement>("#history-search");
    const result = $<HTMLSelectElement>("#history-result");
    const mode = $<HTMLSelectElement>("#history-mode");
    const type = $<HTMLSelectElement>("#history-type");
    result.value = historyQuery.result;
    mode.value = historyQuery.mode;
    type.value = historyQuery.type;
    search.oninput = () => {
      historyQuery.search = search.value;
      renderHistoryMatches();
    };
    result.onchange = () => {
      historyQuery.result = result.value as HistoryQuery["result"];
      renderHistoryMatches();
    };
    mode.onchange = () => {
      historyQuery.mode = mode.value as HistoryQuery["mode"];
      renderHistoryMatches();
    };
    type.onchange = () => {
      historyQuery.type = type.value as HistoryQuery["type"];
      renderHistoryMatches();
    };
    $("#clear-history-filters").onclick = () => {
      historyQuery.search = search.value = "";
      historyQuery.result = result.value = "all";
      historyQuery.mode = mode.value = "all";
      historyQuery.type = type.value = "all";
      renderHistoryMatches();
      search.focus();
    };
    renderHistoryMatches();
  }
  bindReplayFileInput();
  if (document.querySelector("#history-battle"))
    $("#history-battle").onclick = () => closeModal();
  if (historyReturn) {
    const unchanged =
      JSON.stringify(historyReturn.records) === JSON.stringify(profile.history);
    let focus = historyReturn.focus;
    const row = /^\[(data-match-details|data-replay)="(\d+)"\]$/.exec(focus);
    if (!unchanged && row) {
      // Legacy IDs can repeat. Match the captured recording, never just its ID.
      const original = historyReturn.records[Number(row[2])];
      const index = profile.history.findIndex(
        (record) => JSON.stringify(record) === JSON.stringify(original),
      );
      focus = index < 0 ? "#history-search" : `[${row[1]}="${index}"]`;
    }
    const target =
      document.querySelector<HTMLElement>(focus) ??
      document.querySelector<HTMLElement>("#history-search") ??
      document.querySelector<HTMLElement>("#open-replay-file") ??
      document.querySelector<HTMLElement>(".close-modal");
    target?.focus({ preventScroll: unchanged });
    if (unchanged) {
      $(".modal").scrollTop = historyReturn.panel;
      $(".history-list").scrollTop = historyReturn.list;
    }
  }
  historyReturn = null;
}
function downloadJson(text: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function bindReplayFileInput() {
  const input = document.querySelector<HTMLInputElement>("#replay-file");
  const button = document.querySelector<HTMLButtonElement>("#open-replay-file");
  if (!input || !button) return;
  const toolbar = button.closest<HTMLElement>(".replay-file-toolbar")!;
  const error = toolbar.querySelector<HTMLElement>(".replay-file-error")!;
  const showError = (message: string) => {
    error.textContent = message;
    error.hidden = false;
  };
  button.onclick = () => {
    input.value = "";
    input.click();
  };
  const previewFile = async (file: File) => {
    if (screen !== "lobby" || button.disabled) return;
    error.hidden = true;
    button.disabled = true;
    toolbar.setAttribute("aria-busy", "true");
    try {
      if (file.size > MAX_REPLAY_BYTES)
        throw new Error("Choose a replay file smaller than 512 KB.");
      const shared = importReplayFile(await file.text());
      if (
        screen !== "lobby" ||
        document.querySelector("#replay-file") !== input
      )
        return;
      rememberHistoryPosition("#open-replay-file");
      showSharedReplay(shared);
    } catch (cause) {
      if (document.querySelector("#replay-file") !== input) return;
      showError(
        cause instanceof Error
          ? cause.message
          : "Couldn’t read this replay. Try another file.",
      );
    } finally {
      button.disabled = false;
      toolbar.removeAttribute("aria-busy");
    }
  };
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void previewFile(file);
  };
  toolbar.ondragover = (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = button.disabled ? "none" : "copy";
    toolbar.classList.toggle("is-dragging", !button.disabled);
  };
  toolbar.ondragleave = (event) => {
    if (
      event.relatedTarget instanceof Node &&
      toolbar.contains(event.relatedTarget)
    )
      return;
    toolbar.classList.remove("is-dragging");
  };
  toolbar.ondrop = (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    toolbar.classList.remove("is-dragging");
    if (button.disabled || screen !== "lobby") return;
    if (event.dataTransfer.files.length !== 1) {
      showError("Drop one replay file at a time.");
      return;
    }
    void previewFile(event.dataTransfer.files[0]);
  };
}

interface SharedReplayView extends MatchDeckView {
  practiceSide: "yours" | "opponent";
}
function showSharedReplay(
  shared: SharedReplay,
  state: Partial<SharedReplayView> = {},
) {
  if (screen !== "lobby") return;
  const view: SharedReplayView = {
    slot: profile.activeDeck,
    practiceSide: "opponent",
    ...state,
  };
  const { record, playerName } = shared,
    decks = recordedDecks(record);
  const prepareChange = () =>
    prepareDeckChange(() => {
      showSharedReplay(shared, {
        ...view,
        undo: undefined,
        notice: deckPreviewConflictNotice,
      });
      $("#shared-deck-slot").focus();
    });
  const deck = (side: "yours" | "opponent", name: string) =>
    `<section class="match-deck-panel"><div class="match-deck-heading"><h3>${esc(name)}</h3><span><i class="tiny-drop"></i> ${averageCost(decks[side]).toFixed(1)} average</span></div>${deckCompositionHTML(decks[side])}<div class="match-deck-grid">${decks[side].map((id) => cardHTML(id, `data-shared-card="${id}"`)).join("")}</div>${deckCodeButton(side)}<button class="secondary-button" data-use-shared-deck="${side}" aria-describedby="shared-copy-note">${icon("layers-2")} ${side === "yours" ? "Use recorded player deck" : "Use recorded opponent deck"}</button><button class="secondary-button" data-try-shared-deck="${side}" aria-describedby="shared-try-note">${icon("swords")} ${side === "yours" ? "Try recorded player deck" : "Try recorded opponent deck"}</button></section>`;
  modal(
    "Shared replay",
    `<div class="shared-replay"><p class="shared-replay-names"><strong>${esc(playerName)}</strong><span>vs</span><strong>${esc(record.opponent ?? "Royal Trainer")}</strong></p><p class="shared-replay-meta">${esc(recordModeName(record))} · ${clock(record.replay.duration * STEP)} played<br>${esc(new Date(record.date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }))}</p><p class="shared-replay-result">Recorded result: ${record.winner === "blue" ? "Victory" : record.winner === "red" ? "Defeat" : "Draw"} · ${record.crowns[0]} – ${record.crowns[1]}</p><div class="match-copy-target"><label for="shared-deck-slot">Destination battle deck</label><div class="match-deck-choice"><select id="shared-deck-slot" aria-describedby="shared-copy-note">${profile.decks.map((_, slot) => `<option value="${slot}" ${view.slot === slot ? "selected" : ""}>Battle deck ${slot + 1}${profile.activeDeck === slot ? " (active)" : ""}</option>`).join("")}</select>${icon("chevron-down")}</div><p id="shared-copy-note">Replaces battle deck ${view.slot + 1} and selects it.</p></div><div class="match-decks">${deck("yours", playerName)}${deck("opponent", record.opponent ?? "Royal Trainer")}</div>${view.notice ? `<div class="match-deck-status" role="status"><span id="shared-deck-notice">${esc(view.notice)}</span>${view.undo ? `<button class="text-button" id="undo-shared-deck" aria-describedby="shared-deck-notice">Undo deck change</button>` : ""}</div>` : ""}<section class="shared-replay-practice" aria-label="Practice a recorded deck"><label class="practice-choice" for="practice-shared-side">Practice opponent deck<span><select id="practice-shared-side" aria-describedby="practice-shared-note"><option value="opponent" ${view.practiceSide === "opponent" ? "selected" : ""}>Recorded opponent · ${esc(record.opponent ?? "Royal Trainer")}</option><option value="yours" ${view.practiceSide === "yours" ? "selected" : ""}>Recorded player · ${esc(playerName)}</option></select>${icon("chevron-down")}</span></label>${practiceOptionsHTML()}<button class="secondary-button" id="practice-shared-replay" aria-describedby="practice-shared-note">${icon("target")} Practice against this deck</button><p class="match-practice-note" id="practice-shared-note">AI uses the selected recorded deck against your active battle deck. No trophies or rewards.</p></section><p class="match-practice-note" id="shared-try-note">Try either recorded deck as your temporary player deck, then choose a practice matchup. Your saved slots stay the same.</p><p class="modal-footnote">Watching this file does not add battles, rewards or decks to your progress.</p><div class="match-details-actions"><button class="text-button" id="shared-replay-back">Back to battle log</button><button class="primary-button" id="watch-shared-replay">${icon("play")} Watch shared replay</button></div></div>`,
    "shared-replay",
    true,
  );
  bindDeckCodeButtons(decks, "Back to shared replay");
  $("#shared-replay-back").onclick = showHistory;
  $("#shared-deck-slot").onchange = () => {
    const slot = Number($<HTMLSelectElement>("#shared-deck-slot").value);
    if (!Number.isInteger(slot) || !profile.decks[slot]) return;
    view.slot = slot;
    $("#shared-copy-note").textContent =
      `Replaces battle deck ${slot + 1} and selects it.`;
  };
  document
    .querySelectorAll<HTMLButtonElement>("[data-use-shared-deck]")
    .forEach((button) => {
      button.onclick = () => {
        if (screen !== "lobby") return;
        if (!prepareChange()) return;
        const side = button.dataset.useSharedDeck as "yours" | "opponent";
        const undo =
          view.undo && isActiveDeck(profile, decks[side], view.slot)
            ? view.undo
            : useDeck(profile, decks[side], view.slot);
        saveProfile(profile);
        refreshDeck();
        showSharedReplay(shared, {
          ...view,
          undo,
          notice: storageAvailable
            ? `Battle deck ${view.slot + 1} selected and saved.`
            : `Battle deck ${view.slot + 1} selected for this session. Browser storage is unavailable.`,
        });
        $("#undo-shared-deck").focus();
      };
    });
  document
    .querySelectorAll<HTMLButtonElement>("[data-try-shared-deck]")
    .forEach((button) => {
      button.onclick = () => {
        const side = button.dataset.trySharedDeck as "yours" | "opponent";
        tryPracticeDeck(
          {
            name:
              side === "yours"
                ? playerName
                : (record.opponent ?? "Royal Trainer"),
            style: "Shared replay",
            deck: decks[side],
            category: "Shared replay",
          },
          button,
          "Back to shared replay",
        );
      };
    });
  if (view.undo)
    $("#undo-shared-deck").onclick = () => {
      if (screen !== "lobby" || !view.undo) return;
      if (!prepareChange()) return;
      restoreDeckSelection(profile, view.undo);
      saveProfile(profile);
      refreshDeck();
      showSharedReplay(shared, {
        slot: view.slot,
        practiceSide: view.practiceSide,
        notice: storageAvailable
          ? "Previous decks restored."
          : "Previous decks restored for this session. Browser storage is unavailable.",
      });
      $("#shared-deck-slot").focus();
    };
  bindPracticeOptions();
  $("#practice-shared-side").onchange = () => {
    const side = $<HTMLSelectElement>("#practice-shared-side").value;
    if (side === "yours" || side === "opponent") view.practiceSide = side;
  };
  $("#practice-shared-replay").onclick = () => {
    if (screen !== "lobby") return;
    const practice = recordedPractice(record, practiceMode);
    if (view.practiceSide === "yours") {
      practice.name = playerName;
      practice.deck = [...decks.yours];
    }
    startBattle(false, practice);
  };
  $("#watch-shared-replay").onclick = () => {
    if (screen === "lobby")
      watchPreviewReplay(
        record,
        $("#watch-shared-replay"),
        "Back to shared replay",
        playerName,
      );
  };
  document
    .querySelectorAll<HTMLButtonElement>("[data-shared-card]")
    .forEach((button) => {
      button.onclick = () => {
        const panelView = $("#modal-root").firstElementChild!;
        const panel = panelView.querySelector<HTMLElement>(".modal")!;
        const scroll = panel.scrollTop;
        showCard(
          button.dataset.sharedCard as CardId,
          () => {
            modalKey = "shared-replay";
            modalFocus.render("shared-replay", () =>
              $("#modal-root").replaceChildren(panelView),
            );
            nativeCards.hydrate(panelView);
            syncGraphicsStatus();
            panel.scrollTop = scroll;
            button.focus({ preventScroll: true });
          },
          "Back to shared replay",
        );
      };
    });
}
interface MatchDeckView {
  slot: number;
  undo?: DeckSelection;
  notice?: string;
}
interface LocalMatchDeckView extends MatchDeckView {
  record: RecordEntry;
}
function showMatchDetails(
  index: number,
  state: Partial<LocalMatchDeckView> = {},
) {
  const record = state.record ?? profile.history[index];
  if (!record) return;
  const view: LocalMatchDeckView = {
    slot: profile.activeDeck,
    ...state,
    record,
  };
  const decks = recordedDecks(record);
  const editable = screen === "lobby";
  const prepareChange = () =>
    prepareDeckChange(() => {
      showMatchDetails(index, {
        ...view,
        undo: undefined,
        notice: deckPreviewConflictNotice,
      });
      $("#match-deck-slot").focus();
    });
  const section = (side: "yours" | "opponent") =>
    `<section class="match-deck-panel" data-match-side="${side}" aria-label="${side === "yours" ? "Your recorded deck" : "Opponent recorded deck"}"><div class="match-deck-heading"><div><h3>${side === "yours" ? "Your deck" : "Opponent deck"}</h3><p>${side === "yours" ? esc(record.playerName ?? "Your starting eight") : esc(record.opponent ?? "Royal Trainer")}</p></div><span><i class="tiny-drop"></i> ${averageCost(decks[side]).toFixed(1)} average</span></div>${deckCompositionHTML(decks[side])}<div class="match-deck-grid">${decks[side].map((id) => cardHTML(id, `data-match-card="${id}"`)).join("")}</div>${deckCodeButton(side)}${editable ? `<button class="secondary-button" data-use-match-deck="${side}" aria-describedby="match-copy-note">${icon("layers-2")} ${side === "yours" ? "Use your recorded deck" : "Use opponent deck"}</button><button class="secondary-button" data-try-match-deck="${side}" aria-describedby="match-try-note">${icon("swords")} ${side === "yours" ? "Try your recorded deck" : "Try opponent deck"}</button>${side === "opponent" ? `${practiceOptionsHTML()}<button class="secondary-button" id="practice-recorded-deck" aria-describedby="practice-recorded-note">${icon("target")} Practice against this deck</button><p class="match-practice-note" id="practice-recorded-note">AI uses this recorded deck against your active deck. No trophies or rewards.</p>` : ""}` : ""}</section>`;
  modal(
    "Battle details",
    `<div class="match-details"><div class="match-result ${record.winner === "blue" ? "win" : record.winner === "red" ? "loss" : "draw"}"><div><strong>${record.winner === "blue" ? "Victory" : record.winner === "red" ? "Defeat" : "Draw"}</strong><span>vs ${esc(record.opponent ?? "Royal Trainer")}</span></div><b aria-label="Your crowns ${record.crowns[0]}, opponent crowns ${record.crowns[1]}">${record.crowns[0]} ${icon("crown")} ${record.crowns[1]}</b></div><p class="match-metadata">${recordModeName(record)} · ${clock(record.replay.duration * STEP)} played<br>${esc(new Date(record.date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }))}</p>${editable ? `<div class="match-copy-target"><label for="match-deck-slot">Destination battle deck</label><div class="match-deck-choice"><select id="match-deck-slot" aria-describedby="match-copy-note">${profile.decks.map((_, slot) => `<option value="${slot}" ${view.slot === slot ? "selected" : ""}>Battle deck ${slot + 1}${profile.activeDeck === slot ? " (active)" : ""}</option>`).join("")}</select>${icon("chevron-down")}</div><p id="match-copy-note">Replaces battle deck ${view.slot + 1} and selects it.</p></div>` : ""}<div class="match-decks">${section("yours")}${section("opponent")}</div>${editable ? '<p class="match-practice-note" id="match-try-note">Try either recorded deck as your temporary player deck, then choose a practice matchup. Your saved slots stay the same.</p>' : ""}${view.notice ? `<div class="match-deck-status" role="status"><span id="match-deck-notice">${esc(view.notice)}</span>${view.undo ? `<button class="text-button" id="undo-match-deck" aria-describedby="match-deck-notice">Undo deck change</button>` : ""}</div>` : ""}<div class="replay-export"><button class="secondary-button" id="export-replay-file">${icon("hard-drive-download")} Export replay</button><p>Save this recording to watch in another browser.</p><p class="replay-file-error" role="alert" hidden></p></div><div class="match-details-actions"><button class="text-button" id="match-log">Back to battle log</button><button class="primary-button" id="match-replay">${icon("play")} Watch this replay</button></div></div>`,
    "match-details",
    true,
  );
  bindDeckCodeButtons(decks, "Back to battle details");
  $("#match-log").onclick = showHistory;
  $("#match-replay").onclick = () =>
    watchPreviewReplay(record, $("#match-replay"), "Back to battle details");
  $("#export-replay-file").onclick = () => {
    const error = $(".replay-file-error");
    error.hidden = true;
    try {
      const text = exportReplayFile(record, profile.name);
      downloadJson(
        text,
        replayFileName(record),
      );
    } catch (cause) {
      error.textContent =
        cause instanceof Error ? cause.message : "Couldn’t export this replay.";
      error.hidden = false;
    }
  };
  document
    .querySelectorAll<HTMLButtonElement>("[data-match-card]")
    .forEach((button) => {
      button.onclick = () =>
        showCard(button.dataset.matchCard as CardId, returnToModal(button));
    });
  if (!editable) return;
  document
    .querySelectorAll<HTMLButtonElement>("[data-try-match-deck]")
    .forEach((button) => {
      button.onclick = () => {
        const side = button.dataset.tryMatchDeck as "yours" | "opponent";
        tryPracticeDeck(
          {
            name:
              side === "yours"
                ? (record.playerName ?? profile.name)
                : (record.opponent ?? "Royal Trainer"),
            style: "Recorded deck",
            deck: decks[side],
            category: "Recorded deck",
          },
          button,
          "Back to battle details",
        );
      };
    });
  bindPracticeOptions();
  $("#practice-recorded-deck").onclick = () => {
    if (screen === "lobby")
      startBattle(false, recordedPractice(record, practiceMode));
  };
  $("#match-deck-slot").onchange = () => {
    view.slot = Number($<HTMLSelectElement>("#match-deck-slot").value);
    $("#match-copy-note").textContent =
      `Replaces battle deck ${view.slot + 1} and selects it.`;
  };
  document
    .querySelectorAll<HTMLButtonElement>("[data-use-match-deck]")
    .forEach((button) => {
      button.onclick = () => {
        if (screen !== "lobby") return;
        if (!prepareChange()) return;
        const side = button.dataset.useMatchDeck as "yours" | "opponent";
        const undo =
          view.undo && isActiveDeck(profile, decks[side], view.slot)
            ? view.undo
            : useRecordedDeck(profile, record, side, view.slot);
        saveProfile(profile);
        refreshDeck();
        showMatchDetails(index, {
          record,
          slot: view.slot,
          undo,
          notice: storageAvailable
            ? `Battle deck ${view.slot + 1} selected and saved.`
            : `Battle deck ${view.slot + 1} selected for this session. Browser storage is unavailable.`,
        });
        $("#undo-match-deck").focus();
      };
    });
  if (view.undo)
    $("#undo-match-deck").onclick = () => {
      if (screen !== "lobby") return;
      if (!prepareChange()) return;
      restoreDeckSelection(profile, view.undo!);
      saveProfile(profile);
      refreshDeck();
      showMatchDetails(index, {
        record,
        slot: view.slot,
        notice: storageAvailable
          ? "Previous decks restored."
          : "Previous decks restored for this session. Browser storage is unavailable.",
      });
      $("#match-deck-slot").focus();
    };
}
function showSettings() {
  const original = {
    name: profile.name,
    sound: profile.sound,
    music: profile.music,
  };
  const backups =
    screen === "lobby"
      ? `<section class="progress-backup" aria-labelledby="backup-heading"><h3 id="backup-heading">Your progress, to go</h3><p>Save your decks, rewards and battle log to a file, or restore a backup from another browser.</p><div class="backup-actions"><button type="button" class="secondary-button" id="export-progress">${icon("hard-drive-download")} Export progress</button><button type="button" class="secondary-button" id="import-progress">Restore backup ${icon("rotate-ccw")}</button></div><input type="file" id="progress-file" accept=".json,application/json" aria-label="Choose progress backup" hidden/><p class="backup-error" role="alert" hidden></p></section>`
      : "";
  const saveNote = storageAvailable
    ? "Progress saves automatically on this browser."
    : screen === "lobby"
      ? "Browser storage is unavailable. Export a backup below to keep your progress."
      : "Browser storage is unavailable. Progress lasts for this session.";
  modal(
    "Make yourself at home",
    `<form id="settings-form"><label class="field-label" for="player-name">PLAYER NAME</label><input class="name-input" id="player-name" maxlength="18" value="${esc(profile.name)}" required/><div class="setting-row"><div>${icon("volume-2")}<span><b>Sound effects</b><small>Deploys, spells, and a familiar king laugh</small></span></div><label class="switch"><input type="checkbox" id="sound-setting" aria-label="Sound effects" ${profile.sound ? "checked" : ""}/><span></span></label></div><div class="setting-row"><div>${icon("music-2")}<span><b>Battle music</b><small>The soundtrack to your next victory</small></span></div><label class="switch"><input type="checkbox" id="music-setting" aria-label="Battle music" ${profile.music ? "checked" : ""}/><span></span></label></div><div class="setting-row"><div>${icon("maximize")}<span><b>More room for the arena</b><small>Toggle fullscreen mode</small></span></div><button type="button" class="icon-button" id="fullscreen" aria-label="Toggle fullscreen">${icon("expand")}</button></div><div class="save-note">${icon(storageAvailable ? "shield-check" : "hard-drive-download")}<span>${saveNote}</span></div><button type="submit" class="primary-button">Save settings ${icon("check")}</button></form>`,
    "settings",
  );
  $("#settings-form").insertAdjacentHTML(
    "afterend",
    `<button class="secondary-button" id="settings-help">${icon("scroll-text")} How to play</button>${backups}`,
  );
  const view = $("#modal-root").firstElementChild!;
  const panel = view.querySelector<HTMLElement>(".modal")!;
  const returnToSettings = (opener: HTMLElement) => {
    const scroll = panel.scrollTop;
    return () => {
      modalKey = "settings";
      modalFocus.render("settings", () =>
        $("#modal-root").replaceChildren(view),
      );
      syncGraphicsStatus();
      syncFullscreenControl();
      panel.scrollTop = scroll;
      opener.focus({ preventScroll: true });
    };
  };
  $("#settings-help").onclick = () =>
    showHelp(returnToSettings($("#settings-help")));
  refreshIcons();
  if (backups) {
    $("#export-progress").onclick = () => {
      downloadJson(
        exportProgress(profile),
        exportFileName("progress", new Date(), profile.name),
      );
    };
    const input = $<HTMLInputElement>("#progress-file");
    const restore = $<HTMLButtonElement>("#import-progress");
    restore.onclick = () => {
      input.value = "";
      input.click();
    };
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const error = $(".backup-error");
      error.hidden = true;
      restore.disabled = true;
      try {
        if (file.size > MAX_BACKUP_BYTES)
          throw new Error("Choose a progress backup smaller than 2 MB.");
        const imported = importProgress(await file.text());
        if (document.querySelector("#progress-file") !== input) return;
        input.value = "";
        showProgressRestore(imported, returnToSettings(restore));
      } catch (cause) {
        if (document.querySelector("#progress-file") !== input) return;
        error.textContent =
          cause instanceof Error
            ? cause.message
            : "Couldn’t read this backup. Try another file.";
        error.hidden = false;
      } finally {
        restore.disabled = false;
      }
    };
  }
  $("#settings-form").onsubmit = (e) => {
    e.preventDefault();
    applySettingsDraft(
      profile,
      original,
      {
        name: $<HTMLInputElement>("#player-name").value,
        sound: $<HTMLInputElement>("#sound-setting").checked,
        music: $<HTMLInputElement>("#music-setting").checked,
      },
      storageAvailable ? readSavedProfile() : null,
    );
    emotes.setMuted(profile.emotesMuted, false);
    audio.setEnabled(profile.sound);
    audio.musicEnabled = profile.music;
    if (graphicsAvailable && screen !== "lobby" && !paused && !battle.winner)
      audio.startMusic(battle.time);
    if (!profile.music) audio.stopMusic();
    saveProfile(profile);
    refreshProfile();
    refreshSound();
    closeModal();
    toast(
      storageAvailable
        ? "Settings saved."
        : "Settings applied for this session. Browser storage is unavailable.",
    );
  };
  $("#fullscreen").onclick = async () => {
    if (fullscreenPending) return;
    fullscreenPending = true;
    syncFullscreenControl();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      toast("Fullscreen is unavailable in this browser.");
    } finally {
      fullscreenPending = false;
      syncFullscreenControl();
    }
  };
  syncFullscreenControl();
}
function syncFullscreenControl() {
  const button = document.querySelector<HTMLButtonElement>("#fullscreen");
  if (!button) return;
  const active = !!document.fullscreenElement;
  setAttribute(button, "aria-pressed", String(active));
  setAttribute(button, "aria-busy", String(fullscreenPending));
  setAttribute(button, "title", active ? "Exit fullscreen" : "Enter fullscreen");
  button.disabled = fullscreenPending;
}
document.addEventListener("fullscreenchange", syncFullscreenControl);
function showProgressRestore(imported: Profile, back: () => void) {
  modal(
    "Restore your kingdom?",
    `<div class="restore-progress"><p>This replaces the progress saved in this browser.</p><h3>${esc(imported.name)}</h3><dl><div><dt>Trophies</dt><dd>${fmt(imported.trophies)}</dd></div><div><dt>Gold</dt><dd>${fmt(imported.gold)}</dd></div><div><dt>Saved replays</dt><dd>${imported.history.length}</dd></div></dl><button class="primary-button" id="confirm-restore">Restore progress ${icon("check")}</button><button class="text-button" id="cancel-restore">Keep current progress</button></div>`,
    "restore-progress",
  );
  $("#cancel-restore").onclick = back;
  $("#confirm-restore").onclick = () => {
    network.leave();
    Object.assign(profile, imported);
    applyProfilePreferences();
    audio.stopMusic();
    saveProfile(profile);
    closeModal();
    lobby();
    toast(
      storageAvailable
        ? "Progress restored."
        : "Progress restored for this session. Browser storage is unavailable.",
    );
  };
}
function toggleSoundEffects() {
  saveSoundPreference(profile, !profile.sound);
  applyProfilePreferences();
  refreshProfile();
  audio.play("button_click_02");
}
function refreshSound() {
  document.querySelectorAll<HTMLElement>(".sound-toggle,#battle-sound-button").forEach((button) => {
    const label = profile.sound ? "Mute sound effects" : "Enable sound effects";
    button.innerHTML = icon(profile.sound ? "volume-2" : "volume-x");
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-keyshortcuts", "m");
    button.title = `${label} (M)`;
  });
  refreshIcons();
}

function showHelp(back?: () => void) {
  const replay = screen === "replay";
  const steps = replay
    ? `<div class="help-steps"><div><b>1</b><span><h3>Find the moment.</h3><p>Drag the timeline or use the ten-second skip buttons. Open Plays to jump to a recorded card play. Seeking keeps your speed and paused state.</p></span></div><div><b>2</b><span><h3>See either side.</h3><p>Use View opponent side beside Battle settings to switch the arena, hand, elixir and names. View recorded player side switches back.</p></span></div><div><b>3</b><span><h3>Read the hand.</h3><p>Tap a hand card or press 1–4 to inspect its level-11 stats. Reading a card pauses playback. Back to replay restores the previous playback state, speed and viewing side.</p></span></div><div><b>4</b><span><h3>Study the timing.</h3><p>Use the speed and pause controls to review a push. Restart replay begins again with the chosen speed and viewing side.</p></span></div></div>`
    : `<div class="help-steps"><div><b>1</b><span><h3>Pick your eight.</h3><p>Your deck has eight unique cards. Four are in your hand; playing one draws the next card.</p></span></div><div><b>2</b><span><h3>Make your move.</h3><p>Tap a card, then a valid position, or drag it into the arena. Most troops deploy on your half; most spells can target either half. Miner can tunnel across the river, and The Log starts on your side. Taking a Princess Tower opens that lane for deployment.</p></span></div><div><b>3</b><span><h3>Protect your kingdom.</h3><p>Troops fight automatically. Use tanks to soak up damage, ranged support to back them up, and spells to clear swarms.</p></span></div><div><b>4</b><span><h3>Take the crown.</h3><p>Destroy more towers in three minutes. Ties go to sudden death, then a lowest-tower-health tiebreaker. Destroying the King Tower wins instantly.</p></span></div></div>`;
  const shortcuts = replay
    ? `<div class="keyboard-help"><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd> Inspect hand card</span><span><kbd>←</kbd><kbd>→</kbd> Skip ten seconds</span><span><kbd>Shift</kbd><kbd>←</kbd><kbd>→</kbd> Skip one second</span><span><kbd>Home</kbd><kbd>End</kbd> Start / end</span><span><kbd>[</kbd><kbd>]</kbd> Previous / next play</span><span><kbd>−</kbd><kbd>+</kbd> Slower / faster</span><span><kbd>M</kbd> Sound effects</span><span><kbd>Space</kbd> Pause / resume / restart</span><span><kbd>Esc</kbd> Close dialog / pause</span></div>`
    : `<div class="keyboard-help"><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd> Select card</span><span><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> Aim · Shift for larger steps</span><span><kbd>Enter</kbd> Deploy</span><span><kbd>Esc</kbd> Cancel / pause</span><span><kbd>M</kbd> Sound effects</span><span><kbd>Space</kbd> Pause</span></div>`;
  modal(
    replay ? "Replay controls" : "Your first crown starts here.",
    `${steps}${shortcuts}${replay ? '<p class="room-note">Focus the arena to use these shortcuts. Timeline and menu controls keep their usual keys.</p>' : ""}<button class="primary-button" id="help-done">${back ? `Back to settings ${icon("arrow-right")}` : `Ready for the arena ${icon("swords")}`}</button>`,
    "help",
  );
  $("#help-done").onclick = back ?? closeModal;
}

function updateCombatAudio() {
  combatAudio.update(
    battle.time,
    !graphicsAvailable || paused || (multiplayer && !!network.room?.paused),
    new Set(
      battle.entities
        .filter((entity) => entity.hp > 0)
        .map((entity) => entity.id),
    ),
  );
}
function processEvents() {
  if (!graphicsAvailable) {
    eventCursor = battle.events.at(-1)?.id ?? eventCursor;
    combatAudio.skip(battle.audioEvents);
    deathAudio.reset();
    return;
  }
  combatAudio.consume(battle.audioEvents, battle.seed, battle.time);
  for (const ev of battle.events) {
    if (ev.id <= eventCursor) continue;
    eventCursor = ev.id;
    deathAudio.queue(ev, battle.seed, battle.time, battle.nativeTowerLayout);
    if (
      ev.team === "blue" &&
      (ev.type === "deploy" || ev.type === "spell") &&
      ev.card &&
      ev.card !== "tower"
    )
      elixir.spend(
        ev.value ?? battle.cardCost(ev.team, ev.card) ?? CARD_MAP[ev.card].cost,
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
    graphicsAvailable = false;
    peerNetwork?.setGameplayAvailable(false);
    cancelPointer();
    selected = -1;
    $("#hand-caption").textContent =
      "Select a card, then tap your side of the arena";
    $("#deploy-hint").textContent = "Select a card to deploy";
    accumulator = 0;
    audio.stopMusic();
    audio.stopEffects();
    emotes.suspend();
    if (!multiplayer && screen !== "lobby" && !paused) togglePause();
    syncGraphicsStatus();
    updateBattleUI(true);
  };
  arena.onContextRestored = () => {
    graphicsAvailable = true;
    accumulator = 0;
    syncGraphicsStatus();
    if (modalKey === "room") showMultiplayer();
    updateBattleUI(true);
    if (!document.hidden && screen === "battle" && !paused && !battle.winner)
      audio.startMusic(battle.time);
    toast("Arena graphics restored.");
    // Do not turn time spent rebuilding graphics into catch-up simulation.
    frameTime = performance.now();
    lastRenderTime = lastFpsTime = frameTime;
    fpsFrames = 0;
    peerNetwork?.setGameplayAvailable(true);
  };
  arena.onCharge = (burst) => {
    if (
      !graphicsAvailable ||
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
      burst.effect === "charge:dark-prince"
        ? "dark-prince"
        : burst.effect === "charge:battle-ram"
          ? "battle-ram"
          : "prince",
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
arena.renderer.domElement.addEventListener("blur", () => {
  clearKeyboardAim();
  refreshPlacement();
});
arena.host.addEventListener("pointermove", (e) => {
  if (!e.isPrimary) return;
  clearKeyboardAim();
  hover = arena.point(e.clientX, e.clientY);
  refreshPlacement();
});
arena.host.addEventListener("pointerleave", (event) => {
  // Touch leaves after every tap; retain a rejected placement and its reason.
  if (event.pointerType === "touch" && selected >= 0) return;
  if (!dragging && !keyboardAiming) {
    hover = null;
    refreshPlacement();
  }
});
arena.host.addEventListener("pointerdown", (e) => {
  if (!e.isPrimary) return;
  if (screen !== "battle" || selected < 0 || paused || pointerDown) return;
  clearKeyboardAim();
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
  clearKeyboardAim();
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
$("#how-to-play").onclick = () => showHelp();
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
$(".sound-toggle").onclick = toggleSoundEffects;
$("#battle-sound-button").onclick = toggleSoundEffects;
$("#pause-button").onclick = togglePause;
$("#replay-play").onclick = () => {
  if (replayData && replayComplete(battle, replayData) && replayRecord)
    playReplay(
      replayRecord,
      replayRecordedName ?? undefined,
      replayOpponentView,
      speed,
    );
  else togglePause();
};
$("#replay-side").onclick = () => {
  if (screen !== "replay" || !replayRecord || !graphicsAvailable) return;
  const tick = replaySeeks.target ?? battle.tick;
  setReplayView(replayRecord, replayRecordedName ?? profile.name, !replayOpponentView);
  seekReplay(tick);
};
$("#replay-speed").onclick = () => {
  const next =
    speed === 1
      ? 2
      : speed === 2
        ? 4
        : speed === 4
          ? 0.5
          : speed === 0.5
            ? 0.25
            : 1;
  setReplaySpeed(next);
};
$("#replay-exit").onclick = () => {
  const returnTo = replayReturn;
  lobby();
  returnTo?.restore();
};
function seekReplayPlay(play: ReplayPlay) {
  ($("#replay-plays") as HTMLSelectElement).value = String(play.tick);
  seekReplay(play.targetTick);
}
$("#replay-plays").addEventListener("change", () => {
  if (screen !== "replay") return;
  const value = ($("#replay-plays") as HTMLSelectElement).value;
  if (value === "") return;
  const play = replayPlays.find((play) => play.tick === Number(value));
  if (play) seekReplayPlay(play);
});
// Reopening permits selecting the same play again after playback moves on.
for (const type of ["pointerdown", "focus"])
  $("#replay-plays").addEventListener(type, () => {
    ($("#replay-plays") as HTMLSelectElement).value = "";
  });
// Preserve native arrow navigation, typeahead and Escape inside this control.
$("#replay-plays").addEventListener("keydown", (event) =>
  event.stopPropagation(),
);
function seekReplay(targetTick: number) {
  if (screen !== "replay" || !replayData) return;
  replaySeeks.cancel();
  resetEnding();
  announcements.reset();
  intro.skip();
  audio.stopEffects();
  createReplayBattle(replayData, targetTick);
  arena.setBattle(battle);
  eventCursor = battle.events.at(-1)?.id ?? 0;
  combatAudio.skip(battle.audioEvents);
  elixir.reset(battle.time, battle.players.blue.elixir, battle.multiplier);
  nativeCards.reset(battle.time, battle.players.blue.hand);
  matchHud.reset(arena.effectTime, crownCounts());
  accumulator = 0;
  updateBattleUI(true);
  if (graphicsAvailable && !paused && !battle.winner)
    audio.startMusic(battle.time);
  if (battle.winner) startEnding(true);
}
function cancelReplaySeeks() {
  replayScrubPointer = null;
  replaySeeks.cancel();
}
function finishReplayScrub() {
  replayScrubPointer = null;
  replaySeeks.flush();
}
$("#replay-back").onclick = () =>
  seekReplay((replaySeeks.target ?? battle.tick) - 10 / STEP);
$("#replay-forward").onclick = () =>
  seekReplay((replaySeeks.target ?? battle.tick) + 10 / STEP);
$("#replay-seek").addEventListener("pointerdown", (event) => {
  if (screen === "replay") replayScrubPointer = (event as PointerEvent).pointerId;
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  window.addEventListener(type, (event) => {
    if ((event as PointerEvent).pointerId === replayScrubPointer)
      finishReplayScrub();
  });
$("#replay-seek").addEventListener("change", () => replaySeeks.flush());
$("#replay-seek").addEventListener("input", () => {
  if (screen !== "replay" || !replayData) return;
  const target =
    (Number(($("#replay-seek") as HTMLInputElement).value) / 100) *
    replayData.duration;
  if (replayScrubPointer !== null) replaySeeks.request(target);
  else seekReplay(target);
});
$("#about-button").onclick = () =>
  modal(
    "Made for the love of the game.",
    `<div class="about-content"><span class="about-crown">${icon("crown")}</span><p>An independent browser fan project. Built with TypeScript and Three.js, with local saves and a deterministic battle simulation.</p><p>This project is not affiliated with, endorsed, sponsored, or specifically approved by Supercell. Clash Royale artwork, audio, and trademarks belong to Supercell.</p><p>Card art, renders, and audio sourced from <a href="https://github.com/RoyaleAPI/cr-api-assets" target="_blank" rel="noreferrer">RoyaleAPI's asset collection</a>. Original troop and building animations, projectile effects and scenery are reconstructed from archived game assets. Surrounding 3D geometry, particles and fallback models were created for this project.</p><small>${CARDS.length} curated cards · Classic rules · Level 11 standard · AI battles<br>Not a live balance replica. Direct browser-to-browser friendly battles over Wi-Fi or compatible remote networks. No official game account connection.</small></div>`,
    "about",
  );
document.addEventListener("keydown", (e) => {
  if (
    !e.defaultPrevented &&
    !e.altKey &&
    (e.ctrlKey || e.metaKey) &&
    modalKey === "deck" &&
    screen === "lobby" &&
    !(e.target as HTMLElement).closest(
      "input,textarea,select,[contenteditable]:not([contenteditable=false])",
    ) &&
    (e.key.toLowerCase() === "z" ||
      (e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "y"))
  ) {
    e.preventDefault();
    if (!e.repeat)
      restoreDeckEdit(
        e.shiftKey || e.key.toLowerCase() === "y" ? "redo" : "undo",
        true,
      );
    return;
  }
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  // Holding Escape must not cancel a card or close a dialog and then pause.
  if (e.key === "Escape" && e.repeat) {
    e.preventDefault();
    return;
  }
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
  if (!modalKey && (e.target as HTMLElement).matches("input,textarea,select"))
    return;
  if (e.key === "Escape") {
    if (modalKey) {
      closeModal();
      return;
    }
    if (selected >= 0) {
      const fromKeyboard = keyboardAiming;
      clearKeyboardAim();
      if (fromKeyboard)
        $("#keyboard-deployment-status").textContent = "Deployment cancelled.";
      selected = -1;
      arena.showPlacement(null, null);
      updateBattleUI();
      return;
    }
    togglePause();
  }
  if (modalKey) {
    if (
      modalKey === "pause" &&
      e.code === "Space" &&
      (e.repeat ||
        !(e.target as HTMLElement).closest(
          "button,a[href],input,textarea,select",
        ))
    ) {
      e.preventDefault();
      if (!e.repeat) closeModal();
      return;
    }
    if (e.key === "Tab") {
      const focusables = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".modal button:not(:disabled),.modal input:not(:disabled),.modal select:not(:disabled),.modal textarea:not(:disabled),.modal a[href]",
        ),
      ).filter(
        (element) =>
          element.tabIndex >= 0 && element.getClientRects().length > 0,
      );
      const current = focusables.indexOf(document.activeElement as HTMLElement);
      const next =
        current < 0
          ? e.shiftKey
            ? focusables.length - 1
            : 0
          : (current + (e.shiftKey ? -1 : 1) + focusables.length) %
            focusables.length;
      focusables[next]?.focus();
      e.preventDefault();
    }
    return;
  }
  if (
    e.key.toLowerCase() === "m" &&
    ((e.target as HTMLElement).closest(".sound-toggle,#battle-sound-button") ||
      !(e.target as HTMLElement).closest(
        "button,a[href],input,textarea,select,[contenteditable]:not([contenteditable=false])",
      ))
  ) {
    e.preventDefault();
    if (!e.repeat) toggleSoundEffects();
    return;
  }
  if (
    screen === "replay" &&
    ["-", "=", "+"].includes(e.key) &&
    !(e.target as HTMLElement).closest(
      "button,a[href],input,textarea,select,[contenteditable]:not([contenteditable=false])",
    )
  ) {
    e.preventDefault();
    if (!e.repeat) {
      const rates = [0.25, 0.5, 1, 2, 4];
      const index = rates.indexOf(speed) + (e.key === "-" ? -1 : 1);
      setReplaySpeed(rates[Math.max(0, Math.min(rates.length - 1, index))]);
    }
    return;
  }
  if (
    screen === "replay" &&
    replayData &&
    !(e.target as HTMLElement).closest(
      "button,a[href],input,textarea,select,[contenteditable]:not([contenteditable=false])",
    ) &&
    ["ArrowLeft", "ArrowRight", "Home", "End", "[", "]"].includes(e.key)
  ) {
    e.preventDefault();
    if (e.key === "[" || e.key === "]") {
      const play =
        !e.repeat &&
        adjacentReplayPlay(
          replayPlays,
          replaySeeks.target ?? battle.tick,
          e.key === "[" ? -1 : 1,
        );
      if (play) seekReplayPlay(play);
      return;
    }
    if (!e.repeat)
      seekReplay(
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? replayData.duration
            : (replaySeeks.target ?? battle.tick) +
              ((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 10)) / STEP,
      );
    return;
  }
  if (["1", "2", "3", "4"].includes(e.key)) {
    if (!e.repeat) {
      const slot = Number(e.key) - 1;
      if (screen === "replay") inspectReplayCard(slot);
      else selectCard(slot, true);
    }
    e.preventDefault();
  }
  if (
    screen === "battle" &&
    selected >= 0 &&
    !paused &&
    !battle.winner &&
    !intro.clock.blocking &&
    document.activeElement === arena.renderer.domElement
  ) {
    const moved = moveKeyboardTarget(
      keyboardAiming
        ? keyboardTarget!
        : (hover ?? keyboardTarget ?? DEFAULT_KEYBOARD_TARGET),
      e.key,
      e.shiftKey,
    );
    if (moved) {
      e.preventDefault();
      keyboardTarget = moved;
      beginKeyboardAim();
      refreshPlacement();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (!e.repeat) {
        if (!keyboardAiming)
          keyboardTarget = {
            ...(hover ?? keyboardTarget ?? DEFAULT_KEYBOARD_TARGET),
          };
        beginKeyboardAim();
        deploy(keyboardTarget!);
      }
      return;
    }
  }
  if (e.code === "Space" && screen !== "lobby") {
    // Keep native keyboard behavior for focused buttons and links.
    if ((e.target as HTMLElement).closest("button,a[href],[role=button]"))
      return;
    e.preventDefault();
    if (!e.repeat) {
      if (screen === "replay") $("#replay-play").click();
      else togglePause();
    }
  }
});
function suspendFrameLoop() {
  replayScrubPointer = null;
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
  syncIdleProfile();
  if (document.hidden || frameHandle !== undefined) return;
  arena.requestFrame();
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
window.addEventListener("storage", (event) => {
  if (event.key === PROFILE_STORAGE_KEY) syncIdleProfile();
});

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
  if (
    graphicsAvailable &&
    screen !== "lobby" &&
    !paused &&
    !battle.winner &&
    !(screen === "replay" && replaySeeks.target !== undefined)
  ) {
    const wasOpening = intro.clock.blocking;
    accumulator += intro.clock.advance(
      multiplayer && network.room?.paused ? 0 : Math.min(5, elapsed) * speed,
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
        replayComplete(battle, replayData)
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
  const presentationPaused =
    !graphicsAvailable || paused || (multiplayer && !!network.room?.paused);
  audio.syncMusic(
    battle.time,
    screen !== "lobby" &&
      !presentationPaused &&
      !battle.winner &&
      (!multiplayer || network.connected),
  );
  if (presentationPaused && !soundPaused) audio.stopEffects();
  soundPaused = presentationPaused;
  if (screen !== "lobby" && !battle.winner) {
    updateCombatAudio();
    deathAudio.update(battle.time, presentationPaused);
  }
  const idle = screen === "lobby" || presentationPaused || !!battle.winner;
  const frozen =
    (paused && !multiplayer && screen !== "lobby" && !battle.winner) ||
    (screen === "lobby" && !!modalKey) ||
    (screen === "battle" && !!battle.winner && modalKey === "result");
  const frozenChanged = !renderedFrozen || arena.needsFrame || renderedBattle !== battle ||
    renderedTick !== battle.tick;
  if (frozen && !frozenChanged) {
    // Keep presentation clocks current while the saved canvas is at rest.
    // Resuming must not age effects by the wall time spent paused.
    lastRenderTime = lastFpsTime = now;
    fpsFrames = fps = 0;
    arena.adaptResolution(0, false);
  } else if (now - lastRenderTime >= 1000 / (idle ? 30 : arena.targetFps) - 0.5) {
    const renderElapsed = Math.max(0, (now - lastRenderTime) / 1000);
    const renderDelta = Math.min(renderElapsed, 0.1);
    lastRenderTime = now;
    if (screen !== "lobby") animationTime = battle.time;
    else if (!frozen) animationTime = now / 1000;
    arena.render(
      frozen
        ? 0
        : screen === "lobby" || battle.winner
          ? renderDelta
          : presentationPaused
            ? 0
            : renderDelta * speed,
      animationTime,
      frozen
        ? 0
        : screen === "lobby" || battle.winner
          ? renderElapsed
          : presentationPaused
            ? 0
            : renderElapsed * speed,
    );
    renderedBattle = battle;
    renderedTick = battle.tick;
    renderedFrozen = frozen;
    frameCount++;
    fpsFrames++;
    if (now - lastFpsTime >= 1000) {
      fps = Math.round((fpsFrames * 1000) / (now - lastFpsTime));
      arena.adaptResolution(
        fps,
        screen === "battle" &&
          !presentationPaused &&
          !battle.winner &&
          !intro.clock.blocking,
      );
      fpsFrames = 0;
      lastFpsTime = now;
    }
  }
  if (now - lastUi > 90) {
    syncGraphicsStatus();
    if (screen !== "lobby") updateBattleUI();
    if (multiplayer) updateConnection();
    lastUi = now;
  }
  announcements.update(battle, screen !== "lobby");
  intro.update(screen !== "lobby" && !battle.winner);
  if (screen !== "lobby") {
    nativeCards.animateHand($("#hand"), battle.time);
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
  offlineUpdates.update();
  emotes.update(
    presentationPaused ? 0 : delta,
    screen === "battle" &&
      !presentationPaused &&
      !battle.winner &&
      !intro.clock.blocking &&
      (!multiplayer || network.connected),
  );
  if (pendingResult) {
    if (pendingResult.battle !== battle || screen !== "battle")
      pendingResult = null;
    else if (
      !graphicsAvailable ||
      (arena.effectTime >= pendingResult.time && ending.clock.finished)
    ) {
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
        speed,
        graphicsAvailable,
        selected,
        time: battle.time,
        seed: battle.seed,
        rulesVersion: battle.rulesVersion,
        rulesFamily: battle.rulesFamily,
        winner: battle.winner,
        reason: battle.reason,
        loadedEmotes: emotes.loaded,
        music: audio.musicState,
        emotes: emotes.state,
        elixir: battle.players.blue.elixir,
        hand: [...battle.players.blue.hand],
        opponentName,
        enemyDeck: multiplayer ? undefined : [...battle.enemyDeck],
        lastPlayed: battle.players.blue.lastPlayed ?? null,
        handCosts: battle.players.blue.hand.map((id) =>
          battle.cardCost("blue", id),
        ),
        troops: battle.entities.filter((e) => e.kind === "troop").length,
        actions: multiplayer
          ? network.actionCount
          : (replaySource?.actions.length ?? battle.actions.length),
        multiplayer: multiplayer
          ? {
              team: network.team,
              code: network.room?.code,
              matchId: network.room?.matchId,
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
        renderPending: arena.needsFrame,
        animationTime,
        frameLoopRunning: frameHandle !== undefined,
        drawCalls: arena.renderer.info.render.calls,
        renderPixelRatio: arena.renderer.getPixelRatio(),
        renderTargetFps: arena.targetFps,
        loadedEffects: arena.loadedEffects,
        projectileArtwork: arena.projectileState,
        infernoBeams: arena.infernoBeamState,
        minerTrails: arena.minerTrailState,
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
        rageAreas: arena.rageAreaState,
        rageFilter: arena.rageFilterState,
        rageStructures: arena.rageStructureState,
        poisonAreas: arena.poisonAreaState,
        healAreas: battle.areas.filter((area) => area.card === "heal"),
        poisonFilter: arena.poisonFilterState,

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

        poisonStructures: arena.poisonStructureState,
        shake: arena.shakeState,
        placement: arena.placementState,
        loadedAnimations: arena.loadedAnimations,
        spriteGeometry: arena.spriteGeometryCache,
        nativeTowerPrincesses: arena.nativeTowerPrincesses,
        nativePrincessTowers: arena.nativePrincessTowers,
        nativeBombTowerBombers: arena.nativeBombTowerBombers,
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
    void offlineUpdates.register();
  };
  if (document.readyState === "complete") install();
  else window.addEventListener("load", install, { once: true });
}
