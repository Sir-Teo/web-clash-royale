import { test, expect, type Page } from "@playwright/test";

async function backgroundAndReturn(page: Page) {
  // Headless browsers keep tabs visible. Emulate the platform visibility event,
  // while leaving all game state accessible only through read-only diagnostics.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const before = await page.evaluate(() => (window as any).__arena.state);
  expect(before.paused).toBe(true);
  expect(before.frameLoopRunning).toBe(false);
  await page.waitForTimeout(350);
  const after = await page.evaluate(() => (window as any).__arena.state);
  expect(after.renderedFrames).toBe(before.renderedFrames);
  expect(after.time).toBe(before.time);
  expect(after.animationTime).toBe(before.animationTime);
  await page.evaluate(() => {
    delete (document as any).hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__arena.state.renderedFrames),
    )
    .toBeGreaterThan(after.renderedFrames);
  expect(await page.evaluate(() => (window as any).__arena.state.paused)).toBe(
    true,
  );
}

test("deck changes persist, battle deploys, pause and replay work", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena.state.loadedEffects),
      { timeout: 30000 },
    )
    .toBe(18);
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena.state.loadedBuildings),
      { timeout: 30000 },
    )
    .toBe(2);
  await page.getByRole("button", { name: "Cards 24", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator('[data-edit-slot="0"]').click();
  await page.locator('[data-collection="valkyrie"]').click();
  await expect(page.locator('[data-edit-slot="0"]')).toHaveAttribute(
    "aria-label",
    "Valkyrie, 4 elixir",
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await expect(
    page.locator('#deck-preview [data-card-info="valkyrie"]'),
  ).toBeVisible();
  await page.locator("#battle-button").click();
  await expect(page.locator("#hand .game-card")).toHaveCount(4);
  // Select an affordable opening troop using the same public controls as a player.
  const cards = await page.locator("#hand .game-card").evaluateAll((els) =>
    els.map((e) => ({
      id: (e as HTMLElement).dataset.slot,
      label: e.getAttribute("aria-label")!,
      cost: Number(e.querySelector(".cost")!.textContent),
    })),
  );
  const troop = cards.find(
    (c) => c.cost <= 5 && !/Fireball|Arrows/.test(c.label),
  )!;
  await page.locator(`[data-slot="${troop.id}"]`).click();
  const arena = await page.locator("#arena-canvas").boundingBox();
  expect(arena).not.toBeNull();
  // Arena projection is exposed read-only for diagnostics; no state is mutated by the test.
  const point = await page.evaluate(() =>
    (window as any).__arena.project(4, 21),
  );
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.actions))
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.troops))
    .toBeGreaterThan(0);
  const tray = await page.locator("#battle-tray").boundingBox();
  expect(tray!.y + tray!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height + 2,
  );
  await backgroundAndReturn(page);
  await expect(
    page.getByRole("heading", { name: "Battle paused" }),
  ).toBeVisible();
  const time = await page.evaluate(() => (window as any).__arena.state.time);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).__arena.state.time)).toBe(
    time,
  );
  await page
    .getByRole("button", { name: "Resume battle", exact: true })
    .click();
  await page.screenshot({
    path: `test-results/${info.project.name}-battle.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Watch replay", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Watch replay", exact: true }).click();
  await expect(page.locator(".replay-controls")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.time))
    .toBeGreaterThan(0);
  await backgroundAndReturn(page);
  await page
    .getByRole("button", { name: "Resume replay", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause replay", exact: true }),
  ).toBeVisible();
  await page.locator("#replay-speed").click();
  await expect(page.locator("#replay-speed")).toHaveText("2×");
  await page.locator("#replay-exit").click();
  await expect(page.locator("#battle-button")).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `test-results/${info.project.name}-lobby.png`,
    fullPage: true,
  });
});
test("settings and card search are usable without page overflow", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Battle settings", exact: true })
    .click();
  await page.getByLabel("PLAYER NAME", { exact: true }).fill("Royal Tester");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Cards 24", exact: true }).click();
  await page.getByLabel("Search cards", { exact: true }).fill("dragon");
  await expect(page.locator("[data-collection]")).toHaveCount(1);
  await expect(page.locator("[data-collection]")).toHaveAttribute(
    "aria-label",
    "Baby Dragon, 4 elixir",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
