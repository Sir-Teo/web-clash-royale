// Start Vite/preview on 5188; this probe also runs against an earlier build.
import { chromium } from "playwright";
const types = process.argv.includes("--types");

const browser = await chromium.launch({
  args: [
    "--enable-webgl",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const page = await browser.newPage({
    viewport: { width: 900, height: 700 },
    deviceScaleFactor: 1,
    serviceWorkers: "block",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      "browser-royale.profile.v1",
      JSON.stringify({
        version: 1,
        seenTutorial: true,
        sound: false,
        music: false,
      }),
    ),
  );
  const url = process.env.ARENA_PROFILE_URL ?? "http://127.0.0.1:5188/";
  await page.goto(url);
  await page.waitForFunction(
    () => window.__arena && !window.__arena.state.renderPending,
    null,
    { timeout: 90000 },
  );
  await page.locator('[data-nav="cards"]').click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        "#collection-grid [data-native-card].native-card-ready",
      ).length === window.__arena.state.loadedCards &&
      window.__arena.state.loadedCards > 0,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.locator("#card-search").focus();
  if (types) await page.mouse.move(0, 0);
  await page.waitForTimeout(350);
  const scroll = await page.locator(".modal").evaluate((el) => el.scrollTop);
  const pixels = () =>
    page.locator(".modal").screenshot({ animations: "disabled" });
  const beforePixels = await pixels();
  const initial = await page.evaluate((types) => {
    const grid = document.querySelector("#collection-grid");
    const refs = [...grid.querySelectorAll("[data-native-card]")].map(
      (card) => ({
        id: card.dataset.nativeCard,
        card,
        svg: card.querySelector(".native-card-art > svg"),
      }),
    );
    const metrics = {
      artRebuilds: 0,
      gridMutations: 0,
      dialogRebuilds: 0,
      otherMutations: 0,
    };
    const collect = (records) => {
      for (const r of records) {
        if (
          r.type === "childList" &&
          r.target.matches?.(".native-card-art") &&
          (!types || r.target.closest("#collection-grid"))
        )
          metrics.artRebuilds++;
        else if (r.type === "childList" && r.target.id === "collection-grid")
          metrics.gridMutations++;
        else if (r.type === "childList" && r.target.id === "modal-root")
          metrics.dialogRebuilds++;
        else metrics.otherMutations++;
      }
    };
    const observer = new MutationObserver(collect);
    observer.observe(types ? document.querySelector("#modal-root") : grid, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    window.__collectionProbe = { grid, refs, metrics, observer, collect };
    return {
      cards: refs.length,
      nodes: grid.querySelectorAll("*").length,
      frames: window.__arena.state.renderedFrames,
    };
  }, types);
  const inputs = [];
  const started = performance.now();
  for (const value of types
    ? ["troop", "spell", "building", "all"]
    : ["g", "go", "gob", "goblin", ""]) {
    const start = performance.now();
    if (types) await page.locator(`[data-filter="${value}"]`).click();
    else await page.locator("#card-search").fill(value);
    inputs.push({
      [types ? "type" : "search"]: value,
      elapsedMs: performance.now() - start,
      count: await page.locator("#collection-grid [data-collection]").count(),
    });
  }
  const elapsedMs = performance.now() - started;
  const final = await page.evaluate(() => {
    const p = window.__collectionProbe;
    const grid = document.querySelector("#collection-grid");
    p.collect(p.observer.takeRecords());
    p.observer.disconnect();
    const retained = p.refs.filter(
      (ref) =>
        grid.querySelector(`[data-native-card="${ref.id}"]`) === ref.card,
    );
    return {
      ...p.metrics,
      retainedCards: retained.length,
      retainedSvg: retained.filter(
        (ref) => ref.card.querySelector(".native-card-art > svg") === ref.svg,
      ).length,
      cards: grid.querySelectorAll("[data-collection]").length,
      nodes: grid.querySelectorAll("*").length,
      frames: window.__arena.state.renderedFrames,
    };
  });
  if (types) {
    await page.locator("#card-search").focus();
    await page.mouse.move(0, 0);
    await page
      .locator(".modal")
      .evaluate((el, scroll) => (el.scrollTop = scroll), scroll);
    await page.waitForTimeout(180);
  }
  const afterPixels = await pixels();
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    JSON.stringify(
      {
        url,
        mode: types ? "type-filters" : "search",
        elapsedMs,
        inputs,
        initial,
        final,
        sameModalPixels: beforePixels.equals(afterPixels),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
