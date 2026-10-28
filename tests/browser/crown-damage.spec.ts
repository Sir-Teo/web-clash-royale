import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { expectedEffects } from "./native-assets";

test("Crown damage and forecasts agree in current and historical rendered battles", async ({
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
  const traces = [];
  const values = {
    fireball: [275.6, 276],
    arrows: [146.4, 147],
    rocket: [593.6, 594],
    lightning: [551.2, 552],
    log: [203.6, 204],
  };
  for (const version of [43, 44]) {
    await page.locator("#rules").selectOption(String(version));
    for (const team of ["blue", "red"]) {
      await page.locator("#team").selectOption(team);
      await page
        .locator("#tower")
        .selectOption(team === "blue" ? "princess" : "king");
      for (const [card, amounts] of Object.entries(values)) {
        await page.locator("#card").selectOption(card);
        await expect.poll(async () => (await state()).tick).toBe(120);
        await page.locator("#cast").click();
        await expect.poll(async () => (await state()).actions.length).toBe(1);
        expect((await state()).forecast).toBeCloseTo(amounts[version - 43], 10);
        await page.locator("#advance").click();
        await expect.poll(async () => (await state()).tick).toBe(300);
        const impact = await state();
        expect(impact.damage).toBeCloseTo(amounts[version - 43], 10);
        expect(impact.native).toBe(version === 44);
        expect(impact.shots).toBe(0);
        expect(impact.areas).toBe(0);
        await page.locator("#replay").click();
        await expect.poll(async () => (await state()).hp).toBe(impact.hp);
        expect(await state()).toEqual(impact);
        traces.push({ version, team, card, impact });
      }
    }
  }
  await page.screenshot({ path: info.outputPath("crown-damage.png") });
  expect(errors).toEqual([]);
  const path = info.outputPath("crown-damage-traces.json");
  await writeFile(path, JSON.stringify(traces, null, 2));
  await info.attach("crown-damage-traces", {
    path,
    contentType: "application/json",
  });
});
