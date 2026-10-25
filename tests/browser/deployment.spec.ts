import { test, expect } from "@playwright/test";
import { expectedAnimations } from "./native-assets";

test("native deployment formations and invalid placement feedback work through the hand", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      "browser-royale.profile.v1",
      JSON.stringify({
        version: 1,
        sound: false,
        seenTutorial: true,
        deck: [
          "archers",
          "goblins",
          "spear-goblins",
          "skeletons",
          "skeleton-army",
          "minions",
          "knight",
          "giant",
        ],
      }),
    ),
  );
  await page.goto("/");
  await expect
    .poll(
      () =>
        page.evaluate(() => (window as any).__arena?.state.loadedAnimations),
      { timeout: 30000 },
    )
    .toBe(expectedAnimations);
  await page.locator("#battle-button").click();
  const group = page
    .locator("#hand .game-card")
    .filter({
      has: page.locator(
        'img[alt="Archers"],img[alt="Goblins"],img[alt="Spear Goblins"],img[alt="Skeletons"],img[alt="Skeleton Army"],img[alt="Minions"]',
      ),
    })
    .first();
  const label = await group.getAttribute("aria-label");
  const expected = /Skeleton Army/.test(label!)
    ? 15
    : /Archers/.test(label!)
      ? 2
      : /^Goblins/.test(label!)
        ? 4
        : 3;
  await group.click();
  const friendly = await page.evaluate(() =>
    (window as any).__arena.project(9, 22),
  );
  await page.mouse.move(friendly.x, friendly.y);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__arena.state.placement?.nativeCount),
    )
    .toBe(expected);
  await expect(page.locator(".placement-feedback")).toContainText(
    `×${expected}`,
  );
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__arena.state.placement?.valid),
    )
    .toBe(true);
  const enemy = await page.evaluate(() =>
    (window as any).__arena.project(9, 7),
  );
  await page.mouse.move(enemy.x, enemy.y);
  await expect(page.locator(".placement-feedback")).toHaveClass(/invalid/);
  await expect(page.locator(".placement-feedback")).toContainText("your side");
  const before = await page.evaluate(
    () => (window as any).__arena.state.actions,
  );
  await page.mouse.click(enemy.x, enemy.y);
  expect(await page.evaluate(() => (window as any).__arena.state.actions)).toBe(
    before,
  );
  // Drag a card that was already selected. Moving it must restore its selection.
  const bounds = await group.boundingBox();
  await page.mouse.move(
    bounds!.x + bounds!.width / 2,
    bounds!.y + bounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(friendly.x, friendly.y, { steps: 8 });
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__arena.state.placement?.nativeCount),
    )
    .toBe(expected);
  await page.screenshot({
    path: `test-results/${info.project.name}-deployment.png`,
  });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.actions))
    .toBeGreaterThan(before);
  await expect(page.locator(".placement-feedback")).toBeHidden();
  await expect(page.locator("#drag-card")).toBeHidden();
  // Spend the remaining opening elixir through legal commands, then keep a
  // preview open while its resource requirement becomes affordable.
  for (let i = 0; i < 2; i++) {
    const affordable = await page
      .locator("#hand .game-card:not(.unaffordable)")
      .evaluateAll(
        (els) =>
          els
            .map((e) => ({
              slot: (e as HTMLElement).dataset.slot!,
              cost: Number(e.querySelector(".cost")!.textContent),
            }))
            .sort((a, b) => b.cost - a.cost)[0],
      );
    if (!affordable) break;
    await page.locator(`[data-slot="${affordable.slot}"]`).click();
    await page.mouse.click(friendly.x, friendly.y);
    await expect
      .poll(() => page.evaluate(() => (window as any).__arena.state.selected))
      .toBe(-1);
  }
  const expensive = await page
    .locator("#hand .game-card.unaffordable")
    .evaluateAll(
      (els) =>
        els
          .map((e) => ({
            slot: (e as HTMLElement).dataset.slot!,
            cost: Number(e.querySelector(".cost")!.textContent),
          }))
          .sort((a, b) => b.cost - a.cost)[0],
    );
  expect(expensive).toBeDefined();
  await page.locator(`[data-slot="${expensive.slot}"]`).click();
  await page.mouse.move(friendly.x, friendly.y);
  await expect(page.locator(".placement-feedback")).toContainText(
    `You need ${expensive.cost} elixir`,
  );
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena.state.placement?.valid),
      { timeout: 20000 },
    )
    .toBe(true);
  await expect(page.locator(".placement-feedback")).not.toHaveClass(/invalid/);
  expect(errors).toEqual([]);
});
