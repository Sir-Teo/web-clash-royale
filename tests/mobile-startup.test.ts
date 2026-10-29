import { build } from "esbuild";
import { expect, it } from "vitest";

it("keeps simulation and card statistics out of the mobile peer client graph", async () => {
  const result = await build({
    entryPoints: ["src/network/peer-client.ts"],
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform: "browser",
  });
  const modules = Object.keys(result.metafile.inputs);
  expect(modules).toContain("src/network/peer-player.ts");
  expect(modules).toContain("src/game/playable-cards.ts");
  expect(modules).not.toContain("src/network/peer-match.ts");
  expect(modules).not.toContain("src/game/engine.ts");
  expect(modules).not.toContain("src/game/cards.ts");
  expect(modules.some((name) => name.endsWith("-data.json"))).toBe(false);
});
