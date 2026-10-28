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
      { Damage: "1,484", "Crown Tower damage": "594", Radius: "2 tiles" },
    ],
    [
      "fireball",
      { Damage: "689", "Crown Tower damage": "276", Knockback: "1.8 tiles" },
    ],
    [
      "arrows",
      { "Volley damage": "366", "Crown Tower damage": "147", Waves: "1" },
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
    "goblin-gang",
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
    ["goblin-gang", {
      Goblins: "3", "Spear Goblins": "3", Count: "6",
      "Goblin hitpoints": number(CARD_MAP.goblins.hp),
      "Goblin damage": number(CARD_MAP.goblins.damage),
      "Goblin hit interval": `${number(CARD_MAP.goblins.interval)} s`,
      "Goblin range": `${number(CARD_MAP.goblins.range)} tiles`,
      "Goblin targets": "Ground",
      "Spear Goblin hitpoints": number(CARD_MAP["spear-goblins"].hp),
      "Spear Goblin damage": number(CARD_MAP["spear-goblins"].damage),
      "Spear Goblin hit interval": `${number(CARD_MAP["spear-goblins"].interval)} s`,
      "Spear Goblin range": `${number(CARD_MAP["spear-goblins"].range)} tiles`,
      "Spear Goblin targets": "Air & ground",
    }],
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
    if (id === "goblin-gang") {
      for (const label of ["Hitpoints per troop", "Damage per troop", "Targets"])
        await expect(page.locator(`[data-card-stat="${label}"]`)).toHaveCount(0);
      await expect(page.locator(".card-rule-note")).toContainText("per troop of the named type");
      await page.locator('[data-card-stat="Spear Goblin targets"]').scrollIntoViewIfNeeded();
      await expect(page.locator('[data-card-stat="Spear Goblin targets"]')).toBeInViewport();
      await page.screenshot({ path: info.outputPath("goblin-gang-mixed-details.png"), animations: "disabled" });
    }
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

test("production and summoner details show initial waves, spacing and death spawns", async ({ page }, info) => {
  test.setTimeout(180000);
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 568 });
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.locator('[data-nav="cards"]').click();
  for (const [id, name, expected] of [
    ["elixir-collector", "Elixir Collector", {
      "Elixir per cycle": "1", "Production interval": "8.5 s", Lifetime: "70 s",
    }],
    ["witch", "Witch", {
      Spawns: "3 Skeletons", "First spawn delay": "0 s", "Wave interval": "7.5 s",
      "Troop spacing": "0.3 s", "Spawn deploy time": "1 s", Targets: "Air & ground",
      "Spawn targets": "Ground", "Spawn hitpoints": number(CARD_MAP.skeletons.hp),
      "Spawn damage per hit": number(CARD_MAP.skeletons.damage),
    }],
    ["night-witch", "Night Witch", {
      Spawns: "2 Bats", "First spawn delay": "0 s", "Spawn interval": "5 s",
      "On destruction": "4 Bats", "Spawn targets": "Air & ground", Targets: "Ground",
    }],
    ["goblin-hut", "Goblin Hut", {
      Spawns: "1 Spear Goblin", "First spawn delay": "0 s", "Spawn interval": "4.95 s",
      "Troop deploy time": "1 s", Lifetime: "60 s",
    }],
    ["tombstone", "Tombstone", {
      Spawns: "1 Skeleton", "First spawn delay": "0 s", "Spawn interval": "2.95 s",
      "On destruction": "4 Skeletons", "Troop deploy time": "1 s", Lifetime: "40 s",
    }],
    ["furnace", "Furnace", {
      Spawns: "2 Fire Spirits", "First spawn delay": "0 s", "Wave interval": "9.9 s",
      "Troop spacing": "0.5 s", "Troop deploy time": "1 s", Lifetime: "50 s",
    }],
    ["barbarian-hut", "Barbarian Hut", {
      Spawns: "2 Barbarians", "First spawn delay": "0 s", "Wave interval": "14 s",
      "Troop spacing": "0.5 s", "Troop deploy time": "1 s", Lifetime: "60 s",
    }],
  ] as const) {
    await page.locator("#card-search").fill(name);
    await page.locator(`[data-collection="${id}"]`).click();
    await expect(page.locator(".detail-art.native-card-ready")).toHaveCount(1, { timeout: 30000 });
    for (const [label, value] of Object.entries(expected))
      await expect(page.locator(`[data-card-stat="${label}"] b`)).toHaveText(value);
    await expect(page.locator('[data-card-stat="Deploy time"] b')).toHaveText("1 s");
    if (!["witch", "night-witch"].includes(id))
      for (const label of ["Damage per hit", "Hit interval", "Range", "Targets"])
        await expect(page.locator(`[data-card-stat="${label}"]`)).toHaveCount(0);
    await expect(page.locator(".card-rule-note")).toContainText(
      id === "elixir-collector" ? "Stored elixir is capped at 10." :
        id === "witch" ? "The first Skeleton wave starts as deployment finishes." :
        id === "night-witch" ? "The first Bat wave starts as deployment finishes." :
        "The first wave starts as deployment finishes.",
    );
    if (id === "tombstone")
      await expect(page.locator(".card-rule-note")).toContainText("when its lifetime expires");
    expect(await page.locator(".modal").evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(false);
    await page.locator(".stat-grid").scrollIntoViewIfNeeded();
    if (id !== "elixir-collector") {
      await page.locator('[data-card-stat="First spawn delay"]').scrollIntoViewIfNeeded();
      await expect(page.locator('[data-card-stat="First spawn delay"]')).toBeInViewport();
    }
    if (["witch", "night-witch", "elixir-collector", "tombstone", "furnace"].includes(id))
      await page.screenshot({ path: info.outputPath(`${id}-production-details.png`), animations: "disabled" });
    await page.locator('[data-card-stat="Elixir"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-card-stat="Elixir"]')).toBeInViewport();
    await page.getByRole("button", { name: "Back to collection", exact: true }).click();
  }
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(before);
});

