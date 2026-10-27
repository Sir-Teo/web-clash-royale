import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
const siteBase = process.env.VITE_BASE_PATH || "/";
if (!siteBase.startsWith("/") || !siteBase.endsWith("/"))
  throw new Error("VITE_BASE_PATH must start and end with /");
const gameUrl = new URL(
  process.env.ARENA_BASE_URL || new URL(siteBase, "http://127.0.0.1:5189").href,
);
if (!gameUrl.pathname.endsWith("/")) gameUrl.pathname += "/";

const deathAudioManifest = JSON.parse(
  await readFile("reference/client/death-audio-manifest.json", "utf8"),
);
const combatAudioManifest = JSON.parse(
  await readFile("reference/client/combat-audio-manifest.json", "utf8"),
);
const assetManifest = JSON.parse(
  await readFile("public/assets/manifest.json", "utf8"),
);
const expectedEffects = JSON.parse(
  await readFile("public/assets/effects/manifest.json", "utf8"),
).clips;
const expectedBuildings = JSON.parse(
  await readFile("public/assets/buildings/manifest.json", "utf8"),
).files.length;
const expectedAnimations = JSON.parse(
  await readFile("public/assets/animations/manifest.json", "utf8"),
).files.length;
const expectedCards = Object.keys(
  JSON.parse(await readFile("public/assets/ui/cards/cards.json", "utf8"))
    .portraits,
).length;
const expectedHealth = Object.keys(
  JSON.parse(await readFile("public/assets/ui/health/health.json", "utf8"))
    .clips,
).length;
const nativeAudioPaths = [
  ...new Set([
    ...[
      ...deathAudioManifest.audioFiles,
      ...combatAudioManifest.audioFiles,
    ].map((file) => file.path.replace(/^public/, "")),
    ...assetManifest.files
      .filter((file) => file.source.startsWith("music/"))
      .map((file) => `/assets/${file.path}`),
  ]),
].map((path) => new URL(path.replace(/^\//, ""), gameUrl).href);
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
  const misplaced = new Set();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.origin === gameUrl.origin &&
      !url.pathname.startsWith(gameUrl.pathname)
    )
      misplaced.add(url.pathname);
  });
  page.on("console", (m) => {
    if (m.type() === "error") console.error("Browser:", m.text());
  });
  page.on("requestfailed", (r) =>
    console.error("Failed:", r.url(), r.failure()?.errorText),
  );
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(gameUrl.href);

  await page.waitForFunction(() => !!window.__arena);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const scope = await page.evaluate(
    async () => (await navigator.serviceWorker.getRegistration())?.scope,
  );
  if (scope !== gameUrl.href)
    throw new Error(`Expected worker scope ${gameUrl.href}, received ${scope}`);
  const workerCached = await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      if (!name.startsWith("browser-royale-")) continue;
      const cache = await caches.open(name);
      if (
        (await cache.keys()).some((request) =>
          /\/assets\/peer-host-worker-[^/]+\.js$/.test(
            new URL(request.url).pathname,
          ),
        )
      )
        return true;
    }
    return false;
  });
  if (!workerCached)
    throw new Error("Browser match worker is missing from the offline cache");
  await context.setOffline(true);
  await page.reload();
  const phoneInstall = await page.evaluate(async () => {
    const manifestLink = document.querySelector('link[rel="manifest"]');
    const touchLink = document.querySelector('link[rel="apple-touch-icon"]');
    if (!manifestLink || !touchLink) return false;
    const response = await fetch(manifestLink.href);
    if (!response.ok) return false;
    const manifest = await response.json();
    const basePath = new URL(".", manifestLink.href).pathname;
    if (
      manifest.display !== "standalone" ||
      new URL(manifest.start_url, manifestLink.href).pathname !== basePath ||
      new URL(manifest.scope, manifestLink.href).pathname !== basePath ||
      manifest.icons?.length !== 3 ||
      !manifest.icons.some((icon) => icon.purpose === "maskable")
    )
      return false;
    const paths = [
      ...manifest.icons.map(
        (icon) => new URL(icon.src, manifestLink.href).href,
      ),
      touchLink.href,
    ];
    return (
      await Promise.all(
        paths.map(async (path) => {
          const icon = await fetch(path);
          if (
            !icon.ok ||
            !icon.headers.get("content-type")?.includes("image/png")
          )
            return false;
          const bitmap = await createImageBitmap(await icon.blob());
          const valid = bitmap.width >= 180 && bitmap.height === bitmap.width;
          bitmap.close();
          return valid;
        }),
      )
    ).every(Boolean);
  });
  if (!phoneInstall)
    throw new Error("Phone install manifest or icons are unavailable offline");
  const offlineNativeAudio = await page.evaluate(async (paths) => {
    return Promise.all(
      paths.map(async (path) => {
        const response = await fetch(path);
        const bytes = new Uint8Array(await response.arrayBuffer());
        return (
          response.ok && String.fromCharCode(...bytes.slice(0, 4)) === "OggS"
        );
      }),
    );
  }, nativeAudioPaths);

  if (!offlineNativeAudio.every(Boolean))
    throw new Error(
      "Native combat/death audio or battle music is missing from the offline cache",
    );
  await page.waitForFunction(
    ({ effects, buildings, animations, cards, health }) =>
      window.__arena?.state.loadedEffects === effects &&
      window.__arena?.state.loadedBuildings === buildings &&
      window.__arena?.state.loadedAnimations === animations &&
      window.__arena?.state.loadedAnnouncements === 5 &&
      window.__arena?.state.loadedIntros === 2 &&
      window.__arena?.state.loadedElixir === 8 &&
      window.__arena?.state.loadedCards === cards &&
      window.__arena?.state.loadedHealth === health &&
      window.__arena?.state.loadedHud === 6 &&
      window.__arena?.state.loadedEndings === 5 &&
      window.__arena?.state.loadedConnectionWarnings === 1 &&
      window.__arena?.state.loadedEmotes === 17 &&
      document.fonts.check('40px "Supercell Magic"') &&
      document.fonts.check('22px "SC CCBackBeat"') &&
      window.__arena?.state.nativeTowerPrincesses === 4 &&
      window.__arena?.state.nativePrincessTowers === 4,
    {
      effects: expectedEffects,
      buildings: expectedBuildings,
      animations: expectedAnimations,
      cards: expectedCards,
      health: expectedHealth,
    },
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
      window.__arena?.state.rulesVersion === 27 &&
      window.__arena.state.time > 0,
  );
  await page.getByRole("button", { name: "King emotes", exact: true }).click();
  const voice = page.waitForResponse((r) =>
    r.url().endsWith("/king_crying_01.ogg"),
  );
  await page
    .getByRole("button", { name: "Send King cry", exact: true })
    .click();
  await page.waitForFunction(
    () => window.__arena.state.emotes.blue?.kind === "cry",
  );
  const response = await voice;
  if (!response.ok() || !response.fromServiceWorker())
    throw new Error("Emote voice did not load from the offline cache");
  await page.getByRole("button", { name: "King emotes", exact: true }).click();
  await page
    .getByRole("button", { name: "Send Good luck!", exact: true })
    .click();
  await page.waitForFunction(
    () => window.__arena.state.emotes.blue?.kind === "good-luck",
  );
  await page
    .locator(".native-emote-bubble.blue text")
    .filter({ hasText: "Good luck!" })
    .waitFor();
  if (errors.length) throw new Error(errors.join("\n"));
  if (misplaced.size)
    throw new Error(
      `Game requested assets outside its hosting path: ${[...misplaced].join(", ")}`,
    );
  console.log(
    `Production offline reload, browser match worker, battle start, ${nativeAudioPaths.length} native combat/death/music files and connection/emote/voice/font/quick chat passed.`,
  );
} finally {
  await browser.close();
}
