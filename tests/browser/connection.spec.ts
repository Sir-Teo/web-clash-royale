import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import sirv from "sirv";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { STARTER_DECK } from "../../src/game/cards";
import { PROTOCOL } from "../../src/network/protocol";
import type { ServerMessage } from "../../src/network/protocol";

test.use({ serviceWorkers: "block" });
test.skip(
  !process.env.ARENA_PRODUCTION,
  "Run the built-asset connection scenarios with ARENA_PRODUCTION=1.",
);
for (const native of [true, false]) {
  test(`connection loss ${native ? "shows the native warning" : "retains text when warning assets fail"} and recovery clears it`, async ({
    page,
    context,
  }, info) => {
    test.setTimeout(120000);
    // Match the production server bundling, including its JSON rule tables.
    const serverBundle = info.outputPath("rooms.mjs");
    await build({
      entryPoints: ["server/rooms.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      outfile: serverBundle,
    });
    const { attachRooms } = (await import(
      pathToFileURL(serverBundle).href
    )) as typeof import("../../server/rooms");
    // An owned real server lets the test drop the transport and reject retries
    // without exposing diagnostic commands in the game or mocking its client.
    let blocked = false;
    const assets = sirv("dist", { etag: true });
    const http = createServer((req, res) =>
      assets(req, res, () => {
        res.writeHead(404);
        res.end();
      }),
    );
    http.on("connection", (socket) => {
      if (blocked) socket.destroy();
    });
    const roomServer = attachRooms(http);
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(http.address() as any).port}`;
    let opponent: WebSocket | undefined;
    let welcome: Extract<ServerMessage, { type: "welcome" }> | undefined;
    async function host(resume = false) {
      const ws = new WebSocket(`${origin.replace("http", "ws")}/battle`);
      ws.on("message", (bytes) => {
        const message: ServerMessage = JSON.parse(bytes.toString());
        if (message.type === "welcome") welcome = message;
      });
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      ws.send(
        JSON.stringify(
          resume
            ? {
                type: "resume",
                version: PROTOCOL,
                code: welcome!.code,
                token: welcome!.token,
              }
            : {
                type: "create",
                version: PROTOCOL,
                name: "Waiting King",
                deck: STARTER_DECK,
                mode: "classic",
              },
        ),
      );
      return ws;
    }
    const state = () =>
      page.evaluate(() => (window as any).__arena?.state ?? {});
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      opponent = await host();
      await expect.poll(() => welcome?.code).toMatch(/^[A-Z2-9]{6}$/);
      const code = welcome!.code;
      if (!native)
        await context.route(
          "**/assets/ui/connection/connection.json",
          (route) => route.abort(),
        );
      await page.addInitScript(() =>
        localStorage.setItem(
          "browser-royale.profile.v1",
          JSON.stringify({
            version: 1,
            sound: false,
            music: false,
            seenTutorial: true,
          }),
        ),
      );
      await page.goto(`${origin}/?room=${code}`);
      await expect(page.locator("#friend-button")).toBeVisible({
        timeout: 60000,
      });
      await page
        .getByRole("button", { name: "Join room", exact: true })
        .click();
      await expect(page.locator(".room-code")).toHaveText(code);
      if (native)
        await expect
          .poll(async () => (await state()).loadedConnectionWarnings, {
            timeout: 30000,
          })
          .toBe(1);
      opponent.send(JSON.stringify({ type: "ready", ready: true }));
      await page
        .getByRole("button", { name: "Ready for battle", exact: true })
        .click();
      await expect
        .poll(async () => (await state()).multiplayer?.phase)
        .toBe("playing");
      await expect
        .poll(async () => (await state()).intro.active, { timeout: 15000 })
        .toBe(false);
      const warning = page.locator("#connection-warning");
      await expect(warning).toBeHidden();
      // The other player's outage must not imply a broken local connection.
      opponent.close();
      await expect(page.locator("#connection-status")).toContainText(
        "Opponent reconnecting",
      );
      await expect(warning).toBeHidden();
      opponent = await host(true);
      await expect(page.locator("#connection-status")).toContainText(
        "FRIENDLY",
      );
      const before = (await state()).time;
      blocked = true;
      roomServer.rooms
        .get(code)!
        .players.find((player) => player.team === "red")!
        .peer!.ws.terminate();
      await expect(page.locator("#connection-status")).toContainText(
        "Reconnecting",
      );
      await expect
        .poll(async () => (await state()).multiplayer.connected)
        .toBe(false);
      if (native) {
        await expect(warning).toBeVisible();
        await expect(warning).toHaveAttribute("aria-hidden", "true");
        const frame = await warning.getAttribute("data-frame");
        await expect
          .poll(() => warning.getAttribute("data-frame"))
          .not.toBe(frame);
        await page.screenshot({
          path: `docs/screenshots/${info.project.name}-native-connection.png`,
        });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await expect
          .poll(async () => (await state()).connectionWarning.reduced)
          .toBe(true);
        await expect(warning).toHaveAttribute("data-frame", "0");
        const pose = await warning.innerHTML();
        await page.waitForTimeout(150);
        expect(await warning.innerHTML()).toBe(pose);
        if (info.project.name !== "desktop") {
          await page.setViewportSize({ width: 844, height: 390 });
          await expect
            .poll(() =>
              page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            )
            .toBe(true);
          const box = (await warning.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(844);
          expect(box.y + box.height).toBeLessThanOrEqual(390);
          await page.screenshot({
            path: `test-results/${info.project.name}-landscape-native-connection.png`,
          });
        }
      } else {
        await expect(warning).toBeHidden();
        expect((await state()).loadedConnectionWarnings).toBe(0);
      }
      blocked = false;
      await expect
        .poll(async () => (await state()).multiplayer.connected, {
          timeout: 15000,
        })
        .toBe(true);
      await expect(warning).toBeHidden();
      await expect(page.locator("#connection-status")).toContainText(
        "FRIENDLY",
      );
      expect((await state()).time).toBeGreaterThan(before);
      expect((await state()).winner).toBeNull();
      expect(errors).toEqual([]);
    } finally {
      blocked = false;
      opponent?.terminate();
      roomServer.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  });
}
