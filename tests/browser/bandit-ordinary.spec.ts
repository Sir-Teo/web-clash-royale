import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { expectedEffects } from "./native-assets";

test("Bandit keeps fresh ordinary hits on the native clock under legal Rage and replays them", async ({ page }, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/bandit-ordinary.html");
  const state = async () => JSON.parse((await page.locator("#status").getAttribute("data-state"))!);
  await expect.poll(async () => (await state()).effects, { timeout: 60000 }).toBe(expectedEffects);
  const traces = [];
  const timings: Record<string, number[]> = {};
  for (const version of [54, 55]) {
    await page.locator("#rules").selectOption(String(version));
    for (const modifier of ["normal", "rage"]) {
      await page.locator("#buff").selectOption(modifier);
      for (const runner of ["blue", "red"]) {
        await page.locator("#team").selectOption(runner);
        await expect.poll(async () => { const s = await state(); return [s.stage, s.version, s.runner, s.modifier]; })
          .toEqual(["preparing", version, runner, modifier]);
        const before = await state();
        expect(before.native).toBe(version === 55);
        await page.locator("#advance").click();
        await expect.poll(async () => (await state()).stage).toBe("first-hit");
        const first = await state();
        expect(first.hits).toHaveLength(1);
        expect(!!first.recovery).toBe(version === 55);
        await page.locator("#replay").click();
        await expect.poll(async () => (await state()).replayBuilds).toBe(first.replayBuilds + 1);
        expect(await state()).toEqual({ ...first, replayBuilds: first.replayBuilds + 1 });
        await page.locator("#launch").click();
        await expect.poll(async () => (await state()).stage).toBe("four-hits");
        const four = await state();
        expect(four.hits).toHaveLength(4);
        expect(four.dash).toBeUndefined(); expect(four.charge).toBeUndefined();
        expect(four.hitTicks).toEqual(version === 54 ? modifier === "rage" ? [225,248,271,294] : [229,259,289,319] :
          modifier === "rage" ? [224,246,269,291] : [228,258,288,318]);
        expect(four.attacks).toBe(4);
        expect(four.hp).toBeGreaterThan(0);
        expect(four.targetHp).toBeGreaterThan(0);
        expect(four.actions.map((a: { card: string }) => a.card))
          .toEqual(modifier === "rage" ? ["knight", "bandit", "rage"] : ["knight", "bandit"]);
        timings[`${version}/${modifier}/${runner}`] = four.hitTicks;
        if (version === 55) {
          const old = timings[`54/${modifier}/${runner}`];
          expect(four.hitTicks[0]).toBe(old[0] - 1);
          if (modifier === "rage") expect(four.hitTicks[3]).toBeLessThan(old[3]);
          else expect(four.hitTicks).toEqual(old.map((tick) => tick - 1));
          expect(four.recovery.elapsedMs).toBeGreaterThanOrEqual(4000);
          await page.screenshot({ path: info.outputPath(`bandit-${modifier}-${runner}-four-hits.png`) });
        }
        await page.locator("#replay").click();
        await expect.poll(async () => (await state()).replayBuilds).toBe(four.replayBuilds + 1);
        expect(await state()).toEqual({ ...four, replayBuilds: four.replayBuilds + 1 });
        traces.push({ version, modifier, runner, before, first, four });
      }
    }
  }
  expect(errors).toEqual([]);
  const path = info.outputPath("bandit-ordinary-traces.json");
  await writeFile(path, JSON.stringify({ timings, traces }, null, 2));
  await info.attach("bandit-ordinary-traces", { path, contentType: "application/json" });
});
