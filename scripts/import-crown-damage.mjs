import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { csvRows } from "./lib/csv.mjs";

const paths = [
  "reference/client/projectile-arrival-native-trace.json",
  "reference/logic/projectiles.csv",
];
const bytes = await Promise.all(paths.map((p) => readFile(p)));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const trace = JSON.parse(bytes[0]);
if (
  trace.sha256 !==
  "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746"
)
  throw new Error("Recheck native Crown arithmetic binary");
for (const input of trace.inputs)
  if (sha256(await readFile(input.path)) !== input.sha256)
    throw new Error(`Crown arithmetic input differs: ${input.path}`);
const rows = csvRows(bytes[1].toString());
const aliases = {
  fireball: "FireballSpell",
  arrows: "ArrowsSpell",
  rocket: "RocketSpell",
  lightning: "LighningSpell",
  log: "LogProjectileRolling",
};
const cards = {};
for (const [card, projectile] of Object.entries(aliases)) {
  const row = rows.find((r) => r.Name === projectile);
  const witness = trace.profiles.find((p) => p.sourceName === projectile);
  if (
    !row ||
    row.CrownTowerDamagePercent !== "-60" ||
    witness?.crownPercent !== -60
  )
    throw new Error(`Recheck Crown source ${projectile}`);
  cards[card] = { projectile, percent: Number(row.CrownTowerDamagePercent) };
}
const path = "src/game/crown-damage-data.json";
const output = Buffer.from(JSON.stringify(cards, null, 2) + "\n");
await writeFile(path, output);
await writeFile(
  "reference/client/crown-damage-manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      arithmetic:
        "ceil(nonnegative integer damage * max(0, 100 + percent) / 100)",
      nativeHelper: "0x1fb9ba..0x1fba1c",
      scope:
        "Projectile Crown arithmetic applied to the game's normalized integer card damage; native level projection and full hit side effects are outside this capture.",
      inputs: paths.map((path, i) => ({ path, sha256: sha256(bytes[i]) })),
      output: { path, sha256: sha256(output) },
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Imported projectile Crown damage percentages and native arithmetic provenance.",
);
