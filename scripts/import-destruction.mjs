import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvGroups } from "./lib/csv.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const tables = {},
  files = [];
for (const name of ["effects", "particle_emitters"]) {
  const path = `reference/client/${name}.csv`,
    bytes = await readFile(path);
  tables[name] = csvGroups(bytes.toString());
  files.push({ path, sha256: sha(bytes) });
}
const effects = {},
  emitters = {};
for (const [id, source] of Object.entries({
  tower: "TowerExplode",
  king: "King_player_die",
})) {
  const rows = tables.effects[source].filter(
    (row) => row.Type === "ParticleEmitter",
  );
  const ground = rows.find((row) => row.Layer === "Base");
  const rubble = tables.particle_emitters[ground.ParticleEmitterName][0];
  effects[id] = {
    source,
    rubble: rubble.ParticleExportName,
    components: rows
      .filter((row) => row.Layer !== "Base")
      .map((row) => ({
        emitter: row.ParticleEmitterName,
        delay: Number(row.Time) / 1000,
      })),
  };
  for (const row of rows.filter((row) => row.Layer !== "Base")) {
    const name = row.ParticleEmitterName,
      group = tables.particle_emitters[name],
      p = group[0];
    const pair = (min, max, divisor = 1) => [
      Number(p[min]) / divisor,
      Number(p[max]) / divisor,
    ];
    emitters[name] = {
      count: Number(p.ParticleCount),
      emissionLife: pair("MinLife", "MaxLife", 1000),
      interval: pair("ParticleMinInterval", "ParticleMaxInterval", 1000),
      life: pair("ParticleMinLife", "ParticleMaxLife", 1000),
      angle: pair("ParticleMinAngle", "ParticleMaxAngle", 180 / Math.PI),
      radius: pair("ParticleMinRadius", "ParticleMaxRadius", 30),
      speed: pair("ParticleMinSpeed", "ParticleMaxSpeed", 30),
      height: Number(p.ParticleStartZ) / 30,
      verticalSpeed: pair("ParticleMinVelocityZ", "ParticleMaxVelocityZ", 30),
      gravity: Number(p.ParticleGravity) / 30,
      startScale: p.StartScale ? Number(p.StartScale) / 100 : 1,
      endScale: p.EndScale ? Number(p.EndScale) / 100 : 1,
      fadeIn: Number(p.FadeInDuration) / 1000,
      fadeOut: Number(p.FadeOutDuration) / 1000,
      inertia: Number(p.Inertia) / 100,
      rotate: p.RotateToDirection.toLowerCase() === "true",
      loop: p.LoopParticleClip.toLowerCase() === "true",
      clips: group
        .filter((p) => p.ParticleResource === "sc/effects.sc")
        .map((p) => p.ParticleExportName),
    };
  }
}
const path = "src/render/destruction-data.json",
  bytes = JSON.stringify({ effects, emitters }, null, 2) + "\n";
await writeFile(path, bytes);
await writeFile(
  "reference/client/manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      directory:
        "apk/1.8.0/com.supercell.clashroyale_1.8.0_unpack/assets/csv_client/",
      files,
      output: { path, sha256: sha(bytes) },
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Imported ${Object.keys(emitters).length} tower destruction emitters.`,
);
