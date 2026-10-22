import { test, expect } from "@playwright/test";

test("native crowns fly to scores, pause, resize and finish after a King win", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("king");
  await expect(page.locator("#status")).toContainText("45 effects", {
    timeout: 30000,
  });
  const step = page.locator("#step"),
    second = page.locator("#second");
  await page.locator("#princess").click();
  for (let i = 0; i < 5; i++) await step.click();
  await expect(page.locator("#crown-flights")).toHaveText("2 flying crowns");
  await expect(page.locator("#crown-blue")).toHaveText("♛ 1");
  await expect(page.locator("#crown-red")).toHaveText("♛ 1");
  await expect(page.locator("#status")).toContainText("0.5s");
  const poses = await page.locator("#crown-flights").getAttribute("data-poses");
  expect(JSON.parse(poses!).every((c: { visible: boolean }) => c.visible)).toBe(
    true,
  );
  await page.waitForTimeout(400);
  await expect(page.locator("#crown-flights")).toHaveAttribute(
    "data-poses",
    poses!,
  );
  await page.screenshot({
    path: `test-results/${info.project.name}-native-crowns.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator("#crown-flights")).not.toHaveAttribute(
    "data-poses",
    poses!,
  );
  await expect
    .poll(async () => {
      const data = JSON.parse(
        (await page.locator("#crown-flights").getAttribute("data-poses"))!,
      );
      const bounds = (await page.locator("#arena canvas").boundingBox())!;
      return data.every(
        (c: { x: number; y: number }) =>
          c.x > 0 && c.x < bounds.width && c.y > 0 && c.y < bounds.height,
      );
    })
    .toBe(true);
  const resized = JSON.parse(
    (await page.locator("#crown-flights").getAttribute("data-poses"))!,
  );
  const box = (await page.locator("#arena canvas").boundingBox())!;
  for (const c of resized) {
    expect(c.x).toBeGreaterThan(0);
    expect(c.x).toBeLessThan(box.width);
    expect(c.y).toBeGreaterThan(0);
    expect(c.y).toBeLessThan(box.height);
  }
  await second.click();
  await expect(page.locator("#crown-flights")).toHaveText("0 flying crowns");
  await page.locator("#destroy-king").click();
  for (let i = 0; i < 5; i++) await step.click();
  await expect(page.locator("#destruction")).toContainText("2.0s visual");
  await expect(page.locator("#crown-blue")).toHaveText("♛ 3");
  await expect(page.locator("#crown-flights")).toHaveText("2 flying crowns");
  const endTime = (await page.locator("#status").textContent())!.split(
    " · ",
  )[0];
  await second.click();
  await expect(page.locator("#status")).toContainText(endTime);
  await expect(page.locator("#crown-flights")).toHaveText("0 flying crowns");
  await page.locator("#reset").click();
  await page.locator("#destroy-king").click();
  for (let i = 0; i < 5; i++) await step.click();
  await expect(page.locator("#destruction")).toContainText("0.5s visual");
  await expect(page.locator("#crown-flights")).toHaveText("3 flying crowns");
  await page.locator("#rebuild").click();
  await expect(page.locator("#crown-flights")).toHaveText("0 flying crowns");
  expect(errors).toEqual([]);
});

test("native swarm deaths retain all particles with bounded draw calls and pause cleanly", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("death");
  await expect(page.locator("#status")).toContainText("45 effects", {
    timeout: 30000,
  });
  await page.locator("#defeat").click();
  for (let i = 0; i < 3; i++) await page.locator("#step").click();
  await expect(page.locator("#status")).toContainText("0.3s");
  await expect(page.locator("#death-stats")).toContainText(
    "60 deaths · 960 native particles · 420 ground",
  );
  await expect
    .poll(async () =>
      Number(
        (await page.locator("#death-stats").textContent())!.match(
          /(\d+) draws/,
        )![1],
      ),
    )
    .toBeGreaterThan(0);
  const text = (await page.locator("#death-stats").textContent())!;
  expect(Number(text.match(/(\d+) draws/)![1])).toBeLessThan(40);
  await page.waitForTimeout(400);
  await expect(page.locator("#death-stats")).toHaveText(text);
  await page.screenshot({
    path: `test-results/${info.project.name}-native-swarm-deaths.png`,
    fullPage: true,
  });
  for (let i = 0; i < 5; i++) await page.locator("#second").click();
  await expect(page.locator("#death-stats")).toHaveText(
    "60 deaths · 0 native particles · 0 ground · 0 draws",
  );
  await page.locator("#death-card").selectOption("knight");
  await page.locator("#defeat").click();
  for (let i = 0; i < 5; i++) await page.locator("#second").click();
  await expect(page.locator("#death-stats")).toHaveText(
    "2 deaths · 2 native particles · 0 ground · 1 draws",
  );
  await page.locator("#reset").click();
  await expect(page.locator("#death-stats")).toHaveText(
    "0 deaths · 0 native particles · 0 ground · 0 draws",
  );
  expect(errors).toEqual([]);
});

test("a paused Fireball does not keep emitting trail particles", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/combat.html");
  await expect(page.locator("#status")).toContainText("45 effects", {
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
  await expect(page.locator("#status")).toContainText("45 effects", {
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
