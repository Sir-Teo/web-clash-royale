import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";
import { CARD_MAP } from "../../src/game/cards";

for (const scene of ["out", "race", "in"])
  test(`Lightning blocker pull: the natural AI timer handles ${scene}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      `/tests/fixtures/combat.html?scene=ai-lightning-pull-${scene}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    const output = page.locator("#destruction");
    const state = async () =>
      JSON.parse((await output.getAttribute("data-ai-areas"))!);
    const actions = async () =>
      JSON.parse((await output.getAttribute("data-ai-defense"))!).actions;
    for (let i = 0; i < 3; i++) {
      const before = (await state()).time;
      await page.locator("#second").click();
      await expect
        .poll(async () => (await state()).time, { timeout: 15000 })
        .toBeGreaterThan(before + 0.99);
      if (i < 2) expect(await actions()).toEqual([]);
    }
    const inward = scene === "in";
    expect(
      (await actions()).map((a: any) => ({ card: a.card, tick: a.tick })),
    ).toEqual(inward ? [] : [{ card: "freeze", tick: 74 }]);
    const result = await state();
    expect(result.winner).toBeNull();
    expect(result.kings.find((e: any) => e.team === "red").hp).toBeCloseTo(
      inward
        ? 600 - CARD_MAP.lumberjack.damage
        : 600 - CARD_MAP.lightning.damage * 0.4,
    );
    const giant = result.entities.find(
      (e: any) => e.team === "red" && e.card === "giant",
    );
    if (inward) {
      expect(giant).toBeUndefined();
      const hand = JSON.parse((await output.getAttribute("data-ai-spells"))!);
      expect(hand.hand).toContain("freeze");
      expect(hand.elixir).toBeGreaterThan(4);
    } else expect(giant.x).toBeGreaterThan(13.25);
    if (scene === "race") {
      const hand = JSON.parse((await output.getAttribute("data-ai-spells"))!);
      expect(hand.hand).toContain("rocket");
    }
    expect(
      result.areas.find((a: any) => a.card === "lightning").struck,
    ).toHaveLength(3);
    if (scene === "out")
      await page.screenshot({
        path: info.outputPath("ai-lightning-blocker-pull.png"),
        fullPage: true,
      });
    expect(errors).toEqual([]);
  });

for (const scene of ["early", "shield", "late"])
  test(`Lightning windup: the ordinary AI timer accounts for ${scene} Lightning`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      `/tests/fixtures/combat.html?scene=ai-lightning-windup-${scene}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    const output = page.locator("#destruction");
    const state = async () =>
      JSON.parse((await output.getAttribute("data-ai-areas"))!);
    const actions = async () =>
      JSON.parse((await output.getAttribute("data-ai-defense"))!).actions;
    for (let i = 0; i < 3; i++) {
      const before = (await state()).time;
      await page.locator("#second").click();
      await expect
        .poll(async () => (await state()).time)
        .toBeGreaterThan(before + 0.99);
      if (i < 2) expect(await actions()).toEqual([]);
    }
    const late = scene === "late";
    expect(
      (await actions()).map((a: any) => ({ card: a.card, tick: a.tick })),
    ).toEqual([
      { card: "lightning", tick: late ? 70 : 60 },
      ...(late ? [{ card: "freeze", tick: 74 }] : []),
    ]);
    const result = await state();
    expect(result.winner).toBeNull();
    expect(result.kings.find((e: any) => e.team === "red").hp).toBe(
      late
        ? 300
        : 300 -
            CARD_MAP[scene === "shield" ? "dark-prince" : "lumberjack"].damage,
    );
    if (!late) {
      const hand = JSON.parse((await output.getAttribute("data-ai-spells"))!);
      expect(hand.hand).toContain("freeze");
      expect(hand.elixir).toBeGreaterThan(4);
      const remaining = result.entities.filter((e: any) => e.team === "blue");
      expect(remaining).toHaveLength(scene === "shield" ? 2 : 0);
      for (const body of remaining) expect(body.hp).toBe(200);
    }
    if (scene === "early")
      await page.screenshot({
        path: info.outputPath("ai-lightning-windup.png"),
        fullPage: true,
      });
    expect(errors).toEqual([]);
  });

for (const card of ["freeze", "tornado"])
  test(`Lightning feedback: the ordinary AI timer holds ${card} to preserve its King`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      `/tests/fixtures/combat.html?scene=ai-lightning-defense-${card}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      {
        timeout: 60000,
      },
    );
    const output = page.locator("#destruction");
    const state = async () =>
      JSON.parse((await output.getAttribute("data-ai-areas"))!);
    const actions = async () =>
      JSON.parse((await output.getAttribute("data-ai-defense"))!).actions;
    for (let i = 0; i < 3; i++) {
      const before = (await state()).time;
      await page.locator("#second").click();
      await expect
        .poll(async () => (await state()).time)
        .toBeGreaterThan(before + 0.99);
      expect(await actions()).toEqual([]);
    }
    const result = await state();
    expect(result.winner).toBeNull();
    expect(result.kings.find((e: any) => e.team === "red").hp).toBe(58);
    expect(result.entities.filter((e: any) => e.team === "red")).toEqual([]);
    const hand = JSON.parse((await output.getAttribute("data-ai-spells"))!);
    expect(hand.hand).toContain(card);
    expect(hand.elixir).toBeGreaterThan(4);
    if (card === "tornado")
      await page.screenshot({
        path: info.outputPath("ai-lightning-defense-feedback.png"),
        fullPage: true,
      });
    expect(errors).toEqual([]);
  });

