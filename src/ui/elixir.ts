import { renderNativeFrame, type NativeData } from "./native";

export interface ElixirSpend {
  time: number;
  cost: number;
  after: number;
}
/** Presentation follows simulation seconds, so pause/speed/seek cannot drift. */
export class ElixirFeedback {
  time = 0;
  value = 5;
  multiplier = 1;
  gain: number | null = null;
  pulse: number | null = null;
  fullSince: number | null = null;
  rateStart: number | null = null;
  spends: ElixirSpend[] = [];
  reset(time: number, value: number, multiplier: number) {
    this.time = time;
    this.value = value;
    this.multiplier = multiplier;
    this.gain = this.rateStart = null;
    this.pulse = null;
    this.fullSince = value >= 10 ? time : null;
    this.spends = [];
  }
  spend(cost: number, time: number, after: number) {
    this.spends.push({ cost, time, after });
    this.spends = this.spends.slice(-4);
  }
  update(time: number, value: number, multiplier: number) {
    if (time < this.time) this.reset(time, value, multiplier);
    if (time > this.time && Math.floor(value) > Math.floor(this.value))
      this.gain = this.pulse = time;
    if (value >= 10) this.fullSince ??= time;
    else this.fullSince = null;
    if (multiplier !== this.multiplier) this.rateStart = time;
    this.time = time;
    this.value = value;
    this.multiplier = multiplier;
    this.spends = this.spends.filter((s) => time - s.time < 40 / 30);
    if (this.gain !== null && time - this.gain >= 10 / 30) this.gain = null;
    if (this.pulse !== null && time - this.pulse >= 25 / 30) this.pulse = null;
  }
}
const options = {
  path: `${import.meta.env.BASE_URL}assets/ui/elixir`,
  viewBox: "-44 -27 454 62",
  prefix: "elixir",
};
const amountBinding = "elixirBarLeftNumbers/elixirAmount/txt";
const maximumBinding = "elixirBarLeftNumbers/TID_MAX_ELIXIR/TID_MAX_ELIXIR";
const frameAt = (time: number, start: number, frames: number) =>
  Math.min(frames - 1, Math.max(0, Math.floor((time - start) * 30 + 1e-6)));

