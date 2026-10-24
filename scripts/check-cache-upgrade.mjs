import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = await mkdtemp(join(tmpdir(), "arena-cache-upgrade-"));
const dist = join(root, "dist");
const generator = fileURLToPath(new URL("./build-sw.mjs", import.meta.url));
const requests = new Map();
let browser;
let server;
try {
  await mkdir(dist);
  await writeFile(
    join(dist, "index.html"),
    '<!doctype html><title>Offline test</title><script>navigator.serviceWorker.register("/sw.js")</script>',
  );
  await writeFile(join(dist, "unchanged.txt"), "still here");
  await writeFile(join(dist, "changed.txt"), "before");
  const build = () => {
    const result = spawnSync(process.execPath, [generator], {
      cwd: root,
      env: { ...process.env, VITE_BASE_PATH: "/" },
      encoding: "utf8",
    });
    if (result.status !== 0)
      throw new Error(result.stderr || result.stdout || "Service worker build failed");
  };
  await writeFile(
    join(dist, "sw.js"),
    "const CACHE='browser-royale-/-legacy';" +
      "self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE)" +
      ".then(c=>c.addAll(['/index.html','/unchanged.txt','/changed.txt']))" +
      ".then(()=>self.skipWaiting())));" +
      "self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));",
  );
  server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    requests.set(path, (requests.get(path) ?? 0) + 1);
    try {
      const bytes = await readFile(join(dist, path.slice(1) || "index.html"));
      response.writeHead(200, {
        "content-type": path.endsWith(".js")
          ? "text/javascript"
          : path.endsWith(".html") || path === "/"
            ? "text/html"
            : "text/plain",
        "cache-control": "no-store",
      });
      response.end(bytes);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const unchanged = requests.get("/unchanged.txt") ?? 0;
  const changed = requests.get("/changed.txt") ?? 0;
  assert.equal(unchanged, 1);
  assert.equal(changed, 1);

  await writeFile(join(dist, "changed.txt"), "after");
  build();
  await page.evaluate(async () => {
    const activated = new Promise((resolve) =>
      navigator.serviceWorker.addEventListener("controllerchange", resolve, {
        once: true,
      }),
    );
    await (await navigator.serviceWorker.getRegistration()).update();
    await activated;
  });
  assert.equal(requests.get("/unchanged.txt"), unchanged);
  assert.equal(requests.get("/changed.txt"), changed + 1);

  await writeFile(join(dist, "changed.txt"), "newer");
  build();
  await page.evaluate(async () => {
    const activated = new Promise((resolve) =>
      navigator.serviceWorker.addEventListener("controllerchange", resolve, {
        once: true,
      }),
    );
    await (await navigator.serviceWorker.getRegistration()).update();
    await activated;
  });
  assert.equal(requests.get("/unchanged.txt"), unchanged);
  assert.equal(requests.get("/changed.txt"), changed + 2);

  await context.setOffline(true);
  await page.reload();
  assert.deepEqual(
    await page.evaluate(async () => [
      await fetch("/unchanged.txt").then((response) => response.text()),
      await fetch("/changed.txt").then((response) => response.text()),
    ]),
    ["still here", "newer"],
  );
  console.log("Legacy and versioned upgrades fetched only the changed asset; both assets work offline.");
} finally {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve) ?? resolve());
  await rm(root, { recursive: true, force: true });
}
