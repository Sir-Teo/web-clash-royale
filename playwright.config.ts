import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  testIgnore:
    process.env.VITE_LEGACY_ROOMS === "1"
      ? ["**/peer.spec.ts"]
      : [
          "**/multiplayer.spec.ts",
          "**/startup.spec.ts",
          "**/connection.spec.ts",
        ],
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: "http://127.0.0.1:5188",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      args: [
        "--enable-webgl",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    {
      name: "mobile",
      use: {
        ...devices["iPhone 13"],
        deviceScaleFactor: 1,
        defaultBrowserType: "chromium",
      },
    },
    {
      name: "mobile-safari",
      use: {
        ...devices["iPhone 13"],
        browserName: "webkit",
        deviceScaleFactor: 1,
        launchOptions: { args: [] },
      },
    },
  ],
  webServer: {
    stdout: process.env.ARENA_NETWORK_TRACE === "1" ? "pipe" : "ignore",
    command: process.env.ARENA_PRODUCTION
      ? process.env.VITE_LEGACY_ROOMS === "1"
        ? "PORT=5188 npm run start:legacy"
        : "npm start -- --host 127.0.0.1 --port 5188 --strictPort"
      : "npm run dev -- --host 127.0.0.1 --port 5188 --strictPort",
    url: "http://127.0.0.1:5188",
    reuseExistingServer: false,
  },
});
