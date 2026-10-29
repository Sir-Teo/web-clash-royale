import { test, expect } from "@playwright/test";
import sharp from "sharp";

test.use({ serviceWorkers: "block" });

async function ready(page: import("@playwright/test").Page) {
  await page.goto("/tests/fixtures/elixir.html");
  await expect(page.locator("#status")).toContainText("8 native clips");
}

test("retained elixir frames match rebuilt SVG through forward and backward playback", async ({
  page,
}) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const path = "/src/ui/native.ts";
    const { renderNativeFrame, renderRetainedNativeFrame } = await import(path);
    const data = await fetch("/assets/ui/elixir/elixir.json").then((r) =>
      r.json(),
    );
    let frames = 0,
      reused = 0;
    const mismatches: string[] = [];
    for (const bind of [false, true]) {
      for (const [name, clip] of Object.entries<any>(data.clips)) {
        const reference = document.createElement("div");
        const retained = document.createElement("div");
        const options = {
          path: "/assets/ui/elixir",
          prefix: "compare",
          viewBox: "-240 -100 520 240",
          bind,
          transform: "scale(0.8 1)",
          fit: true,
        };
        const overrides = { "icon/txt": "-3", "elixirRegen/elixir/txt": "x3" };
        const sequence = [
          ...clip.frames.keys(),
          ...[...clip.frames.keys()].reverse(),
        ];
        for (const frame of sequence) {
          const before = retained.firstElementChild;
          renderNativeFrame(reference, data, name, frame, overrides, options);
          renderRetainedNativeFrame(
            retained,
            data,
            name,
            frame,
            overrides,
            options,
          );
          if (before && before === retained.firstElementChild) reused++;
          if (
            retained.innerHTML !== reference.innerHTML ||
            retained.getAttribute("aria-label") !==
              reference.getAttribute("aria-label")
          )
            mismatches.push(`${name}:${frame}:${bind}`);
          frames++;
        }
      }
    }
    return { frames, reused, mismatches };
  });
  expect(result.frames).toBe(648);
  expect(result.reused).toBeGreaterThan(500);
  expect(result.mismatches).toEqual([]);
});

test("retained frames rebuild for edited artwork, text, options and replaced hosts", async ({
  page,
}) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const path = "/src/ui/native.ts";
    const { renderNativeFrame, renderRetainedNativeFrame } = await import(path);
    const source = await fetch("/assets/ui/elixir/elixir.json").then((r) =>
      r.json(),
    );
    const polygon = structuredClone(
      source.shapes[636].polygons?.[0] ?? source.shapes[636],
    );
    const solid = { ...structuredClone(polygon), solid: 0xff406080 };
    const part = {
      shape: 0,
      binding: "art",
      matrix: [1, 0, 0, 1, 0, 0],
      color: [0, 0, 0, 255, 255, 255, 255],
    };
    const text = {
      text: 0,
      binding: "label",
      matrix: [1, 0, 0, 1, 1, 2],
      color: [...part.color],
    };
    const data = {
      shapes: { 0: { ...polygon, polygons: [solid, polygon] } },
      texts: {
        0: {
          size: 20,
          color: 0xffffffff,
          outlineColor: 0xff000000,
          outlined: true,
          align: 0,
          bounds: [0, 0, 40, 30],
        },
      },
      translations: {},
      audio: {},
      clips: { demo: { fps: 30, frames: [[part, text]] } },
    };
    const options: any = {
      path: "/assets/ui/elixir",
      prefix: "edited",
      viewBox: "0 0 100 100",
      fit: true,
    };
    const overrides = { label: "Old" };
    const retained = document.createElement("div"),
      reference = document.createElement("div");
    const mismatches: string[] = [],
      rebuilt: boolean[] = [];
    const compare = (label: string) => {
      const before = retained.firstElementChild;
      renderNativeFrame(reference, data, "demo", 0, overrides, options);
      renderRetainedNativeFrame(retained, data, "demo", 0, overrides, options);
      if (
        reference.innerHTML !== retained.innerHTML ||
        reference.getAttribute("aria-label") !==
          retained.getAttribute("aria-label")
      )
        mismatches.push(label);
      rebuilt.push(before !== retained.firstElementChild);
    };
    compare("initial");
    part.matrix[4] = 10;
    text.matrix[5] = 12;
    part.color[3] = 128;
    text.color[3] = 128;
    retained.setAttribute("aria-label", "External label");
    compare("transforms and alpha");
    part.color[0] = 30;
    text.color[4] = 100;
    compare("tint mode");
    part.color[0] = 60;
    part.color[5] = 120;
    compare("tint coefficients");
    polygon.xy[0][0] += 2;
    polygon.uv[0][1] += 0.01;
    polygon.file = "replacement.png";
    compare("in-place geometry and texture");
    solid.solid = 0xff112233;
    compare("in-place solid");
    overrides.label = "<New & longer>";
    compare("text override");
    data.texts[0].size = 30;
    compare("text style");
    options.path = "/other";
    options.prefix = "other";
    options.bind = true;
    options.transform = "scale(0.5)";
    options.stretch = true;
    options.sliceOverlap = { 0: 0.2 };
    compare("options");
    part.color[3] = 0;
    compare("hidden part");
    part.color[3] = 255;
    compare("visible part");
    retained.replaceChildren(document.createElement("span"));
    compare("externally replaced SVG");
    const copied = structuredClone(data);
    const beforeCopy = retained.firstElementChild;
    solid.solid = 0xff998877;
    data.texts[0].color = 0xffff0000;
    renderNativeFrame(reference, copied, "demo", 0, overrides, options);
    renderRetainedNativeFrame(retained, copied, "demo", 0, overrides, options);
    if (reference.innerHTML !== retained.innerHTML)
      mismatches.push("replacement dataset with matching values");
    rebuilt.push(beforeCopy !== retained.firstElementChild);
    return { mismatches, rebuilt };
  });
  expect(result.mismatches).toEqual([]);
  expect(result.rebuilt).toEqual([
    true,
    false,
    true,
    false,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    false,
  ]);
});