export class NativeElixir {
  readonly feedback = new ElixirFeedback();
  private data: NativeData | null = null;
  private bar: HTMLElement;
  private requirement: HTMLElement;
  private gain: HTMLElement;
  private floats: HTMLElement;
  private rate: HTMLElement;
  private number: HTMLElement;
  private tip: HTMLElement;
  private flow: HTMLElement;
  private warning: HTMLElement;
  private bound = new Map<string, SVGGElement[]>();
  private signatures = new WeakMap<HTMLElement, string>();
  private serial = 0;
  private inputSignature = "";
  private trackWidth = 400;
  private pendingTrackWidth: number | null = null;
  constructor(private host: HTMLElement) {
    this.bar = host.querySelector(".elixir-art")!;
    this.requirement = host.querySelector(".elixir-requirement")!;
    this.gain = host.querySelector(".elixir-gain")!;
    this.floats = host.querySelector(".elixir-floats")!;
    this.rate = host.querySelector("#elixir-rate")!;
    this.number = host.querySelector("#elixir-number")!;
    this.tip = host.querySelector(".elixir-tip")!;
    this.flow = host.querySelector(".elixir-flow")!;
    this.warning = host.querySelector(".elixir-warning")!;
    new ResizeObserver(([entry]) => {
      // Changing height inside this callback causes a ResizeObserver loop in
      // WebKit. Apply the new geometry during the next presentation update.
      this.pendingTrackWidth = entry.contentRect.width < 280 ? 200 : 400;
    }).observe(host);
    void this.load();
  }
  get loaded() {
    return this.data ? Object.keys(this.data.clips).length : 0;
  }
  private async load() {
    try {
      const r = await fetch(
        `${import.meta.env.BASE_URL}assets/ui/elixir/elixir.json`,
      );
      if (!r.ok) throw new Error(`Native elixir: ${r.status}`);
      const data: NativeData = await r.json();
      await document.fonts.load('40px "Supercell Magic"');
      await Promise.all(
        Object.values(data.shapes)
          .flatMap((s) => s.polygons ?? [s])
          .filter((s) => s.file)
          .map(async (s) => {
            const image = new Image();
            image.src = `${options.path}/${s.file}`;
            await image.decode();
          }),
      );
      this.data = data;
      renderNativeFrame(
        this.bar,
        data,
        "elixir_bar",
        0,
        {},
        {
          ...options,
          bind: true,
          omit: ["bar_tip", "bar_flow", "elixirRequirementBar"],
        },
      );
      for (const group of this.bar.querySelectorAll<SVGGElement>(
        "[data-binding]",
      )) {
        const key = group.dataset.binding!;
        this.bound.set(key, [...(this.bound.get(key) ?? []), group]);
      }
      this.layout();
      this.groups("ghost", "opacity", "0");
      this.host.classList.add("native-ready");
      this.inputSignature = "";
    } catch (error) {
      console.warn("Native elixir assets unavailable", error);
    }
  }
  private get viewBox() {
    return `-44 -27 ${this.trackWidth + 54} 62`;
  }
  private layout() {
    this.inputSignature = "";
    this.host.style.aspectRatio = `${this.trackWidth + 54} / 62`;
    this.host.style.setProperty("--elixir-total", String(this.trackWidth + 54));
    this.host.style.setProperty("--elixir-unit", String(this.trackWidth / 10));
    this.bar.querySelector("svg")?.setAttribute("viewBox", this.viewBox);
    if (!this.data) return;
    // Native placeholders receive layout dimensions from the game client.
    this.groups("bar_bg", "transform", `scale(${this.trackWidth / 400} 1)`);
    this.groups("", "transform", `translate(${this.trackWidth - 400} 0)`);
    for (let i = 1; i < 10; i++) {
      const part = this.data.clips.elixir_bar.frames[0].find(
        (p) => p.binding === `d${i}`,
      )!;
      this.groups(
        `d${i}`,
        "transform",
        `translate(${(i * this.trackWidth) / 10 - part.matrix[4]} 0)`,
      );
    }
    this.groups(amountBinding, "transform", "translate(-35 0)");
    this.groups(
      maximumBinding,
      "transform",
      `translate(${this.trackWidth - 60} 0)`,
    );
    this.signatures = new WeakMap();
  }
  private groups(binding: string, attribute: string, value: string) {
    for (const group of this.bound.get(binding) ?? [])
      if (group.getAttribute(attribute) !== value)
        group.setAttribute(attribute, value);
  }
  private clip(
    host: HTMLElement,
    name: string,
    frame: number,
    viewBox: string,
    overrides: Record<string, string> = {},
    transform?: string,
  ) {
    const signature = `${name}:${frame}:${JSON.stringify(overrides)}`;
    if (!this.data || this.signatures.get(host) === signature) return;
    this.signatures.set(host, signature);
    const prefix =
      (host.dataset.nativePrefix ??= `elixir-effect-${this.serial++}`);
    renderNativeFrame(host, this.data, name, frame, overrides, {
      ...options,
      viewBox,
      prefix,
      transform,
    });
  }
  reset(time = 0, value = 5, multiplier = 1) {
    this.inputSignature = "";
    this.feedback.reset(time, value, multiplier);
    this.floats.replaceChildren();
    this.gain.classList.add("hidden");
    this.signatures = new WeakMap();
  }
  spend(cost: number, time: number, after: number) {
    this.inputSignature = "";
    this.feedback.spend(cost, time, after);
  }
  update(
    time: number,
    value: number,
    multiplier: number,
    selectedCost: number | null,
  ) {
    if (this.pendingTrackWidth !== null) {
      if (this.pendingTrackWidth !== this.trackWidth) {
        this.trackWidth = this.pendingTrackWidth;
        this.layout();
      }
      this.pendingTrackWidth = null;
    }
    value = Math.max(0, Math.min(10, value));
    const input = `${time}:${value}:${multiplier}:${selectedCost}`;
    if (input === this.inputSignature) return;
    this.inputSignature = input;
    this.feedback.update(time, value, multiplier);
    const integer = Math.floor(value);
    this.number.textContent = String(integer);
    this.host.setAttribute(
      "aria-valuenow",
      String(Math.round(value * 100) / 100),
    );
    this.host.setAttribute(
      "aria-valuetext",
      `${integer} of 10 elixir, ${multiplier} times regeneration${selectedCost !== null ? `, selected card costs ${selectedCost}` : ""}`,
    );
    this.host.classList.toggle("full", value >= 10);
    this.host.style.setProperty("--elixir-value", `${value * 10}%`);
    this.host.classList.toggle(
      "insufficient",
      selectedCost !== null && value < selectedCost,
    );
    this.host.dataset.cost = String(selectedCost ?? 0);
    if (!this.data) {
      this.rate.textContent = `${multiplier}×`;
      return;
    }
    const unit = this.trackWidth / 10;
    const total = this.trackWidth + 54;
    const width = value * unit;
    // Stretch the native center strip; preserve the curved right cap.
    const bodyWidth = Math.max(0, width - 3.6 + 1.45);
    this.groups(
      "bar_body",
      "transform",
      `translate(-1.45 0) scale(${bodyWidth / 7.189453125} 1) translate(1.45 0)`,
    );
    this.groups("bar_body", "opacity", value > 0 ? "1" : "0");
    this.groups("bar_end", "transform", `translate(${width - 8.5447265625} 0)`);
    this.groups("bar_end", "opacity", value > 0.09 ? "1" : "0");
    for (const group of this.bound.get(amountBinding) ?? []) {
      const text = group.querySelector("text")!;
      if (text.textContent !== String(integer))
        text.textContent = String(integer);
    }
    this.groups(maximumBinding, "opacity", value >= 10 ? "1" : "0");
    const latest = this.feedback.spends.at(-1);
    const ghostAge = latest ? time - latest.time : 1;
    if (latest && ghostAge < 0.33) {
      const ghostWidth = Math.min(
        this.trackWidth - latest.after * unit,
        latest.cost * unit,
      );
      this.groups(
        "ghost",
        "transform",
        `translate(${latest.after * unit} 0) scale(${ghostWidth / 7.189453125} 1) translate(1.65 0)`,
      );
      this.groups("ghost", "opacity", String(0.65 * (1 - ghostAge / 0.33)));
    } else this.groups("ghost", "opacity", "0");
    const cost = Math.max(0, Math.min(10, selectedCost ?? 0));
    this.requirement.classList.toggle("hidden", !cost);
    if (cost)
      this.clip(
        this.requirement,
        "elixir_requirement",
        cost,
        this.viewBox,
        {},
        `scale(${this.trackWidth / 400} 1)`,
      );
    this.gain.classList.toggle("hidden", this.feedback.gain === null);
    if (this.feedback.gain !== null) {
      this.gain.style.left = `${((44 + Math.max(0, integer - 1) * unit) / total) * 100}%`;
      this.clip(
        this.gain,
        "Elixir_bar_drop_anim",
        frameAt(time, this.feedback.gain, 10),
        "-2 -27 44 62",
      );
    }
    this.tip.classList.toggle("hidden", this.feedback.pulse === null);
    if (this.feedback.pulse !== null) {
      this.tip.style.transform = `translateX(${((width - (90.15527 * this.trackWidth) / 400) / total) * 100}%)`;
      this.clip(
        this.tip,
        "elixir_tip",
        frameAt(time, this.feedback.pulse, 25),
        this.viewBox,
        {},
        `scale(${this.trackWidth / 400} 1)`,
      );
    }
    this.flow.classList.toggle("hidden", this.feedback.fullSince === null);
    this.warning.classList.toggle("hidden", this.feedback.fullSince === null);
    if (this.feedback.fullSince !== null) {
      const age = time - this.feedback.fullSince;
      this.clip(
        this.flow,
        "elixir_flow",
        Math.floor(age * 30 + 1e-6) % 30,
        this.viewBox,
        {},
        `scale(${this.trackWidth / 400} 1)`,
      );
      // Repeat the authored warning once every three seconds while capped.
      this.clip(
        this.warning,
        "elixir_warning",
        Math.min(29, Math.floor(age * 30 + 1e-6) % 90),
        "-180 -20 360 50",
      );
    }
    while (this.floats.childElementCount > this.feedback.spends.length)
      this.floats.firstElementChild!.remove();
    this.feedback.spends.forEach((spend, i) => {
      let element = this.floats.children[i] as HTMLElement | undefined;
      if (!element) {
        element = document.createElement("div");
        this.floats.append(element);
      }
      element.style.left = `${((44 + Math.min(9.5, spend.after + spend.cost / 2) * unit) / total) * 100}%`;
      this.clip(
        element,
        "elixir_float_txt",
        frameAt(time, spend.time, 40),
        "-20 -80 40 100",
        { "icon/txt": `-${spend.cost}` },
      );
    });
    this.rate.classList.toggle("hidden", multiplier === 1);
    if (multiplier > 1)
      this.clip(
        this.rate,
        "HUD_topRight_double_elixir",
        this.feedback.rateStart === null
          ? 14
          : frameAt(time, this.feedback.rateStart, 15),
        "-86 58 80 86",
        { "elixirRegen/elixir/txt": `x${multiplier}` },
      );
    this.bar.setAttribute("aria-label", `${integer} elixir`);
  }
}
export const elixirMarkup = `<div class="elixir-hud" id="elixir-hud" role="meter" aria-label="Elixir" aria-valuemin="0" aria-valuemax="10" aria-valuenow="5"><span id="elixir-number">5</span><div class="elixir-art" aria-hidden="true"></div><div class="elixir-glints" aria-hidden="true"><div class="elixir-tip hidden"></div><div class="elixir-flow hidden"></div></div><div class="elixir-requirement hidden" aria-hidden="true"></div><div class="elixir-gain hidden" aria-hidden="true"></div><div class="elixir-floats" aria-hidden="true"></div><div class="elixir-warning hidden" aria-hidden="true"></div><div id="elixir-rate" class="native-elixir-rate" aria-label="Elixir regeneration"></div></div>`;