for (const scene of [
  "ai-health-fireball",
  "ai-health-shield",
  "ai-health-late",
])
  test(`${scene}: the AI accounts for actual incoming damage before defending`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/tests/fixtures/combat.html?scene=${scene}`);
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    const output = page.locator("#destruction");
    const state = async () =>
      JSON.parse((await output.getAttribute("data-ai-areas"))!);
    const actions = async () =>
      JSON.parse((await output.getAttribute("data-ai-defense"))!).actions;
    for (let i = 0; i < 3; i++) {
      const before = (await state()).time;
      await page.locator("#second").click();
      await expect
        .poll(async () => (await state()).time)
        .toBeGreaterThan(before + 0.99);
      if (i < 2) expect(await actions()).toEqual([]);
    }
    const defend = scene !== "ai-health-fireball";
    expect(
      (await actions()).map((a: any) => ({ card: a.card, tick: a.tick })),
    ).toEqual([
      {
        card:
          scene === "ai-health-shield"
            ? "arrows"
            : scene === "ai-health-late"
              ? "rocket"
              : "fireball",
        tick: 72,
      },
      ...(defend ? [{ card: "freeze", tick: 74 }] : []),
    ]);
    const result = await state();
    expect(result.winner).toBeNull();
    expect(result.kings.find((e: any) => e.team === "red").hp).toBe(300);
    if (!defend) {
      expect(result.entities.filter((e: any) => e.team === "blue")).toEqual([]);
      const hand = JSON.parse((await output.getAttribute("data-ai-spells"))!);
      expect(hand.hand).toContain("freeze");
      expect(hand.elixir).toBeGreaterThan(4);
      await page.screenshot({
        path: info.outputPath("ai-health-queued-damage.png"),
        fullPage: true,
      });
    }
    expect(errors).toEqual([]);
  });

for (const scene of [
  "ai-combined-freeze",
  "ai-combined-tornado",
  "ai-combined-split",
])
  test(`${scene}: the ordinary AI timer defends enough combined King damage`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/tests/fixtures/combat.html?scene=${scene}`);
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    const output = page.locator("#destruction");
    const state = async () =>
      JSON.parse((await output.getAttribute("data-ai-areas"))!);
    const actions = async () =>
      JSON.parse((await output.getAttribute("data-ai-defense"))!).actions;
    for (let i = 0; i < 2; i++) {
      const before = (await state()).time;
      await page.locator("#second").click();
      await expect
        .poll(async () => (await state()).time)
        .toBeGreaterThan(before + 0.99);
    }
    expect(await actions()).toEqual([]);
    await page.locator("#second").click();
    await expect.poll(async () => (await actions()).length).toBe(1);
    expect((await actions())[0]).toMatchObject({
      card: scene === "ai-combined-tornado" ? "tornado" : "freeze",
      tick: 74,
    });
    const before = (await state()).time;
    await page.locator("#second").click();
    await expect
      .poll(async () => (await state()).time)
      .toBeGreaterThan(before + 0.99);
    const result = await state();
    expect(result.winner).toBeNull();
    expect(result.kings.find((e: any) => e.team === "red").hp).toBe(
      scene === "ai-combined-split" ? 82 : 300,
    );
    expect(await actions()).toHaveLength(1);
    if (scene === "ai-combined-freeze")
      await page.screenshot({
        path: info.outputPath("ai-combined-king-defense.png"),
        fullPage: true,
      });
    expect(errors).toEqual([]);
  });

