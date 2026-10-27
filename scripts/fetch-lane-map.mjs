import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const repository = "https://github.com/smlbiobot/cr";
const commit = "7fc7687e6de74690e902543ee4b59f562121e225";
const directory = "apk/1.8.0/com.supercell.clashroyale_1.8.0_unpack/assets/";
const files = [
  {
    path: "reference/locations/tilemap.csv",
    source: "locations/tilemap.decoded.csv",
    sha256: "b9f8d48b49b465b66d5d316b35cc13c5db73a31fb3be2aa5981fa31d7710209b",
  },
  {
    path: "reference/locations/locations.csv",
    source: "csv_logic/locations.decoded.csv",
    sha256: "8cc03a576dc9e6db75126a4d2717fa09bc6667f2ce6f84b37823e56136a37174",
  },
];
const check = process.argv.includes("--check");
if (!check) await mkdir("reference/locations", { recursive: true });
for (const file of files) {
  let bytes;
  if (check) bytes = await readFile(file.path);
  else {
    const response = await fetch(
      `https://raw.githubusercontent.com/smlbiobot/cr/${commit}/${directory}${file.source}`,
    );
    if (!response.ok)
      throw new Error(`Source download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
    throw new Error(`Archived lane source differs: ${file.path}`);
  if (!check) await writeFile(file.path, bytes);
}
const path = "reference/locations/manifest.json";
const manifest =
  JSON.stringify({ repository, commit, directory, files }, null, 2) + "\n";
if (check) {
  if ((await readFile(path, "utf8")) !== manifest)
    throw new Error("Archived lane source manifest differs");
} else await writeFile(path, manifest);
console.log("Verified two pinned arena layout and location source files.");
