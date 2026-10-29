import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { expectedEffects } from "./native-assets";

test("Bandit recovers into a melee hit sooner after landing and replays it", async ({ page }, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/bandit-recovery.html");
  const state = async () => JSON.parse((await page.locator("#status").getAttribute("data-state"))!);
  await expect.poll(async () => (await state()).effects, { timeout: 60000 }).toBe(expectedEffects);
  const traces = [];
  const timings: Record<string, number> = {};
  for (const version of [51, 52]) {
    await page.locator("#rules").selectOption(String(version));
    for (const runner of ["blue", "red"]) {
      await page.locator("#team").selectOption(runner);
      await expect.poll(async () => { const s = await state(); return [s.stage, s.version, s.runner]; })
        .toEqual(["landed", version, runner]);
      const before = await state();
      expect(before.native).toBe(version === 52);
      expect(!!before.recovery).toBe(version === 52);
      await page.locator("#advance").click();
      await expect.poll(async () => (await state()).stage).toBe("preparing");
      let preparing = await state();
      expect(!!preparing.pending?.recovery).toBe(version === 52);
      if (version === 52) {
        expect(preparing.pending.recovery.animating).toBe(true);
        expect(preparing.attacks).toBe(1);
        expect(preparing.hits).toHaveLength(0);
        await page.screenshot({ path: info.outputPath(`bandit-${runner}-melee-preparation.png`) });
      }
      await page.locator("#replay").click();
      await expect.poll(async () => (await state()).replayBuilds).toBe(preparing.replayBuilds + 1);
      expect(await state()).toEqual({ ...preparing, replayBuilds: preparing.replayBuilds + 1 });
      await page.locator("#launch").click();
      await expect.poll(async () => (await state()).stage).toBe("hit");
      const hit = await state();
      expect(hit.hits).toHaveLength(1);
      expect(hit.pending?.recovery).toBeUndefined();
      expect(hit.actions.map((a: { card: string }) => a.card)).toEqual(["bandit", "knight"]);
      timings[`${version}/${runner}`] = hit.tick - hit.landingTick;
      if (version === 52) expect(timings[`52/${runner}`]).toBeLessThan(timings[`51/${runner}`]);
      await page.locator("#replay").click();
      await expect.poll(async () => (await state()).replayBuilds).toBe(hit.replayBuilds + 1);
      expect(await state()).toEqual({ ...hit, replayBuilds: hit.replayBuilds + 1 });
      traces.push({ version, runner, before, preparing, hit });
    }
  }
  await page.screenshot({ path: info.outputPath("bandit-first-melee-hit.png") });
  expect(errors).toEqual([]);
  const path = info.outputPath("bandit-recovery-traces.json");
  await writeFile(path, JSON.stringify({ timings, traces }, null, 2));
  await info.attach("bandit-recovery-traces", { path, contentType: "application/json" });
});
