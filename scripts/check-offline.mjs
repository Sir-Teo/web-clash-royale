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
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(
    () =>
      window.__arena?.state.loadedEffects === 18 &&
      window.__arena?.state.loadedBuildings === 2 &&
      window.__arena?.state.loadedAnimations === 18,
  );
  console.log(
    "Offline title:",
    await page.title(),
    "HTML:",
    (await page.content()).slice(0, 200),
  );
  await page.locator("#battle-button").click();
  await page.locator("#hand .game-card").first().waitFor();
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Production offline reload and battle start passed.");
} finally {
  await browser.close();
}
