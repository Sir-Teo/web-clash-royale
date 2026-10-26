"""Verify pinned native formation math in a bounded x86 emulator.

Requires unicorn==2.1.4 only for regeneration; ordinary tests use the fixture.
The Android app/library is never loaded into the host process. Only bounded
geometry/trig and optional mixed-group fragments run; globals/assertions are hooks.
Usage: python scripts/probe-formation.py /path/to/1.8.1/x86/libg.so [--check]
Add --mixed to capture Goblin Gang geometry and its native character selector.
"""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import re
import struct
import subprocess
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE, UC_HOOK_INTR, UC_PROT_READ, UC_PROT_EXEC
from unicorn.x86_const import (
    UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EDX,
    UC_X86_REG_ESI, UC_X86_REG_EDI, UC_X86_REG_EBP, UC_X86_REG_ESP,
    UC_X86_REG_EFLAGS, UC_X86_REG_EIP,
)

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("library", type=Path)
parser.add_argument("--check", action="store_true")
parser.add_argument("--mixed", action="store_true")
args = parser.parse_args()
if importlib.metadata.version("unicorn") != "2.1.4":
    raise RuntimeError("Regeneration requires pinned unicorn==2.1.4")
binary = args.library.read_bytes()
sha256 = hashlib.sha256(binary).hexdigest()
if sha256 != "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746":
    raise RuntimeError("Expected the pinned 1.8.1 x86 libg.so")
ph_offset = struct.unpack_from("<I", binary, 28)[0]
ph_size, ph_count = struct.unpack_from("<HH", binary, 42)
segments = [struct.unpack_from("<8I", binary, ph_offset + i * ph_size)
            for i in range(ph_count)]

def word(address):
    for kind, offset, virtual, _, file_size, _, _, _ in segments:
        if kind == 1 and virtual <= address and address + 4 <= virtual + file_size:
            return struct.unpack_from("<i", binary, offset + address - virtual)[0]
    raise RuntimeError("Native address outside retained ELF load segments")

memory_size = max(v + ms for kind, _, v, _, _, ms, _, _ in segments if kind == 1)
memory_size = (memory_size + 4095) & ~4095
cpu = Uc(UC_ARCH_X86, UC_MODE_32)
cpu.mem_map(0, memory_size)
for kind, offset, virtual, _, file_size, _, _, _ in segments:
    if kind == 1:
        cpu.mem_write(virtual, binary[offset:offset + file_size])
cpu.mem_protect(0, memory_size, UC_PROT_READ | UC_PROT_EXEC)
globals_address, stack_address, stop_address = 0x1000000, 0x2000000, 0x3000000
cpu.mem_map(globals_address, 4096)
cpu.mem_write(globals_address + 0x2c4, b"\1")
cpu.mem_map(stack_address, 0x100000)
cpu.mem_map(stop_address, 4096)

def return_from_hook(value=None):
    stack = cpu.reg_read(UC_X86_REG_ESP)
    target = struct.unpack("<I", cpu.mem_read(stack, 4))[0]
    if value is not None:
        cpu.reg_write(UC_X86_REG_EAX, value)
    cpu.reg_write(UC_X86_REG_ESP, stack + 4)
    cpu.reg_write(UC_X86_REG_EIP, target)

def instruction_hook(_cpu, address, _size, _data):
    if address == 0x1e6cee:
        return_from_hook(globals_address)
    elif address == 0x356eb0:
        stack = cpu.reg_read(UC_X86_REG_ESP)
        condition = struct.unpack("<I", cpu.mem_read(stack + 4, 4))[0]
        if not condition:
            raise RuntimeError("Native formation assertion failed")
        return_from_hook()
    elif not (0x1cce2e <= address < 0x1cd028 or 0x35bec0 <= address < 0x35c117 or
              (args.mixed and (0x1cca1b <= address < 0x1cca20 or
                               0x1cca6a <= address < 0x1cca74 or
                               0x1ccb4d <= address < 0x1ccb79 or
                               0x35be60 <= address < 0x35beb3))):
        raise RuntimeError(f"Native instruction escaped geometry/trig ranges: {address:#x}")

def interrupt_hook(_cpu, interrupt, _data):
    raise RuntimeError(f"Unexpected emulated interrupt: {interrupt}")

cpu.hook_add(UC_HOOK_CODE, instruction_hook)
cpu.hook_add(UC_HOOK_INTR, interrupt_hook)
registers = [UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EDX,
             UC_X86_REG_ESI, UC_X86_REG_EDI, UC_X86_REG_EBP]

