import { readFileSync } from "node:fs";

// Readiness follows the built source bundle. Asset tests independently verify
// its exact exports, source geometry and hashes.
export const expectedEffects: number = JSON.parse(
  readFileSync("public/assets/effects/manifest.json", "utf8"),
).clips;
export const expectedAnimations: number = JSON.parse(
  readFileSync("public/assets/animations/manifest.json", "utf8"),
).files.length;
export const expectedBuildings: number = JSON.parse(
  readFileSync("public/assets/buildings/manifest.json", "utf8"),
).files.length;
export const expectedHealth: number = Object.keys(JSON.parse(
  readFileSync("public/assets/ui/health/health.json", "utf8"),
).clips).length;
export const expectedHealthRoots: number = Object.keys(JSON.parse(
  readFileSync("public/assets/ui/health/health.json", "utf8"),
).clips).filter((name) => !name.endsWith("_bar")).length;
