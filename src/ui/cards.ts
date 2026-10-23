import { CARD_MAP, type CardId } from "../game/cards";
import { renderNativeFrame, type NativeData } from "./native";

export interface CardData extends NativeData {
  portraits: Record<CardId, { shape: number; sourceId: number; name: string }>;
}
/** Only newly drawn cards animate; existing slots survive a hand DOM refresh. */
export class HandReveal {
  private slots = new Map<number, { id: string; start: number | null }>();
  private time = 0;
  reset(time: number, ids: readonly string[]) {
    this.time = time;
    this.slots = new Map(ids.map((id, i) => [i, { id, start: null }]));
  }
  frame(slot: number, id: string, time: number, fps = 60, end = 19) {
    if (time < this.time) this.slots.clear();
    this.time = time;
    const previous = this.slots.get(slot);
    if (!previous || previous.id !== id)
      this.slots.set(slot, { id, start: previous ? time : null });
    const state = this.slots.get(slot)!;
    if (state.start === null) return null;
    const frame = Math.max(0, Math.floor((time - state.start) * fps + 1e-6));
    if (frame > end) {
      state.start = null;
      return null;
    }
    return frame;
  }
}

export const nativeCardArt =
  '<span class="native-card-art" aria-hidden="true"></span>';
export class NativeCards {
  readonly reveal = new HandReveal();
  private data: CardData | null = null;
  private portraits = new Map<CardId, CardData>();
  private signatures = new WeakMap<HTMLElement, string>();
  private serial = 0;
  private reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  constructor() {
    void this.load();
  }
  get loaded() {
    return this.data ? Object.keys(this.data.portraits).length : 0;
  }
  private async load() {
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}assets/ui/cards/cards.json`,
      );
      if (!response.ok) throw new Error(`Card artwork: ${response.status}`);
      const data: CardData = await response.json();
      const files = new Set(
        Object.values(data.shapes).flatMap((s) =>
          (s.polygons ?? [s]).flatMap((p) => (p.file ? [p.file] : [])),
        ),
      );
      await Promise.all([
        document.fonts.load('18px "Supercell Magic"'),
        ...[...files].map(
          (file) =>
            new Promise<void>((resolve, reject) => {
              const img = new Image();
              img.onload = () => resolve();
              img.onerror = () => reject(new Error(`Card texture: ${file}`));
              img.src = `${import.meta.env.BASE_URL}assets/ui/cards/${file}`;
            }),
        ),
      ]);
      this.data = data;
      this.hydrate();
    } catch (error) {
      console.warn(
        "Native cards unavailable; retaining fallback artwork",
        error,
      );
    }
  }
  hydrate(root: ParentNode = document) {
    root
      .querySelectorAll<HTMLElement>("[data-native-card]")
      .forEach((e) => this.draw(e));
  }
  reset(time: number, hand: readonly CardId[]) {
    this.reveal.reset(time, hand);
  }
  updateHand(root: ParentNode, time: number) {
    if (!this.data) return;
    const clip = this.data.clips.reveal;
    root
      .querySelectorAll<HTMLElement>("[data-native-card][data-slot]")
      .forEach((e) => {
        const frame = this.reveal.frame(
          Number(e.dataset.slot),
          e.dataset.nativeCard!,
          time,
          clip.fps,
          clip.labels!.show_end,
        );
        this.draw(e, this.reducedMotion.matches ? null : frame);
      });
  }
  draw(element: HTMLElement, revealFrame: number | null = null) {
    const id = element.dataset.nativeCard as CardId;
    if (!this.data?.portraits[id]) return;
    const host = element.querySelector<HTMLElement>(".native-card-art");
    if (!host) return;
    const variant = element.dataset.cardVariant ?? "deck";
    const selected = element.classList.contains("selected");
    const clip =
      variant === "cost"
        ? "cost"
        : variant === "thumbnail"
          ? "hand"
          : variant === "hand" && revealFrame !== null && !selected
            ? "reveal"
            : `${variant}${selected ? "-selected" : ""}`;
    const frame = clip === "reveal" ? revealFrame! : 0;
    const signature = `${id}:${clip}:${frame}`;
    if (this.signatures.get(host) === signature) return;
    let data = this.portraits.get(id);
    if (!data) {
      data = {
        ...this.data,
        shapes: {
          ...this.data.shapes,
          [-1]: this.data.shapes[this.data.portraits[id].shape],
        },
      };
      this.portraits.set(id, data);
    }
    const card = CARD_MAP[id];
    renderNativeFrame(
      host,
      data,
      clip,
      frame,
      {
        "elixar_count/count": String(card.cost),
        "card/elixar_count/count": String(card.cost),
        count: String(card.cost),
        card_name: card.name,
        card_level: "Level 11",
      },
      {
        path: `${import.meta.env.BASE_URL}assets/ui/cards`,
        viewBox:
          variant === "cost"
            ? "-25 -27 50 54"
            : variant === "thumbnail"
              ? "-65 -80 130 160"
              : "-71 -86 142 177",
        prefix: `native-card-${++this.serial}`,
        fit: true,
        omit:
          variant === "thumbnail" ? ["elixar_count", "elixar_count/count"] : [],
      },
    );
    this.signatures.set(host, signature);
    element.classList.add("native-card-ready");
    element.dataset.cardClip = clip;
    element.dataset.cardFrame = String(frame);
  }
}