for (const scene of ["ai-tornado-king", "ai-tornado-race", "ai-tornado-air"])
  test(`${scene}: Tornado chooses useful damage or a timely pull on the ordinary AI timer`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/tests/fixtures/combat.html?scene=${scene}`);
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    const output = page.locator("#destruction");
    const state = async () =>
      JSON.parse((await output.getAttribute("data-ai-areas"))!);
    const actions = async () =>
      JSON.parse((await output.getAttribute("data-ai-defense"))!).actions;
    for (let i = 0; i < 2; i++) {
      const before = (await state()).time;
      await page.locator("#second").click();
      await expect
        .poll(async () => (await state()).time)
        .toBeGreaterThan(before + 0.99);
    }
    expect(await actions()).toEqual([]);
    const beforeDecision = (await state()).time;
    await page.locator("#second").click();
    await expect
      .poll(async () => (await state()).time, { timeout: 15000 })
      .toBeGreaterThan(beforeDecision + 0.99);
    expect(await actions()).toHaveLength(1);
    expect((await actions())[0]).toMatchObject({ card: "tornado", tick: 74 });
    expect((await state()).areas.some((a: any) => a.card === "tornado")).toBe(
      true,
    );
    if (scene === "ai-tornado-air") {
      for (let i = 0; i < 3; i++) {
        const before = (await state()).time;
        await page.locator("#second").click();
        await expect
          .poll(async () => (await state()).time, { timeout: 15000 })
          .toBeGreaterThan(before + 0.99);
      }
      await expect.poll(async () => (await state()).entities.length).toBe(0);
    } else {
      expect((await state()).kings.find((e: any) => e.team === "red").hp).toBe(
        100,
      );
      expect((await state()).winner).toBeNull();
      const attacker = (await state()).entities.find(
        (e: any) => e.card === "lumberjack",
      );
      expect(attacker.y).toBeGreaterThan(4.8);
      if (scene === "ai-tornado-king")
        await page.screenshot({
          path: info.outputPath("ai-tornado-defense.png"),
          fullPage: true,
        });
      const before = (await state()).time;
      await page.locator("#second").click();
      await expect
        .poll(async () => (await state()).time, { timeout: 15000 })
        .toBeGreaterThan(before + 0.99);
      expect((await state()).kings.find((e: any) => e.team === "red").hp).toBe(
        100,
      );
      expect((await state()).winner).toBeNull();
    }
    expect(await actions()).toHaveLength(1);
    expect(errors).toEqual([]);
  });

for (const card of ["rage", "freeze", "poison"] as const)
  test(`the AI uses ${card} for its intended role and avoids refreshing a covered group`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/tests/fixtures/combat.html?scene=ai-${card}`);
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    const output = page.locator("#destruction");
    const state = async () =>
      JSON.parse((await output.getAttribute("data-ai-areas"))!);
    const time = async () =>
      JSON.parse((await output.getAttribute("data-state"))!).time;
    await expect.poll(async () => (await state()).scene).toBe(`ai-${card}`);
    const step = async () => {
      const before = await time();
      await page.locator("#second").click();
      await expect.poll(time).toBeGreaterThan(before + 0.99);
    };
    await step();
    await step();
    expect((await state()).actions).toEqual([]);
    await step();
    expect((await state()).actions).toHaveLength(1);
    expect((await state()).actions[0].card).toBe(card);
    expect(
      (await state()).areas.some(
        (a: any) => a.card === card && a.team === "red",
      ),
    ).toBe(true);
    const affected = (await state()).entities.filter(
      (e: any) => e.team === (card === "rage" ? "red" : "blue"),
    );
    expect(
      affected.some((e: any) => (card === "freeze" ? e.stun > 0 : !!e[card])),
    ).toBe(true);
    const frozen = await state();
    await page.waitForTimeout(160);
    expect(await state()).toEqual(frozen);
    await step();
    await step();
    await step();
    expect((await state()).actions).toHaveLength(1);
    expect(
      (await state()).areas.filter((a: any) => a.card === card),
    ).toHaveLength(1);
    expect(errors).toEqual([]);
  });

