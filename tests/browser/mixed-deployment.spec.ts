import { test, expect } from "@playwright/test";
import native from "../fixtures/native-mixed-deployment-golden.json" with { type: "json" };
import { expectedEffects } from "./native-assets";

test("mixed Goblin deployment artwork keeps native per-body timing while combat readiness stays at one second", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/combat.html?scene=deployment");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  await page.locator("#death-card").selectOption("goblin-gang");
  await page.locator("#spawn").click();
  const units = async () =>
    JSON.parse(
      (await page
        .locator("#destruction")
        .getAttribute("data-deployment-timing"))!,
    ) as {
      id: number;
      team: string;
      card: string;
      age: number;
      deploy: number;
      delay: number;
      native: boolean;
    }[];
  const filters = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-deploy-filter"))!,
    ) as { id: number; frame: number; applied: boolean }[];
  await expect
    .poll(async () => (await units()).length, { timeout: 30000 })
    .toBe(12);
  await expect
    .poll(async () => (await units()).every((u) => u.native))
    .toBe(true);
  const captured = native.cases[0].points;
  for (const team of ["blue", "red"]) {
    const group = (await units()).filter((u) => u.team === team);
    expect(group.map((u) => u.delay)).toEqual(
      captured.map((p) => p.visualDelayMs / 1000),
    );
    expect(group.map((u) => u.card)).toEqual(
      captured.map((p) =>
        p.character === "Goblin" ? "goblins" : "spear-goblins",
      ),
    );
    expect(group.every((u) => u.deploy === 1 && u.age === 0)).toBe(true);
  }
  await page.locator("#step").click();
  await expect
    .poll(async () =>
      (await units()).every((u) => Math.abs(u.age - 0.1) < 1e-8),
    )
    .toBe(true);
  await expect.poll(async () => (await filters()).length).toBe(12);
  const poses = await filters();
  for (const team of ["blue", "red"]) {
    const group = (await units()).filter((u) => u.team === team);
    expect(group.map((u) => poses.find((p) => p.id === u.id)!.frame)).toEqual([
      0, 0, 0, 0, 0, 4,
    ]);
    expect(group.every((u) => u.deploy > 0.89 && u.deploy < 0.91)).toBe(true);
  }
  expect(poses.every((p) => p.applied)).toBe(true);
  const held = await units();
  await page.waitForTimeout(350);
  expect(await units()).toEqual(held);
  expect(await filters()).toEqual(poses);
  await page.locator("#arena").screenshot({
    path: info.outputPath("goblin-gang-angular-deployment.png"),
  });
  await page.locator("#second").click();
  await expect
    .poll(async () =>
      (await units()).every((u) => u.age > 1.09 && u.deploy <= 0),
    )
    .toBe(true);
  await expect.poll(async () => (await filters()).length).toBe(0);
  expect((await units()).every((u) => u.native)).toBe(true);
  expect(errors).toEqual([]);
});
