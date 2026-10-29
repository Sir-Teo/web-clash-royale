import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { expectedEffects } from "./native-assets";

test("vulnerable Bandit charging, launch and legal Zap rebuild through replay", async ({ page }, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/bandit-startup.html");
  const state = async () => JSON.parse((await page.locator("#status").getAttribute("data-state"))!);
  await expect.poll(async () => (await state()).effects, { timeout: 60000 }).toBe(expectedEffects);
  const traces = [];
  for (const version of [49, 50]) {
    await page.locator("#rules").selectOption(String(version));
    for (const runner of ["blue", "red"]) {
      await page.locator("#team").selectOption(runner);
      await expect.poll(async () => { const s = await state(); return [s.stage, s.version, s.runner]; })
        .toEqual(["ready", version, runner]);
      const before = await state();
      expect(before.native).toBe(version === 50);
      expect(!!before.charge).toBe(version === 50);
      expect(!!before.dash).toBe(version === 49);
      if (version === 50) {
        expect(before.charge.remainingMs).toBe(950);
        expect(before.filter).toEqual([]);
        expect(before.trails).toEqual([]);
        await page.screenshot({ path: info.outputPath(`bandit-${runner}-charging.png`) });
      }
      await page.locator("#zap").click();
      await expect.poll(async () => (await state()).stage).toBe("zapped");
      const zapped = await state();
      expect(zapped.zapDamage).toBe(version === 50 ? 192 : 0);
      if (version === 50) expect(zapped.stun).toBeGreaterThan(0);
      await page.locator("#tick").click();
      await expect.poll(async () => (await state()).stage).toBe("launched");
      const launch = await state();
      expect(launch.charge).toBeUndefined();
      expect(launch.dash.goal).toBeDefined();
      expect(launch.actions.map((a: { card: string }) => a.card)).toEqual(["bandit", "knight", "zap"]);
      await page.locator("#replay").click();
      await expect.poll(async () => (await state()).replayBuilds).toBe(launch.replayBuilds + 1);
      expect(await state()).toEqual({ ...launch, replayBuilds: launch.replayBuilds + 1 });
      traces.push({ version, runner, before, zapped, launch });
    }
  }
  await page.screenshot({ path: info.outputPath("bandit-charge-launched.png") });
  expect(errors).toEqual([]);
  const path = info.outputPath("bandit-startup-traces.json");
  await writeFile(path, JSON.stringify(traces, null, 2));
  await info.attach("bandit-startup-traces", { path, contentType: "application/json" });
});
