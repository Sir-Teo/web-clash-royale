// Read-only companion to the retained Hopper screen-shake evidence.
// Usage: node scripts/probe-screen-shake.mjs /absolute/path/to/libg.so
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const bytes = await readFile(process.argv[2]);
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (
  sha256 !== "a7eb74c5b72770e39b8dc2c55e452fc11434f3df3efc46fd0ea13d28c1da9309"
)
  throw new Error("Expected the pinned historical 1.8.0 x86 libg.so");
const u16 = (offset) => bytes.readUInt16LE(offset);
const u32 = (offset) => bytes.readUInt32LE(offset);
const hex = (value) => `0x${value.toString(16)}`;
const cstring = (offset) =>
  bytes.toString("utf8", offset, bytes.indexOf(0, offset));
if (bytes[4] !== 1 || bytes[5] !== 1 || u16(18) !== 3)
  throw new Error("Expected ELF32 little-endian x86");
const segments = Array.from({ length: u16(44) }, (_, i) => {
  const p = u32(28) + i * u16(42);
  return {
    type: u32(p),
    offset: u32(p + 4),
    address: u32(p + 8),
    size: u32(p + 16),
  };
}).filter((s) => s.type === 1);
const fileOffset = (address) => {
  const s = segments.find(
    (s) => address >= s.address && address < s.address + s.size,
  );
  if (!s) throw new Error(`Not file-backed: ${hex(address)}`);
  return address - s.address + s.offset;
};
const virtualAddress = (offset) => {
  const s = segments.find(
    (s) => offset >= s.offset && offset < s.offset + s.size,
  );
  if (!s) throw new Error(`Not mapped: ${hex(offset)}`);
  return offset - s.offset + s.address;
};
const sections = Array.from({ length: u16(48) }, (_, i) => {
  const p = u32(32) + i * u16(46);
  return {
    nameOffset: u32(p),
    type: u32(p + 4),
    address: u32(p + 12),
    offset: u32(p + 16),
    size: u32(p + 20),
    link: u32(p + 24),
    stride: u32(p + 36),
  };
});
const names = sections[u16(50)];
for (const s of sections) s.name = cstring(names.offset + s.nameOffset);
const got = sections.find((s) => s.name === ".got.plt").address;
const code = sections.find((s) => s.name === ".text");
const fieldOffset = bytes.indexOf(Buffer.from("ShakeScreen\0"));
const fieldAddress = virtualAddress(fieldOffset);
const displacement = Buffer.alloc(4);
displacement.writeUInt32LE((fieldAddress - got) >>> 0);
const references = [];
let position = code.offset;
while (
  (position = bytes.indexOf(displacement, position)) >= 0 &&
  position < code.offset + code.size
) {
  references.push({
    displacementAddress: hex(virtualAddress(position)),
    instructionBytes: bytes
      .subarray(position - 2, position + 4)
      .toString("hex"),
  });
  position++;
}
const constants = [
  ["tableToSeconds", got - 0x1b92c0],
  ["remainingTimeToRadiusFactor", got - 0x1b9294],
  ["randomIntegerToRadians", got - 0x1b91e8],
].map(([name, address]) => ({
  name,
  address: hex(address),
  fileOffset: fileOffset(address),
  value: bytes.readFloatLE(fileOffset(address)),
}));
const scalePointer = got - 0x478;
const scaleAddress = u32(fileOffset(scalePointer));
const imports = [];
for (const s of sections.filter((s) => s.type === 9))
  for (let p = s.offset; p < s.offset + s.size; p += s.stride) {
    const address = u32(p),
      info = u32(p + 4);
    if (![got + 0x5c, got + 0x60].includes(address)) continue;
    const symbols = sections[s.link],
      strings = sections[symbols.link];
    const symbol = symbols.offset + (info >>> 8) * symbols.stride;
    imports.push({
      address: hex(address),
      name: cstring(strings.offset + u32(symbol)),
    });
  }
const evidence = {
  source:
    "https://raw.githubusercontent.com/smlbiobot/cr/7fc7687e6de74690e902543ee4b59f562121e225/apk/1.8.0/com.supercell.clashroyale_1.8.0/lib/x86/libg.so",
  sha256,
  bytes: bytes.length,
  gotBase: hex(got),
  field: {
    name: "ShakeScreen",
    address: hex(fieldAddress),
    fileOffset: fieldOffset,
    relativeReferences: references,
  },
  constants,
  scale: {
    pointerAddress: hex(scalePointer),
    pointerFileOffset: fileOffset(scalePointer),
    address: hex(scaleAddress),
    value: bytes.readFloatLE(fileOffset(scaleAddress)),
  },
  imports,
  limitations: [
    "Byte matches are candidates until confirmed by the retained Hopper disassembly.",
    "The file-backed scene factor is 12; this probe does not establish every runtime writer or display-unit conversion.",
    "No original executable was run. Frame cadence, reduced-motion policy and browser coordinate adaptation remain reconstruction choices.",
  ],
};
await writeFile(
  "reference/client/screen-shake-layout.json",
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(
  `Verified ${sha256}; ${references.length} ShakeScreen PIC reference, ${imports.length} trigonometric imports.`,
);
