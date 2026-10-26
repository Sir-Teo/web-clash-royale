import { CARD_MAP } from "../../src/game/cards";
import { test, expect } from "@playwright/test";
const number = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
const deck = [
  "rage",
  "freeze",
  "poison",
  "rocket",
  "fireball",
  "arrows",
  "zap",
  "minion-horde",
];
const key = "browser-royale.profile.v1";
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ deck, key }) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          deck,
          seenTutorial: true,
          sound: false,
          music: false,
        }),
      ),
    { deck, key },
  );
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__arena);
});

test("spell details describe their actual damage, allegiance and timed effects", async ({
  page,
}, info) => {
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 740 });
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  const cases = [
    [
      "rage",
      {
        "Speed boost": "+35%",
        Duration: "6 s",
        Linger: "Up to 2 s",
        Targets: "Friendly air & ground troops",
      },
    ],
    [
      "freeze",
      { Effect: "Freeze", Duration: "4 s", "Hidden Tesla": "Affected" },
    ],
    [
      "poison",
      {
        "Damage per second": "121",
        "Crown Tower / second": "48.4",
        Duration: "8 s",
        Linger: "Up to 1 s",
      },
    ],
    [
      "rocket",
      { Damage: "1,484", "Crown Tower damage": "593.6", Radius: "2 tiles" },
    ],
    [
      "fireball",
      { Damage: "689", "Crown Tower damage": number(CARD_MAP.fireball.damage * 0.4), Knockback: "1.8 tiles" },
    ],
    [
      "arrows",
      { "Volley damage": "366", "Crown Tower damage": number(CARD_MAP.arrows.damage * 0.4), Waves: "1" },
    ],
    ["zap", { Damage: "192", "Crown Tower damage": number(CARD_MAP.zap.damage * 0.4), Stun: "0.5 s" }],
  ] as const;
  for (const [id, expected] of cases) {
    await page.locator(`#deck-preview [data-card-info="${id}"]`).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    for (const [label, value] of Object.entries(expected))
      await expect(page.locator(`[data-card-stat="${label}"] b`)).toHaveText(
        value,
      );
    if (id !== "rage")
      await expect(page.locator('[data-card-stat="Targets"] b')).toHaveText(
        "Enemy air & ground",
      );
    await expect(page.locator(".level-pill")).toContainText(
      "CURRENT ARENA STATS",
    );
    await expect(page.locator('[data-card-stat="Area damage"]')).toHaveCount(0);
    if (id === "rage" || id === "freeze")
      await expect(page.locator('[data-card-stat="Damage"]')).toHaveCount(0);
    const overflow = await page
      .locator(".modal")
      .evaluate((e) => e.scrollWidth > e.clientWidth);
    expect(overflow).toBe(false);
    const boxes = await page
      .locator("[data-card-stat]")
      .evaluateAll((elements) =>
        elements.map((e) => ({
          left: e.getBoundingClientRect().left,
          right: e.getBoundingClientRect().right,
        })),
      );
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    if (id === "poison" && info.project.name !== "mobile") {
      await page.locator(".stat-grid").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath("poison-card-stats.png"),
        animations: "disabled",
      });
    }
    await page.keyboard.press("Escape");
  }
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    before,
  );
});

test("shared-deck card inspection shows per-troop stats and building lifetimes without changing the deck", async ({
  page,
}, info) => {
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 568 });
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  const preview = [
    "minion-horde",
    "skeleton-army",
    "archers",
    "cannon",
    "tesla",
    "knight",
    "giant",
    "witch",
  ];
  await page.locator('[data-nav="cards"]').click();
  await page.locator("#deck-codes").click();
  await page
    .locator("#shared-deck-code")
    .fill("BRA-DECK-1:" + preview.join(","));
  await page.getByRole("button", { name: "Preview deck", exact: true }).click();
  for (const [id, expected] of [
    [
      "minion-horde",
      {
        "Hitpoints per troop": "230",
        "Damage per troop": "102",
        Count: "6",
        "Hit interval": "1 s",
      },
    ],
    [
      "skeleton-army",
      { "Hitpoints per troop": "81", "Damage per troop": "81", Count: "15" },
    ],
    ["archers", { "Hitpoints per troop": "304", Count: "2" }],
    ["cannon", { Hitpoints: "824", Lifetime: "30 s", Targets: "Ground" }],
    [
      "tesla",
      { Hitpoints: "1,152", Lifetime: `${CARD_MAP.tesla.lifetime} s`, Targets: "Air & ground" },
    ],
  ] as const) {
    await page.locator(`[data-code-card="${id}"]`).click();
    for (const [label, value] of Object.entries(expected))
      await expect(page.locator(`[data-card-stat="${label}"] b`)).toHaveText(
        value,
      );
    expect(
      await page
        .locator(".modal")
        .evaluate((e) => e.scrollWidth > e.clientWidth),
    ).toBe(false);
    await page
      .getByRole("button", { name: "Back to deck codes", exact: true })
      .click();
    await expect(page.locator("#shared-deck-preview")).toBeVisible();
  }
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    before,
  );
});

