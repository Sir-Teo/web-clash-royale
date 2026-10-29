import {
  test,
  chromium,
  expect as baseExpect,
  type Page,
} from "@playwright/test";
import { CARD_MAP, type CardId } from "../../src/game/cards";
import { expectedCards } from "./native-assets";
const expect = baseExpect.configure({ timeout: 20000 });
test.use({ serviceWorkers: "block", actionTimeout: 20000 });
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state);
async function init(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem(
      "browser-royale.profile.v1",
      JSON.stringify({
        version: 1,
        name: "Feedback King",
        seenTutorial: true,
        sound: false,
        music: false,
      }),
    ),
  );
  await page.goto("/");
  await expect
    .poll(async () => (await state(page))?.loadedCards, { timeout: 60000 })
    .toBe(expectedCards);
  await page.locator("#friend-button").click();
}
async function toastBounds(page: Page) {
  const toast = page.locator("#toast"),
    box = (await toast.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await toast.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
    true,
  );
}
for (const delayed of [false, true])
  test(`host rejection is explicit and ${delayed ? "a delayed reply preserves newer aim" : "a manual retry receives confirmation"}`, async ({
    page,
    browser,
    browserName,
  }, info) => {
    test.setTimeout(180000);
    const counterpart =
      browserName === "webkit"
        ? await chromium.launch({
            args: [
              "--enable-webgl",
              "--use-gl=angle",
              "--use-angle=swiftshader",
              "--enable-unsafe-swiftshader",
              // Container WebKit cannot resolve Chromium's masked local ICE names.
              "--disable-features=WebRtcHideLocalIpsWithMdns",
            ],
          })
        : undefined;
    const context = await (counterpart ?? browser).newContext({
      ...info.project.use,
      baseURL: "http://127.0.0.1:5188",
      serviceWorkers: "block",
    } as any);
    const friend = await context.newPage();
    const errors: string[] = [];
    for (const p of [page, friend])
      p.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.addInitScript(
        ({ delayed }) => {
          const w = window as any,
            NativeWorker = window.Worker;
          let rejected = false,
            held: any = null,
            owner: Worker | null = null,
            released = false;
          // Exercise the real authority's pause rejection, rather than fabricating an ack.
          window.Worker = class extends NativeWorker {
            private matchWorker: boolean;
            constructor(url: string | URL, options?: WorkerOptions) {
              super(url, options);
              this.matchWorker = options?.name === "royale-peer-match";
              if (this.matchWorker)
                this.addEventListener("message", (event) => {
                  if (
                    delayed &&
                    !released &&
                    event.data.message?.type === "ack" &&
                    !event.data.message.ok
                  ) {
                    event.stopImmediatePropagation();
                    held = event.data;
                    owner = this;
                  }
                });
            }
            override postMessage(message: any, transfer: Transferable[] = []) {
              if (
                this.matchWorker &&
                !rejected &&
                message.type === "command" &&
                message.message?.type === "play"
              ) {
                rejected = true;
                super.postMessage({
                  type: "availability",
                  team: message.team,
                  active: false,
                  connected: true,
                });
                super.postMessage(message, transfer);
                super.postMessage({
                  type: "availability",
                  team: message.team,
                  active: true,
                  connected: true,
                });
              } else super.postMessage(message, transfer);
            }
          };
          w.__feedbackDelivery = {
            get held() {
              return !!held;
            },
            release() {
              if (!owner || !held) throw new Error("No held acknowledgement");
              released = true;
              owner.dispatchEvent(new MessageEvent("message", { data: held }));
              held = null;
            },
          };
        },
        { delayed },
      );
      await init(page);
      await init(friend);
      test.skip(
        !(await page.evaluate(() => typeof RTCPeerConnection === "function")),
        "RTCPeerConnection is unavailable on this platform",
      );
      if (info.project.name !== "desktop")
        for (const p of [page, friend])
          await p.setViewportSize({ width: 320, height: 740 });
      await page.locator("#create-peer").click();
      await expect(page.locator("#peer-share")).toHaveValue(/^CR1\./);
      await friend
        .locator("#peer-invite")
        .fill(await page.locator("#peer-share").inputValue());
      await friend.locator('#peer-join-form button[type="submit"]').click();
      await expect(friend.locator("#peer-share")).toHaveValue(/^CR1\./);
      await page
        .locator("#peer-reply")
        .fill(await friend.locator("#peer-share").inputValue());
      await page.locator('#peer-accept-form button[type="submit"]').click();
      for (const p of [page, friend])
        await expect(p.locator("#room-ready")).toBeVisible();
      await page.locator("#room-ready").click();
      await friend.locator("#room-ready").click();
      await expect
        .poll(async () => (await state(page)).multiplayer?.phase, {
          timeout: 30000,
        })
        .toBe("playing");
      await expect
        .poll(async () => (await state(page)).intro.blocking, {
          timeout: 15000,
        })
        .toBe(false);
      const before = await state(page),
        slot = before.hand.findIndex(
          (id: CardId) =>
            CARD_MAP[id].kind === "troop" && CARD_MAP[id].cost <= before.elixir,
        );
      expect(slot).toBeGreaterThanOrEqual(0);
      const card: CardId = before.hand[slot],
        name = CARD_MAP[card].name;
      if (delayed) {
        await page.keyboard.press(String(slot + 1));
        await expect.poll(async () => (await state(page)).selected).toBe(slot);
        await page.keyboard.press("Enter");
      } else {
        const hand = page.locator(`#hand [data-slot="${slot}"]`);
        const touch = await page.evaluate(() => navigator.maxTouchPoints > 0);
        if (touch) await hand.tap();
        else await hand.click();
        await expect.poll(async () => (await state(page)).selected).toBe(slot);
        const point = await page.evaluate(() =>
          (window as any).__arena.project(9, 24),
        );
        if (touch) await page.touchscreen.tap(point.x, point.y);
        else await page.mouse.click(point.x, point.y);
      }
      const status = page.locator("#keyboard-deployment-status"),
        toast = page.locator("#toast");
      let accepted = card;
      if (delayed) {
        await expect
          .poll(() =>
            page.evaluate(() => (window as any).__feedbackDelivery.held),
          )
          .toBe(true);
        await expect(status).toHaveText(`${name} placement submitted.`);
        const held = await state(page),
          next = held.hand.findIndex(
            (id: CardId, i: number) =>
              i !== slot &&
              CARD_MAP[id].kind === "troop" &&
              CARD_MAP[id].cost <= held.elixir,
          );
        expect(next).toBeGreaterThanOrEqual(0);
        accepted = held.hand[next];
        await page.keyboard.press(String(next + 1));
        await expect.poll(async () => (await state(page)).selected).toBe(next);
        const aim = await status.textContent();
        expect(aim).toContain("Enter deploys.");
        await page.evaluate(() => (window as any).__feedbackDelivery.release());
        await expect(toast).toHaveText(
          `${name} not deployed. Waiting for both players.`,
        );
        await expect(toast).toHaveAttribute("aria-hidden", "false");
        await toastBounds(page);
        await expect(status).toHaveText(aim!);
        expect((await state(page)).selected).toBe(next);
        expect((await state(page)).actions).toBe(0);
      } else {
        await expect(status).toHaveText(
          `${name} not deployed. Waiting for both players.`,
        );
        await expect(toast).toHaveText((await status.textContent()) ?? "");
        await expect(toast).toHaveAttribute("aria-hidden", "true");
        await toastBounds(page);
        expect((await state(page)).actions).toBe(0);
        expect((await state(page)).hand).toEqual(before.hand);
        expect((await state(page)).elixir).toBeGreaterThanOrEqual(
          before.elixir,
        );
        if (info.project.name !== "mobile")
          await page.screenshot({
            path: info.outputPath("deployment-rejected.png"),
            animations: "disabled",
          });
        await expect(toast).not.toHaveClass(/visible/);
        await expect(status).toHaveText(
          `${name} not deployed. Waiting for both players.`,
        );
        expect((await state(page)).actions).toBe(0);
        await page.keyboard.press(String(slot + 1));
        await expect.poll(async () => (await state(page)).selected).toBe(slot);
      }
      await page.keyboard.press("Enter");
      await expect(status).toHaveText(`${CARD_MAP[accepted].name} deployed.`);
      await expect.poll(async () => (await state(page)).actions).toBe(1);
      await expect.poll(async () => (await state(friend)).actions).toBe(1);
      if (!delayed) {
        await page.locator("#arena-settings").click();
        await page
          .getByRole("button", { name: "Save settings", exact: true })
          .click();
        await expect(toast).toHaveText("Settings saved.");
        await expect(toast).toHaveAttribute("aria-hidden", "false");
      }
      await page.locator("#pause-button").click();
      await page.locator("#online-surrender").click();
      await expect(
        page.getByRole("button", { name: "Watch replay", exact: true }),
      ).toBeVisible({ timeout: 30000 });
      const record = await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("browser-royale.profile.v1")!)
            .history[0],
      );
      expect(record.replay.actions).toHaveLength(1);
      expect(record.replay.actions[0].card).toBe(accepted);
      await page
        .getByRole("button", { name: "Watch replay", exact: true })
        .click();
      await expect(status).toHaveText("");
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await counterpart?.close();
    }
  });
