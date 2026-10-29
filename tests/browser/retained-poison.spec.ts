import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { expectedEffects } from "./native-assets";

test("retained Poison damages buried Tesla in new games and preserves historical replay", async ({ page }, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/retained-poison.html");
  const state = async () => JSON.parse((await page.locator("#status").getAttribute("data-state"))!);
  await expect.poll(async () => (await state()).effects, { timeout: 60000 }).toBe(expectedEffects);
  const traces = [];
  for (const version of [46, 47]) {
    await page.locator("#rules").selectOption(String(version));
    for (const team of ["blue", "red"]) {
      await page.locator("#team").selectOption(team);
      await expect.poll(async () => {
        const s = await state();
        return [s.stage, s.version, s.caster];
      }).toEqual(["hidden", version, team]);
      const before = await state();
      expect(before.version).toBe(version);
      expect(before.caster).toBe(team);
      expect(before.phase).toBe("hidden");
      expect(before.poison.remaining).toBeGreaterThan(0);
      expect(before.native).toBe(version === 47);
      expect(before.actions.map((a: { card: string }) => a.card)).toEqual(["tesla", "skeletons", "poison"]);
      await page.locator("#tick").click();
      await expect.poll(async () => (await state()).stage).toBe("ticked");
      const impact = await state();
      const expected = Math.max(0, before.hp - before.decayPerStep * (impact.tick - before.tick) - (version === 47 ? 121 : 0));
      expect(impact.hp).toBeCloseTo(expected, 8);
      expect(impact.phase).toBe("hidden");
      await page.locator("#replay").click();
      await expect.poll(async () => (await state()).replayBuilds).toBe(impact.replayBuilds + 1);
      await expect.poll(async () => (await state()).hp).toBe(impact.hp);
      expect(await state()).toEqual({ ...impact, replayBuilds: impact.replayBuilds + 1 });
      traces.push({ version, team, before, impact });
    }
  }
  await page.screenshot({ path: info.outputPath("retained-poison-tesla.png") });
  expect(errors).toEqual([]);
  const path = info.outputPath("retained-poison-traces.json");
  await writeFile(path, JSON.stringify(traces, null, 2));
  await info.attach("retained-poison-traces", { path, contentType: "application/json" });
});
