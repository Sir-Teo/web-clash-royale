import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { build } from "esbuild";
import { serviceWorkerSource } from "../../scripts/lib/service-worker.mjs";

const base = "/arena-update-test/";
let server: Server;
let origin: string;
let version = 1;
let ui: string;
test.beforeAll(async () => {
  ui = (
    await build({
      stdin: {
        contents: `export { OfflineUpdates } from './src/ui/offline-updates';`,
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      format: "esm",
      define: { "import.meta.env.BASE_URL": JSON.stringify(base) },
    })
  ).outputFiles[0].text;
  server = createServer((request, response) => {
    const path = new URL(request.url!, "http://localhost").pathname;
    response.setHeader("Cache-Control", "no-store");
    if (path === `${base}sw.js`) {
      response.setHeader("Content-Type", "text/javascript");
      response.end(
        serviceWorkerSource({
          base,
          version: `test-${version}`,
          files: [
            `${base}index.html`,
            `${base}app-${version}.js`,
            `${base}late-worker-${version}.js`,
            `${base}updates.js`,
          ],
        }),
      );
    } else if (path === base || path === `${base}index.html`) {
      response.setHeader("Content-Type", "text/html");
      response.end(
        `<html><body><main id="app"><p>Release ${version}</p><button id="play">Start battle</button><button id="leave">Return to lobby</button></main><aside class="offline-update" hidden role="status"></aside><script type="module" src="app-${version}.js"></script></body></html>`,
      );
    } else if (path === `${base}updates.js`) {
      response.setHeader("Content-Type", "text/javascript");
      response.end(ui);
    } else if (path === `${base}app-${version}.js`) {
      response.setHeader("Content-Type", "text/javascript");
      response.end(`import { OfflineUpdates } from './updates.js';
        window.appVersion = ${version};
        let busy = false;
        const updates = new OfflineUpdates(document.querySelector('aside'), () => !busy,
          updating => { document.querySelector('#app').inert = updating; });
        document.querySelector('#play').onclick = () => { busy = true; updates.update(); };
        document.querySelector('#leave').onclick = () => { busy = false; updates.update(); };
        window.updatesReady = updates.register();`);
    } else if (path === `${base}late-worker-${version}.js`) {
      response.setHeader("Content-Type", "text/javascript");
      response.end(`postMessage(${version});`);
    } else {
      response.statusCode = 404;
      response.end("Retired release asset");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
test.beforeEach(() => {
  version = 1;
});

async function open(page: Page) {
  await page.goto(`${origin}${base}`);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await expect
    .poll(() => page.evaluate(() => (window as any).appVersion))
    .toBe(1);
}
async function publish(page: Page) {
  version = 2;
  await page.evaluate(async () => {
    await (window as any).updatesReady;
    await (await navigator.serviceWorker.getRegistration())!.update();
  });
  await expect.poll(() => page.evaluate(
    async () => !!(await navigator.serviceWorker.getRegistration())?.waiting,
  )).toBe(true);
}
async function lateWorker(page: Page, release: number) {
  return page.evaluate(
    (release) =>
      new Promise((resolve, reject) => {
        const worker = new Worker(`late-worker-${release}.js`);
        worker.onmessage = (event) => {
          worker.terminate();
          resolve(event.data);
        };
        worker.onerror = () => {
          worker.terminate();
          reject(new Error("Late worker failed"));
        };
      }),
    release,
  );
}

test("keeps a running release coherent through a deploy and offline reload, then updates deliberately from the lobby", async ({
  page,
  context,
}) => {
  await open(page);
  await expect(page.getByRole("button", { name: "Update game" })).toBeHidden();
  await page.locator("#play").click();
  await page.evaluate(async () => {
    const unrelated = await caches.open("another-site-cache");
    await unrelated.put(
      "/other-site.txt",
      new Response("Keep this site's data"),
    );
  });
  await publish(page);
  await expect(page.getByRole("button", { name: "Update game" })).toBeHidden();
  await page
    .locator("aside button")
    .first()
    .evaluate((button: HTMLButtonElement) => button.click());
  expect(
    await page.evaluate(
      async () => !!(await navigator.serviceWorker.getRegistration())?.waiting,
    ),
  ).toBe(true);
  expect(await page.locator("#app").evaluate((element) => element.inert)).toBe(
    false,
  );
  expect(await lateWorker(page, 1)).toBe(1);
  await context.setOffline(true);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => (window as any).appVersion))
    .toBe(1);
  await page.getByRole("button", { name: "Update game" }).click();
  await page.waitForFunction(() => (window as any).appVersion === 2);
  expect(await lateWorker(page, 2)).toBe(2);
  await expect(page.getByRole("button", { name: "Update game" })).toBeHidden();
  expect((await page.evaluate(() => caches.keys())).sort()).toEqual(
    ["another-site-cache", `browser-royale-${base}-test-2`].sort(),
  );
});

test("keeps both tabs on their existing release until the other arena tab closes", async ({
  page,
  context,
}) => {
  await open(page);
  const other = await context.newPage();
  await open(other);
  const unrelated = await context.newPage();
  await unrelated.goto(`${origin}/another-site/`);
  await other.locator("#play").click();
  await publish(page);
  await page.getByRole("button", { name: "Update game" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Close other arena tabs, then update.",
  );
  expect(await page.locator("#app").evaluate((element) => element.inert)).toBe(
    false,
  );
  expect(await lateWorker(other, 1)).toBe(1);
  expect(await other.evaluate(() => (window as any).appVersion)).toBe(1);
  await other.close();
  await page.getByRole("button", { name: "Update game" }).click();
  await page.waitForFunction(() => (window as any).appVersion === 2);
});

test("keeps the game usable when browser privacy settings deny service-worker access", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "serviceWorker", {
      get() {
        throw new DOMException("Access denied", "SecurityError");
      },
    });
  });
  await page.goto(`${origin}${base}`);
  await page.waitForFunction(() => (window as any).appVersion === 1);
  await page.evaluate(() => (window as any).updatesReady);
  await expect(page.getByRole("button", { name: "Update game" })).toBeHidden();
  await page.locator("#play").click();
  await page.locator("#leave").click();
  expect(errors).toEqual([]);
});
