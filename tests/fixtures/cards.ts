import "../../src/ui/announcements.css";
import "../../src/ui/cards.css";
import { NativeCards, nativeCardArt } from "../../src/ui/cards";
import { CARDS } from "../../src/game/cards";
const cards = new NativeCards();
const $ = (s: string) => document.querySelector<HTMLElement>(s)!;
const markup = (index: number, variant: string, slot?: number) =>
  `<button class="sample ${variant === "hand" ? "hand-card" : ""}" data-native-card="${CARDS[index].id}" data-card-variant="${variant}" ${slot !== undefined ? `data-slot="${slot}"` : ""} aria-label="${CARDS[index].name}">${nativeCardArt}</button>`;
$("#hand").innerHTML = [0, 1, 2, 3].map((i) => markup(i, "hand", i)).join("");
$("#gallery").innerHTML = CARDS.map((_, i) => markup(i, "deck")).join("");
let time = 0,
  next = 4,
  playing = false,
  last = performance.now();
cards.reset(
  time,
  CARDS.slice(0, 4).map((c) => c.id),
);
document.querySelectorAll<HTMLButtonElement>(".sample").forEach(
  (e) =>
    (e.onclick = () => {
      e.classList.toggle("selected");
      e.setAttribute("aria-pressed", String(e.classList.contains("selected")));
      cards.draw(e);
    }),
);
$("#draw").onclick = () => {
  const e = document.querySelector<HTMLElement>('[data-slot="0"]')!;
  e.dataset.nativeCard = CARDS[next++ % CARDS.length].id;
  e.classList.remove("selected");
  e.setAttribute("aria-label", CARD_NAME(e.dataset.nativeCard));
  cards.updateHand($("#hand"), time);
};
function CARD_NAME(id: string) {
  return CARDS.find((c) => c.id === id)!.name;
}
$("#step").onclick = () => {
  time += 1 / 60;
};
$("#play").onclick = () => {
  playing = !playing;
  $("#play").textContent = playing ? "Pause" : "Play";
};
$("#reset").onclick = () => {
  time = 0;
  cards.reset(
    time,
    [...$("#hand").querySelectorAll<HTMLElement>("[data-native-card]")].map(
      (e) => e.dataset.nativeCard as (typeof CARDS)[number]["id"],
    ),
  );
};
function render(now: number) {
  if (playing) time += Math.min(0.1, (now - last) / 1000);
  last = now;
  cards.updateHand($("#hand"), time);
  $("#status").textContent =
    `${cards.loaded} native portraits · ${time.toFixed(2)}s`;
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
