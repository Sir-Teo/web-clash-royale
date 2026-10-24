import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import base from "../../playwright.config";
const root = resolve(import.meta.dirname, "../..");
export default defineConfig({
  ...base,
  testDir: import.meta.dirname,
  testMatch: "native-peer.spec.ts",
  outputDir: resolve(root, "test-results/native-rtc"),
  webServer: { ...base.webServer, cwd: root },
});
