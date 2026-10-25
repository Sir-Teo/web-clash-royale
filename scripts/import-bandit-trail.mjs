import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvGroups } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = ["reference/client/particle_emitters.csv", "reference/sc/chr_bandit.bin"];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const groups = csvGroups(inputs[0].toString());
const model = parseSC(inputs[1]);
const blue = groups.assassin_dashing;
const red = groups.assassin_dashing_red;
for (const [rows, prefix] of [[blue, "bandit_dash1_"], [red, "bandit_red_dash1_"]]) {
  const head = rows?.[0];
  if (rows?.length !== 9 || head?.ParticleCount !== "8" ||
      head.ParticleMinInterval !== "25" || head.ParticleMaxInterval !== "25" ||
      head.ParticleMinLife !== "300" || head.ParticleMaxLife !== "400" ||
      head.ParticleResource !== "sc/chr_bandit.sc" ||
      head.FadeOutDuration !== "500" || head.ResourceFromAngle !== "true" ||
      rows.some((row, index) => row.ParticleExportName !== `${prefix}${index + 1}` ||
        !model.names[row.ParticleExportName]))
    throw new Error("Recheck archived Bandit directional dash afterimages");
}
if (blue[0].EnemyVersion !== "assassin_dashing_red")
  throw new Error("Recheck archived Bandit red trail binding");
const outputPath = "src/render/bandit-trail-data.json";
const output = Buffer.from(JSON.stringify({
  source: "assassin_dashing",
  count: Number(blue[0].ParticleCount),
  interval: Number(blue[0].ParticleMinInterval) / 1000,
  life: [Number(blue[0].ParticleMinLife) / 1000,
    Number(blue[0].ParticleMaxLife) / 1000],
  fadeOut: Number(blue[0].FadeOutDuration) / 1000,
  blueExports: blue.map((row) => row.ParticleExportName),
  redExports: red.map((row) => row.ParticleExportName),
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/bandit-trail-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported eight directional Bandit afterimages per dash.");
