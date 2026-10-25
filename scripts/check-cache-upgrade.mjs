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
  await writeFile(join(dist, "alias.txt"), "still here");
  await writeFile(join(dist, "duplicate.txt"), "still here");
  await writeFile(join(dist, "changed.txt"), "before");
  const build = () => {
    const result = spawnSync(process.execPath, [generator], {
      cwd: root,
      env: { ...process.env, VITE_BASE_PATH: "/" },
      encoding: "utf8",
    });
    if (result.status !== 0)
      throw new Error(
        result.stderr || result.stdout || "Service worker build failed",
      );
  };
  await writeFile(
    join(dist, "sw.js"),
    "const CACHE='browser-royale-/-legacy';" +
      "self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE)" +
      ".then(c=>c.addAll(['/index.html','/alias.txt','/duplicate.txt','/unchanged.txt','/changed.txt']))" +
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
  const alias = requests.get("/alias.txt") ?? 0;
  const duplicate = requests.get("/duplicate.txt") ?? 0;
  const changed = requests.get("/changed.txt") ?? 0;
  assert.equal(unchanged, 1);
  assert.equal(alias, 1);
  assert.equal(duplicate, 1);
  assert.equal(changed, 1);

  await writeFile(join(dist, "changed.txt"), "after");
  build();
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration()).update();
  });
  const waitForUpdate = async () => {
    const deadline = Date.now() + 30_000;
    while (
      !(await page.evaluate(async () =>
        Boolean((await navigator.serviceWorker.getRegistration()).waiting),
      ))
    ) {
      if (Date.now() >= deadline)
        throw new Error("Offline update did not finish installing");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  await waitForUpdate();
  await page.evaluate(async () => {
    const activated = new Promise((resolve) =>
      navigator.serviceWorker.addEventListener("controllerchange", resolve, {
        once: true,
      }),
    );
    const registration = await navigator.serviceWorker.getRegistration();
    const waiting = registration.waiting;
    if (!waiting)
      throw new Error(
        "Missing waiting worker: " +
          registration.active?.state +
          "/" +
          registration.installing?.state,
      );
    waiting.postMessage({ type: "ACTIVATE_UPDATE" });
    await activated;
    await new Promise((resolve) => {
      const worker = registration.active;
      if (worker.state === "activated") resolve();
      else
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") resolve();
        });
    });
  });
  assert.equal(requests.get("/unchanged.txt"), unchanged);
  assert.equal(requests.get("/alias.txt"), alias);
  assert.equal(requests.get("/duplicate.txt"), duplicate);
  assert.equal(requests.get("/changed.txt"), changed + 1);

  await writeFile(join(dist, "changed.txt"), "newer");
  await rm(join(dist, "alias.txt"));
  build();
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration()).update();
  });
  await waitForUpdate();
  await page.evaluate(async () => {
    const activated = new Promise((resolve) =>
      navigator.serviceWorker.addEventListener("controllerchange", resolve, {
        once: true,
      }),
    );
    const registration = await navigator.serviceWorker.getRegistration();
    const waiting = registration.waiting;
    if (!waiting)
      throw new Error(
        "Missing waiting worker: " +
          registration.active?.state +
          "/" +
          registration.installing?.state,
      );
    waiting.postMessage({ type: "ACTIVATE_UPDATE" });
    await activated;
    await new Promise((resolve) => {
      const worker = registration.active;
      if (worker.state === "activated") resolve();
      else
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") resolve();
        });
    });
  });
  assert.equal(requests.get("/unchanged.txt"), unchanged);
  assert.equal(requests.get("/duplicate.txt"), duplicate);
  assert.equal(requests.get("/changed.txt"), changed + 2);

  await context.setOffline(true);
  await page.reload();
  assert.deepEqual(
    await page.evaluate(async () => [
      await fetch("/unchanged.txt").then((response) => response.text()),
      await fetch("/duplicate.txt").then((response) => response.text()),
      await fetch("/changed.txt").then((response) => response.text()),
    ]),
    ["still here", "still here", "newer"],
  );
  const beforeCold =
    (requests.get("/duplicate.txt") ?? 0) +
    (requests.get("/unchanged.txt") ?? 0);
  const coldContext = await browser.newContext();
  const coldPage = await coldContext.newPage();
  await coldPage.goto(origin);
  await coldPage.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
  );
  const afterCold =
    (requests.get("/duplicate.txt") ?? 0) +
    (requests.get("/unchanged.txt") ?? 0);
  assert.equal(afterCold - beforeCold, 1);
  const cachedCopies = await coldPage.evaluate(async () => {
    const name = (await caches.keys()).find((key) =>
      key.startsWith("browser-royale-"),
    );
    const cache = await caches.open(name);
    return (await cache.keys()).filter((request) =>
      ["/duplicate.txt", "/unchanged.txt"].includes(
        new URL(request.url).pathname,
      ),
    ).length;
  });
  assert.equal(cachedCopies, 1);
  await coldContext.setOffline(true);
  assert.deepEqual(
    await coldPage.evaluate(async () => [
      await fetch("/duplicate.txt").then((response) => response.text()),
      await fetch("/unchanged.txt").then((response) => response.text()),
    ]),
    ["still here", "still here"],
  );
  console.log(
    "Legacy and versioned upgrades reused unchanged bytes; duplicate URLs need one download and work offline.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve) ?? resolve());
  await rm(root, { recursive: true, force: true });
}
