import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { expectedEffects } from "./native-assets";

test("Bandit can prepare a distant follow-up immediately after landing and replay it", async ({ page }, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/bandit-reentry.html");
  const state = async () => JSON.parse((await page.locator("#status").getAttribute("data-state"))!);
  await expect.poll(async () => (await state()).effects, { timeout: 60000 }).toBe(expectedEffects);
  const traces = [];
  for (const version of [50, 51]) {
    await page.locator("#rules").selectOption(String(version));
    for (const runner of ["blue", "red"]) {
      await page.locator("#team").selectOption(runner);
      await expect.poll(async () => { const s = await state(); return [s.stage, s.version, s.runner]; })
        .toEqual(["landed", version, runner]);
      const before = await state();
      expect(before.native).toBe(version === 51);
      expect(before.ready).toBe(version === 51);
      expect(before.dash).toBeUndefined();
      await page.locator("#advance").click();
      await expect.poll(async () => (await state()).stage).toBe("follow-up");
      let follow = await state();
      expect(!!follow.charge).toBe(version === 51);
      if (version === 51) {
        expect(follow.charge.target).toBe(follow.knight);
        expect([follow.x, follow.y]).toEqual([follow.landing.x, follow.landing.y]);
        expect(follow.starts).toBe(2);
        await page.screenshot({ path: info.outputPath(`bandit-${runner}-follow-up.png`) });
      } else expect(Math.hypot(follow.x - before.x, follow.y - before.y)).toBeGreaterThan(0);
      await page.locator("#replay").click();
      await expect.poll(async () => (await state()).replayBuilds).toBe(follow.replayBuilds + 1);
      expect(await state()).toEqual({ ...follow, replayBuilds: follow.replayBuilds + 1 });
      if (version === 51) {
        await page.locator("#launch").click();
        await expect.poll(async () => (await state()).stage).toBe("launched");
        follow = await state();
        expect(follow.dash.goal).toBeDefined();
        await page.locator("#replay").click();
        await expect.poll(async () => (await state()).replayBuilds).toBe(follow.replayBuilds + 1);
        expect(await state()).toEqual({ ...follow, replayBuilds: follow.replayBuilds + 1 });
      }
      expect(follow.actions.map((a: { card: string }) => a.card)).toEqual(["bandit", "spear-goblins", "knight", "zap"]);
      traces.push({ version, runner, before, follow });
    }
  }
  await page.screenshot({ path: info.outputPath("bandit-follow-up-launched.png") });
  expect(errors).toEqual([]);
  const path = info.outputPath("bandit-reentry-traces.json");
  await writeFile(path, JSON.stringify(traces, null, 2));
  await info.attach("bandit-reentry-traces", { path, contentType: "application/json" });
});
