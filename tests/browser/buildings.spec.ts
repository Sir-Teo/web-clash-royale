import { expectedBuildings } from "./native-assets";
import { test, expect } from "@playwright/test";

test("native defensive buildings emerge, attack and retract in the arena", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("burrow");
  await expect(page.locator("#status")).toContainText(`${expectedBuildings} buildings loaded`, {
    timeout: 30000,
  });
  await expect(page.locator("#buildings")).toHaveText(
    "blue: hidden 0% · red: hidden 0%",
  );
  const step = page.getByRole("button", { name: "Step 0.1s", exact: true });
  const attackers = page.getByRole("button", {
    name: "Toggle attackers",
    exact: true,
  });
  await attackers.click();
  for (let i = 0; i < 4; i++) await step.click();
  await expect(page.locator("#buildings")).toHaveText(
    "blue: rising 50% · red: rising 50%",
  );
  for (let i = 0; i < 12; i++) await step.click();
  await expect(page.locator("#buildings")).toHaveText(
    "blue: exposed 100% · red: exposed 100%",
  );
  await page.screenshot({
    path: `test-results/${info.project.name}-buildings.png`,
    fullPage: true,
  });
  await attackers.click();
  for (let i = 0; i < 12; i++) await step.click();
  await expect(page.locator("#buildings")).toContainText("sinking");
  for (let i = 0; i < 5; i++) await step.click();
  await expect(page.locator("#buildings")).toHaveText(
    "blue: hidden 0% · red: hidden 0%",
  );
  expect(errors).toEqual([]);
});

test("Kings wake before firing and also activate after a Princess Tower falls", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("king");
  await expect(page.locator("#status")).toContainText(`${expectedBuildings} buildings loaded`, {
    timeout: 30000,
  });
  await expect(page.locator("#kings")).toHaveText("red: asleep · blue: asleep");
  await page.getByRole("button", { name: "Zap Kings", exact: true }).click();
  const second = page.getByRole("button", { name: "Step 1s", exact: true });
  await second.click();
  await expect(page.locator("#kings")).toContainText("waking");
  await expect(page.locator("#king-hits")).toHaveText("0 tower hits");
  await page.screenshot({
    path: `test-results/${info.project.name}-king-wake.png`,
    fullPage: true,
  });
  for (let i = 0; i < 2; i++) await second.click();
  await expect(page.locator("#kings")).toContainText("waking");
  await expect(page.locator("#king-hits")).toHaveText("0 tower hits");
  for (let i = 0; i < 2; i++) await second.click();
  await expect(page.locator("#kings")).toHaveText("red: active · blue: active");
  await expect(page.locator("#king-hits")).toHaveText(/[1-9]\d* tower hits/);
  await page.screenshot({
    path: `test-results/${info.project.name}-king-active.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page
    .getByRole("button", { name: "Destroy Princess Towers", exact: true })
    .click();
  await second.click();
  await expect(page.locator("#kings")).toContainText("waking");
  expect(errors).toEqual([]);
});