for (const scene of ["ai-freeze-king", "ai-freeze-race", "ai-freeze-ranged"])
  test(`${scene}: AI Freeze interrupts a fatal King windup before a losing spell choice`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/tests/fixtures/combat.html?scene=${scene}`);
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    const output = page.locator("#destruction");
    const state = async () =>
      JSON.parse((await output.getAttribute("data-ai-areas"))!);
    const time = async () =>
      JSON.parse((await output.getAttribute("data-state"))!).time;
    const step = async () => {
      const before = await time();
      await page.locator("#second").click();
      await expect.poll(time).toBeGreaterThan(before + 0.99);
    };
    await step();
    await step();
    expect((await state()).actions).toEqual([]);
    await step();
    const defended = await state();
    const attacker = scene === "ai-freeze-ranged" ? "musketeer" : "lumberjack";
    expect(defended.actions).toHaveLength(1);
    expect(defended.actions[0]).toMatchObject({ card: "freeze", team: "red" });
    expect(defended.kings.find((e: any) => e.team === "red").hp).toBe(100);
    expect(
      defended.entities.find((e: any) => e.card === attacker).stun,
    ).toBeGreaterThan(0);
    expect(defended.entities.some((e: any) => e.clone)).toBe(false);
    await page.screenshot({
      path: info.outputPath(`${scene}.png`),
      fullPage: true,
    });
    await step();
    await step();
    await step();
    const survived = await state();
    expect(survived.winner).toBeNull();
    expect(survived.kings.find((e: any) => e.team === "red").hp).toBe(100);
    expect(
      survived.entities.some((e: any) => e.card === attacker && e.hp > 0),
    ).toBe(false);
    expect(survived.actions).toEqual(defended.actions);
    await page.waitForTimeout(160);
    expect(await state()).toEqual(survived);
    expect(errors).toEqual([]);
  });

test("AI takes an earlier winning Zap before the ranged attack can arrive", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/combat.html?scene=ai-freeze-ranged-fast");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const output = page.locator("#destruction");
  const state = async () =>
    JSON.parse((await output.getAttribute("data-ai-areas"))!);
  const spells = async () =>
    JSON.parse((await output.getAttribute("data-ai-spells"))!);
  const time = async () =>
    JSON.parse((await output.getAttribute("data-state"))!).time;
  for (let second = 0; second < 2; second++) {
    const before = await time();
    await page.locator("#second").click();
    await expect.poll(time).toBeGreaterThan(before + 0.99);
  }
  expect((await spells()).actions).toEqual([]);
  await page.locator("#second").click();
  await expect.poll(async () => (await state()).winner).toBe("red");
  expect((await spells()).actions).toEqual([
    expect.objectContaining({ card: "zap", team: "red" }),
  ]);
  const won = await state();
  expect(won.actions).toEqual([]);
  expect(won.kings.find((e: any) => e.team === "red").hp).toBe(100);
  expect(won.kings.find((e: any) => e.team === "blue")?.hp ?? 0).toBe(0);
  await page.screenshot({
    path: info.outputPath("ai-freeze-ranged-fast.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("AI freezes an active charged Inferno lock before a late winning Rocket", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/combat.html?scene=ai-inferno-king");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const output = page.locator("#destruction");
  const state = async () =>
    JSON.parse((await output.getAttribute("data-ai-areas"))!);
  const actions = async () =>
    JSON.parse((await output.getAttribute("data-ai-defense"))!).actions;
  const step = async () => {
    const before = (await state()).time;
    await page.locator("#second").click();
    await expect
      .poll(async () => (await state()).time)
      .toBeGreaterThan(before + 0.99);
  };
  await step();
  await step();
  expect(await actions()).toEqual([]);
  await step();
  expect(await actions()).toMatchObject([
    { card: "freeze", team: "red", tick: 74 },
  ]);
  expect(await actions()).toHaveLength(1);
  const defended = await state();
  expect(defended.kings.find((e: any) => e.team === "red").hp).toBe(671);
  expect(
    defended.entities.find((e: any) => e.card === "inferno-dragon").stun,
  ).toBeGreaterThan(0);
  await step();
  const survived = await state();
  expect(survived.winner).toBeNull();
  expect(survived.kings.find((e: any) => e.team === "red").hp).toBe(671);
  expect(await actions()).toHaveLength(1);
  await page.screenshot({
    path: info.outputPath("ai-inferno-king-defense.png"),
    fullPage: true,
  });
  await page.waitForTimeout(160);
  expect(await state()).toEqual(survived);
  expect(errors).toEqual([]);
});
