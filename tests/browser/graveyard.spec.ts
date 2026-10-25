import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Graveyard shows team ground art and native Skeleton bursts on desktop and phone", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("graveyard");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const node = page.locator("#destruction");
  const state = async () =>
    JSON.parse((await node.getAttribute("data-state"))!);
  const areas = async () =>
    JSON.parse((await node.getAttribute("data-graveyard-areas"))!);
  const births = async () =>
    JSON.parse((await node.getAttribute("data-graveyard-births"))!);
  await expect.poll(async () => (await areas()).length).toBe(2);
  expect(await areas()).toMatchObject([
    { team: "blue", card: "graveyard", frame: 0 },
    { team: "red", card: "graveyard", frame: 0 },
  ]);
  for (let i = 0; i < 3; i++) await page.locator("#second").click();
  await expect.poll(async () => (await births()).length).toBe(6);
  expect(new Set((await births()).map((birth: any) => birth.team))).toEqual(
    new Set(["blue", "red"]),
  );
  expect((await areas()).every((area: any) => area.frame === 90)).toBe(true);
  const active = await state();
  expect(active.clips.graveyard_ground).toBeGreaterThan(0);
  expect(active.particles).toBeGreaterThan(60);
  expect(active.draws).toBeGreaterThan(0);
  await page.screenshot({
    path: info.outputPath("native-graveyard-active.png"),
    fullPage: true,
  });
  await page.waitForTimeout(250);
  expect(await state()).toEqual(active);
  for (let i = 0; i < 8; i++) await page.locator("#second").click();
  await expect.poll(async () => (await areas()).length).toBe(0);
  expect(errors).toEqual([]);
});
