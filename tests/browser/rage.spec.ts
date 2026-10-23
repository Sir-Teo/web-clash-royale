import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("native Rage colors friendly troops on both teams and clears with its area", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("rage");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, { timeout: 60000 });
  const node = page.locator("#destruction");
  const areas = async () => JSON.parse((await node.getAttribute("data-rage-areas"))!);
  const filter = async () => JSON.parse((await node.getAttribute("data-rage-filter"))!);
  await page.locator("#rage-cast").click();
  await page.locator("#step").click();
  await expect.poll(async () => (await areas()).length).toBe(2);
  await expect.poll(async () => (await filter()).length).toBe(4);
  expect((await areas()).map((area: { team: string }) => area.team)).toEqual(["blue", "red"]);
  expect((await filter()).every((actor: { applied: boolean }) => actor.applied)).toBe(true);
  await expect.poll(async () => JSON.parse((await node.getAttribute("data-state"))!).particles).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath("native-rage-active.png"), fullPage: true });
  for (let i = 0; i < 6; i++) await page.locator("#second").click();
  await expect.poll(async () => (await areas()).length).toBe(0);
  await expect.poll(async () => (await filter()).length).toBe(0);
  await page.locator("#reset").click();
  expect(await areas()).toEqual([]);
  expect(errors).toEqual([]);
});
