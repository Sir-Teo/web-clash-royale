import { readFileSync } from "node:fs";

// Readiness follows the built source bundle. Asset tests independently verify
// its exact exports, source geometry and hashes.
export const expectedEffects: number = JSON.parse(
  readFileSync("public/assets/effects/manifest.json", "utf8"),
).clips;

export const expectedCards = Object.keys(
  JSON.parse(readFileSync("public/assets/ui/cards/cards.json", "utf8"))
    .portraits,
).length;
