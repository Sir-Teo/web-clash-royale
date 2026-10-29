// Start Vite on port 5188. This measures SVG construction, not device FPS.
import { chromium } from "playwright";

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    serviceWorkers: "block",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    process.env.ARENA_PROFILE_URL ??
      "http://127.0.0.1:5188/tests/fixtures/elixir.html",
  );
  await page.waitForFunction(() =>
    document.querySelector("#status")?.textContent.includes("8 native clips"),
  );
  const result = await page.evaluate(async () => {
    const { renderNativeFrame, renderRetainedNativeFrame } =
      await import("/src/ui/native.ts");
    const { hudView } = await import("/src/ui/hud-data.ts");
    const { endView } = await import("/src/ui/ending-data.ts");
    const [elixir, intro, hud, ending] = await Promise.all(
      ["elixir", "intro", "hud", "ending"].map((name) =>
        fetch(`/assets/ui/${name}/${name}.json`).then((r) => r.json()),
      ),
    );
    const view = (data, clip, frame) => ({ data, clip, frame });
    const end = {
      names: { blue: "Player", red: "Opponent" },
      crowns: { blue: 3, red: 1 },
      earned: { blue: 3, red: 1 },
      winner: "blue",
    };
    const cases = {
      elixirFlow: Array.from({ length: 300 }, (_, i) =>
        view(elixir, "elixir_flow", i % 30),
      ),
      introduction: intro.clips.pvp_battle_start.frames.map((_, i) =>
        view(intro, "pvp_battle_start", i),
      ),
      crowns: Array.from({ length: 100 }, (_, i) =>
        view(hudView(hud, false, i, 99 - i), "display", 0),
      ),
      ending: ending.clips.printScore_player.frames.map((_, i) =>
        view(endView(ending, end, i), "display", 0),
      ),
    };
    const options = {
      path: "/assets/ui",
      prefix: "profile",
      viewBox: "-500 -300 1000 600",
      bind: true,
    };
    function run(render, frames, options, countNodes = false) {
      const host = document.createElement("div");
      let rebuilds = 0,
        createdElements = 0;
      const start = performance.now();
      for (const { data, clip, frame } of frames) {
        const before = host.firstElementChild;
        render(host, data, clip, frame, {}, options);
        if (countNodes && before !== host.firstElementChild) {
          rebuilds++;
          createdElements += host.querySelectorAll("*").length;
        }
      }
      return {
        ms: performance.now() - start,
        rebuilds,
        createdElements,
        finalElements: host.querySelectorAll("*").length,
        markup: host.innerHTML,
        label: host.getAttribute("aria-label"),
      };
    }
    const results = {};
    for (const [name, frames] of Object.entries(cases)) {
      // Separate node instrumentation from timing and alternate sample order.
      const folder = {
        elixirFlow: "elixir",
        introduction: "intro",
        crowns: "hud",
        ending: "ending",
      }[name];
      const scopedOptions = { ...options, path: `/assets/ui/${folder}` };
      const reference = run(renderNativeFrame, frames, scopedOptions, true);
      const retained = run(
        renderRetainedNativeFrame,
        frames,
        scopedOptions,
        true,
      );
      const timings = [[], []];
      for (let i = 0; i < 5; i++) {
        for (const index of i % 2 ? [1, 0] : [0, 1])
          timings[index].push(
            run(
              [renderNativeFrame, renderRetainedNativeFrame][index],
              frames,
              scopedOptions,
            ).ms,
          );
      }
      results[name] = {
        frames: frames.length,
        reference: {
          rebuilds: reference.rebuilds,
          createdElements: reference.createdElements,
          finalElements: reference.finalElements,
          medianMs: timings[0].sort((a, b) => a - b)[2],
        },
        retained: {
          rebuilds: retained.rebuilds,
          createdElements: retained.createdElements,
          finalElements: retained.finalElements,
          medianMs: timings[1].sort((a, b) => a - b)[2],
        },
        markupMatches:
          reference.markup === retained.markup &&
          reference.label === retained.label,
      };
    }
    return results;
  });
  if (errors.length) throw new Error(errors.join("\n"));
  if (Object.values(result).some((value) => !value.markupMatches))
    throw new Error("Retained UI differs from reference");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
