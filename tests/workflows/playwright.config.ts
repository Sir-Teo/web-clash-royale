import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import base from "../../playwright.config";

const root = fileURLToPath(new URL("../../", import.meta.url));
// defineConfig concatenates server lists; supply the inherited launcher once.
const { webServer, ...common } = base;

export default defineConfig(common, {
  testDir: fileURLToPath(new URL("../browser", import.meta.url)),
  outputDir: fileURLToPath(new URL("../../test-results", import.meta.url)),
  // Include future practice and shared-replay journeys without editing CI lists.
  testMatch: [
    "**/practice-*.spec.ts",
    "**/recorded-practice.spec.ts",
    "**/shared-replay*.spec.ts",
    "**/replay-side.spec.ts",
    "**/replay-cards.spec.ts",
    "**/paused-deck.spec.ts",
    "**/help.spec.ts",
    "**/settings-controls.spec.ts",
    "**/mobile-loading.spec.ts",
    "**/mirror-placement.spec.ts",
  ],
  webServer: Array.isArray(webServer)
    ? webServer.map((server) => ({ ...server, cwd: root }))
    : webServer
      ? { ...webServer, cwd: root }
      : undefined,
});