test("retained introductions, notices, crowns and endings match their full native timelines", async ({
  page,
}) => {
  test.setTimeout(120000);
  await ready(page);
  const result = await page.evaluate(async () => {
    const nativePath = "/src/ui/native.ts",
      hudPath = "/src/ui/hud-data.ts",
      endingPath = "/src/ui/ending-data.ts";
    const { renderNativeFrame, renderRetainedNativeFrame } = await import(
      nativePath
    );
    const { hudView } = await import(hudPath);
    const { endView } = await import(endingPath);
    let frames = 0,
      reused = 0;
    const mismatches: string[] = [];
    const loaded: Record<string, any> = {};
    for (const name of ["intro", "hud", "ending", "announcements"])
      loaded[name] = await fetch(
        `/assets/ui/${name === "announcements" ? name : name + "/" + name}.json`,
      ).then((r) => r.json());
    function compareSequence(
      name: string,
      views: { data: any; clip: string; frame: number }[],
    ) {
      const reference = document.createElement("div"),
        retained = document.createElement("div");
      const options = {
        path: "/assets/ui",
        prefix: "timeline",
        viewBox: "-500 -300 1000 600",
        bind: true,
        fit: true,
      };
      for (const view of views) {
        const overrides = Object.fromEntries(
          Object.values<any>(view.data.clips)
            .flatMap((c) => c.frames.flat())
            .filter((p: any) => p.text !== undefined)
            .map((p: any) => [p.binding, "Example <&> 11"]),
        );
        const before = retained.firstElementChild;
        renderNativeFrame(
          reference,
          view.data,
          view.clip,
          view.frame,
          overrides,
          options,
        );
        renderRetainedNativeFrame(
          retained,
          view.data,
          view.clip,
          view.frame,
          overrides,
          options,
        );
        if (before && before === retained.firstElementChild) reused++;
        if (
          (reference.innerHTML !== retained.innerHTML ||
            reference.getAttribute("aria-label") !==
              retained.getAttribute("aria-label")) &&
          mismatches.length < 10
        )
          mismatches.push(`${name}:${view.clip}:${view.frame}`);
        frames++;
      }
    }
    for (const [name, data] of Object.entries(loaded)) {
      for (const [clip, value] of Object.entries<any>(data.clips)) {
        if (
          value.frames.some((frame: any[]) =>
            frame.some((p) => p.text === undefined && !data.shapes[p.shape]),
          )
        )
          continue;
        compareSequence(
          name,
          value.frames.map((_: any, frame: number) => ({ data, clip, frame })),
        );
      }
    }
    for (const landscape of [false, true])
      compareSequence(
        "crown composition",
        Array.from({ length: 100 }, (_, frame) => ({
          data: hudView(loaded.hud, landscape, frame, 99 - frame),
          clip: "display",
          frame: 0,
        })),
      );
    for (const crowns of [
      { blue: 3, red: 1 },
      { blue: 0, red: 3 },
    ]) {
      for (const still of [false, true]) {
        const end = {
          names: { blue: "Player", red: "Opponent" },
          crowns,
          earned: crowns,
          winner: crowns.blue > crowns.red ? "blue" : "red",
        };
        compareSequence(
          "score composition",
          loaded.ending.clips.printScore_player.frames.map(
            (_: any, frame: number) => ({
              data: endView(loaded.ending, end, frame, still),
              clip: "display",
              frame: 0,
            }),
          ),
        );
      }
    }
    return { frames, reused, mismatches };
  });
  expect(result.frames).toBeGreaterThan(2000);
  expect(result.reused).toBeGreaterThan(1000);
  expect(result.mismatches).toEqual([]);
});

