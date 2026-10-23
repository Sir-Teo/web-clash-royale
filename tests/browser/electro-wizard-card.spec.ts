import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Electro Wizard draws two native lightning beams in desktop and phone combat", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("attack-impacts");
  await page.locator("#attack-card").selectOption("electro-wizard");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, { timeout: 60000 });
  const data = async (key: string) => JSON.parse((await page.locator("#destruction").getAttribute(`data-${key}`))!);
  const step = async () => {
    const before = (await data("state")).time;
    await page.locator("#step").click();
    await expect.poll(async () => (await data("state")).time).toBeGreaterThan(before + 0.099);
  };
  for (let i = 0; i < 25 && !((await data("attack-impacts"))["electro-wizard"] >= 2); i++) await step();
  expect((await data("attack-impacts"))["electro-wizard"]).toBe(2);
  await expect.poll(async () => (await data("impact-sprites")).filter((sprite: any) => sprite.name === "electro_wiz_beam").length).toBe(2);
  await page.screenshot({ path: info.outputPath("electro-wizard-dual-beam.png"), fullPage: true });
  expect(errors).toEqual([]);
});
