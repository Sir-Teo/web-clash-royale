// Start Vite/preview on 5188; also works against the pre-optimization build.
import { chromium } from "playwright";

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
    serviceWorkers: "block",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem(
      "browser-royale.profile.v1",
      JSON.stringify({
        version: 1,
        seenTutorial: true,
        sound: false,
        music: false,
        deck: [
          "skeletons",
          "ice-spirit",
          "goblins",
          "spear-goblins",
          "archers",
          "knight",
          "bats",
          "fire-spirits",
        ],
      }),
    );
    Math.random = () => 0;
  });
  await page.goto(process.env.ARENA_PROFILE_URL ?? "http://127.0.0.1:5188/");
  await page.waitForFunction(
    () => window.__arena && !window.__arena.state.renderPending,
    null,
    { timeout: 90000 },
  );
  await page.locator("#battle-button").click();
  await page.waitForFunction(
    () =>
      !window.__arena.state.intro.blocking &&
      document.querySelectorAll("#hand .native-card-ready").length === 4,
    null,
    { timeout: 90000 },
  );
  const selected = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("#hand [data-slot]")];
    return buttons.reduce(
      (best, button, index) =>
        Number(button.dataset.cardCost) < Number(buttons[best].dataset.cardCost)
          ? index
          : best,
      0,
    );
  });
  const before = await page.evaluate((slot) => {
    const root = document.querySelector("#hand");
    const refs = [...root.querySelectorAll("[data-slot]")].map((button) => ({
      button,
      slot: Number(button.dataset.slot),
      id: button.dataset.nativeCard,
      svg: button.querySelector(".native-card-art > svg"),
    }));
    const metrics = { unchangedArtRebuilds: 0, rootMutations: 0 };
    const collect = (records) => {
      for (const record of records) {
        if (record.type === "childList" && record.target === root)
          metrics.rootMutations++;
        const button = record.target.closest?.("[data-slot]");
        if (
          record.type === "childList" &&
          record.target.matches?.(".native-card-art") &&
          Number(button?.dataset.slot) !== slot
        )
          metrics.unchangedArtRebuilds++;
      }
    };
    const observer = new MutationObserver(collect);
    observer.observe(root, { subtree: true, childList: true });
    window.__handProbe = { refs, metrics, observer, collect };
    return {
      hand: window.__arena.state.hand,
      actions: window.__arena.state.actions,
      slot,
    };
  }, selected);
  await page.locator(`#hand [data-slot="${selected}"]`).click();
  const point = await page.evaluate(() => window.__arena.project(4, 23));
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(
    (before) =>
      window.__arena.state.actions > before.actions &&
      window.__arena.state.hand[before.slot] !== before.hand[before.slot],
    before,
  );
  const time = await page.evaluate(() => window.__arena.state.time);
  await page.waitForFunction(
    (time) => window.__arena.state.time > time + 0.7,
    time,
  );
  const after = await page.evaluate((slot) => {
    const probe = window.__handProbe;
    probe.collect(probe.observer.takeRecords());
    probe.observer.disconnect();
    const unchanged = probe.refs.filter((ref) => ref.slot !== slot);
    return {
      ...probe.metrics,
      retainedButtons: unchanged.filter(
        (ref) =>
          document.querySelector(`#hand [data-slot="${ref.slot}"]`) ===
          ref.button,
      ).length,
      retainedSvg: unchanged.filter(
        (ref) =>
          document.querySelector(
            `#hand [data-slot="${ref.slot}"] .native-card-art > svg`,
          ) === ref.svg,
      ).length,
      unchangedCards: unchanged.length,
      actions: window.__arena.state.actions,
      hand: window.__arena.state.hand,
      nodes: document.querySelectorAll("#hand *").length,
    };
  }, selected);
  console.log(JSON.stringify({ before, after, errors }, null, 2));
  if (errors.length) throw new Error("Page errors during hand probe");
} finally {
  await browser.close();
}
