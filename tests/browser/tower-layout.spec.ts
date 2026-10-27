import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Crown positions, native models and persistent ruins follow the replay layout", async ({
  page,
}, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = async () => {
    const value = JSON.parse(
      (await page.locator("#destruction").getAttribute("data-tower-layout"))!,
    );
    value.ruins.sort((a: { key: string }, b: { key: string }) =>
      a.key.localeCompare(b.key),
    );
    return value;
  };
  const traces = [];
  for (const version of [30, 31]) {
    await page.goto(
      `/tests/fixtures/combat.html?scene=tower-layout&rules=${version}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    await expect
      .poll(
        async () => {
          const current = await state();
          return (
            current.crowns.length === 6 &&
            current.crowns.every((body: any) => body.native)
          );
        },
        { timeout: 30000 },
      )
      .toBe(true);
    const initial = await state();
    expect(initial.version).toBe(version);
    expect(initial.policy).toBe(version === 31);
    expect(initial.crowns.map((body: any) => body.id)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(initial.ruins).toEqual([]);
    for (const crown of initial.crowns) {
      const source = version === 31;
      const left = source ? 3.5 : 4;
      const top = crown.king ? (source ? 3 : 2.5) : source ? 6.5 : 6;
      const x = crown.king ? 9 : crown.lane === "left" ? left : 18 - left;
      const y = crown.team === "red" ? top : 32 - top;
      expect({ x: crown.x, y: crown.y }).toEqual({ x, y });
      expect(crown.worldX).toBe(x - 9);
      expect(crown.worldZ).toBe(y - 16);
    }
    await page.locator("main").screenshot({
      path: info.outputPath(`crown-layout-rules-${version}.png`),
    });
    await page.locator("#princess").click();
    for (let i = 0; i < 4; i++) await page.locator("#step").click();
    await expect.poll(async () => (await state()).ruins.length).toBe(2);
    const destroyed = await state();
    for (const ruin of destroyed.ruins) {
      const crown = initial.crowns.find(
        (body: any) => `${body.team}-${body.x}` === ruin.key,
      );
      expect(crown.king).toBe(false);
      expect(crown.lane).toBe("left");
      expect({ x: ruin.x, y: ruin.y }).toEqual({ x: crown.x, y: crown.y });
      expect(destroyed.deaths).toContainEqual({
        team: crown.team,
        x: crown.x,
        y: crown.y,
      });
    }
    await page.locator("#rebuild").click();
    await expect
      .poll(
        async () => (await state()).crowns.every((body: any) => body.native),
        { timeout: 30000 },
      )
      .toBe(true);
    expect((await state()).ruins).toEqual(destroyed.ruins);
    await page.locator("#destroy-king").click();
    for (let i = 0; i < 4; i++) await page.locator("#step").click();
    await expect.poll(async () => (await state()).ruins.length).toBe(4);
    const won = await state();
    expect(won.ruins).toContainEqual({
      key: "red-9",
      x: 9,
      y: version === 31 ? 3 : 2.5,
    });
    await page.locator("main").screenshot({
      path: info.outputPath(`crown-ruins-rules-${version}.png`),
    });
    await page.locator("#rebuild").click();
    await expect.poll(async () => (await state()).ruins).toEqual(won.ruins);
    const guests = [];
    for (const incoming of [version === 31 ? 30 : 31, version]) {
      await page.locator("#guest-ruins").click();
      await expect.poll(async () => (await state()).ruins.length).toBe(6);
      await expect
        .poll(async () => (await state()).policy)
        .toBe(incoming === 31);
      const guest = await state();
      guests.push(guest);
      expect(guest.crowns).toEqual([]);
      expect(guest.ruins).toContainEqual({
        key: "red-9",
        x: 9,
        y: incoming === 31 ? 3 : 2.5,
      });
      expect(guest.ruins).toContainEqual({
        key: "blue-9",
        x: 9,
        y: incoming === 31 ? 29 : 29.5,
      });
      const left = incoming === 31 ? 3.5 : 4;
      expect(guest.ruins).toContainEqual({
        key: `red-${left}`,
        x: left,
        y: incoming === 31 ? 6.5 : 6,
      });
    }
    traces.push({ version, initial, destroyed, won, guests });
  }
  await info.attach("crown-layout-traces", {
    body: JSON.stringify(traces, null, 2),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});
