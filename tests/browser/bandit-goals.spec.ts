import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { expectedEffects } from "./native-assets";

test("committed Bandit route survives target death and reconstructs from legal replay", async ({ page }, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/bandit-goals.html");
  const state = async () => JSON.parse((await page.locator("#status").getAttribute("data-state"))!);
  await expect.poll(async () => (await state()).effects, { timeout: 60000 }).toBe(expectedEffects);
  const traces = [];
  for (const version of [48, 49]) {
    await page.locator("#rules").selectOption(String(version));
    for (const runner of ["blue", "red"]) {
      await page.locator("#team").selectOption(runner);
      await expect.poll(async () => {
        const s = await state(); return [s.stage, s.version, s.runner];
      }).toEqual(["target-lost", version, runner]);
      const before = await state();
      expect(before.native).toBe(version === 49);
      expect(!!before.dash).toBe(version === 49);
      expect(before.actions.map((a: { card: string }) => a.card)).toEqual(["bandit", "skeletons", "zap"]);
      if (version === 49) {
        expect(before.dash.goal).toEqual(before.goal);
        await page.screenshot({ path: info.outputPath(`bandit-${runner}-committed.png`) });
      }
      await page.locator("#tick").click();
      await expect.poll(async () => (await state()).stage).toBe("finished");
      const finish = await state();
      expect(finish.dash).toBeUndefined();
      expect(finish.hp).toBe(before.hp);
      expect(finish.hits).toBe(0);
      if (version === 49) {
        expect(Math.hypot(finish.x - before.x, finish.y - before.y)).toBeGreaterThan(1);
        expect(Math.hypot(finish.x - before.goal.x, finish.y - before.goal.y)).toBeLessThan(0.5);
      } else expect([finish.x, finish.y]).toEqual([before.x, before.y]);
      await page.locator("#replay").click();
      await expect.poll(async () => (await state()).replayBuilds).toBe(finish.replayBuilds + 1);
      expect(await state()).toEqual({ ...finish, replayBuilds: finish.replayBuilds + 1 });
      traces.push({ version, runner, before, finish });
    }
  }
  await page.screenshot({ path: info.outputPath("bandit-goal-finished.png") });
  expect(errors).toEqual([]);
  const path = info.outputPath("bandit-goal-traces.json");
  await writeFile(path, JSON.stringify(traces, null, 2));
  await info.attach("bandit-goal-traces", { path, contentType: "application/json" });
});
