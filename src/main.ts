import "@fontsource/lilita-one/latin-400.css";
import "@fontsource/nunito-sans/latin-400.css";
import "@fontsource/nunito-sans/latin-600.css";
import "@fontsource/nunito-sans/latin-700.css";
import "@fontsource/nunito-sans/latin-800.css";
import "./style.css";
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
audio.enabled = profile.sound;
audio.musicEnabled = profile.music;
let arena: Arena;
let battle: Battle;
let screen: "lobby" | "battle" | "replay" = "lobby";
let mode: Mode = "classic";
let selected = -1;
let paused = false;
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
let lastPhase = "normal";
let frameCount = 0;
let fps = 60;

const modeNames: Record<Mode, string> = {
  classic: "Classic 1v1",
  training: "Training camp",
  double: "Double elixir",
};
const cardHTML = (id: CardId, attrs = "", extra = "") => {
  const c = CARD_MAP[id];
  return `<button class="game-card ${c.rarity.toLowerCase()} ${extra}" ${attrs} aria-label="${c.name}, ${c.cost} elixir"><span class="cost">${c.cost}</span><img src="${cardArt(id)}" alt="${c.name}" draggable="false"/><span class="card-level">Level 11</span><span class="card-name">${c.name}</span></button>`;
};

$("#app").innerHTML = `
 <div class="app-shell">
  <header class="topbar">
   <a class="brand" href="#" aria-label="Clash Royale home"><span class="brand-shield">${icon("crown")}</span><span><b>CLASH <em>ROYALE</em></b><small>BROWSER ARENA</small></span></a>
   <nav class="primary-nav" aria-label="Main navigation"><button data-nav="battle" class="active">${icon("swords")}<span>Battle</span></button><button data-nav="cards">${icon("layers-2")}<span>Cards</span><b>24</b></button><button data-nav="history">${icon("history")}<span>Battle log</span></button></nav>
   <div class="top-actions"><div class="gold-wallet" title="Gold earned from battles and chests"><span class="coin">${icon("coins")}</span><b id="gold">${fmt(profile.gold)}</b><span class="wallet-label">GOLD</span></div><button class="icon-button sound-toggle" aria-label="Toggle sound">${icon(profile.sound ? "volume-2" : "volume-x")}</button><button class="avatar" data-settings aria-label="Player settings">T<span></span></button></div>
  </header>
  <div class="workspace">
   <aside class="left-sidebar">
    <section class="player-card"><div class="player-insignia">${icon("shield")}<span>1</span></div><div><span class="eyebrow">YOUR KINGDOM</span><h2 class="player-name">${esc(profile.name)}</h2><span class="player-status"><i></i> Ready for battle</span></div><button class="small-icon" data-settings aria-label="Edit profile">${icon("pencil")}</button></section>
    <section class="journey panel"><div class="section-heading"><h3>Trophy road</h3>${icon("trophy")}</div><div class="trophy-total">${icon("trophy")}<b id="trophies">${fmt(profile.trophies)}</b><span>TROPHIES</span></div><div class="road-line"><span id="road-progress"></span><b>1</b><b>2</b></div><div class="road-caption"><span>Goblin Stadium</span><b id="road-count">0 / 300</b></div><div class="next-arena"><img src="/assets/arenas/arena2.png" alt="Bone Pit arena"/><div><small>NEXT MILESTONE</small><b>Bone Pit</b><span>300 trophies</span></div>${icon("lock-keyhole")}</div></section>
    <section class="feature-card"><div class="feature-glow"></div><span class="eyebrow">A CROWN IS EARNED</span><h3>Small cards.<br>Big plays.</h3><p>Every elixir counts.<br>Make your next move matter.</p><img src="/assets/characters/knight.png" alt="Knight raising his sword"/><span class="feature-mark">${icon("swords")}</span></section>
    <div class="local-save">${icon("hard-drive-download")}<div><b>YOUR PROGRESS, SAVED</b><span>Stored on this browser</span></div><i></i></div>
   </aside>
   <main class="arena-panel">
    <div class="arena-heading"><div><span class="eyebrow">ARENA 1</span><h1>Goblin Stadium</h1></div><button class="mode-select">${icon("swords")}<span id="mode-name">Classic 1v1</span>${icon("chevron-down")}</button><button class="icon-button" id="arena-settings" aria-label="Battle settings">${icon("settings-2")}</button></div>
    <div class="arena-stage" id="arena-stage"><div class="arena-vignette"></div><div class="arena-canvas" id="arena-canvas"></div>
     <div class="arena-corner top-left"></div><div class="arena-corner bottom-right"></div>
     <div class="lobby-badge"><span class="live-dot"></span> THE ARENA IS YOURS</div>
     <div class="lobby-bottom"><div class="battle-button-wrap"><span class="battle-flare"></span><button id="battle-button" class="battle-button">${icon("swords")} BATTLE ${icon("chevron-right")}</button></div><span class="battle-caption">${icon("shield-check")} Level 11 cards <span>·</span> Offline AI opponent</span></div>
     <div class="match-top hidden"><div class="competitor enemy"><span class="mini-shield red">${icon("shield")}</span><div><b>Royal Trainer</b><span>Training guild</span></div></div><div class="match-timer"><span id="phase-label">TIME LEFT</span><b id="match-clock">3:00</b></div></div>
     <div class="match-crowns hidden"><div class="red">${icon("crown")}<b id="red-crowns">0</b></div><span>:</span><div class="blue"><b id="blue-crowns">0</b>${icon("crown")}</div></div>
     <div class="match-bottom hidden"><div class="competitor"><span class="mini-shield blue">${icon("shield")}</span><div><b class="player-name">${esc(profile.name)}</b><span>Browser kingdom</span></div></div><div class="battle-tools"><button id="emote-button" class="small-icon" aria-label="Send King laugh emote">${icon("smile")}</button><button id="pause-button" class="small-icon" aria-label="Pause battle">${icon("pause")}</button></div></div>
     <div class="arena-message hidden" id="arena-message"></div><div id="deploy-hint" class="deploy-hint hidden">Select a card to deploy</div>
     <div class="pause-cover hidden"><span class="eyebrow">TAKE A BREATHER</span><h2>Battle paused</h2><button class="primary-button" id="resume-button">${icon("play")} Resume battle</button><button class="text-button" id="surrender-button">Leave battle</button></div>
     <div class="emote-bubble hidden">${icon("crown")}<b>HA HA HA!</b></div>
    </div>
    <div id="lobby-footer" class="chest-tray"><div class="chest-heading"><span>VICTORY CHESTS</span><b id="chest-count">0 / 4</b></div><div class="chest-slots" id="chest-slots"></div></div>
    <div id="battle-tray" class="battle-tray hidden"><div class="hand-row"><div class="next-card"><span>NEXT</span><img id="next-card-img" alt="Next card"/><b id="next-card-cost"></b></div><div class="hand" id="hand"></div></div><div class="elixir-row"><span class="elixir-drop"><b id="elixir-number">5</b></span><div class="elixir-track"><div id="elixir-fill"></div>${"<i></i>".repeat(9)}</div><b id="elixir-rate">1×</b></div><div class="tray-caption"><span id="hand-caption">Select a card, then tap your side of the arena</span><span><kbd>1</kbd>–<kbd>4</kbd> SELECT</span></div></div>
    <div class="replay-controls hidden"><button id="replay-play" class="icon-button" aria-label="Pause replay">${icon("pause")}</button><span id="replay-clock">0:00</span><input id="replay-seek" aria-label="Replay timeline" type="range" min="0" max="100" value="0"/><button id="replay-speed" class="text-button">1×</button><button id="replay-exit" class="text-button">Exit</button></div>
   </main>
   <aside class="right-sidebar"><section class="deck-panel panel"><div class="section-heading"><div><span class="eyebrow">YOUR WINNING EIGHT</span><h3>Battle deck</h3></div><span class="deck-number">01</span></div><div class="deck-tabs" id="deck-tabs"></div><div class="deck-grid" id="deck-preview"></div><div class="deck-summary"><span><i class="tiny-drop"></i> Average elixir <b id="average-elixir">3.5</b></span><span>8 / 8</span></div><button id="edit-deck" class="secondary-button">${icon("layers-2")} Edit deck ${icon("arrow-up-right")}</button></section>
    <section class="battle-brief panel"><div class="section-heading"><h3>Battle brief</h3>${icon("scroll-text")}</div><div class="brief-item"><span>${icon("crown")}</span><div><b>Take the crown</b><p>Destroy more towers. Take the King Tower for an instant win.</p></div></div><div class="brief-item"><span class="purple">${icon("droplet")}</span><div><b>Spend wisely</b><p>Elixir refills over time. Save some to defend your side.</p></div></div><div class="brief-item"><span class="blue">${icon("timer")}</span><div><b>Three minutes. One winner.</b><p>Tied? Two-minute sudden death. Elixir speeds up as time runs out.</p></div></div><button id="how-to-play" class="text-button">How to play ${icon("arrow-right")}</button></section>
   </aside>
  </div>
  <footer class="app-footer"><span><i></i> BUILT FOR THE BROWSER. MADE FOR THE CROWN.</span><button id="about-button">Independent fan project ${icon("external-link")}</button><span class="fps-label">WEB ARENA · v0.1</span></footer>
 </div><div id="modal-root"></div><div class="toast" id="toast" role="status"></div><div id="drag-card" class="drag-card hidden"></div>`;

