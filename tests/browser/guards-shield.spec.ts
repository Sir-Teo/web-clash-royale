import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Guards render three source shields, then expose their unshielded models", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("guards");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, {
    timeout: 60000,
  });
  const diagnostic = page.locator("#destruction");
  const state = async () => JSON.parse((await diagnostic.getAttribute("data-state"))!);
  const guards = async () => JSON.parse((await diagnostic.getAttribute("data-guards"))!);
  const step = async () => {
    const before = (await state()).time;
    await page.locator("#step").click();
    await expect.poll(async () => (await state()).time).toBeGreaterThan(before + 0.099);
  };
  await expect.poll(async () => (await guards()).units.length).toBe(3);
  expect((await guards()).units.every((unit: any) => unit.art === "shielded" &&
    unit.shield === 242 && unit.health === "hp_shield_player_number")).toBe(true);
  for (let i = 0; i < 7; i++) await step();
  await page.screenshot({ path: info.outputPath("guards-shielded.png"), fullPage: true });
  await page.locator("#break-shield").click();
  for (let i = 0; i < 40 && (await guards()).shieldBreaks < 3; i++) await step();
  const broken = await guards();
  expect(broken.shieldBreaks).toBe(3);
  expect(broken.shieldAudio).toBe(3);
  expect(broken.units.every((unit: any) => unit.art === "unshielded" &&
    unit.shield === 0 && unit.hp === 105 &&
    ["hp_player_number", null].includes(unit.health))).toBe(true);
  expect(broken.particles).toBeGreaterThan(0);
  for (let i = 0; i < 4; i++) {
    const before = (await state()).time;
    await page.locator("#second").click();
    await expect.poll(async () => (await state()).time).toBeGreaterThan(before + 0.9);
  }
  await page.screenshot({ path: info.outputPath("guards-unshielded.png"), fullPage: true });
  expect(errors).toEqual([]);
});
