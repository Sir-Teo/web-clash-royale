import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { CARDS } from "../../src/game/cards";

test.use({ serviceWorkers: "block", actionTimeout: 20000 });
test.setTimeout(150000);
const key = "browser-royale.profile.v1";

test("collection search, type, cost and sort reuse native artwork within their dialog", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          seenTutorial: true,
          sound: false,
          music: false,
        }),
      ),
    key,
  );
  await page.goto("/");
  await page.waitForFunction(
    () => {
      const s = (window as any).__arena?.state;
      return s && !s.renderPending;
    },
    null,
    { timeout: 90000 },
  );
  await page.locator('[data-nav="cards"]').click();
  await expect(page.locator("#collection-grid .native-card-ready")).toHaveCount(
    CARDS.length,
    { timeout: 60000 },
  );
  await page.evaluate(() => document.fonts.ready);
  const saved = await page.evaluate((key) => localStorage.getItem(key), key);
  const search = page.getByRole("textbox", {
    name: "Search cards",
    exact: true,
  });
  await search.focus();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  const modal = page.locator(".modal");
  const scroll = await modal.evaluate((el) => el.scrollTop);
  const pixels = await modal.screenshot({
    path: info.outputPath("original-collection.png"),
    animations: "disabled",
  });
  await page.evaluate(() => {
    const grid = document.querySelector("#collection-grid")!;
    const refs = [
      ...grid.querySelectorAll<HTMLElement>("[data-native-card]"),
    ].map((card) => ({
      id: card.dataset.nativeCard,
      card,
      svg: card.querySelector(".native-card-art > svg"),
    }));
    let rebuilds = 0;
    const collect = (records: MutationRecord[]) => {
      for (const record of records)
        if (
          record.type === "childList" &&
          (record.target as Element).matches?.(".native-card-art")
        )
          rebuilds++;
    };
    const observer = new MutationObserver(collect);
    observer.observe(grid, { subtree: true, childList: true });
    (window as any).__collectionTest = {
      grid,
      refs,
      observer,
      collect,
      rebuilds: () => rebuilds,
    };
  });
  for (const [query, count] of [
    ["g", 22],
    ["go", 10],
    ["gob", 6],
    ["goblin", 6],
    ["no such card", 0],
    ["", CARDS.length],
  ] as const) {
    await search.fill(query);
    await expect(search).toBeFocused();
    await expect(page.locator("[data-collection]")).toHaveCount(count);
    await expect(page.locator("#collection-results")).toHaveText(
      `Showing ${count} of ${CARDS.length} cards.`,
    );
    if (!count)
      await expect(page.locator("#collection-grid .empty-state")).toHaveText(
        "No cards match these filters.",
      );
  }
  await modal.evaluate((el, scroll) => (el.scrollTop = scroll), scroll);
  const restoredPixels = await modal.screenshot({
    path: info.outputPath("reused-collection.png"),
    animations: "disabled",
  });
  const original = await sharp(pixels)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const restored = await sharp(restoredPixels)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(restored.info).toEqual(original.info);
  // The rounded modal border may differ by one rasterized 8-bit value.
  let maxChannelDelta = 0;
  for (let i = 0; i < original.data.length; i++)
    maxChannelDelta = Math.max(
      maxChannelDelta,
      Math.abs(original.data[i] - restored.data[i]),
    );
  expect(maxChannelDelta).toBeLessThanOrEqual(1);
  const cost = page.getByLabel("Elixir cost", { exact: true });
  const sort = page.getByLabel("Sort cards", { exact: true });
  await cost.selectOption("4");
  await sort.focus();
  await sort.selectOption("name");
  await expect(sort).toBeFocused();
  for (const kind of ["troop", "spell", "building", "all", "all"] as const) {
    const button = page.locator(`[data-filter="${kind}"]`);
    await button.focus();
    await button.press("Enter");
    await expect(button).toBeFocused();
    await expect(button).toHaveClass(/active/);
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator('[data-filter][aria-pressed="true"]'),
    ).toHaveCount(1);
    await expect(cost).toHaveValue("4");
    await expect(sort).toHaveValue("name");
    await expect(search).toHaveValue("");
    await expect(page.locator("[data-collection]")).toHaveCount(
      CARDS.filter((c) => c.cost === 4 && (kind === "all" || c.kind === kind))
        .length,
    );
  }
  await cost.selectOption("all");
  await sort.selectOption("collection");
  await expect(page.locator("[data-collection]")).toHaveCount(CARDS.length);
  for (const [id, name] of [
    ["musketeer", "Musketeer"],
    ["giant", "Giant"],
  ]) {
    const card = page.locator(`[data-collection="${id}"]`);
    await card.scrollIntoViewIfNeeded();
    await card.focus();
    const heldScroll = await modal.evaluate((el) => el.scrollTop);
    await card.press("Enter");
    await expect(page.getByRole("dialog", { name, exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Back to collection", exact: true })
      .click();
    await expect(card).toBeFocused();
    await expect(card).toBeInViewport();
    expect(await modal.evaluate((el) => el.scrollTop)).toBeCloseTo(
      heldScroll,
      0,
    );
  }
  const retained = await page.evaluate(() => {
    const p = (window as any).__collectionTest;
    const grid = document.querySelector("#collection-grid");
    p.collect(p.observer.takeRecords());
    p.observer.disconnect();
    return {
      rebuilds: p.rebuilds(),
      sameGrid: grid === p.grid,
      cards: p.refs.filter(
        (ref: any) =>
          grid!.querySelector(`[data-native-card="${ref.id}"]`) === ref.card &&
          ref.card.querySelector(".native-card-art > svg") === ref.svg,
      ).length,
    };
  });
  expect(retained).toEqual({
    rebuilds: 0,
    sameGrid: true,
    cards: CARDS.length,
  });
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    saved,
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.locator('[data-nav="cards"]').click();
  await expect(page.locator("#collection-grid .native-card-ready")).toHaveCount(
    CARDS.length,
  );
  expect(
    await page.evaluate(
      () =>
        document.querySelector("#collection-grid") !==
        (window as any).__collectionTest.grid,
    ),
  ).toBe(true);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    saved,
  );
  expect(errors).toEqual([]);
});