def native_point(index, count, radius, angle, flip_y, lane):
    stack, output = stack_address + 0xf0000, stack_address + 0x1000
    for register in registers:
        cpu.reg_write(register, 0)
    cpu.reg_write(UC_X86_REG_EFLAGS, 2)
    cpu.reg_write(UC_X86_REG_ESP, stack)
    cpu.mem_write(stack - 0x1000, b"\0" * 0x2000)
    cpu.mem_write(stack, struct.pack("<8I", stop_address, index, count, radius,
                                  int(flip_y), lane, angle, output))
    cpu.mem_write(output, b"\0" * 8)
    cpu.emu_start(0x1cce2e, stop_address, count=20000)
    if cpu.reg_read(UC_X86_REG_EIP) != stop_address:
        raise RuntimeError("Native fragment exceeded the instruction budget")
    return list(struct.unpack("<2i", cpu.mem_read(output, 8)))

if args.mixed:
    import csv
    import io
    import sys

    input_paths = ["reference/logic/spells_characters.csv", "reference/logic/characters.csv",
                   "reference/client/formation-native-trace.json"]
    inputs = [{"path": path, "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest()}
              for path in input_paths]
    spells, characters = [[*csv.DictReader(io.StringIO(Path(path).read_text()))]
                          for path in input_paths[:2]]
    card = next(row for row in spells if row["Name"] == "GoblinGang")
    primary = next(row for row in characters if row["Name"] == card["SummonCharacter"])
    secondary = next(row for row in characters if row["Name"] == card["SummonCharacterSecond"])
    count = int(card["SummonNumber"])
    radius = int(card["SummonRadius"] or primary["SpawnRadius"] or primary["CollisionRadius"])
    angle = int(primary["SpawnAngleShift"] or 0)
    if (primary["Name"], secondary["Name"], count, radius, angle) != ("Goblin", "SpearGoblin", 6, 700, 0):
        raise RuntimeError("Recheck the source Goblin Gang profile")

    def setup_mixed():
        sp, bp = stack_address + 0xf0000, stack_address + 0xf8000
        for register in registers:
            cpu.reg_write(register, 0)
        cpu.reg_write(UC_X86_REG_EFLAGS, 2)
        cpu.reg_write(UC_X86_REG_ESP, sp)
        cpu.reg_write(UC_X86_REG_EBP, bp)
        cpu.mem_write(sp - 0x1000, b"\0" * 0x2000)
        cpu.mem_write(bp, b"\0" * 0x100)
        return sp, bp

    def fragment(start, end):
        cpu.emu_start(start, end, count=1000)
        if cpu.reg_read(UC_X86_REG_EIP) != end:
            raise RuntimeError("Native mixed fragment exceeded the instruction budget")

    def native_flip(owner):
        sp, _ = setup_mixed()
        cpu.mem_write(sp + 0x48, struct.pack("<i", owner))
        fragment(0x1cca1b, 0x1cca20)
        fragment(0x1cca6a, 0x1cca74)
        return bool(cpu.mem_read(sp + 0x50, 1)[0])

    def native_character(y, owner, has_secondary=True):
        sp, bp = setup_mixed()
        primary_pointer, secondary_pointer = globals_address + 0x100, globals_address + 0x200
        cpu.reg_write(UC_X86_REG_ESI, owner)
        cpu.mem_write(bp + 0xc, struct.pack("<I", primary_pointer))
        cpu.mem_write(bp + 0x38, struct.pack("<I", secondary_pointer if has_secondary else 0))
        cpu.mem_write(sp + 0x84, struct.pack("<i", y))
        fragment(0x1ccb4d, 0x1ccb79)
        selected = cpu.reg_read(UC_X86_REG_ESI)
        if selected not in [primary_pointer, secondary_pointer]:
            raise RuntimeError("Unexpected native mixed character pointer")
        return primary["Name"] if selected == primary_pointer else secondary["Name"]

    mixed_cases = []
    for owner in range(4):
        for lane in [0, 1]:
            flip_y = native_flip(owner)
            points = []
            for index in range(count):
                x, y = native_point(index, count, radius, angle, flip_y, lane)
                points.append({"index": index, "x": x, "y": y,
                               "character": native_character(y, owner)})
            mixed_cases.append({"ownerIndex": owner, "lane": lane, "flipY": flip_y,
                                "points": points})
    sign_cases = [{"ownerIndex": owner, "y": y, "hasSecondary": has_secondary,
                   "character": native_character(y, owner, has_secondary)}
                  for owner in range(4) for y in [-1, 0, 1] for has_secondary in [False, True]]
    mixed_ranges = [
        ("secondaryCharacterLoader", 0x200cbe, 0x200cf2,
         "SummonCharacterSecond at 0x61a160 resolves to SpellData+0x28."),
        ("secondaryCharacterAccessor", 0x2027e4, 0x2027f4,
         "Returns the secondary character pointer at SpellData+0x28."),
        ("secondaryCharacterCall", 0x220e49, 0x220e55,
         "The card summon path retains the secondary pointer at stack+0x64."),
        ("summonGroupCall", 0x220e89, 0x220efd,
         "Passes the secondary pointer at argument stack+0x30, read by the group at EBP+0x38."),
        ("ownerParity", 0x1cca1b, 0x1cca20,
         "Masks the previously found owner index to its low bit."),
        ("formationFlip", 0x1cca6a, 0x1cca74,
         "Even owner indices select the geometry Y reflection."),
        ("formationCall", 0x1cca9b, 0x1ccadb,
         "The primary character angle, group count, selected radius, reflection and lane enter the existing geometry helper."),
        ("mixedCharacter", 0x1ccb4d, 0x1ccb79,
         "A secondary pointer selects by the sign of the original formation Y offset and owner parity, before child allocation."),
        ("sign", 0x35be60, 0x35beb3,
         "Returns -1, 0 or 1. A zero offset keeps the primary character."),
    ]
    mixed_blocks = []
    for name, start, end, interpretation in mixed_ranges:
        assembly = subprocess.check_output(["objdump", "-d", "-Mintel",
                      f"--start-address={start:#x}", f"--stop-address={end:#x}", str(args.library)], text=True)
        instructions = [re.sub(r"\s+<[^>]+>", "", line.strip())
                        for line in assembly.splitlines() if re.match(r"\s+[0-9a-f]+:", line)]
        mixed_blocks.append({"name": name, "start": hex(start), "end": hex(end),
                             "interpretation": interpretation, "instructions": instructions})
    source = "https://raw.githubusercontent.com/smlbiobot/cr/7fc7687e6de74690e902543ee4b59f562121e225/apk/1.8.1/com.supercell.clashroyale-1.8.1/lib/x86/libg.so"
    trace = {"source": source, "sha256": sha256, "inputs": inputs,
             "profile": {"card": card["Name"], "primary": primary["Name"], "secondary": secondary["Name"],
                         "count": count, "radius": radius, "angleShift": angle},
             "blocks": mixed_blocks,
             "emulation": {"engine": "unicorn", "version": "2.1.4", "geometryBudget": 20000,
                           "selectorBudget": 1000, "hooks": ["controlled globals", "require a successful geometry assertion"],
                           "memory": "ELF segments are read/execute only. Fake globals and stack are isolated writable pages. Only geometry/trig and the explicit parity/selector ranges execute; all interrupts fail."},
             "limits": ["The Android app is not launched and its library is not loaded into the host process.",
                        "Owner-list lookup and lane lookup are controlled inputs. Native parity, integer offsets and character-pointer selection execute from the source binary.",
                        "Child allocation, collision adjustment, edge snapping, deployment visibility and visual-delay timing are not executed."]}
    fixture = {"source": source, "sha256": sha256, "emulator": "unicorn 2.1.4",
               "cases": mixed_cases, "signCases": sign_cases}
    for path, value in [(Path("reference/client/mixed-formation-native-trace.json"), trace),
                        (Path("tests/fixtures/native-mixed-formation-golden.json"), fixture)]:
        output = json.dumps(value, indent=2) + "\n"
        if args.check:
            if path.read_text() != output:
                raise RuntimeError(f"Native mixed artifact differs: {path}")
        else:
            path.write_text(output)
    print(json.dumps({"cases": len(mixed_cases), "points": sum(len(c["points"]) for c in mixed_cases),
                      "signCases": len(sign_cases), "blocks": len(mixed_blocks), "sha256": sha256}))
    sys.exit(0)

configurations = [(1, 500, 0), (2, 500, 0), (2, 700, 0), (3, 500, 0),
                  (3, 650, 0), (3, 800, 0), (4, 500, 0), (5, 750, 45),
                  (6, 500, 0), (7, 500, 0), (8, 500, 0), (15, 500, 0)]
cases = []
for count, radius, angle in configurations:
    for flip_y in [False, True]:
        for lane in [0, 1]:
            cases.append({"count": count, "radius": radius, "angleShift": angle,
                          "flipY": flip_y, "lane": lane,
                          "points": [native_point(i, count, radius, angle, flip_y, lane)
                                     for i in range(count)]})

ranges = [
    ("summonRadiusLoader", 0x200cfa, 0x200d22,
     "SummonRadius string at 0x61a176 is read into SpellData+0x50."),
    ("summonRadiusAccessor", 0x202804, 0x202814,
     "Returns SpellData+0x50, the explicit card summon-radius override."),
    ("summonRadiusCall", 0x220e7d, 0x220e89,
     "The card summon path reads the radius override and stores it at argument stack+0x34."),
    ("summonGroupCall", 0x220e89, 0x220efd,
     "The group helper receives that override at its +0x3c parameter alongside count, secondary character and spawn data."),
    ("collisionColumn", 0x1dcccc, 0x1dccfa,
     "CollisionRadius resolves to the cached column at GOT+0x1894."),
    ("collisionLoader", 0x1d9207, 0x1d921f,
     "The collision radius integer is stored at CharacterData+0x22c."),
    ("collisionAccessor", 0x1de3f0, 0x1de404,
     "Returns CharacterData+0x22c."),
    ("spawnRadiusLoader", 0x1d8eb4, 0x1d8edf,
     "SpawnRadius is stored at CharacterData+0xc4."),
    ("spawnRadiusAccessor", 0x1de8ba, 0x1de8ce,
     "Returns CharacterData+0xc4."),
    ("angleLoader", 0x1da925, 0x1da950,
     "SpawnAngleShift is stored at CharacterData+0x160."),
    ("radiusSelection", 0x1cca3d, 0x1cca6a,
     "An explicit summon-radius override wins; otherwise SpawnRadius, when positive, replaces CollisionRadius."),
    ("formationArguments", 0x1cca9b, 0x1ccadb,
     "The group count, selected radius, orientation flags and character angle shift are passed to the geometry helper."),
    ("formationGeometry", 0x1cce2e, 0x1cd028,
     "Count-specific layouts, fixed-point radius expansion, integer angles and axis reflections."),
    ("sineScale", 0x35bf80, 0x35bfc5,
     "Integer sine lookup times radius, divided by 1024 with truncation toward zero."),
    ("sineLookup", 0x35bfd0, 0x35c08b,
     "Normalized degree angles reflect through the 91-entry sine table at 0x642208."),
    ("cosineScale", 0x35c090, 0x35c117,
     "Cosine uses the same sine lookup with a 90-degree phase shift."),
    ("laneSequenceFlag", 0x1f1d2d, 0x1f1d60,
     "LOGIC_LANE_ID_BASED_DEPLOY_SEQUENCE is read into Globals+0x2c4."),
]
blocks = []
for name, start, end, interpretation in ranges:
    assembly = subprocess.check_output(["objdump", "-d", "-Mintel",
                  f"--start-address={start:#x}", f"--stop-address={end:#x}",
                  str(args.library)], text=True)
    instructions = [re.sub(r"\s+<[^>]+>", "", line.strip())
                    for line in assembly.splitlines() if re.match(r"\s+[0-9a-f]+:", line)]
    blocks.append({"name": name, "start": hex(start), "end": hex(end),
                   "interpretation": interpretation, "instructions": instructions})
source = "https://raw.githubusercontent.com/smlbiobot/cr/7fc7687e6de74690e902543ee4b59f562121e225/apk/1.8.1/com.supercell.clashroyale-1.8.1/lib/x86/libg.so"
trace = {"source": source, "sha256": sha256, "bytes": len(binary),
         "sineTable": [word(0x642208 + i * 4) for i in range(91)],
         "countBranches": [hex(0x7b8a14 + word(0x63d594 + i * 4)) for i in range(7)],
         "blocks": blocks,
         "emulation": {"engine": "unicorn", "version": "2.1.4", "entry": "0x1cce2e",
                       "instructionBudget": 20000,
                       "hooks": ["0x1e6cee: controlled globals pointer with lane sequence enabled",
                                 "0x356eb0: require a successful assertion and return"],
                       "memory": "Original ELF segments are read/execute only; fake globals and stack are isolated writable pages. Instructions outside geometry/trig ranges and all interrupts fail."},
         "limits": ["The Android app is not launched and the library is not loaded into the host process. Only the bounded geometry fragment and its integer trig helpers are emulated.",
                    "Native pathfinding, lane lookup, summon sequencing, edge snapping and creation-time collision resolution are outside this probe.",
                    "Large counts can return overlapping centers. Browser adoption initially excludes groups above six and mixed Goblin Gang."]}
fixture = {"source": source, "sha256": sha256, "emulator": "unicorn 2.1.4",
           "laneSequenceEnabled": True, "cases": cases}
outputs = [(Path("reference/client/formation-native-trace.json"), trace),
           (Path("tests/fixtures/native-formation-golden.json"), fixture)]
for path, value in outputs:
    text = json.dumps(value, indent=2) + "\n"
    if args.check:
        if path.read_text() != text:
            raise RuntimeError(f"Native formation artifact differs: {path}")
    else:
        path.write_text(text)
print(json.dumps({"cases": len(cases), "points": sum(len(c["points"]) for c in cases),
                  "blocks": len(blocks), "sha256": sha256}))
