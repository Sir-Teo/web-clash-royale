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
    "chargeColumn",
    0x1dbada,
    0x1dbb24,
    "ChargeRange string at 0x613fb7 (GOT 0x7b8a14 minus 0x1a4a5d); its column index is stored at GOT+0x17c8.",
  ],
  [
    "chargeLoader",
    0x1d99d8,
    0x1d99f0,
    "The cached column is read as an integer and stored at CharacterData+0x1ac.",
  ],
  [
    "chargeAccessor",
    0x1ddfa2,
    0x1ddfb5,
    "The accessor returns the unscaled ChargeRange integer.",
  ],
  [
    "speedLoader",
    0x1d9714,
    0x1d973f,
    "ChargeSpeedMultiplier string at 0x613918 (GOT minus 0x1a50fc) is read as an integer and stored at CharacterData+0x1b0.",
  ],
  [
    "chargeSpeed",
    0x263466,
    0x2634df,
    "Movement budget is multiplied by CharacterData+0x1b0 (ChargeSpeedMultiplier), divided by 100, once charge progress reaches 10000.",
  ],
  [
    "movementDistance",
    0x2634df,
    0x263552,
    "Target coordinates and actor position (getters 0x219af6/0x219b06) form a vector. 0x35d670 measures its distance; the movement spend is bounded by that distance.",
  ],
  [
    "unspentMovement",
    0x26365c,
    0x263735,
    "The direction is scaled by the movement spend. Remaining movement is max(budget minus spend, 0), stored at stack+0x30.",
  ],
  [
    "chargeProgress",
    0x2638ea,
    0x2639bb,
    "Spent movement (stack+0x2c minus stack+0x30), divided by 10 with integer truncation, increases progress by spent/10*10000/ChargeRange. Stalled movement below 10 resets progress; a blocking status or non-walking state also resets it.",
  ],
  [
    "coordinateGetters",
    0x219af6,
    0x219b36,
    "The position getters return the two adjacent actor coordinate fields and their vector address.",
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
const evidence = {
  source:
    "https://raw.githubusercontent.com/smlbiobot/cr/7fc7687e6de74690e902543ee4b59f562121e225/apk/1.8.1/com.supercell.clashroyale-1.8.1/lib/x86/libg.so",
  sha256,
  bytes: bytes.length,
  conclusion:
    "ChargeRange measures voluntary movement distance, not elapsed movement time. ChargeSpeedMultiplier is a percent.",
  reconstruction:
    "With 1000 world units per tile, ChargeRange 250 becomes 2.5 tiles and 300 becomes 3 tiles. Prince, Dark Prince and Battle Ram use a 200 percent charge speed. Browser rules 17 accumulate their own movement distance and exclude separation, knockback and Tornado displacement.",
  blocks,
  limitations: [
    "Static disassembly only; the original executable was not run.",
    "Names describe inferred roles in a stripped binary; addresses, bytes and the accessor dataflow are retained for inspection.",
    "The browser retains its fixed 30 Hz float movement, bridge routing, status rules and collision resolution. It does not reproduce native integer truncation, movement substeps or every charge-reset condition.",
    "Earlier origin rules 1–16 and local rules 1–5 retain their existing timer-based charge behavior.",
  ],
};
writeFileSync(
  "reference/client/charge-native-trace.json",
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(
  `Verified ${sha256}; retained ${blocks.length} disassembly blocks.`,
);