test("shielded troop details separate body and shield hitpoints without changing the deck", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 740 });
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.locator('[data-nav="cards"]').click();
  for (const [id, query, expected] of [
    [
      "guards",
      "Guards",
      { "Hitpoints per troop": "105", "Shield per troop": "242", Count: "3" },
    ],
    [
      "dark-prince",
      "Dark Prince",
      { Hitpoints: "1,184", "Shield hitpoints": "322", Count: "1" },
    ],
  ] as const) {
    await page.locator("#card-search").fill(query);
    await page.locator(`[data-collection="${id}"]`).click();
    for (const [label, value] of Object.entries(expected))
      await expect(page.locator(`[data-card-stat="${label}"] b`)).toHaveText(
        value,
      );
    await expect(page.locator(".card-rule-note")).toContainText(
      "Shield hitpoints are separate.",
    );
    await expect(page.locator(".card-rule-note")).toContainText(
      "A hit that breaks the shield does not damage the body.",
    );
    if (id === "guards")
      await expect(page.locator(".card-rule-note")).toContainText(
        "Damage is per troop, per hit.",
      );
    expect(
      await page
        .locator(".modal")
        .evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
    if (id === "guards") {
      await page.locator(".stat-grid").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath("guards-shield-details.png"),
        animations: "disabled",
      });
    }
    await page
      .getByRole("button", { name: "Back to collection", exact: true })
      .click();
  }
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    before,
  );
  expect(errors).toEqual([]);
});

test("charger details show charge damage and distance on a narrow phone", async ({ page }, info) => {
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 568 });
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.locator('[data-nav="cards"]').click();
  for (const [id, name, damage, distance] of [
    ["prince", "Prince", "784", "2.5 tiles"],
    ["dark-prince", "Dark Prince", "467", "2.5 tiles"],
    ["battle-ram", "Battle Ram", "610", "3 tiles"],
  ]) {
    await page.locator("#card-search").fill(name);
    await page.locator(`[data-collection="${id}"]`).click();
    await expect(page.locator('[data-card-stat="Charge damage"] b')).toHaveText(damage);
    await expect(page.locator('[data-card-stat="Charge distance"] b')).toHaveText(distance);
    await expect(page.locator(".card-rule-note")).toContainText("Stun resets the charge.");
    await page.locator('[data-card-stat="Charge distance"]').scrollIntoViewIfNeeded();
    expect(await page.locator(".modal").evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(false);
    if (id === "dark-prince") await page.screenshot({
      path: info.outputPath("dark-prince-charge-details.png"), animations: "disabled",
    });
    await page.getByRole("button", { name: "Back to collection", exact: true }).click();
  }
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(before);
});

test("utility building details explain production, staggered waves and death spawns", async ({ page }, info) => {
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 568 });
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.locator('[data-nav="cards"]').click();
  for (const [id, name, expected] of [
    ["elixir-collector", "Elixir Collector", {
      "Elixir per cycle": "1", "Production interval": "8.5 s", Lifetime: "70 s",
    }],
    ["goblin-hut", "Goblin Hut", {
      Spawns: "1 Spear Goblin", "First spawn delay": "4.95 s", "Spawn interval": "4.95 s",
      "Troop deploy time": "1 s", Lifetime: "60 s",
    }],
    ["tombstone", "Tombstone", {
      Spawns: "1 Skeleton", "First spawn delay": "2.95 s", "Spawn interval": "2.95 s",
      "On destruction": "4 Skeletons", "Troop deploy time": "1 s", Lifetime: "40 s",
    }],
    ["furnace", "Furnace", {
      Spawns: "2 Fire Spirits", "First spawn delay": "9.4 s", "Wave interval": "9.9 s",
      "Troop spacing": "0.5 s", "Troop deploy time": "1 s", Lifetime: "50 s",
    }],
    ["barbarian-hut", "Barbarian Hut", {
      Spawns: "2 Barbarians", "First spawn delay": "13.5 s", "Wave interval": "14 s",
      "Troop spacing": "0.5 s", "Troop deploy time": "1 s", Lifetime: "60 s",
    }],
  ] as const) {
    await page.locator("#card-search").fill(name);
    await page.locator(`[data-collection="${id}"]`).click();
    for (const [label, value] of Object.entries(expected))
      await expect(page.locator(`[data-card-stat="${label}"] b`)).toHaveText(value);
    await expect(page.locator('[data-card-stat="Deploy time"] b')).toHaveText("1 s");
    for (const label of ["Damage per hit", "Hit interval", "Range", "Targets"])
      await expect(page.locator(`[data-card-stat="${label}"]`)).toHaveCount(0);
    await expect(page.locator(".card-rule-note")).toContainText(
      id === "elixir-collector" ? "Stored elixir is capped at 10." :
        "The first spawn delay starts after the building deploys.",
    );
    if (id === "tombstone")
      await expect(page.locator(".card-rule-note")).toContainText("when its lifetime expires");
    expect(await page.locator(".modal").evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(false);
    await page.locator(".stat-grid").scrollIntoViewIfNeeded();
    if (["elixir-collector", "tombstone", "furnace"].includes(id))
      await page.screenshot({ path: info.outputPath(`${id}-production-details.png`), animations: "disabled" });
    await page.getByRole("button", { name: "Back to collection", exact: true }).click();
  }
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(before);
});