test("cached rows hidden before native artwork loads upgrade when restored", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/assets/ui/cards/cards.json", async (route) => {
    await held;
    await route.continue();
  });
  await page.addInitScript(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          seenTutorial: true,
          sound: false,
          music: false,
        }),
      ),
    key,
  );
  try {
    await page.goto("/");
    await page.locator('[data-nav="cards"]').click();
    await expect(page.locator("[data-collection]")).toHaveCount(CARDS.length);
    await expect(
      page.locator("#collection-grid .native-card-ready"),
    ).toHaveCount(0);
    const saved = await page.evaluate((key) => localStorage.getItem(key), key);
    await page.evaluate(() => {
      (window as any).__lateCollectionGrid =
        document.querySelector("#collection-grid");
      (window as any).__lateCollectionCard = document.querySelector(
        '[data-collection="musketeer"]',
      );
    });
    await page.locator("#card-search").fill("goblin");
    await expect(page.locator("[data-collection]")).toHaveCount(6);
    await page.locator('[data-collection="goblins"]').click();
    await expect(page.locator(".detail-art.native-card-ready")).toHaveCount(0);
    release();
    await expect(page.locator(".detail-art.native-card-ready")).toHaveCount(1, {
      timeout: 60000,
    });
    await page
      .getByRole("button", { name: "Back to collection", exact: true })
      .click();
    await expect(
      page.locator("#collection-grid .native-card-ready"),
    ).toHaveCount(6, { timeout: 60000 });
    expect(
      await page.evaluate(
        () =>
          document.querySelector("#collection-grid") ===
          (window as any).__lateCollectionGrid,
      ),
    ).toBe(true);
    await page.locator("#card-search").fill("");
    await expect(
      page.locator("#collection-grid .native-card-ready"),
    ).toHaveCount(CARDS.length, { timeout: 30000 });
    expect(
      await page.evaluate(
        () =>
          document.querySelector('[data-collection="musketeer"]') ===
          (window as any).__lateCollectionCard,
      ),
    ).toBe(true);
    await page.locator('[data-collection="musketeer"]').click();
    await expect(
      page.getByRole("dialog", { name: "Musketeer", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".detail-art.native-card-ready")).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      saved,
    );
    expect(errors).toEqual([]);
  } finally {
    release();
  }
});
