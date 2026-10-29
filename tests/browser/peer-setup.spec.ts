import { test, expect, type Page } from "@playwright/test";
import { STARTER_DECK } from "../../src/game/cards";
import { decodeSignal, encodeSignal } from "../../src/network/peer-signaling";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const sdp = "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const invite = encodeSignal({
  version: 1,
  type: "offer",
  id: "1".repeat(24),
  mode: "classic",
  sdp,
});

async function init(page: Page, stall: "prepare" | "accept" | "none" = "none") {
  await page.addInitScript(
    ({ key, deck, sdp, stall }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          name: "Connection King",
          deck,
          sound: false,
          music: false,
          seenTutorial: true,
          history: [],
        }),
      );
      const controller = { peers: [] as any[], stall };
      (window as any).__peerSetup = controller;
      class Channel {
        readyState = "connecting";
        bufferedAmount = 0;
        onopen?: () => void;
        onclose?: () => void;
        send() {}
        close() {
          this.readyState = "closed";
          this.onclose?.();
        }
      }
      class Peer {
        iceGatheringState = "complete";
        connectionState = "new";
        localDescription: any;
        channel = new Channel();
        ondatachannel?: (event: any) => void;
        onconnectionstatechange?: () => void;
        finish?: () => void;
        constructor() {
          controller.peers.push(this);
        }
        async createOffer() {
          return { type: "offer", sdp };
        }
        async createAnswer() {
          return { type: "answer", sdp };
        }
        async setLocalDescription(value: any) {
          if (controller.stall === "prepare")
            await new Promise<void>((resolve) => (this.finish = resolve));
          this.localDescription = value;
        }
        async setRemoteDescription(value: any) {
          if (controller.stall === "accept" && value.type === "answer")
            await new Promise<void>((resolve) => (this.finish = resolve));
        }
        createDataChannel() {
          return this.channel;
        }
        close() {
          this.connectionState = "closed";
          this.onconnectionstatechange?.();
        }
        openGuest() {
          this.ondatachannel?.({ channel: this.channel });
          this.channel.readyState = "open";
          this.channel.onopen?.();
        }
      }
      (window as any).RTCPeerConnection = Peer;
    },
    { key, deck: STARTER_DECK, sdp, stall },
  );
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => !!(window as any).__arena?.state))
    .toBe(true);
  await page.locator("#friend-button").click();
  await page.clock.install();
  return page.evaluate((key) => localStorage.getItem(key), key);
}

async function join(page: Page) {
  await page.locator("#peer-invite").fill(invite);
  await page.locator('#peer-join-form button[type="submit"]').click();
}

async function retry(page: Page, saved: string | null) {
  await expect(page.locator("#create-peer")).toBeVisible();
  await expect(page.locator("#peer-invite")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__peerSetup.peers[0].connectionState),
    )
    .toBe("closed");
  await page.evaluate(() => ((window as any).__peerSetup.stall = "none"));
  await page.locator("#create-peer").click();
  await expect(page.locator("#peer-share")).toHaveValue(/^CR1\./);
  const signal = await page.locator("#peer-share").inputValue();
  await page.evaluate(() => (window as any).__peerSetup.peers[0].finish?.());
  await page.clock.fastForward(30000);
  await expect(page.locator("#peer-share")).toHaveValue(signal);
  await expect(page.locator(".room-error")).toBeEmpty();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    saved,
  );
}

for (const role of ["host", "guest"] as const) {
  test(`a stalled ${role} preparation returns to an actionable invite screen`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const saved = await init(page, "prepare");
    if (role === "host") await page.locator("#create-peer").click();
    else await join(page);
    await expect(page.locator(".room-banner")).toContainText(
      "Preparing your connection",
    );
    await page.clock.fastForward(20000);
    await expect(page.locator(".room-banner")).toContainText(
      "Preparing your connection",
    );
    await page.clock.fastForward(6000);
    await expect(page.locator(".room-error")).toContainText(
      "Preparing the connection took too long",
    );
    await retry(page, saved);
    expect(errors).toEqual([]);
  });

  test(`manual ${role} sharing stays available beyond the setup deadline`, async ({
    page,
  }) => {
    const saved = await init(page);
    if (role === "host") await page.locator("#create-peer").click();
    else await join(page);
    await expect(page.locator("#peer-share")).toHaveValue(/^CR1\./);
    const signal = await page.locator("#peer-share").inputValue();
    await page.clock.fastForward(120000);
    await expect(page.locator("#peer-share")).toHaveValue(signal);
    await expect(page.locator("#copy-peer")).toBeVisible();
    await expect(page.locator(".room-error")).toBeEmpty();
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      saved,
    );
  });
}

test("a stalled host reply expires and a late browser result cannot replace a new invite", async ({
  page,
}) => {
  const saved = await init(page, "accept");
  await page.locator("#create-peer").click();
  await expect(page.locator("#peer-share")).toHaveValue(/^CR1\./);
  const reply = encodeSignal({
    ...decodeSignal(await page.locator("#peer-share").inputValue()),
    type: "answer",
  });
  await page.locator("#peer-reply").fill(reply);
  await page.locator('#peer-accept-form button[type="submit"]').click();
  await expect(page.locator(".room-banner")).toContainText(
    "Connecting to your friend",
  );
  await page.clock.fastForward(26000);
  await expect(page.locator(".room-error")).toContainText(
    "browsers could not connect",
  );
  await retry(page, saved);
});

test("an open guest channel must complete the game handshake", async ({
  page,
}) => {
  const saved = await init(page);
  await join(page);
  await expect(page.locator("#peer-share")).toHaveValue(/^CR1\./);
  await page.evaluate(() => (window as any).__peerSetup.peers[0].openGuest());
  await expect(page.locator(".room-banner")).toContainText(
    "Connecting to your friend",
  );
  await page.clock.fastForward(26000);
  await expect(page.locator(".room-error")).toContainText(
    "game did not respond",
  );
  await retry(page, saved);
});

test("leaving a stalled preparation permits a fresh invite immediately", async ({
  page,
}) => {
  const saved = await init(page, "prepare");
  await page.locator("#create-peer").click();
  await expect(page.locator(".room-banner")).toContainText(
    "Preparing your connection",
  );
  await page.locator("#cancel-peer").click();
  await page.clock.fastForward(200);
  await retry(page, saved);
});
