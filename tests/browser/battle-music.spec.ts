import { test, expect } from "@playwright/test";
import { STARTER_DECK } from "../../src/game/cards";

test("native battle music follows live replay phases on desktop and phone", async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const replay = {
    version: 5, seed: 71, mode: "classic",
    deck: STARTER_DECK, enemyDeck: STARTER_DECK,
    actions: [], duration: 6300,
  };
  await page.addInitScript((replay) => {
    localStorage.setItem("browser-royale.profile.v1", JSON.stringify({
      version: 1, sound: true, music: true, seenTutorial: true,
      history: [{ id: 1, date: "2026-10-23T12:00:00Z", mode: "classic",
        winner: "red", crowns: [0, 0], replay }],
    }));
  }, replay);
  await page.goto("/");
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator('[data-replay="0"]').click();
  const music = () => page.evaluate(() => (window as any).__arena?.state.music);
  const seek = page.getByRole("slider", { name: "Replay timeline" });
  await expect.poll(async () => (await music())?.file).toBe("battle");
  await expect.poll(async () => (await music())?.paused).toBe(false);
  for (const [percent, file] of [
    [65, "battle-last-minute"],
    [75, "battle-final-30"],
    [93, "battle-sudden-death"],
  ] as const) {
    await seek.fill(String(percent));
    await expect.poll(async () => (await music())?.file).toBe(file);
  }
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  await expect.poll(async () => (await music())?.paused).toBe(true);
  await page.getByRole("button", { name: "Resume replay", exact: true }).click();
  await expect.poll(async () => (await music())?.file).toBe("battle-sudden-death");
  await expect.poll(async () => (await music())?.paused).toBe(false);
  await page.getByRole("button", { name: "Battle settings" }).click();
  await page.locator("#sound-setting").uncheck();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect.poll(async () => (await music())?.paused).toBe(false);
  await seek.fill("75");
  await expect.poll(async () => (await music())?.file).toBe("battle-final-30");
  await expect.poll(async () => (await music())?.paused).toBe(false);
  expect(errors).toEqual([]);
});
