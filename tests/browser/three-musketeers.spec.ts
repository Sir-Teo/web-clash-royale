import { CARDS } from "../../src/game/cards";
import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { expectedCards, expectedAnimations } from "./native-assets";
const card = "three-musketeers",
  key = "browser-royale.profile.v1";
test("Three Musketeers persist, require nine elixir and render three native bodies through replay", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ({ key }) => {
      Math.random = () => 0;
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            seenTutorial: true,
            sound: false,
            music: false,
            deck: [
              "knight",
              "skeletons",
              "goblins",
              "spear-goblins",
              "archers",
              "giant",
              "arrows",
              "musketeer",
            ],
          }),
        );
    },
    { key },
  );
  const state = () => page.evaluate(() => (window as any).__arena?.state);
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__arena);
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 740 });
  await page
    .getByRole("button", { name: `Cards ${expectedCards}`, exact: true })
    .click();
  await page.locator(`[data-collection="${card}"]`).click();
  for (const [label, value] of [
    ["Count", "3"],
    ["Elixir", "9"],
    ["Hitpoints per troop", "720"],
    ["Damage per troop", "218"],
    ["Targets", "Air & ground"],
  ])
    await expect(page.locator(`[data-card-stat="${label}"] b`)).toHaveText(
      value,
    );
  await expect(page.locator(".detail-art")).toHaveAttribute(
    "data-native-card",
    card,
  );
  await expect.poll(async () => (await state()).loadedCards).toBe(CARDS.length);
  await expect
    .poll(() =>
      page
        .locator(".modal-backdrop")
        .evaluate((e) => getComputedStyle(e).opacity),
    )
    .toBe("1");
  await expect(
    page.locator('.detail-art image[href$="portrait-three-musketeers.webp"]'),
  ).toHaveCount(1);
  // WebKit can paint SVG text before its cached image resources settle.
  // Inspect the portrait interior, excluding the cost and card-name text.
  await expect
    .poll(async () => {
      const art = sharp(await page.locator(".detail-art").screenshot());
      const { width, height } = await art.metadata();
      const stats = await art
        .extract({
          left: Math.floor(width! * 0.2),
          top: Math.floor(height! * 0.2),
          width: Math.floor(width! * 0.6),
          height: Math.floor(height! * 0.4),
        })
        .stats();
      return Math.max(...stats.channels.slice(0, 3).map((c) => c.stdev));
    })
    .toBeGreaterThan(20);
  await page.screenshot({
    path: info.outputPath("three-musketeers-details.png"),
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Back to collection", exact: true })
    .click();
  await page.locator('[data-edit-slot="7"]').click();
  await page.locator(`[data-collection="${card}"]`).click();
  await expect(page.locator('[data-edit-slot="7"]')).toHaveAttribute(
    "aria-label",
    "Three Musketeers, 9 elixir",
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await expect(
    page.locator(`#deck-preview [data-card-info="${card}"]`),
  ).toBeVisible();
  await page.locator(".mode-select").click();
  await page.locator('[data-mode="training"]').click();
  await page.locator("#battle-button").click();
  await expect
    .poll(async () => (await state()).intro.blocking, { timeout: 15000 })
    .toBe(false);
  await expect
    .poll(async () => (await state()).loadedAnimations, { timeout: 30000 })
    .toBe(expectedAnimations);
  await expect.poll(async () => (await state()).loadedCards).toBe(CARDS.length);
  const slot = (await state()).hand.indexOf(card);
  expect(slot).toBeGreaterThanOrEqual(0);
  await page.keyboard.press(String(slot + 1));
  await expect.poll(async () => (await state()).placement?.nativeCount).toBe(3);
  expect((await state()).placement.valid).toBe(false);
  const before = (await state()).elixir;
  await page.keyboard.press("Enter");
  await expect(page.locator("#keyboard-deployment-status")).toContainText(
    "9 elixir",
  );
  expect((await state()).hand).toContain(card);
  expect((await state()).elixir).toBeGreaterThanOrEqual(before);
  await expect
    .poll(async () => (await state()).elixir, { timeout: 40000 })
    .toBeGreaterThanOrEqual(9);
  await expect.poll(async () => (await state()).placement.valid).toBe(true);
  const deployedAt = (await state()).time;
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await state()).time)
    .toBeGreaterThan(deployedAt + 1.05);
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await state()).health.filter((e: any) => e.maxHp === 720 && e.y > 20)
          .length,
    )
    .toBe(3);
  const held = await state();
  expect(held.elixir).toBeLessThan(2);
  expect(held.hand).not.toContain(card);
  expect(
    held.health
      .filter((e: any) => e.maxHp === 720 && e.y > 20)
      .every((e: any) => e.hp > 0),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("three-musketeers-battle.png"),
    style: ".pause-cover { visibility: hidden; }",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await page.getByRole("button", { name: "Watch replay", exact: true }).click();
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  await page.locator("#replay-seek").fill("100");
  await expect(page.locator("#replay-play")).toHaveAttribute(
    "aria-label",
    "Restart replay",
  );
  await expect
    .poll(
      async () =>
        (await state()).health.filter((e: any) => e.maxHp === 720 && e.y > 20)
          .length,
    )
    .toBe(3);
  await page.locator("#replay-seek").fill("0");
  expect((await state()).time).toBe(0);
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    key,
  );
  expect(saved.deck).toContain(card);
  expect(
    saved.history[0].replay.actions.filter(
      (a: any) => a.team === "blue" && a.card === card,
    ),
  ).toHaveLength(1);
  expect(errors).toEqual([]);
});
