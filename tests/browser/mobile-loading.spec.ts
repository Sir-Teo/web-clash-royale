import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

const libraries = [
  ["loadedAnnouncements", "announcements"],
  ["loadedIntros", "intro/intro"],
  ["loadedElixir", "elixir/elixir"],
  ["loadedHud", "hud/hud"],
  ["loadedEndings", "ending/ending"],
  ["loadedEmotes", "emotes/emotes"],
  ["loadedCards", "cards/cards"],
  ["loadedConnectionWarnings", "connection/connection"],
  ["loadedHealth", "health/health"],
].map(([state, file]) => {
  const data = JSON.parse(
    readFileSync(`public/assets/ui/${file}.json`, "utf8"),
  );
  const directory = file.includes("/") ? file.split("/")[0] + "/" : "";
  const images = new Set<string>(
    Object.values(data.shapes).flatMap((shape: any) =>
      (shape.polygons ?? [shape]).flatMap((part: any) =>
        part.file ? [part.file] : [],
      ),
    ),
  );
  if (data.atlas) images.add(data.atlas.file);
  return {
    state,
    count: data.portraits
      ? Object.keys(data.portraits).length
      : state === "loadedConnectionWarnings"
        ? 1
        : Object.keys(data.clips).length,
    images: [...images].map((image) => `assets/ui/${directory}${image}`),
  };
});
const allImages = libraries.flatMap((library) => library.images).sort();

async function observeDecodes(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "browser-royale.profile.v1",
      JSON.stringify({ version: 1, seenTutorial: true, sound: false }),
    );
    const stats = { active: 0, peak: 0, failures: 0, sources: [] as string[] };
    (window as any).__nativeDecodes = stats;
    const OriginalImage = window.Image;
    window.Image = class extends OriginalImage {
      decode() {
        stats.active++;
        stats.peak = Math.max(stats.peak, stats.active);
        stats.sources.push(new URL(this.src).pathname);
        return super
          .decode()
          .catch((error) => {
            stats.failures++;
            throw error;
          })
          .finally(() => stats.active--);
      }
    };
  });
}

async function ready(page: Page, exclude: string | string[] = "") {
  const excluded = new Set(Array.isArray(exclude) ? exclude : [exclude]);
  await expect
    .poll(
      () =>
        page.evaluate(
          (expected) => {
            const state = (window as any).__arena?.state;
            return expected.every(([name, count]) => state?.[name] === count);
          },
          libraries
            .filter((library) => !excluded.has(library.state))
            .map((library) => [library.state, library.count]),
        ),
      { timeout: 60000 },
    )
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => (window as any).__nativeDecodes.active))
    .toBe(0);
}

test("all native UI libraries share the phone decode budget", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await observeDecodes(page);
  await page.goto("/");
  await ready(page);
  const stats = await page.evaluate(() => (window as any).__nativeDecodes);
  expect(stats.peak).toBeGreaterThan(0);
  expect(stats.peak).toBeLessThanOrEqual(4);
  expect(stats.failures).toBe(0);
  expect(stats.sources.map((source: string) => source.slice(1)).sort()).toEqual(
    allImages,
  );
  await expect(page.locator("#deck-preview .native-card-ready")).toHaveCount(8);
  await info.attach("native-image-loading", {
    body: JSON.stringify(stats),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});

test("a missing card crop leaves fallback cards and lets other libraries finish", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await observeDecodes(page);
  const missing = libraries.find((library) => library.state === "loadedCards")!
    .images[0];
  await page.route(`**/${missing}`, (route) => route.abort());
  await page.goto("/");
  await ready(page, "loadedCards");
  expect(
    await page.evaluate(() => (window as any).__arena.state.loadedCards),
  ).toBe(0);
  await expect(page.locator("#deck-preview .native-card-ready")).toHaveCount(0);
  await expect(page.locator("#deck-preview [data-native-card]")).toHaveCount(8);
  const stats = await page.evaluate(() => (window as any).__nativeDecodes);
  expect(stats.peak).toBeLessThanOrEqual(4);
  expect(stats.failures).toBe(1);
  expect(stats.sources).toHaveLength(allImages.length);
  expect(errors).toEqual([]);
});

test("stalled image requests release the shared budget while fallback battles remain playable", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await observeDecodes(page);
  const stalled: string[] = [];
  const release: (() => void)[] = [];
  await page.route("**/assets/ui/**", async (route) => {
    const source = new URL(route.request().url()).pathname.slice(1);
    if (allImages.includes(source) && stalled.length < 4) {
      stalled.push(source);
      await new Promise<void>((resolve) => release.push(resolve));
      await route.abort().catch(() => {});
    } else await route.continue();
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect.poll(() => stalled.length).toBe(4);
    const initial = await page.evaluate(() => (window as any).__nativeDecodes);
    expect(initial.active).toBe(4);
    expect(initial.sources).toHaveLength(4);
    await page.locator("#battle-button").click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__arena?.state.actions), {
        timeout: 30000,
      })
      .toBeGreaterThan(0);
    const affected = libraries
      .filter((library) =>
        library.images.some((source) => stalled.includes(source)),
      )
      .map((library) => library.state);
    await ready(page, affected);
    for (const name of affected)
      expect(
        await page.evaluate(
          (name) => (window as any).__arena.state[name],
          name,
        ),
      ).toBe(0);
    const stats = await page.evaluate(() => (window as any).__nativeDecodes);
    expect(stats.peak).toBeLessThanOrEqual(4);
    expect(stats.failures).toBe(4);
    expect(stats.sources).toHaveLength(allImages.length);
    await expect(page.locator("#battle-tray")).toBeVisible();
    await expect(page.locator("#hand [data-slot]")).toHaveCount(4);
    await info.attach("stalled-native-images", {
      body: JSON.stringify({ stalled, affected, stats }),
      contentType: "application/json",
    });
    await page.screenshot({
      path: info.outputPath("stalled-artwork-battle.png"),
    });
    expect(errors).toEqual([]);
  } finally {
    for (const resolve of release) resolve();
  }
});
