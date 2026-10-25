import { expect, test } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("the AI casts useful Fireball while released Arrows will miss the approaching Hog", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html?scene=ai-approach-arrows-hog");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const output = page.locator("#destruction");
  const state = async () =>
    JSON.parse((await output.getAttribute("data-ai-areas"))!);
  const defense = async () =>
    JSON.parse((await output.getAttribute("data-ai-defense"))!);
  const advance = async () => {
    const before = (await state()).time;
    await page.locator("#second").click();
    await expect
      .poll(async () => (await state()).time)
      .toBeGreaterThan(before + 0.99);
  };
  await advance();
  await advance();
  expect((await defense()).actions).toEqual([]);
  await advance();
  const accepted = (await defense()).actions;
  expect(accepted.map((a: any) => [a.card, a.tick])).toEqual([
    ["arrows", 73],
    ["fireball", 74],
  ]);
  expect(
    (await state()).entities.filter((e: any) => e.card === "hog-rider"),
  ).toHaveLength(1);
  await advance();
  await advance();
  await advance();
  const result = await defense();
  expect(result.actions).toEqual(accepted);
  expect(
    (await state()).entities.filter((e: any) => e.card === "hog-rider"),
  ).toHaveLength(0);
  expect(result.towers.find((e: any) => !e.king && e.lane === "left").hp).toBe(
    3052,
  );
  expect(result.hogHits).toEqual([]);
  expect((await state()).winner).toBeNull();
  await page.screenshot({
    path: info.outputPath("approaching-arrows-reservation.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
