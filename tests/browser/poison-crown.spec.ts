import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { expectedEffects } from "./native-assets";

test("Poison renders integer Crown ticks and replays historical fractional ticks", async ({ page }, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/crown-damage.html");
  const state = async () => JSON.parse((await page.locator("#status").getAttribute("data-state"))!);
  await expect.poll(async () => (await state()).effects, { timeout: 60000 }).toBe(expectedEffects);
  await page.locator("#card").selectOption("poison");
  const traces = [];
  for (const version of [45, 46]) {
    await page.locator("#rules").selectOption(String(version));
    for (const team of ["blue", "red"]) {
      await page.locator("#team").selectOption(team);
      for (const tower of ["princess", "king"]) {
        await page.locator("#tower").selectOption(tower);
        await expect.poll(async () => (await state()).tick).toBe(120);
        await page.locator("#cast").click();
        await expect.poll(async () => (await state()).actions.length).toBe(1);
        const amount = version === 46 ? 49 : 48.4;
        const before = await state();
        expect(before.version).toBe(version);
        expect(before.buffNative).toBe(version === 46);
        expect(before.forecast).toBeCloseTo(amount * 8, 9);
        await page.locator("#advance").click();
        await expect.poll(async () => (await state()).tick).toBe(300);
        expect((await state()).damage).toBeCloseTo(amount * 6, 9);
        if (version === 46 && team === "red" && tower === "king")
          await page.screenshot({ path: info.outputPath("poison-active-crown.png") });
        await page.locator("#advance3").click();
        await expect.poll(async () => (await state()).tick).toBe(390);
        const impact = await state();
        expect(impact.damage).toBeCloseTo(amount * 8, 9);
        await page.locator("#replay").click();
        await expect.poll(async () => (await state()).replayBuilds).toBe(impact.replayBuilds + 1);
        await expect.poll(async () => (await state()).hp).toBe(impact.hp);
        expect(await state()).toEqual({ ...impact, replayBuilds: impact.replayBuilds + 1 });
        traces.push({ version, team, tower, impact });
      }
    }
  }
  await page.screenshot({ path: info.outputPath("poison-eight-ticks.png") });
  expect(errors).toEqual([]);
  const path = info.outputPath("poison-crown-traces.json");
  await writeFile(path, JSON.stringify(traces, null, 2));
  await info.attach("poison-crown-traces", { path, contentType: "application/json" });
});
