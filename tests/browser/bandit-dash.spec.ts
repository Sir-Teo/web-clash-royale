import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { expectedEffects } from "./native-assets";

test("native Bandit travel and retained Poison render and replay for both teams", async ({ page }, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/bandit-dash.html");
  const state = async () => JSON.parse((await page.locator("#status").getAttribute("data-state"))!);
  await expect.poll(async () => (await state()).effects, { timeout: 60000 }).toBe(expectedEffects);
  const traces = [];
  for (const version of [47, 48]) {
    await page.locator("#rules").selectOption(String(version));
    for (const runner of ["blue", "red"]) {
      await page.locator("#team").selectOption(runner);
      await expect.poll(async () => {
        const s = await state();
        return [s.stage, s.version, s.runner];
      }).toEqual(["ready", version, runner]);
      const before = await state();
      expect(before.native).toBe(version === 48);
      expect(before.dash).toBeTruthy();
      expect(before.poison.remaining).toBeGreaterThan(0);
      expect(before.actions.map((a: { card: string }) => a.card)).toEqual(["bandit", "knight", "poison"]);
      await page.locator("#tick").click();
      await expect.poll(async () => (await state()).stage).toBe("ticked");
      const impact = await state();
      expect(impact.hp).toBe(before.hp - (version === 48 ? 121 : 0));
      expect(impact.dash).toBeTruthy();
      expect(Math.hypot(impact.x - before.x, impact.y - before.y)).toBeCloseTo((version === 48 ? 10 : 500 / 60) / 30, 8);
      await page.locator("#replay").click();
      await expect.poll(async () => (await state()).replayBuilds).toBe(impact.replayBuilds + 1);
      expect(await state()).toEqual({ ...impact, replayBuilds: impact.replayBuilds + 1 });
      traces.push({ version, runner, before, impact });
    }
  }
  await page.screenshot({ path: info.outputPath("bandit-poison-dash.png") });
  expect(errors).toEqual([]);
  const path = info.outputPath("bandit-dash-traces.json");
  await writeFile(path, JSON.stringify(traces, null, 2));
  await info.attach("bandit-dash-traces", { path, contentType: "application/json" });
});
