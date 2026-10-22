import { test, expect } from "@playwright/test";

test("native portraits use separate frames and the draw animation freezes and settles", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/cards.html");
  await expect(page.locator("#status")).toContainText("24 native portraits", {
    timeout: 30000,
  });
  await expect(page.locator("#gallery .native-card-ready")).toHaveCount(24);
  const knight = page.locator('#gallery [data-native-card="knight"]');
  await expect(knight.locator("text")).toHaveText(["3", "Knight", "Level 11"]);
  await knight.click();
  await expect(knight).toHaveAttribute("data-card-clip", "deck-selected");
  const hand = page.locator('#hand [data-slot="0"]');
  await page.locator("#draw").click();
  await expect(hand).toHaveAttribute("data-card-clip", "reveal");
  await expect(hand).toHaveAttribute("data-card-frame", "0");
  const frozen = await hand.innerHTML();
  await page.waitForTimeout(200);
  expect(await hand.innerHTML()).toBe(frozen);
  await page.locator("#step").click();
  await expect(hand).toHaveAttribute("data-card-frame", "1");
  await page.locator("#play").click();
  await expect(hand).toHaveAttribute("data-card-clip", "hand");
  await page.locator("#play").click();
  await hand.click();
  await expect(hand).toHaveAttribute("data-card-clip", "hand-selected");
  await page.locator("#draw").click();
  await page.locator("#reset").click();
  await expect(hand).toHaveAttribute("data-card-clip", "hand");
  expect(errors).toEqual([]);
});

test("card selection and deployment preserve readable costs and touch targets across phone rotations", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
      { timeout: 30000 },
    )
    .toBe(24);
  await expect(page.locator("#deck-preview .native-card-ready")).toHaveCount(8);
  await page.locator('#deck-preview [data-card-info="knight"]').click();
  await expect(page.locator(".detail-art.native-card-ready text")).toHaveText([
    "3",
    "Knight",
    "Level 11",
  ]);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.locator("#battle-button").click();
  const hand = page.locator("#hand .game-card");
  await expect(hand.first()).toBeEnabled({ timeout: 15000 });
  const card = await hand.evaluateAll(
    (els) =>
      els
        .map((e) => ({
          id: (e as HTMLElement).dataset.nativeCard,
          slot: (e as HTMLElement).dataset.slot,
          cost: Number(e.querySelector(".cost")!.textContent),
        }))
        .sort((a, b) => a.cost - b.cost)[0],
  );
  const chosen = page.locator(`#hand [data-slot="${card.slot}"]`);
  await chosen.click();
  await expect(chosen).toHaveAttribute("data-card-clip", "hand-selected");
  const node = await chosen.elementHandle();
  await page.waitForTimeout(200);
  expect(await node!.evaluate((e) => e.isConnected)).toBe(true);
  const before = await page.evaluate(
    () => (window as any).__arena.state.actions,
  );
  const point = await page.evaluate(() =>
    (window as any).__arena.project(4, 23),
  );
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.actions))
    .toBeGreaterThan(before);
  await expect(chosen).not.toHaveAttribute("data-native-card", card.id!);
  await expect(chosen).toHaveAttribute("data-card-clip", "hand");
  await expect(page.locator(".elixir-floats > div")).toHaveCount(0);
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  const held = await page.locator("#hand").innerHTML();
  await page.waitForTimeout(200);
  expect(await page.locator("#hand").innerHTML()).toBe(held);
  const sizes =
    info.project.name === "desktop"
      ? [{ width: 1440, height: 900 }]
      : [
          { width: 320, height: 568 },
          { width: 360, height: 640 },
          { width: 375, height: 667 },
          { width: 390, height: 844 },
          { width: 667, height: 375 },
          { width: 844, height: 390 },
        ];
  for (const size of sizes) {
    await page.setViewportSize(size);
    const boxes = await hand.evaluateAll((els) =>
      els.map((e) => {
        const b = e.getBoundingClientRect();
        const text = e
          .querySelector(".native-card-art text")!
          .getBoundingClientRect();
        return {
          x: b.x,
          y: b.y,
          right: b.right,
          bottom: b.bottom,
          width: b.width,
          height: b.height,
          digit: text.height,
          digitBottom: text.bottom,
        };
      }),
    );
    for (const b of boxes) {
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.right).toBeLessThanOrEqual(size.width + 1);
      expect(b.bottom).toBeLessThanOrEqual(size.height + 1);
      expect(b.digit).toBeGreaterThan(11);
      expect(b.digitBottom).toBeLessThanOrEqual(size.height + 1);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await expect(
      page.locator(".next-card-picture.native-card-ready"),
    ).toBeVisible();
    const nextCost = await page.locator(".native-next-cost").evaluate((e) => {
      const outer = e.getBoundingClientRect(),
        svg = e.querySelector("svg")!.getBoundingClientRect();
      return {
        outer: {
          x: outer.x + e.clientLeft,
          y: outer.y + e.clientTop,
          width: e.clientWidth,
          height: e.clientHeight,
        },
        svg: { x: svg.x, y: svg.y, width: svg.width, height: svg.height },
      };
    });
    for (const axis of ["x", "y", "width", "height"] as const)
      expect(nextCost.svg[axis]).toBeCloseTo(nextCost.outer[axis], 1);

    await expect(
      page.locator(".native-next-cost .native-card-art text"),
    ).toHaveText(await page.locator("#next-card-cost").innerText());
    if (
      size.width === 390 ||
      size.width === 667 ||
      info.project.name === "desktop"
    )
      await page.screenshot({
        path: `test-results/${info.project.name}-native-cards-${size.width}.png`,
      });
  }
  expect(errors).toEqual([]);
});

test("unavailable native cards retain usable fallback artwork and deployment controls", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/assets/ui/cards/cards.json", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("#deck-preview .game-card")).toHaveCount(8);
  await expect(page.locator("#deck-preview .native-card-ready")).toHaveCount(0);
  expect(
    await page
      .locator("#deck-preview .game-card img")
      .first()
      .evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0),
  ).toBe(true);
  await page.locator("#battle-button").click();
  const card = page.locator("#hand .game-card").first();
  await expect(card).toBeEnabled({ timeout: 15000 });
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect(card.locator(".cost")).toBeVisible();
  await expect(page.locator("#hand .native-card-ready")).toHaveCount(0);
  expect(errors).toEqual([]);
});
