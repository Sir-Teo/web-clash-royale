import { test, expect } from "@playwright/test";
import { expectedEffects, expectedAnimations } from "./native-assets";
import { CARDS, STARTER_DECK } from "../../src/game/cards";

test("Electro Wizard concentrates or splits native bolts and retains earlier replay behavior", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-electro-bolts"))!,
    );
  const traces = [];
  for (const version of [26, 27]) {
    await page.goto(
      `/tests/fixtures/combat.html?scene=electro-bolts&rules=${version}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    for (const mode of ["lone", "split", "rear"]) {
      await page.locator("#electro-mode").selectOption(mode);
      await expect
        .poll(async () => {
          const current = await state();
          return (
            current.mode === mode &&
            current.time === 0 &&
            current.bodies.length === 2 &&
            current.bodies.every((body: any) => body.native)
          );
        })
        .toBe(true);
      const initial = await state();
      expect(initial.version).toBe(version);
      expect(new Set(initial.bodies.map((body: any) => body.team)).size).toBe(
        2,
      );
      for (
        let step = 0;
        step < 30 &&
        !(await state()).bodies.every((body: any) => body.hits > 0);
        step++
      ) {
        const before = (await state()).time;
        await page.locator("#step").click();
        await expect
          .poll(async () => (await state()).time)
          .toBeGreaterThan(before + 0.099);
      }
      const active = await state();
      for (const body of active.bodies) {
        const previous = initial.bodies.find(
          (entry: any) => entry.id === body.id,
        );
        const split = mode === "split" || (mode === "rear" && version === 26);
        expect(body.policy).toBe(version === 27);
        expect(previous.primaryHp - body.primaryHp).toBe(
          body.damage * (version === 27 && !split ? 2 : 1),
        );
        if (mode !== "lone")
          expect(previous.otherHp - body.otherHp).toBe(split ? body.damage : 0);
        expect(body.hits).toBe(mode === "lone" && version === 26 ? 1 : 2);
      }
      const beams = mode === "lone" && version === 26 ? 2 : 4;
      await expect.poll(async () => (await state()).beams).toBe(beams);
      await page.locator("main").screenshot({
        path: info.outputPath(`electro-${mode}-rules-${version}.png`),
      });
      traces.push({ version, mode, initial, active });
      if (version === 27 && mode === "rear") {
        await page.locator("#rebuild").click();
        await expect
          .poll(async () =>
            (await state()).bodies.every((body: any) => body.native),
          )
          .toBe(true);
        expect((await state()).bodies).toEqual(active.bodies);
      }
    }
  }
  await info.attach("electro-bolt-traces", {
    body: JSON.stringify(traces, null, 2),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});

test("Electro Wizard card explains each bolt and deploys from the real hand", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(
    (deck) =>
      localStorage.setItem(
        "browser-royale.profile.v1",
        JSON.stringify({
          version: 1,
          sound: false,
          music: false,
          seenTutorial: true,
          deck,
        }),
      ),
    ["electro-wizard", ...STARTER_DECK.filter((id) => id !== "arrows")],
  );
  await page.goto("/");
  const state = () => page.evaluate(() => (window as any).__arena?.state);
  await expect
    .poll(async () => (await state())?.loadedCards, { timeout: 60000 })
    .toBe(CARDS.length);
  await expect
    .poll(async () => (await state())?.loadedAnimations, { timeout: 60000 })
    .toBe(expectedAnimations);
  await page.locator('#deck-preview [data-card-info="electro-wizard"]').click();
  await expect(page.locator(".detail-art.native-card-ready text")).toHaveText([
    "4",
    "Electro Wizard",
    "Level 11",
  ]);
  await expect(page.locator('[data-card-stat="Damage per bolt"] b')).toHaveText(
    "121",
  );
  await expect(
    page.locator('[data-card-stat="Bolts per attack"] b'),
  ).toHaveText("2");
  await expect(page.locator(".card-rule-note")).toContainText(
    "Both hit one opponent",
  );
  expect(
    await page
      .locator('[role="dialog"]')
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  const dialog = await page.getByRole("dialog").boundingBox();
  const viewport = page.viewportSize()!;
  expect(dialog!.x).toBeGreaterThanOrEqual(0);
  expect(dialog!.y).toBeGreaterThanOrEqual(0);
  expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(dialog!.y + dialog!.height).toBeLessThanOrEqual(viewport.height + 1);
  await page.screenshot({
    path: info.outputPath("electro-wizard-bolt-details.png"),
  });
  await page.locator(".card-rule-note").scrollIntoViewIfNeeded();
  await expect(page.locator(".card-rule-note")).toBeInViewport();
  await page.screenshot({ path: info.outputPath("electro-wizard-bolt-explanation.png") });
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.evaluate(() => {
    Math.random = () => 0;
  });
  await page.locator("#battle-button").click();
  await expect
    .poll(async () => (await state())?.intro.blocking, { timeout: 60000 })
    .toBe(false);
  await expect
    .poll(async () => (await state())?.elixir, { timeout: 30000 })
    .toBeGreaterThanOrEqual(4);
  const before = await state();
  expect(before.rulesVersion).toBe(30);
  const slot = before.hand.indexOf("electro-wizard");
  expect(slot).toBeGreaterThanOrEqual(0);
  await page.locator(`#hand [data-slot="${slot}"]`).click();
  const point = await page.evaluate(() =>
    (window as any).__arena.project(4, 21),
  );
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect
    .poll(async () => (await state()).actions)
    .toBeGreaterThan(before.actions);
  await expect
    .poll(async () =>
      (await state()).units.some(
        (entity: any) =>
          entity.team === "blue" &&
          entity.card === "electro-wizard" &&
          entity.hp > 0,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: info.outputPath("electro-wizard-hand-deployment.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
