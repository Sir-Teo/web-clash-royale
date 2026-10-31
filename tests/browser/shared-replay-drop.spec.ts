import { test, expect, type Page } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import { exportReplayFile } from "../../src/game/replay-file";
import type { RecordEntry } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const record: RecordEntry = {
  id: 1,
  date: "2026-10-31T12:00:00.000Z",
  mode: "classic",
  winner: "draw",
  crowns: [0, 0],
  playerName: "Drop Learner",
  opponent: "Remote Rival",
  opponentType: "friend",
  replay: {
    version: 56,
    rulesFamily: "origin",
    seed: 123,
    mode: "classic",
    perspective: "red",
    deck: [...STARTER_DECK],
    enemyDeck: [...PRESETS[1].deck],
    duration: 600,
    actions: [],
  },
};
const text = exportReplayFile(record, "Drop Learner");
async function files(page: Page, entries: { name: string; text: string }[]) {
  return page.evaluateHandle((entries) => {
    const transfer = new DataTransfer();
    for (const entry of entries)
      transfer.items.add(
        new File([entry.text], entry.name, { type: "application/json" }),
      );
    return transfer;
  }, entries);
}
test.beforeEach(async ({ page }, info) => {
  await page.addInitScript(
    ({ key, record }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            name: "Local Learner",
            sound: false,
            music: false,
            seenTutorial: true,
            history: [{ ...record, opponent: "Local Rival" }],
          }),
        );
    },
    { key, record },
  );
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
      { timeout: 60000 },
    )
    .toBe(expectedCards);
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
});

test("drops one replay into a filtered log and returns from the preview with its source cards, filters and progress intact", async ({
  page,
}, info) => {
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.locator("#history-search").fill("Local");
  const zone = page.locator(".replay-file-toolbar");
  const transfer = await files(page, [{ name: "shared-match.json", text }]);
  await zone.scrollIntoViewIfNeeded();
  await zone.dispatchEvent("dragover", { dataTransfer: transfer });
  await expect(zone).toHaveClass(/is-dragging/);
  await page.screenshot({
    path: info.outputPath("replay-drop-target.png"),
    animations: "disabled",
  });
  await zone.dispatchEvent("dragleave");
  await expect(zone).not.toHaveClass(/is-dragging/);
  await zone.dispatchEvent("dragover", { dataTransfer: transfer });
  await zone.dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
  await expect(
    page.getByRole("heading", { name: "Shared replay", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".shared-replay-names")).toContainText(
    "Remote Rival",
  );
  expect(
    await page
      .locator(".shared-replay .match-deck-panel")
      .first()
      .locator("[data-native-card]")
      .evaluateAll((cards) =>
        cards.map((c) => (c as HTMLElement).dataset.nativeCard),
      ),
  ).toEqual(PRESETS[1].deck);
  await page.locator("#shared-replay-back").click();
  await expect(page.locator("#history-search")).toHaveValue("Local");
  await expect(page.locator("#open-replay-file")).toBeFocused();
  await expect(page.locator(".history-entry")).toHaveCount(1);
  await expect(zone).not.toHaveClass(/is-dragging/);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    before,
  );
});

test("rejects multiple, malformed and oversized drops and discards a busy read after its log closes", async ({
  page,
}) => {
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  const zone = page.locator(".replay-file-toolbar");
  const error = zone.locator('[role="alert"]');
  const button = page.locator("#open-replay-file");
  for (const [entries, message] of [
    [
      [
        { name: "one.json", text },
        { name: "two.json", text },
      ],
      "Drop one replay file at a time.",
    ],
    [
      [{ name: "invalid.json", text: "not JSON" }],
      "This file is not a Browser Arena replay.",
    ],
    [
      [{ name: "large.json", text: "x".repeat(512001) }],
      "Choose a replay file smaller than 512 KB.",
    ],
  ] as const) {
    const transfer = await files(page, [...entries]);
    await zone.dispatchEvent("drop", { dataTransfer: transfer });
    await transfer.dispose();
    await expect(error).toHaveText(message);
    await expect(button).toBeEnabled();
    await expect(
      page.getByRole("heading", { name: "Your battle log", exact: true }),
    ).toBeVisible();
  }
  await page.evaluate((text) => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      if (this.name !== "slow-replay.json") return original.call(this);
      return new Promise<string>((resolve) => {
        (window as any).__finishReplayDrop = () => {
          File.prototype.text = original;
          resolve(text);
        };
      });
    };
  }, text);
  const slow = await files(page, [
    { name: "slow-replay.json", text: "pending" },
  ]);
  await zone.dispatchEvent("drop", { dataTransfer: slow });
  await expect(button).toBeDisabled();
  await expect(zone).toHaveAttribute("aria-busy", "true");
  const other = await files(page, [{ name: "another.json", text }]);
  await zone.dispatchEvent("drop", { dataTransfer: other });
  await expect(button).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    (window as any).__finishReplayDrop();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });
  await slow.dispose();
  await other.dispose();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await expect(button).toBeEnabled();
  await expect(error).toBeHidden();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    before,
  );
});
