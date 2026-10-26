// Read-only static trace; never executes the archived Android library.
// Usage: node scripts/probe-charge.mjs /absolute/path/to/1.8.1/x86/libg.so
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const input = process.argv[2];
const bytes = readFileSync(input);
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (
  sha256 !== "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746"
)
  throw new Error("Expected the pinned 1.8.1 x86 libg.so");
const hex = (value) => `0x${value.toString(16)}`;
const ranges = [
  [
    "deployTimeLoader",
    0x1d9c6d,
    0x1d9c98,
    "DeployTime string at 0x6139b6 is read as an integer into CharacterData+0x200.",
  ],
  [
    "deployDelayLoader",
    0x1dade8,
    0x1dae13,
    "DeployDelay string at 0x613c53 is read as an integer into CharacterData+0x2a8.",
  ],
  [
    "deployTimeAccessor",
    0x1dec0a,
    0x1dec1d,
    "Returns CharacterData+0x200 without adding DeployDelay.",
  ],
  [
    "spawnDeployTime",
    0x1ccc4b,
    0x1ccc5a,
    "The ordinary summoned-unit path reads the DeployTime accessor into the deployment-time local.",
  ],
  [
    "enterDeployState",
    0x215594,
    0x2155dc,
    "Entering deployment state 5 initializes the unit countdown at +0x90 to max(existing countdown, DeployTime). The helper at 0x35bd10 returns the integer maximum.",
  ],
  [
    "maximum",
    0x35bd10,
    0x35bd52,
    "Integer maximum helper used when entering deployment.",
  ],
  [
    "visualGroupDelay",
    0x1ccd63,
    0x1ccd8e,
    "For the ordinary group path, DeployDelay * body index / body count, modulo DeployTime, is passed to the +0x68 virtual hook on the unit presentation attachment at +0x18.",
  ],
  [
    "visualAttachment",
    0x88cf4,
    0x88d77,
    "The client presentation constructor installs itself at the unit attachment through 0x219478.",
  ],
  [
    "characterVisualVtable",
    0x7e60e,
    0x7e648,
    "The character presentation constructor replaces the base vtable with 0x7a9b30. Its +0x68 slot points to 0x870e0.",
  ],
  [
    "visualDelaySetter",
    0x870e0,
    0x8713d,
    "The character presentation hook checks deployment state 5 and stores the passed offset at presentation+0x530. It does not extend the unit countdown.",
  ],
  [
    "visualDelayGate",
    0x84e1a,
    0x84e3b,
    "Presentation compares elapsed deployment (0x2184ee) against presentation+0x530 before drawing its deployment animation.",
  ],
  [
    "elapsedDeployment",
    0x2184ee,
    0x21853b,
    "Returns max(DeployTime minus unit countdown at +0x90, 0).",
  ],
];
const blocks = ranges.map(([name, start, end, interpretation]) => ({
  name,
  start: hex(start),
  end: hex(end),
  interpretation,
  instructions: execFileSync(
    "objdump",
    [
      "-d",
      "-Mintel",
      `--start-address=${hex(start)}`,
      `--stop-address=${hex(end)}`,
      input,
    ],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter((line) => /^\s+[0-9a-f]+:/.test(line))
    .map((line) => line.trim().replace(/\s+<[^>]+>/g, "")),
}));
// Resolve the presentation vtable through ELF load segments, then verify its
// virtual slot independently of the disassembly interpretation.
const phOffset = bytes.readUInt32LE(28);
const phSize = bytes.readUInt16LE(42);
const phCount = bytes.readUInt16LE(44);
function nativeWord(address) {
  for (let i = 0; i < phCount; i++) {
    const entry = phOffset + i * phSize;
    const fileOffset = bytes.readUInt32LE(entry + 4);
    const virtualAddress = bytes.readUInt32LE(entry + 8);
    const fileSize = bytes.readUInt32LE(entry + 16);
    if (
      bytes.readUInt32LE(entry) === 1 &&
      address >= virtualAddress &&
      address + 4 <= virtualAddress + fileSize
    )
      return bytes.readUInt32LE(fileOffset + address - virtualAddress);
  }
  throw new Error("Address is outside the retained ELF load segments");
}
const visualHook = {
  vtable: "0x7a9b30",
  slot: "0x68",
  target: hex(nativeWord(0x7a9b30 + 0x68)),
};
if (visualHook.target !== "0x870e0")
  throw new Error("Unexpected visual delay hook");
const evidence = {
  source:
    "https://raw.githubusercontent.com/smlbiobot/cr/7fc7687e6de74690e902543ee4b59f562121e225/apk/1.8.1/com.supercell.clashroyale-1.8.1/lib/x86/libg.so",
  sha256,
  bytes: bytes.length,
  conclusion:
    "DeployTime controls combat deployment. DeployDelay supplies a per-body visual deployment offset through the presentation attachment; it is not added in full to combat deployment.",
  visualHook,
  blocks,
  limitations: [
    "Static disassembly only; the original executable was not run.",
    "Names describe inferred roles in a stripped binary. Addresses and bounded instructions are retained for inspection.",
    "These blocks establish the ordinary summoned-group path. Angular mixed formations, custom overrides, every spawn source and native animation scheduling are not fully reconstructed.",
    "Browser rules 18 correct the five direct card delays, the two hut troop delays and Night Witch Bat delays. Native visual staggering remains separate future presentation work; older origin and local replays retain their clocks.",
  ],
};
writeFileSync(
  "reference/client/deployment-native-trace.json",
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(
  `Verified ${sha256}; retained ${blocks.length} disassembly blocks.`,
);
