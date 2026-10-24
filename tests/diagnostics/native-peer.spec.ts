import { test, expect } from "@playwright/test";
test("native data-channel loopback without the game", async ({
  page,
  browser,
}, info) => {
  const context = await browser.newContext();
  const friend = await context.newPage();
  try {
    for (const p of [page, friend]) {
      await p.goto("/crown.svg");
      await p.evaluate(() => {
        const state = {
          available: typeof RTCPeerConnection === "function",
          events: [] as string[],
          candidates: 0,
          mdns: 0,
        };
        (window as any).nativePeer = { pc: null, state, channel: null };
        if (!state.available) return;
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });
        (window as any).nativePeer = { pc, state, channel: null };
        for (const event of [
          "iceconnectionstatechange",
          "connectionstatechange",
          "signalingstatechange",
        ])
          pc.addEventListener(event, () =>
            state.events.push(
              `${event}:${pc.iceConnectionState}:${pc.connectionState}:${pc.signalingState}`,
            ),
          );
        pc.addEventListener("icecandidate", (event) => {
          if (event.candidate) {
            state.candidates++;
            if (event.candidate.candidate.includes(".local")) state.mdns++;
          }
        });
        pc.ondatachannel = (event) =>
          ((window as any).nativePeer.channel = event.channel);
      });
    }
    for (const p of [page, friend])
      expect(
        await p.evaluate(() => (window as any).nativePeer.state.available),
      ).toBe(true);
    const offer = await page.evaluate(async () => {
      const { pc } = (window as any).nativePeer;
      (window as any).nativePeer.channel = pc.createDataChannel("test");
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") resolve();
        else
          pc.addEventListener("icegatheringstatechange", () => {
            if (pc.iceGatheringState === "complete") resolve();
          });
      });
      return pc.localDescription.toJSON();
    });
    const answer = await friend.evaluate(async (offer) => {
      const { pc } = (window as any).nativePeer;
      await pc.setRemoteDescription(offer);
      await pc.setLocalDescription(await pc.createAnswer());
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") resolve();
        else
          pc.addEventListener("icegatheringstatechange", () => {
            if (pc.iceGatheringState === "complete") resolve();
          });
      });
      return pc.localDescription.toJSON();
    }, offer);
    await page.evaluate(
      (answer) => (window as any).nativePeer.pc.setRemoteDescription(answer),
      answer,
    );
    await expect
      .poll(
        () =>
          page.evaluate(() => (window as any).nativePeer.channel?.readyState),
        { timeout: 15000 },
      )
      .toBe("open");
    await expect
      .poll(
        () =>
          friend.evaluate(() => (window as any).nativePeer.channel?.readyState),
        { timeout: 15000 },
      )
      .toBe("open");
  } finally {
    const states = [];
    for (const p of [page, friend])
      states.push(
        await p.evaluate(() => {
          const peer = (window as any).nativePeer;
          return peer
            ? {
                ...peer.state,
                iceConnectionState: peer.pc?.iceConnectionState,
                connectionState: peer.pc?.connectionState,
                signalingState: peer.pc?.signalingState,
                channelState: peer.channel?.readyState,
              }
            : { available: false };
        }),
      );
    await info.attach("native-rtc-states", {
      body: JSON.stringify({
        project: info.project.name,
        browser: browser.version(),
        node: process.version,
        states,
      }),
      contentType: "application/json",
    });
    await context.close();
  }
});
