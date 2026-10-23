import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Inferno Dragon beam ramps through all three native stages on desktop and phone", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("attack-impacts");
  await page.locator("#attack-card").selectOption("inferno-dragon");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, { timeout: 60000 });
  const beams = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-inferno-beams"))!);
  const time = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-state"))!).time;
  const advance = async () => {
    const before = await time();
    await page.locator("#second").click();
    await expect.poll(time).toBeGreaterThan(before + 0.9);
  };
  for (const [stage, clip, seconds] of [
    [0, "inferno_dragon_beam", 1],
    [1, "inferno_dragon_beam1", 2],
    [2, "inferno_dragon_beam2", 2],
  ] as const) {
    for (let i = 0; i < seconds; i++) await advance();
    await expect.poll(async () => beams()).toMatchObject([{ stage, beam: clip }]);
    await page.screenshot({ path: info.outputPath(`inferno-dragon-stage-${stage}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});
