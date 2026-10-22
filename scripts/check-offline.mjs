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
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  // Check offline correctness with a cold asset cache on a busy test host.
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") console.error("Browser:", m.text());
  });
  page.on("requestfailed", (r) =>
    console.error("Failed:", r.url(), r.failure()?.errorText),
  );
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5189");
  await page.waitForFunction(() => !!window.__arena);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(
    () =>
      window.__arena?.state.loadedEffects === 45 &&
      window.__arena?.state.loadedBuildings === 3 &&
      window.__arena?.state.loadedAnimations === 19 &&
      window.__arena?.state.loadedAnnouncements === 5 &&
      document.fonts.check('40px "Supercell Magic"') &&
      window.__arena?.state.nativeTowerPrincesses === 4 &&
      window.__arena?.state.nativePrincessTowers === 4,
  );
  console.log(
    "Offline title:",
    await page.title(),
    "HTML:",
    (await page.content()).slice(0, 200),
  );
  await page.locator("#battle-button").click();
  await page.locator("#hand .game-card").first().waitFor();
  await page.waitForFunction(
    () =>
      window.__arena?.state.rulesVersion === 5 && window.__arena.state.time > 0,
  );
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Production offline reload and battle start passed.");
} finally {
  await browser.close();
}
