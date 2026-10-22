import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

test("saved v4 and v5 replays retain their endings when seeking on desktop and phones", async ({
  page,
}) => {
  // Both histories use the same captured commands. Version 5 additionally
  // collapses the losing side's remaining tower when its King falls.
  const fixture = JSON.parse(
    readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
  );
  const expected = [
    { version: 5, ruins: 3 },
    { version: 4, ruins: 2 },
  ];
  const profile = {
    version: 1,
    sound: false,
    seenTutorial: true,
    battles: 2,
    history: expected.map(({ version }) => ({
      id: version,
      date: "2026-10-22T12:00:00.000Z",
      mode: fixture.replay.mode,
      winner: "red",
      crowns: [0, 3],
      replay: { ...fixture.replay, version },
    })),
  };
  await page.addInitScript(
    (saved) =>
      localStorage.setItem("browser-royale.profile.v1", JSON.stringify(saved)),
    profile,
  );
  await page.goto("/");
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedEffects),
      { timeout: 30000 },
    )
    .toBe(45);
  for (const [index, end] of expected.entries()) {
    await page.getByRole("button", { name: "Battle log", exact: true }).click();
    await expect(page.locator("[data-replay]")).toHaveCount(2);
    await page.locator(`[data-replay="${index}"]`).click();
    expect(
      await page.evaluate(() => (window as any).__arena.state.rulesVersion),
    ).toBe(end.version);
    const timeline = page.getByRole("slider", { name: "Replay timeline" });
    await timeline.focus();
    await timeline.press("End");
    await expect
      .poll(() => page.evaluate(() => (window as any).__arena.state.winner))
      .toBe("red");
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__arena.state.destruction.rubble),
      )
      .toBe(end.ruins);
    await expect(
      page.getByRole("button", { name: "Restart replay", exact: true }),
    ).toBeVisible();
    await timeline.press("Home");
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__arena.state.destruction.rubble),
      )
      .toBe(0);
    expect(
      await page.evaluate(() => (window as any).__arena.state.winner),
    ).toBeNull();
    await page.locator("#replay-exit").click();
  }
});

async function backgroundAndReturn(page: Page, awaitingResult = false) {
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
  expect(before.paused).toBe(!awaitingResult);
  expect(before.frameLoopRunning).toBe(false);
  await page.waitForTimeout(awaitingResult ? 1700 : 350);
  const after = await page.evaluate(() => (window as any).__arena.state);
  expect(after.renderedFrames).toBe(before.renderedFrames);
  expect(after.time).toBe(before.time);
  expect(after.animationTime).toBe(before.animationTime);
  if (awaitingResult)
    await expect(
      page.getByRole("button", { name: "Watch replay", exact: true }),
    ).not.toBeVisible();
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
    !awaitingResult,
  );
}

test("deck changes persist, battle deploys, pause and replay work", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30000 });
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedEffects),
      { timeout: 30000 },
    )
    .toBe(45);
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena.state.loadedBuildings),
      { timeout: 30000 },
    )
    .toBe(3);
  await expect
    .poll(
      () =>
        page.evaluate(() => [
          (window as any).__arena.state.nativeTowerPrincesses,
          (window as any).__arena.state.nativePrincessTowers,
        ]),
      { timeout: 30000 },
    )
    .toEqual([4, 4]);
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
  ).toBeVisible({ timeout: 30000 });
  await page.locator("#battle-button").click();
  await expect(page.locator("#hand .game-card")).toHaveCount(4);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__arena.state.intro.blocking),
    )
    .toBe(false);
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
  await backgroundAndReturn(page, true);
  await expect(
    page.getByRole("button", { name: "Watch replay", exact: true }),
  ).toBeVisible({ timeout: 15000 });
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