test("death-spawn troop details distinguish released bodies, targets and timing", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 568 });
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.locator('[data-nav="cards"]').click();
  for (const [id, name, child, expected] of [
    ["golem", "Golem", "golemite", {
      "On destruction": "2 Golemites", "Deploy time": "3 s",
      "Spawn targets": "Buildings", "Spawn deploy time": "1 s",
      "Death damage": "314", "Death radius": "2 tiles",
      "Golemite death damage": "64", "Golemite death radius": "2 tiles",
    }],
    ["lava-hound", "Lava Hound", "lava-pup", {
      "On destruction": "6 Lava Pups", "Deploy time": "1 s",
      "Spawn targets": "Air & ground", "Spawn deploy time": "1 s",
    }],
    ["battle-ram", "Battle Ram", "barbarians", {
      "On destruction": "2 Barbarians", "Deploy time": "1 s",
      "Spawn targets": "Ground", "Spawn deploy time": "0.8 s",
      "Charge damage": "610", "Charge distance": "3 tiles",
    }],
    ["night-witch", "Night Witch", "bats", {
      "On destruction": "4 Bats", "Deploy time": "1 s",
      "Spawn targets": "Air & ground", "Spawn deploy time": "1 s",
      Spawns: "2 Bats", "First spawn delay": "0 s", "Spawn interval": "5 s",
    }],
  ] as const) {
    await page.locator("#card-search").fill(name);
    await page.locator(`[data-collection="${id}"]`).click();
    for (const [label, value] of Object.entries({
      ...expected,
      "Spawn hitpoints": number(CARD_MAP[child].hp),
      "Spawn damage per hit": number(CARD_MAP[child].damage),
      "Spawn hit interval": `${number(CARD_MAP[child].interval)} s`,
    }))
      await expect(page.locator(`[data-card-stat="${label}"] b`)).toHaveText(value);
    await expect(page.locator(".card-rule-note")).toContainText("per troop");
    await page.locator('[data-card-stat="On destruction"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-card-stat="On destruction"]')).toBeInViewport();
    expect(await page.locator(".modal").evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(false);
    const bounds = await page.locator("[data-card-stat]").evaluateAll((rows) => rows.map((row) => ({
      left: row.getBoundingClientRect().left, right: row.getBoundingClientRect().right,
    })));
    for (const box of bounds) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    if (id === "golem" || id === "night-witch")
      await page.screenshot({ path: info.outputPath(`${id}-death-spawn-details.png`), animations: "disabled" });
    await page.locator('[data-card-stat="Elixir"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-card-stat="Elixir"]')).toBeInViewport();
    await page.getByRole("button", { name: "Back to collection", exact: true }).click();
  }
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(before);
  expect(errors).toEqual([]);
});

