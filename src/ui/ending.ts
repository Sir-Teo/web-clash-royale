import { EndClock, endView, type EndResult } from "./ending-data";
import { renderNativeFrame, type NativeData } from "./native";
export class NativeEnding {
  readonly clock = new EndClock();
  private data: NativeData | null = null;
  private result: EndResult | null = null;
  private signature = "";
  private readonly reduced = matchMedia("(prefers-reduced-motion: reduce)");
  private readonly art: HTMLElement;
  private readonly next: HTMLButtonElement;
  onContinue = () => {};
  constructor(private host: HTMLElement) {
    host.innerHTML =
      '<div class="native-ending-art" role="img"></div><button class="ending-continue hidden" type="button">Continue</button>';
    this.art = host.querySelector(".native-ending-art")!;
    this.next = host.querySelector(".ending-continue")!;
    this.next.onclick = () => this.onContinue();
    void this.load();
  }
  get loaded() {
    return this.data ? Object.keys(this.data.clips).length : 0;
  }
  get state() {
    return {
      ...this.clock.state,
      active: !!this.clock.state,
      time: this.clock.time,
      result: this.result,
    };
  }
  private async load() {
    try {
      const response = await fetch("/assets/ui/ending/ending.json");
      if (!response.ok) throw new Error(`Native ending: ${response.status}`);
      const data: NativeData = await response.json();
      await document.fonts.load('59px "Supercell Magic"');
      await Promise.all(
        Object.values(data.shapes)
          .flatMap((s) => s.polygons ?? [s])
          .filter((s) => s.file)
          .map(async (s) => {
            const image = new Image();
            image.src = `/assets/ui/ending/${s.file}`;
            await image.decode();
          }),
      );
      this.data = data;
    } catch (error) {
      console.warn("Native ending assets unavailable", error);
    }
  }
  start(result: EndResult, hold = false) {
    this.reset();
    if (!this.data) return;
    this.result = result;
    this.clock.start(this.reduced.matches, hold);
    this.update(0);
  }
  reset() {
    this.clock.reset();
    this.result = null;
    this.signature = "";
    this.art.replaceChildren();
    this.host.classList.add("hidden");
    this.next.classList.add("hidden");
    delete this.host.dataset.stage;
    delete this.host.dataset.frame;
  }
  skip() {
    this.clock.skip();
    this.update(0);
  }
  update(delta: number, canContinue = false) {
    this.clock.advance(delta);
    const state = this.clock.state;
    if (!state || !this.data || !this.result) {
      if (!this.host.classList.contains("hidden"))
        this.host.classList.add("hidden");
      return;
    }
    if (this.host.classList.contains("hidden"))
      this.host.classList.remove("hidden");
    if (this.next.classList.contains("hidden") === canContinue)
      this.next.classList.toggle("hidden", !canContinue);
    const signature = `${state.stage}:${state.frame}:${state.still}`;
    if (signature === this.signature) return;
    this.signature = signature;
    const scores = state.stage === "scores";
    renderNativeFrame(
      this.art,
      scores
        ? endView(this.data, this.result, state.frame, state.still)
        : this.data,
      scores ? "display" : "finalScore",
      scores ? 0 : state.frame,
      {
        "playerName/txt": this.result.names.blue,
        "enemyName/txt": this.result.names.red,
      },
      {
        path: "/assets/ui/ending",
        viewBox: "-360 -260 720 520",
        prefix: "ending",
        fit: true,
        bind: true,
      },
    );
    this.art.setAttribute(
      "aria-label",
      `Match over. ${this.result.names.blue}: ${this.result.crowns.blue} crowns. ${this.result.names.red}: ${this.result.crowns.red} crowns.`,
    );
    this.host.dataset.stage = state.stage;
    this.host.dataset.frame = String(state.frame);
  }
}
