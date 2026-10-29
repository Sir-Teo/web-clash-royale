import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";
import { CARD_MAP } from "../../src/game/cards";

for (const scene of ["ai-spells", "ai-spells-mirror"])
  test(`${scene}: the ordinary AI timer casts a cheaper tower finisher and waits for its in-flight damage`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/tests/fixtures/combat.html?scene=${scene}`);
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    const output = page.locator("#destruction");
    const state = async () =>
      JSON.parse((await output.getAttribute("data-ai-spells"))!);
    const time = async () =>
      JSON.parse((await output.getAttribute("data-ai-areas"))!).time;
    const step = async () => {
      const before = await time();
      await page.locator("#second").click();
      await expect.poll(time).toBeGreaterThan(before + 0.99);
    };
    await expect
      .poll(async () => (await state()).towers.some((t: any) => t.hp === 100))
      .toBe(true);
    const target = (await state()).towers.find((t: any) => t.hp === 100);
    expect(target).toBeDefined();
    await step();
    await step();
    expect((await state()).actions).toEqual([]);
    await step();
    const cast = (await state()).actions;
    expect(cast).toHaveLength(1);
    expect(cast[0]).toMatchObject({
      card: "fireball",
      x: target.x,
      y: target.y,
    });
    if (scene === "ai-spells-mirror") {
      expect((await state()).hand).toContain("mirror");
      expect((await state()).elixir).toBeGreaterThan(2);
      expect((await state()).elixir).toBeLessThan(3);
    }
    await step();
    expect((await state()).actions).toHaveLength(1);
    await page.waitForTimeout(180);
    expect((await state()).actions).toEqual(cast);
    await step();
    await step();
    expect(
      (await state()).towers.find((t: any) => t.id === target.id)?.hp ?? 0,
    ).toBeLessThanOrEqual(0);
    expect((await state()).crowns).toBe(1);
    expect((await state()).actions).toHaveLength(1);
    expect(errors).toEqual([]);
  });

test("the ordinary timer holds Zap for an earlier queued overtime win", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/combat.html?scene=ai-overtime-reserved");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const output = page.locator("#destruction");
  const state = async () =>
    JSON.parse((await output.getAttribute("data-ai-areas"))!);
  const spells = async () =>
    JSON.parse((await output.getAttribute("data-ai-spells"))!);
  const original = (await spells()).actions;
  expect(original).toHaveLength(1);
  expect(original[0].card).toBe("rocket");
  for (let i = 0; i < 3; i++) await page.locator("#second").click();
  await expect.poll(async () => (await state()).winner).toBe("red");
  expect((await spells()).actions).toEqual(original);
  expect((await spells()).hand).toContain("zap");
  expect((await state()).reason).toBe("Sudden death");
  expect((await state()).time).toBeCloseTo(202.6);
  expect(errors).toEqual([]);
});

for (const card of ["poison", "zap"] as const)
  test(`the AI wins the launched-shot race with ${card} on its ordinary timer`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/tests/fixtures/combat.html?scene=ai-launched-${card}`);
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    const output = page.locator("#destruction");
    const actions = async () =>
      JSON.parse((await output.getAttribute("data-ai-defense"))!).actions;
    const state = async () =>
      JSON.parse((await output.getAttribute("data-ai-areas"))!);
    const time = async () =>
      JSON.parse((await output.getAttribute("data-ai-areas"))!).time;
    const original = await actions();
    for (let i = 0; i < 2; i++) {
      const before = await time();
      await page.locator("#second").click();
      await expect.poll(time).toBeGreaterThan(before + 0.99);
    }
    expect(await actions()).toEqual(original);
    await page.locator("#second").click();
    await expect
      .poll(async () => (await actions()).length)
      .toBe(original.length + 1);
    expect((await actions()).at(-1)).toMatchObject({ card, team: "red" });
    if (card === "poison") await page.locator("#second").click();
    await expect.poll(async () => (await state()).winner).toBe("red");
    const won = await state();
    expect(won.kings.find((e: any) => e.team === "red").hp).toBe(100);
    expect(won.kings.find((e: any) => e.team === "blue")?.hp ?? 0).toBe(0);
    await page.screenshot({
      path: info.outputPath(`ai-launched-${card}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });

for (const scene of ["ai-overtime", "ai-tiebreaker"])
  test(`${scene}: the ordinary timer chooses Zap to win the match`, async ({
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
    const spells = async () =>
      JSON.parse((await output.getAttribute("data-ai-spells"))!);
    const time = async () =>
      JSON.parse((await output.getAttribute("data-ai-areas"))!).time;
    const princess = (await spells()).towers.find(
      (e: any) => e.hp === (scene === "ai-overtime" ? 50 : 100),
    );
    expect(princess).toBeDefined();
    for (let i = 0; i < 2; i++) {
      const before = await time();
      await page.locator("#second").click();
      await expect.poll(time).toBeGreaterThan(before + 0.99);
    }
    expect((await spells()).actions).toEqual([]);
    await page.locator("#second").click();
    await expect.poll(async () => (await state()).winner).toBe("red");
    expect((await spells()).actions).toHaveLength(1);
    const cast = (await spells()).actions[0];
    expect(cast.card).toBe("zap");
    expect(Math.hypot(cast.x - princess.x, cast.y - princess.y)).toBeLessThan(
      CARD_MAP.zap.radius! + princess.radius,
    );
    expect((await state()).kings.find((e: any) => e.team === "red").hp).toBe(
      scene === "ai-overtime" ? 100 : 80,
    );
    expect(
      (await spells()).towers.find((e: any) => e.id === princess.id)?.hp ?? 0,
    ).toBe(scene === "ai-overtime" ? 0 : 100 - Math.ceil(CARD_MAP.zap.damage * 0.4));
    if (scene === "ai-overtime") {
      expect((await state()).time).toBeGreaterThan(202.5);
      expect((await state()).time).toBeLessThan(203);
      expect((await state()).reason).toBe("Sudden death");
    } else {
      expect((await state()).time).toBe(300);
      expect((await state()).reason).toBe("Tiebreaker");
    }
    await page.screenshot({
      path: info.outputPath(`${scene}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });

for (const scene of ["ai-regulation", "ai-regulation-tie"])
  test(`${scene}: AI uses the regulation clock to choose its finisher`, async ({
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
    const spells = async () =>
      JSON.parse((await output.getAttribute("data-ai-spells"))!);
    for (let i = 0; i < 2; i++) {
      const before = (await state()).time;
      await page.locator("#second").click();
      await expect
        .poll(async () => (await state()).time)
        .toBeGreaterThan(before + 0.99);
    }
    expect((await spells()).actions).toEqual([]);
    await page.locator("#second").click();
    await expect.poll(async () => (await spells()).actions.length).toBe(1);
    expect((await spells()).actions[0].card).toBe("zap");
    expect((await state()).winner).toBeNull();
    expect((await state()).crowns.red).toBe(1);
    await page.locator("#second").click();
    await expect.poll(async () => (await state()).phase).toBe("overtime");
    const end = await state();
    if (scene === "ai-regulation") {
      expect(end.winner).toBe("red");
      expect(end.reason).toBe("More crowns");
      expect(end.time).toBe(180);
      expect(end.crowns).toEqual({ blue: 0, red: 1 });
    } else {
      expect(end.winner).toBeNull();
      expect(end.time).toBe(180.5);
      expect(end.crowns).toEqual({ blue: 1, red: 1 });
    }
    expect((await spells()).actions).toHaveLength(1);
    expect(end.kings.find((e: any) => e.team === "red").hp).toBe(100);
    await page.screenshot({
      path: info.outputPath(`${scene}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });

for (const scene of ["ai-lightning", "ai-lightning-king"])
  test(`${scene}: AI Lightning chooses its three-pulse role on the ordinary timer`, async ({
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
    const impacts = async () =>
      JSON.parse((await output.getAttribute("data-attack-impacts"))!)
        .lightning ?? 0;
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
    expect((await actions())[0].card).toBe("lightning");
    await expect.poll(impacts).toBe(1);
    await page.screenshot({
      path: info.outputPath(`${scene}.png`),
      fullPage: true,
    });
    if (scene === "ai-lightning") {
      await page.locator("#second").click();
      await expect.poll(impacts).toBe(3);
      expect((await state()).entities).toEqual([]);
      expect((await state()).winner).toBeNull();
    } else {
      expect((await state()).winner).toBe("red");
      expect((await state()).reason).toBe("King Tower destroyed");
      expect((await state()).kings.find((e: any) => e.team === "red").hp).toBe(
        100,
      );
      expect((await state()).crowns.red).toBe(3);
      const spells = JSON.parse((await output.getAttribute("data-ai-spells"))!);
      expect(spells.hand).toContain("mirror");
    }
    expect(await actions()).toHaveLength(1);
    expect(errors).toEqual([]);
  });

test("AI holds its newly drawn Fireball while Lightning finishes the tower", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/combat.html?scene=ai-lightning-followup");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const output = page.locator("#destruction");
  const state = async () =>
    JSON.parse((await output.getAttribute("data-ai-areas"))!);
  const actions = async () =>
    JSON.parse((await output.getAttribute("data-ai-defense"))!).actions;
  const spells = async () =>
    JSON.parse((await output.getAttribute("data-ai-spells"))!);
  const target = (await spells()).towers.find((e: any) => e.hp === 100);
  expect(target).toBeDefined();
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
  expect((await actions())[0].card).toBe("lightning");
  for (let i = 0; i < 2; i++) await page.locator("#second").click();
  await expect.poll(async () => (await state()).time).toBe(5);
  expect(await actions()).toHaveLength(1);
  expect((await spells()).hand).toContain("fireball");
  expect((await spells()).elixir).toBeGreaterThan(4);
  expect((await spells()).crowns).toBe(1);
  expect(
    (await spells()).towers.find((e: any) => e.id === target.id)?.hp ?? 0,
  ).toBe(0);
  expect((await state()).entities).toEqual([]);
  await page.screenshot({
    path: info.outputPath("ai-lightning-followup.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("AI Lightning predicts the health order after a Fireball clears its blockers", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/combat.html?scene=ai-lightning-health");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const output = page.locator("#destruction");
  const state = async () =>
    JSON.parse((await output.getAttribute("data-ai-areas"))!);
  const actions = async () =>
    JSON.parse((await output.getAttribute("data-ai-defense"))!).actions;
  const original = await actions();
  expect(original).toHaveLength(1);
  expect(original[0].card).toBe("fireball");
  expect((await state()).entities).toHaveLength(3);
  for (let i = 0; i < 2; i++) {
    const before = (await state()).time;
    await page.locator("#second").click();
    await expect
      .poll(async () => (await state()).time)
      .toBeGreaterThan(before + 0.99);
  }
  expect(await actions()).toEqual(original);
  await page.locator("#second").click();
  await expect.poll(async () => (await state()).winner).toBe("red");
  expect((await actions()).map((a: any) => a.card)).toEqual([
    "fireball",
    "lightning",
  ]);
  expect((await state()).reason).toBe("King Tower destroyed");
  expect((await state()).crowns.red).toBe(3);
  expect((await state()).entities).toEqual([]);
  expect(
    (await state()).kings.find((e: any) => e.team === "blue")?.hp ?? 0,
  ).toBe(0);
  expect((await state()).time).toBeLessThan(3);
  await page.screenshot({
    path: info.outputPath("ai-lightning-health.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("AI uses a nonlethal Zap to turn Lightning's last pulse into a King win", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/combat.html?scene=ai-lightning-combo");
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
  expect((await actions())[0].card).toBe("lightning");
  expect((await state()).kings.find((e: any) => e.team === "blue").hp).toBe(80);
  await page.locator("#second").click();
  await expect.poll(async () => (await state()).winner).toBe("red");
  expect((await actions()).map((a: any) => a.card)).toEqual([
    "lightning",
    "zap",
  ]);
  expect((await state()).time).toBe(3.9);
  expect((await state()).reason).toBe("King Tower destroyed");
  expect((await state()).crowns.red).toBe(3);
  expect((await state()).entities).toEqual([]);
  await page.screenshot({
    path: info.outputPath("ai-lightning-combo.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

for (const scene of ["ai-log-ground", "ai-log-air", "ai-log-king"])
  test(`${scene}: AI Log follows its ground corridor on the ordinary timer`, async ({
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
    if (scene === "ai-log-air") {
      await page.locator("#second").click();
      expect(await actions()).toEqual([]);
      expect((await state()).entities).toHaveLength(3);
      expect(
        (await state()).entities.every(
          (e: any) => e.card === "minions" && e.hp === e.maxHp,
        ),
      ).toBe(true);
    } else {
      await expect.poll(async () => (await actions()).length).toBe(1);
      expect((await actions())[0]).toMatchObject({ card: "log", tick: 74 });
      expect((await actions())[0].y).toBeLessThanOrEqual(14.5);
      if (scene === "ai-log-ground") {
        await expect.poll(async () => (await state()).entities.length).toBe(0);
        expect((await actions())[0].y).toBeLessThan(10);
        await page.locator("#step").click();
        await page.screenshot({
          path: info.outputPath("ai-log-corridor.png"),
          fullPage: true,
        });
      } else {
        for (let i = 0; i < 4 && !(await state()).winner; i++)
          await page.locator("#second").click();
        await expect.poll(async () => (await state()).winner).toBe("red");
        expect((await state()).reason).toBe("King Tower destroyed");
        expect((await state()).crowns.red).toBe(3);
        const spells = JSON.parse(
          (await output.getAttribute("data-ai-spells"))!,
        );
        expect(spells.hand).toContain("mirror");
        expect(await actions()).toHaveLength(1);
      }
    }
    expect(errors).toEqual([]);
  });