test("updated native filters and text reproduce rebuilt pixels", async ({
  page,
}, info) => {
  await ready(page);
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.evaluate(async () => {
    const path = "/src/ui/native.ts";
    const { renderNativeFrame, renderRetainedNativeFrame } = await import(path);
    const data = await fetch("/assets/ui/elixir/elixir.json").then((r) =>
      r.json(),
    );
    const overlay = document.createElement("div");
    overlay.id = "native-comparison";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0 auto auto 0",
      width: "390px",
      background: "#29475d",
      zIndex: "10000",
    });
    document.body.append(overlay);
    const grids = [
      document.createElement("div"),
      document.createElement("div"),
    ];
    const samples: [string, number, string][] = [
      ["elixir_bar", 0, "-44 -27 454 62"],
      ["elixir_requirement", 7, "-44 -27 454 62"],
      ["elixir_flow", 15, "-44 -27 454 62"],
      ["elixir_tip", 12, "-44 -27 454 62"],
      ["Elixir_bar_drop_anim", 5, "-2 -27 44 62"],
      ["elixir_float_txt", 20, "-20 -80 40 100"],
      ["elixir_warning", 15, "-180 -20 360 50"],
      ["HUD_topRight_double_elixir", 7, "-86 58 80 86"],
    ];
    for (let i = 0; i < samples.length; i++) {
      const [name, frame, viewBox] = samples[i];
      for (const [index, render] of [
        renderNativeFrame,
        renderRetainedNativeFrame,
      ].entries()) {
        const host = document.createElement("div");
        host.style.cssText = "height:100px;width:390px";
        grids[index].append(host);
        const options = {
          path: "/assets/ui/elixir",
          prefix: `pixels-${i}`,
          viewBox,
        };
        const overrides = { "icon/txt": "-3", "elixirRegen/elixir/txt": "x3" };
        render(host, data, name, 0, overrides, options);
        render(host, data, name, frame, overrides, options);
        host.querySelector("svg")!.style.cssText = "width:100%;height:100%";
      }
    }
    (window as any).__showNativeComparison = (index: number) =>
      overlay.replaceChildren(grids[index]);
    (window as any).__showNativeComparison(0);
  });
  const overlay = page.locator("#native-comparison");
  const original = await overlay.screenshot({ scale: "css" });
  await page.evaluate(() => (window as any).__showNativeComparison(1));
  const retained = await overlay.screenshot({ scale: "css" });
  await info.attach("rebuilt-native", {
    body: original,
    contentType: "image/png",
  });
  await info.attach("retained-native", {
    body: retained,
    contentType: "image/png",
  });
  expect(await sharp(retained).raw().toBuffer()).toEqual(
    await sharp(original).raw().toBuffer(),
  );
});