test("Inferno detail panels show three per-hit stages and total lock times", async ({ page }, info) => {
  if (info.project.name !== "desktop") await page.setViewportSize({ width: 320, height: 568 });
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.locator('[data-nav="cards"]').click();
  for (const [id, name, damage] of [
    ["inferno-tower", "Inferno Tower", ["51", "192", "1,024"]],
    ["inferno-dragon", "Inferno Dragon", ["36", "121", "424"]],
  ] as const) {
    await page.locator("#card-search").fill(name);
    await page.locator(`[data-collection="${id}"]`).click();
    await expect(page.locator(".detail-art.native-card-ready")).toHaveCount(1, { timeout: 30000 });
    for (const [stage, value] of damage.entries())
      await expect(page.locator(`[data-card-stat="Stage ${stage + 1} damage"] b`)).toHaveText(value);
    await expect(page.locator('[data-card-stat="Stage 2 after"] b')).toHaveText("2 s");
    await expect(page.locator('[data-card-stat="Stage 3 after"] b')).toHaveText("4 s");
    await expect(page.locator('[data-card-stat="Hit interval"] b')).toHaveText("0.4 s");
    await expect(page.locator('[data-card-stat="Damage per hit"]')).toHaveCount(0);
    await expect(page.locator(".card-rule-note")).toContainText("Damage is per hit");
    await expect(page.locator(".card-rule-note")).toContainText("Rage accelerates the ramp and slow delays it");
    await expect(page.locator(".card-rule-note")).toContainText("Stun, losing range or changing targets resets");
    expect(await page.locator(".modal").evaluate((modal) => modal.scrollWidth > modal.clientWidth)).toBe(false);
    await page.locator('[data-card-stat="Stage 3 after"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-card-stat="Stage 3 after"]')).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`${id}-stage-details.png`), animations: "disabled" });
    await page.getByRole("button", { name: "Back to collection", exact: true }).click();
  }
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(before);
});

for (const [id, name, damage, delay] of [
  ["giant-skeleton", "Giant Skeleton", "1,160", "3 s"],
  ["balloon", "Balloon", "330", "1 s"],
] as const)
test(`${name} details distinguish its delayed air-and-ground death bomb`, async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  if (info.project.name !== "desktop") await page.setViewportSize({ width: 320, height: 568 });
  const before = await page.evaluate(key => localStorage.getItem(key), key);
  await page.locator('[data-nav="cards"]').click();
  await page.locator("#card-search").fill(name);
  await page.locator(`[data-collection="${id}"]`).click();
  await expect(page.locator(".detail-art.native-card-ready")).toHaveCount(1, { timeout: 30000 });
  for (const [label, value] of Object.entries({
    "Damage per hit": number(CARD_MAP[id].damage),
    Targets: id === "balloon" ? "Buildings" : "Ground", "Death bomb damage": damage, "Bomb delay": delay,
    "Bomb radius": "3 tiles", "Bomb targets": "Air & ground",
    ...(id === "giant-skeleton" ? { "Bomb knockback": "1.8 tiles" } : {}),
  })) await expect(page.locator(`[data-card-stat="${label}"] b`)).toHaveText(value);
  await expect(page.locator(".card-rule-note")).toContainText("where it is destroyed");
  if (id === "giant-skeleton") await expect(page.locator(".card-rule-note")).toContainText("eligible troops");
  else {
    await expect(page.locator(".card-rule-note")).toContainText("normal attack targets buildings");
    await expect(page.locator('[data-card-stat="Bomb knockback"]')).toHaveCount(0);
  }
  await page.locator('[data-card-stat="Bomb targets"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-card-stat="Bomb targets"]')).toBeInViewport();
  expect(await page.locator(".modal").evaluate(modal => modal.scrollWidth > modal.clientWidth)).toBe(false);
  const bounds = await page.locator("[data-card-stat]").evaluateAll(rows => rows.map(row => ({ left: row.getBoundingClientRect().left, right: row.getBoundingClientRect().right })));
  for (const box of bounds) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await page.screenshot({ path: info.outputPath(`${id}-bomb-details.png`), animations: "disabled" });
  await page.locator('[data-card-stat="Elixir"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-card-stat="Elixir"]')).toBeInViewport();
  await page.getByRole("button", { name: "Back to collection", exact: true }).click();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(before);
  expect(errors).toEqual([]);
});
