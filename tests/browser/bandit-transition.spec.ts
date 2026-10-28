import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { expectedEffects } from "./native-assets";

test("Bandit finishes a committed post-dash swing through a legal Tornado and replays it", async ({ page }, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/bandit-transition.html");
  const state = async () => JSON.parse((await page.locator("#status").getAttribute("data-state"))!);
  await expect.poll(async () => (await state()).effects, { timeout: 60000 }).toBe(expectedEffects);
  const traces = [];
  for (const version of [53, 54]) for (const runner of ["blue", "red"]) {
    await page.locator("#rules").selectOption(String(version));
    await page.locator("#team").selectOption(runner);
    await expect.poll(async () => { const s = await state(); return [s.stage, s.version, s.runner]; })
      .toEqual(["preparing", version, runner]);
    const before = await state();
    expect(before.tick).toBe(266);
    expect(before.native).toBe(version === 54);
    expect(before.pending.recovery.animating).toBe(true);
    await page.locator("#pull").click();
    await expect.poll(async () => (await state()).stage).toBe("cast");
    const cast = await state();
    await page.locator("#replay").click();
    await expect.poll(async () => (await state()).replayBuilds).toBe(cast.replayBuilds + 1);
    expect(await state()).toEqual({ ...cast, replayBuilds: cast.replayBuilds + 1 });
    await page.locator("#advance").click();
    await expect.poll(async () => (await state()).stage).toBe("resolved");
    const resolved = await state();
    expect(resolved.tick).toBe(278);
    expect(resolved.gap).toBeGreaterThan(1.85);
    expect(resolved.hp).toBeGreaterThan(0);
    expect(resolved.targetHp).toBeGreaterThan(0);
    expect(resolved.actions.map((a: { card: string }) => a.card)).toEqual(["bandit", "knight", "tornado"]);
    expect(resolved.hits).toHaveLength(version === 54 ? 1 : 0);
    expect(resolved.targetHp).toBe(resolved.landingHp - (version === 54 ? resolved.damage : 0));
    if (version === 54) {
      expect(resolved.damage).toBe(194);
      await page.screenshot({ path: info.outputPath(`bandit-${runner}-committed-hit.png`) });
    }
    await page.locator("#replay").click();
    await expect.poll(async () => (await state()).replayBuilds).toBe(resolved.replayBuilds + 1);
    expect(await state()).toEqual({ ...resolved, replayBuilds: resolved.replayBuilds + 1 });
    traces.push({ version, runner, before, cast, resolved });
  }
  expect(errors).toEqual([]);
  const path = info.outputPath("bandit-transition-traces.json");
  await writeFile(path, JSON.stringify(traces, null, 2));
  await info.attach("bandit-transition-traces", { path, contentType: "application/json" });
});
