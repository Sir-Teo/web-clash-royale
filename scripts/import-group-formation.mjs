import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const paths = [
  "reference/client/group-formation-native-trace.json",
  "src/game/formation-data.json",
  "src/game/goblin-gang-data.json",
  "src/game/distant-target-data.json",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const [capture, historical, gang, coordinates] = bytes.map((value) =>
  JSON.parse(value),
);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
if (
  capture.sha256 !==
  "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746"
)
  throw new Error("Recheck native group formation binary");
for (const input of capture.inputs)
  if (sha256(await readFile(input.path)) !== input.sha256)
    throw new Error(`Native group input differs: ${input.path}`);
if (
  capture.profiles.length !== 14 ||
  capture.cases.length !== 76 ||
  capture.controls.length !== 68 ||
  coordinates.sourceUnitsPerTile !== 1000
)
  throw new Error("Recheck native group source inventory/scale");
const cards = {};
for (const profile of capture.profiles) {
  if (profile.card === "skeleton-army") continue;
  const previous =
    profile.card === "goblin-gang"
      ? { count: gang.count, ...gang.formation }
      : historical.cards[profile.card];
  if (
    !previous ||
    ["count", "radius", "angleShift"].some(
      (key) => previous[key] !== profile[key],
    )
  )
    throw new Error(
      `Group profile differs from retained math: ${profile.card}`,
    );
  const rows = capture.cases.filter((row) => row.card === profile.card);
  if (
    rows.length < 4 ||
    ![0, 1].every((owner) =>
      [3500, 14500].every((x) =>
        rows.some(
          (row) =>
            row.section === "Map" &&
            row.ownerIndex === owner &&
            row.center.x === x,
        ),
      ),
    )
  )
    throw new Error(`Missing canonical group cases: ${profile.card}`);
  for (const row of rows) {
    if (
      row.children.length !== profile.count ||
      row.formationArguments.length !== profile.count ||
      !row.returnsFirstChild
    )
      throw new Error("Native group loop differs");
    for (const [index, args] of row.formationArguments.entries())
      if (
        JSON.stringify(args) !==
        JSON.stringify([
          index,
          profile.count,
          profile.radius,
          Number(row.ownerIndex % 2 === 0),
          row.center.x < 9000 ? 1 : 2,
          profile.angleShift,
        ])
      )
        throw new Error("Native group geometry argument differs");
    if (profile.card === "goblin-gang") {
      const secondary = row.children
        .filter((child) => child.character === profile.secondary)
        .map((child) => child.index);
      if (
        JSON.stringify(secondary) !==
        JSON.stringify(gang.formation.secondaryIndices)
      )
        throw new Error("Native mixed character order differs");
    }
  }
  cards[profile.card] = {
    count: profile.count,
    radius: profile.radius,
    angleShift: profile.angleShift,
  };
}
if (Object.keys(cards).length !== 13)
  throw new Error("Recheck adopted group profiles");
const outputPath = "src/game/group-formation-data.json";
const output = Buffer.from(
  JSON.stringify(
    { sourceUnitsPerTile: coordinates.sourceUnitsPerTile, cards },
    null,
    2,
  ) + "\n",
);
await writeFile(outputPath, output);
await writeFile(
  "reference/client/group-formation-manifest.json",
  JSON.stringify(
    {
      source: capture.source,
      nativeSha256: capture.sha256,
      inputs: paths.map((path, index) => ({
        path,
        sha256: sha256(bytes[index]),
      })),
      output: { path: outputPath, sha256: sha256(output) },
      scope:
        "Two-account ordinary group factory requests with native physical lanes and owner reflection",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Imported ${Object.keys(cards).length} native physical group profiles.`,
);
