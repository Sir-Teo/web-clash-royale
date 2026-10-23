import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Clone shows one-hitpoint holograms and native area art on desktop and phone", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("clone");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const node = page.locator("#destruction");
  const read = async (name: string) =>
    JSON.parse((await node.getAttribute(`data-${name}`))!);
  await page.locator("#step").click();
  await expect.poll(async () => (await read("clone-entities")).length).toBe(4);
  expect((await read("clone-entities")).every((e: any) => e.hp === 1)).toBe(
    true,
  );
  await expect.poll(async () => (await read("clone-filter")).length).toBe(4);
  expect((await read("clone-filter")).every((f: any) => f.applied)).toBe(true);
  expect(await read("clone-areas")).toHaveLength(1);
  const state = await read("state");
  expect(state.particles).toBeGreaterThan(0);
  await page.screenshot({
    path: info.outputPath("native-clone-holograms.png"),
    fullPage: true,
  });
  await page.waitForTimeout(200);
  expect(await read("state")).toEqual(state);
  await page.locator("#second").click();
  await expect.poll(async () => (await read("clone-areas")).length).toBe(0);
  expect(errors).toEqual([]);
});
