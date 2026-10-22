import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
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
    command: process.env.ARENA_PRODUCTION
      ? "PORT=5188 npm start"
      : "npm run dev -- --host 127.0.0.1 --port 5188 --strictPort",
    url: "http://127.0.0.1:5188",
    reuseExistingServer: false,
  },
});
