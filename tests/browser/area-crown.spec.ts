import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { expectedEffects } from "./native-assets";

test("Zap renders integer Crown damage and preserves fractional historical replays", async ({
  page,
}, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/crown-damage.html");
  const state = async () =>
    JSON.parse((await page.locator("#status").getAttribute("data-state"))!);
  await expect
    .poll(async () => (await state()).effects, { timeout: 60000 })
    .toBe(expectedEffects);
  await page.locator("#card").selectOption("zap");
  const traces = [];
  for (const version of [44, 45]) {
    await page.locator("#rules").selectOption(String(version));
    for (const team of ["blue", "red"]) {
      await page.locator("#team").selectOption(team);
      for (const tower of ["princess", "king"]) {
        await page.locator("#tower").selectOption(tower);
        await expect.poll(async () => (await state()).tick).toBe(120);
        await page.locator("#cast").click();
        await expect.poll(async () => (await state()).actions.length).toBe(1);
        const before = await state();
        expect(before.version).toBe(version);
        expect(before.areaNative).toBe(version === 45);
        expect(before.forecast).toBeCloseTo(version === 45 ? 77 : 76.8, 10);
        await page.locator("#advance").click();
        await expect.poll(async () => (await state()).tick).toBe(300);
        const impact = await state();
        expect(impact.damage).toBeCloseTo(version === 45 ? 77 : 76.8, 10);
        expect(impact.shots).toBe(0);
        await page.locator("#replay").click();
        await expect
          .poll(async () => (await state()).replayBuilds)
          .toBe(impact.replayBuilds + 1);
        await expect.poll(async () => (await state()).hp).toBe(impact.hp);
        expect(await state()).toEqual({
          ...impact,
          replayBuilds: impact.replayBuilds + 1,
        });
        traces.push({ version, team, tower, impact });
      }
    }
  }
  await page.screenshot({ path: info.outputPath("zap-crown-damage.png") });
  expect(errors).toEqual([]);
  const path = info.outputPath("area-crown-traces.json");
  await writeFile(path, JSON.stringify(traces, null, 2));
  await info.attach("area-crown-traces", {
    path,
    contentType: "application/json",
  });
});
