import { test, expect } from "@playwright/test";

test("a paused Fireball does not keep emitting trail particles", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/combat.html");
  await expect(page.locator("#status")).toContainText("31 effects", {
    timeout: 30000,
  });
  await page.getByRole("button", { name: "Step 0.1s", exact: true }).click();
  await expect(page.locator("#status")).toContainText("0.1s");
  const particles = await page.locator("#particles").textContent();
  await page.waitForTimeout(500);
  await expect(page.locator("#particles")).toHaveText(particles!);
  await expect(page.locator("#status")).toContainText("0.1s");
});

test("tower debris pauses, settles after victory, and rubble survives renderer rebuilds", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("king");
  await expect(page.locator("#status")).toContainText("31 effects", {
    timeout: 30000,
  });
  await expect(page.locator("#status")).toContainText("3 buildings loaded");
  await page.locator("#princess").click();
  const step = page.locator("#step"),
    second = page.locator("#second");
  for (let i = 0; i < 4; i++) await step.click();
  await expect(page.locator("#status")).toContainText("0.4s");
  await expect(page.locator("#destruction")).toContainText("2 ruins");
  await expect(page.locator("#destruction")).toHaveText(
    /2 ruins · [1-9]\d* debris/,
  );
  const paused = await page.locator("#destruction").textContent();
  await page.waitForTimeout(400);
  await expect(page.locator("#destruction")).toHaveText(paused!);
  for (let i = 0; i < 3; i++) await step.click();
  await page.screenshot({
    path: `test-results/${info.project.name}-tower-debris.png`,
    fullPage: true,
  });
  for (let i = 0; i < 4; i++) await second.click();
  await expect(page.locator("#destruction")).toHaveText(/2 ruins · 0 debris/);
  await page.locator("#rebuild").click();
  await expect(page.locator("#destruction")).toHaveText(
    "2 ruins · 0 debris · 0.0s visual",
  );
  await page.locator("#destroy-king").click();
  for (let i = 0; i < 3; i++) await step.click();
  await expect(page.locator("#destruction")).toHaveText(
    /3 ruins · [1-9]\d* debris/,
  );
  const endTime = (await page.locator("#status").textContent())!.split(
    " · ",
  )[0];
  for (let i = 0; i < 4; i++) await second.click();
  await expect(page.locator("#status")).toContainText(endTime);
  await expect(page.locator("#destruction")).toHaveText(/3 ruins · 0 debris/);
  await page.screenshot({
    path: `test-results/${info.project.name}-tower-ruins.png`,
    fullPage: true,
  });
  await page.locator("#reset").click();
  await expect(page.locator("#destruction")).toHaveText(/0 ruins · 0 debris/);
  expect(errors).toEqual([]);
});