function refreshIcons() {
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
function showMessage(message: string, duration = 1800) {
  const m = $("#arena-message");
  m.textContent = message;
  m.classList.remove("hidden");
  setTimeout(() => m.classList.add("hidden"), duration);
}
function modal(title: string, body: string, key = "generic", wide = false) {
  if (!modalKey && screen !== "lobby" && !paused && !battle.winner) {
    paused = true;
    modalPausedBattle = true;
    audio.stopMusic();
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
      ? `<button class="chest-slot filled ${type}" data-chest="${i}"><img src="/assets/chests/${type}.png" alt="${type} chest"/><span>OPEN CHEST</span><b>${type}</b></button>`
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
    `<div class="chest-reward"><div class="reward-rays"></div><img class="reward-chest" src="/assets/chests/${reward.type}.png" alt="Opened ${reward.type} chest"/><h3>${reward.type} chest</h3><p>A little something for your next victory.</p><div class="reward-items"><span>${icon("coins")}<b>+${reward.gold}</b><small>GOLD</small></span><span>${icon("crown")}<b>Well played!</b><small>REWARD CLAIMED</small></span></div><button class="primary-button" id="claim-done">Collect rewards ${icon("check")}</button></div>`,
    "chest",
  );
  $("#claim-done").onclick = closeModal;
}

function lobby() {
  screen = "lobby";
  selected = -1;
  paused = false;
  resultShown = false;
  replayData = null;
  replayRecord = null;
  accumulator = 0;
  audio.stopMusic();
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
  $("#arena-message").classList.add("hidden");
  refreshProfile();
}
function startBattle() {
  closeModal();
  screen = "battle";
  paused = false;
  speed = 1;
  selected = -1;
  accumulator = 0;
  resultShown = false;
  replayData = null;
  eventCursor = 0;
  lastPhase = "normal";
  document.body.classList.add("in-battle");
  window.scrollTo(0, 0);
  document.body.classList.remove("in-replay");
  battle = new Battle({
    deck: profile.deck,
    mode,
    seed: Math.floor(Math.random() * 2147483646) + 1,
  });
  arena.setBattle(battle);
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
  updateBattleUI(true);
  audio.play("button_click_02");
  audio.startMusic();
  showMessage("FIGHT!", 1500);
  if (!profile.seenTutorial) {
    profile.seenTutorial = true;
    saveProfile(profile);
  }
}
let lastHand = "";
function updateBattleUI(force = false) {
  refreshPlacement();
  $("#match-clock").textContent = clock(Math.ceil(battle.remaining));
  $("#phase-label").textContent =
    battle.time >= 180 ? "SUDDEN DEATH" : "TIME LEFT";
  $(".match-timer").classList.toggle("urgent", battle.remaining <= 30);
  $("#blue-crowns").textContent = String(battle.players.blue.crowns);
  $("#red-crowns").textContent = String(battle.players.red.crowns);
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
        if (screen !== "battle" || paused) return;
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
  $("#next-card-cost").textContent = String(next.cost);
  $("#elixir-number").textContent = String(Math.floor(p.elixir));
  $("#elixir-fill").style.width = `${p.elixir * 10}%`;
  $("#elixir-rate").textContent = `${battle.multiplier}×`;
  document.querySelectorAll<HTMLElement>("[data-slot]").forEach((e, i) => {
    e.classList.toggle("unaffordable", CARD_MAP[p.hand[i]].cost > p.elixir);
    e.classList.toggle("selected", selected === i);
    e.setAttribute("aria-pressed", String(selected === i));
  });
  if (screen === "replay" && replayData) {
    $("#replay-clock").textContent = clock(battle.time);
    ($("#replay-seek") as HTMLInputElement).value = String(
      (battle.tick / Math.max(1, replayData.duration)) * 100,
    );
  }
  if (screen === "battle" && battle.winner && !resultShown) showResult();
  if (screen === "replay" && replayData && battle.tick >= replayData.duration) {
    paused = true;
    if (replayRecord && !battle.winner)
      battle.finish(replayRecord.winner, "Replay complete");
  }
  if (screen === "replay") syncReplayControl();
}
function selectCard(slot: number) {
  if (screen !== "battle" || paused || battle.winner) return;
  selected = selected === slot ? -1 : slot;
  audio.play("button_click_02", 0.2);
  if (selected < 0) {
    $("#hand-caption").textContent =
      "Select a card, then tap your side of the arena";
    $("#deploy-hint").textContent = "Select a card to deploy";
    arena.showPlacement(null, null);
  } else {
    const c = CARD_MAP[battle.players.blue.hand[selected]];
    $("#hand-caption").textContent =
      `${c.name} · ${c.cost} elixir · ${c.kind === "spell" ? "Target anywhere" : "Deploy on the blue half"}`;
    $("#deploy-hint").textContent =
      c.kind === "spell"
        ? `${c.name} · Target anywhere`
        : `${c.name} · Deploy on your side`;
    refreshPlacement();
  }
  updateBattleUI();
}
function refreshPlacement() {
  if (screen !== "battle" || paused || selected < 0 || battle.winner) {
    arena.showPlacement(null, null);
    return;
  }
  const id = battle.players.blue.hand[selected],
    cost = CARD_MAP[id].cost;
  const place = hover
    ? battle.canPlace("blue", id, hover.x, hover.y)
    : { ok: true, reason: "" };
  const affordable = battle.players.blue.elixir + 1e-6 >= cost;
  arena.showPlacement(
    id,
    hover,
    place.ok && affordable,
    !place.ok ? place.reason : !affordable ? `You need ${cost} elixir` : "",
  );
}
function deploy(point: Point) {
  if (selected < 0 || screen !== "battle" || paused || battle.winner) return;
  const id = battle.players.blue.hand[selected];
  const result = battle.play("blue", selected, point.x, point.y);
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
  paused = !paused;
  if (paused) cancelPointer();
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
  resultShown = true;
  audio.stopMusic();
  const reward = recordBattle(profile, battle),
    win = battle.winner === "blue",
    draw = battle.winner === "draw";
  audio.play(win ? "win_tour_01" : "lose_tour_01", 0.45);
  refreshProfile();
  arena.showPlacement(null, null);
  $("#deploy-hint").classList.add("hidden");
  setTimeout(() => {
    if (screen !== "battle") return;
    modal(
      draw
        ? "A worthy battle."
        : win
          ? "Victory is yours!"
          : "A crown to chase.",
      `<div class="result-content ${win ? "victory" : "defeat"}"><div class="result-crown">${icon("crown")}</div><span class="eyebrow">${esc(battle.reason)}</span><div class="result-score"><span class="blue">${icon("crown")} ${battle.players.blue.crowns}</span><b>–</b><span class="red">${battle.players.red.crowns} ${icon("crown")}</span></div><p>${win ? "Your kingdom stands tall. Well played." : draw ? "Two kings still standing. A rematch awaits." : "Every great king learns from a battle."}</p><div class="result-rewards"><div>${icon("trophy")}<b>${reward.trophies > 0 ? "+" : ""}${reward.trophies}</b><small>TROPHIES</small></div><div>${icon("coins")}<b>+${reward.gold}</b><small>GOLD</small></div>${reward.chest ? `<div><img src="/assets/chests/${reward.chest}.png" alt="${reward.chest} chest"/><b>+1</b><small>${reward.chest.toUpperCase()} CHEST</small></div>` : ""}</div><button class="primary-button" id="rematch">${icon("swords")} Battle again</button><div class="result-links"><button class="text-button" id="watch-replay">${icon("play")} Watch replay</button><button class="text-button" id="return-home">Back to arena ${icon("arrow-right")}</button></div></div>`,
      "result",
    );
    $("#rematch").onclick = startBattle;
    $("#return-home").onclick = lobby;
    $("#watch-replay").onclick = () => playReplay(profile.history[0]);
  }, 1000);
}
function playReplay(record: RecordEntry) {
  closeModal();
  screen = "replay";
  replayRecord = record;
  replayData = record.replay;
  resultShown = true;
  paused = false;
  speed = 1;
  selected = -1;
  accumulator = 0;
  eventCursor = 0;
  document.body.classList.add("in-battle", "in-replay");
  window.scrollTo(0, 0);
  battle = new Battle({ replay: replayData });
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
  updateBattleUI(true);
  showMessage("REPLAY", 1000);
  refreshIcons();
}
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
    `<div class="card-detail"><div class="detail-art ${c.rarity.toLowerCase()}"><img src="${cardArt(id)}" alt="${c.name}"/><span class="cost">${c.cost}</span></div><div><span class="rarity-label ${c.rarity.toLowerCase()}">${c.rarity} · ${c.kind}</span><p>${c.description}</p><span class="level-pill">TOURNAMENT STANDARD · LEVEL 11</span></div></div><div class="stat-grid">${[
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
    `<div class="builder-top"><p>Choose a deck card, then select its replacement below.</p><span><i class="tiny-drop"></i> ${averageCost(profile.deck).toFixed(1)} average</span></div><div class="builder-deck">${profile.deck.map((id, i) => cardHTML(id, `data-edit-slot="${i}"`, editSlot === i ? "selected" : "")).join("")}</div><div class="builder-controls"><div class="collection-label"><h3>Card collection</h3><span>24 / 24 unlocked</span></div><label class="search-input">${icon("search")}<input id="card-search" placeholder="Find a card…" value="${esc(search)}" aria-label="Search cards"/></label><div class="filter-row">${["all", "troop", "spell", "building"].map((f) => `<button class="${filter === f ? "active" : ""}" data-filter="${f}">${f === "all" ? "All cards" : f === "troop" ? "Troops" : f === "spell" ? "Spells" : "Buildings"}</button>`).join("")}</div></div><div class="collection-grid" id="collection-grid"></div><div class="builder-footer"><span id="builder-hint">${editSlot < 0 ? "Select one of your eight cards to replace it." : `Replacing ${CARD_MAP[profile.deck[editSlot]].name} · Choose a card below.`}</span><button class="primary-button" id="deck-done">${icon("check")} Done</button></div>`,
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
    `<div class="history-summary"><div>${icon("swords")}<b>${profile.battles}</b><span>BATTLES</span></div><div>${icon("trophy")}<b>${profile.wins}</b><span>VICTORIES</span></div><div>${icon("crown")}<b>${profile.crowns}</b><span>CROWNS</span></div></div><div class="history-list">${profile.history.length ? profile.history.map((r, i) => `<div class="history-entry"><span class="history-outcome ${r.winner === "blue" ? "win" : "loss"}">${icon(r.winner === "blue" ? "trophy" : r.winner === "draw" ? "equal" : "swords")}</span><div><b>${r.winner === "blue" ? "Victory" : r.winner === "draw" ? "Draw" : "Defeat"} <small>vs Royal Trainer</small></b><span>${modeNames[r.mode] ?? "Classic 1v1"} · ${new Date(r.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div><strong>${r.crowns[0]} – ${r.crowns[1]}</strong><button class="secondary-button" data-replay="${i}">${icon("play")} Replay</button></div>`).join("") : `<div class="empty-history">${icon("swords")}<h3>Your story starts in the arena.</h3><p>Play a battle to see your results and replays here.</p><button class="primary-button" id="history-battle">Let's battle ${icon("arrow-right")}</button></div>`}</div><p class="modal-footnote">Your latest 10 battles are saved locally, with playable replays.</p>`,
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

function processEvents() {
  for (const ev of battle.events) {
    if (ev.id <= eventCursor) continue;
    eventCursor = ev.id;
    if (ev.type === "deploy") {
      const voices: Partial<Record<CardId, string>> = {
        knight: "knight_deploy_31111",
        archers: "clash_archer_deploy_01",
        giant: "giant_deploy_01",
        musketeer: "musketeer_deploy_01",
        "mini-pekka": "minipekka_deploy_01",
        goblins: "goblin_deploy_14",
        "spear-goblins": "goblin_deploy_14",
        skeletons: "skeleton_deploy_03",
        "skeleton-army": "skeleton_deploy_03",
        bomber: "skeleton_deploy_03",
        valkyrie: "valkyrie_deploy_02",
        "hog-rider": "hogrider_deploy_01",
        "baby-dragon": "babydragon_deploy_01",
        minions: "minion_deploy_01",
        wizard: "deploy_wizard_01",
        prince: "prince_deploy_01",
        pekka: "pekka_deploy_01",
        balloon: "deploy_balloon_06",
      };
      audio.play(voices[ev.card as CardId] ?? "button_click_02", 0.22);
    }
    if (ev.type === "hit") {
      const impacts: Partial<Record<CardId, string>> = {
        fireball: "fireball_hit_01",
        zap: "zap_02",
        arrows: "arrow_hit_13",
        knight: "axe_impact_01",
        valkyrie: "axe_impact_01",
        giant: "giant_attack_swing_01",
        "mini-pekka": "mini_pekka_hit_03",
        pekka: "mini_pekka_hit_03",
        "baby-dragon": "baby_dragon_fireball_08",
      };
      audio.play(
        impacts[ev.card as CardId] ?? "arrow_hit_13",
        ev.card === "fireball" ? 0.35 : 0.12,
      );
    }
    if (ev.type === "crown") {
      audio.play("1st_crown_01", 0.35);
      showMessage(`${ev.team === "blue" ? "YOU" : "OPPONENT"} TOOK A TOWER`);
    }
    if (ev.type === "phase" && battle.phase !== lastPhase) {
      lastPhase = battle.phase;
      showMessage(
        battle.phase === "overtime"
          ? "SUDDEN DEATH"
          : battle.phase === "triple"
            ? "3× ELIXIR!"
            : "2× ELIXIR!",
      );
    }
  }
}

try {
  arena = new Arena($("#arena-canvas"));
  arena.onContextLost = () => {
    if (screen !== "lobby" && !paused) togglePause();
    toast("Graphics paused. Reload if the arena does not recover.");
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
  $("#drag-card").innerHTML = `<img src="${cardArt(id)}" alt=""/>`;
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
$("#battle-button").onclick = startBattle;
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
  battle.finish("red", "Surrender");
  updateBattleUI();
};
$("#emote-button").onclick = () => {
  audio.play("king_laughter_01", 0.5);
  $(".emote-bubble").classList.remove("hidden");
  setTimeout(() => $(".emote-bubble").classList.add("hidden"), 1800);
};
$("#replay-play").onclick = () => {
  if (replayData && battle.tick >= replayData.duration && replayRecord)
    playReplay(replayRecord);
  else togglePause();
};
$("#replay-speed").onclick = () => {
  speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
  $("#replay-speed").textContent = `${speed}×`;
};
$("#replay-exit").onclick = lobby;
$("#replay-seek").addEventListener("input", () => {
  if (!replayData) return;
  const target = Math.floor(
    (Number(($("#replay-seek") as HTMLInputElement).value) / 100) *
      replayData.duration,
  );
  battle = new Battle({ replay: replayData });
  for (let i = 0; i < target && !battle.winner; i++) battle.step();
  arena.setBattle(battle);
  eventCursor = battle.events.at(-1)?.id ?? 0;
  accumulator = 0;
  updateBattleUI(true);
});
$("#about-button").onclick = () =>
  modal(
    "Made for the love of the game.",
    `<div class="about-content"><span class="about-crown">${icon("crown")}</span><p>An independent browser fan project. Built with TypeScript and Three.js, with local saves and a deterministic battle simulation.</p><p>This project is not affiliated with, endorsed, sponsored, or specifically approved by Supercell. Clash Royale artwork, audio, and trademarks belong to Supercell.</p><p>Card art, renders, and audio sourced from <a href="https://github.com/RoyaleAPI/cr-api-assets" target="_blank" rel="noreferrer">RoyaleAPI's asset collection</a>. Original troop and building animations, projectile effects and scenery are reconstructed from archived game assets. Surrounding 3D geometry, particles and fallback models were created for this project.</p><small>24 curated cards · Classic rules · Level 11 standard · AI battles<br>Not a live balance replica. No online multiplayer or official game account connection.</small></div>`,
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
  cancelPointer();
  if (screen !== "lobby" && !paused && !battle.winner) togglePause();
  audio.stopMusic();
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
refreshIcons();
if (!storageAvailable)
  toast("Browser storage is unavailable. Progress lasts for this session.");
function frame(now: number) {
  frameHandle = undefined;
  if (document.hidden) return;
  const elapsed = (now - frameTime) / 1000;
  const delta = Math.min(0.5, elapsed);
  frameTime = now;
  if (screen !== "lobby" && !paused && !battle.winner) {
    accumulator += delta * speed;
    let ticks = 0;
    while (accumulator >= STEP && ticks < 15) {
      if (
        screen === "replay" &&
        replayData &&
        battle.tick >= replayData.duration
      )
        break;
      battle.step();
      accumulator -= STEP;
      ticks++;
    }
    if (ticks === 15) accumulator = 0;
    processEvents();
  }
  const idle = screen === "lobby" || paused || !!battle.winner;
  if (!idle || now - lastRenderTime >= 1000 / 30 - 0.5) {
    const renderDelta = Math.min((now - lastRenderTime) / 1000, 0.1);
    lastRenderTime = now;
    animationTime = screen === "lobby" ? now / 1000 : battle.time;
    arena.render(
      screen === "lobby" || battle.winner
        ? renderDelta
        : paused
          ? 0
          : renderDelta * speed,
      animationTime,
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
    lastUi = now;
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
        winner: battle.winner,
        elixir: battle.players.blue.elixir,
        hand: [...battle.players.blue.hand],
        troops: battle.entities.filter((e) => e.kind === "troop").length,
        actions: battle.actions.length,
        fps,
        renderedFrames: frameCount,
        animationTime,
        frameLoopRunning: frameHandle !== undefined,
        drawCalls: arena.renderer.info.render.calls,
        loadedEffects: arena.loadedEffects,
        loadedBuildings: arena.loadedBuildings,
        destruction: arena.destructionState,
        placement: arena.placementState,
        loadedAnimations: arena.loadedAnimations,
        nativeTowerPrincesses: arena.nativeTowerPrincesses,
        nativePrincessTowers: arena.nativePrincessTowers,
      };
    },
    project: (x: number, y: number) => {
      const p = arena.screen(x, y),
        r = arena.host.getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    },
  },
  writable: false,
});

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
