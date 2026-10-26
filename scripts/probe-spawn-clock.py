"""Bounded native 1.8.1 summoner clock capture, without loading the Android app.
Requires unicorn==2.1.4 for regeneration only. Real spawn allocation and String
bookkeeping are intercepted; countdown, indexing, getters and empty-buff rate
arithmetic execute from the pinned x86 library. A separate deployment guard
also runs, with its state callback intercepted. Complete state transitions,
control eligibility, child positions and lifetimes remain outside the contract.
"""
import argparse
import csv
import io
import hashlib
import importlib.metadata
import json
from pathlib import Path
import re
import struct
import subprocess
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE, UC_HOOK_INTR, UC_PROT_READ, UC_PROT_EXEC
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EDX, UC_X86_REG_ESI, UC_X86_REG_EDI, UC_X86_REG_EBP, UC_X86_REG_ESP, UC_X86_REG_EIP, UC_X86_REG_EFLAGS

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("library", type=Path)
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
if importlib.metadata.version("unicorn") != "2.1.4":
    raise RuntimeError("Regeneration requires unicorn==2.1.4")
binary = args.library.read_bytes()
sha = hashlib.sha256(binary).hexdigest()
if sha != "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746":
    raise RuntimeError("Expected pinned 1.8.1 x86 libg.so")
ph_offset = struct.unpack_from("<I", binary, 28)[0]
ph_size, ph_count = struct.unpack_from("<HH", binary, 42)
segments = [struct.unpack_from("<8I", binary, ph_offset + i * ph_size) for i in range(ph_count)]
size = (max(v + ms for kind, _, v, _, _, ms, _, _ in segments if kind == 1) + 4095) & ~4095
cpu = Uc(UC_ARCH_X86, UC_MODE_32)
cpu.mem_map(0, size)
for kind, offset, virtual, _, file_size, _, _, _ in segments:
    if kind == 1:
        cpu.mem_write(virtual, binary[offset:offset + file_size])
cpu.mem_protect(0, size, UC_PROT_READ | UC_PROT_EXEC)
heap, stack = 0x1000000, 0x2000000
cpu.mem_map(heap, 0x10000)
cpu.mem_map(stack, 0x100000)
body, data, child, component = heap, heap + 0x1000, heap + 0x2000, heap + 0x3000
registers = [UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EDX, UC_X86_REG_ESI, UC_X86_REG_EDI, UC_X86_REG_EBP]
allowed = [(0x21640b, 0x21644e), (0x214602, 0x214617), (0x214ecf, 0x214ede), (0x216777, 0x216972),
           (0x21960e, 0x21961e), (0x2199b0, 0x2199c8), (0x1de0ba, 0x1de11e),
           (0x1de882, 0x1de896), (0x1de8ba, 0x1de8ce), (0x25be20, 0x25bede),
           (0x35bd10, 0x35be20)]
spawned = []
transition_calls = 0
current_stops = set()

def read(address):
    return struct.unpack("<i", cpu.mem_read(address, 4))[0]

def write(address, value):
    cpu.mem_write(address, struct.pack("<i", value))

def return_hook(value=0):
    sp = cpu.reg_read(UC_X86_REG_ESP)
    destination = struct.unpack("<I", cpu.mem_read(sp, 4))[0]
    cpu.reg_write(UC_X86_REG_EAX, value)
    cpu.reg_write(UC_X86_REG_ESP, sp + 4)
    cpu.reg_write(UC_X86_REG_EIP, destination)

def instruction(_cpu, address, _size, _data):
    global transition_calls
    if address in current_stops:
        cpu.emu_stop()
    elif address == 0x21698e:
        transition_calls += 1
        return_hook()
    elif address in [0x2993a0, 0x298fe0]:
        return_hook()
    elif address == 0x2159bc:
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if read(sp + 4) != body or read(sp + 8) != child:
            raise RuntimeError("Unexpected native spawn target")
        spawned.append(read(sp + 12))
        return_hook()
    elif not any(start <= address < end for start, end in allowed):
        raise RuntimeError(f"Native instruction escaped clock ranges: {address:#x}")

def interrupt(_cpu, number, _data):
    raise RuntimeError(f"Unexpected emulated interrupt: {number}")

cpu.hook_add(UC_HOOK_CODE, instruction)
cpu.hook_add(UC_HOOK_INTR, interrupt)

def run(start, end, owner=body, model=data, other_end=None):
    global current_stops
    current_stops = {end} if other_end is None else {end, other_end}
    for register in registers:
        cpu.reg_write(register, 0)
    cpu.reg_write(UC_X86_REG_EFLAGS, 2)
    cpu.reg_write(UC_X86_REG_ESP, stack + 0xf0000)
    cpu.reg_write(UC_X86_REG_EBP, stack + 0xf8000)
    cpu.reg_write(UC_X86_REG_EBX, 0x7b8a14)
    cpu.reg_write(UC_X86_REG_EDI, owner)
    cpu.reg_write(UC_X86_REG_ESI, model)
    cpu.emu_start(start, end, count=4000)
    if cpu.reg_read(UC_X86_REG_EIP) not in current_stops:
        raise RuntimeError("Native clock exceeded instruction budget")

input_paths = ["reference/logic/characters.csv", "reference/logic/buildings.csv"]
inputs = []
rows = {}
for path in input_paths:
    content = Path(path).read_bytes()
    inputs.append({"path": path, "sha256": hashlib.sha256(content).hexdigest()})
    for row in csv.DictReader(io.StringIO(content.decode())):
        rows[row["Name"]] = row
source_cards = {"witch": "Witch", "night-witch": "DarkWitch", "goblin-hut": "GoblinHut",
                "tombstone": "Tombstone", "furnace": "FirespiritHut", "barbarian-hut": "BarbarianHut"}
profiles = []
for name, source_card in source_cards.items():
    row = rows[source_card]
    if not row["SpawnCharacter"]:
        raise RuntimeError("Expected a source summoner")
    profiles.append((name, *[int(row[field] or 0) for field in
                            ["SpawnStartTime", "SpawnInterval", "SpawnNumber", "SpawnPauseTime"]]))
profiles += [("witch-delayed", 1000, 300, 3, 6900), ("witch-negative-start", -100, 300, 3, 6900)]
cases = []
for name, start_ms, interval, count, pause in profiles:
    cpu.mem_write(heap, b"\0" * 0x10000)
    write(body + 0x10, data)
    write(body + 0x38, 8)
    write(body + 0x48, component)
    write(data + 0x90, child)
    for offset, value in [(0x1e4, start_ms), (0x1e8, interval), (0x1ec, count), (0x1f0, pause)]:
        write(data + offset, value)
    run(0x214602, 0x214617, owner=data, model=body)
    run(0x214ecf, 0x214ede, owner=data, model=body)
    initial = read(body + 0x78)
    events, checkpoints = [], []
    for tick in range(1, 721):
        spawned.clear()
        run(0x216777, 0x216972)
        state = {"remaining": read(body + 0x78), "index": read(body + 0x7c)}
        if spawned:
            events.append({"tick": tick, "counts": list(spawned), **state})
        if tick in [1, 2, 5, 6, 12, 20, 60, 100, 200, 600, 720]:
            checkpoints.append({"tick": tick, **state})
    cases.append({"name": name, "startMs": start_ms, "intervalMs": interval, "count": count,
                  "pauseMs": pause, "initialRemaining": initial, "events": events, "checkpoints": checkpoints})

deployment_cases = []
for remaining in [1000, 100, 50, 1, 0, -50]:
    for state in [1, 5, 8]:
        cpu.mem_write(heap, b"\0" * 0x10000)
        write(body + 0x90, remaining)
        write(body + 0x60, state)
        transition_calls = 0
        run(0x21640b, 0x21644e, other_end=0x216985)
        deployment_cases.append({"remaining": remaining, "state": state,
                                 "after": read(body + 0x90),
                                 "continues": cpu.reg_read(UC_X86_REG_EIP) == 0x21644e,
                                 "transitionCalls": transition_calls})

static = [
    ("startColumn", 0x1dc701, 0x1dc72c, "SpawnStartTime string at 0x61418c is cached at GOT+0x1850."),
    ("spawnColumns", 0x1dc754, 0x1dc825, "SpawnInterval, SpawnNumber and SpawnPauseTime cache at GOT+0x1854/1858/185c."),
    ("clockData", 0x1d9b4d, 0x1d9bad, "The cached fields load into CharacterData+0x1e4/1e8/1ec/1f0."),
    ("clockGetters", 0x1de0ba, 0x1de11e, "Read start, interval, count, pause and limit from CharacterData."),
    ("initialZero", 0x214602, 0x214617, "Character clock +0x78 initializes to zero."),
    ("positiveStartOverride", 0x214ecf, 0x214ede, "A strictly positive SpawnStartTime replaces that zero clock."),
    ("deploymentGuard", 0x21640b, 0x21644e, "A positive deployment countdown advances by 50 ms and returns while positive. State 8 also returns. Expiry notifies the intercepted state callback and can continue on the same update."),
    ("summonerClock", 0x216777, 0x216972, "Current eligible summon update: rate/2 decrement; one child per positive interval, otherwise a simultaneous group; count reset; add interval or pause, carrying remainder and clamping to one millisecond."),
    ("emptyBuffRate", 0x25be20, 0x25bede, "An empty buff component produces rate 100; the clock update divides it by two, advancing 50 ms."),
    ("displayedCycle", 0x1bbf78, 0x1bbf9e, "The native card-stat path computes SpawnPauseTime + (SpawnNumber - 1) * SpawnInterval."),
]
blocks = []
for name, start, end, meaning in static:
    assembly = subprocess.check_output(["objdump", "-d", "-Mintel", f"--start-address={start:#x}", f"--stop-address={end:#x}", str(args.library)], text=True)
    instructions = [re.sub(r"\s+<[^>]+>", "", line.strip()) for line in assembly.splitlines() if re.match(r"\s+[0-9a-f]+:", line)]
    blocks.append({"name": name, "start": hex(start), "end": hex(end), "interpretation": meaning, "instructions": instructions})
output = json.dumps({"source": "apk/1.8.1/x86/libg.so", "sha256": sha,
                     "emulator": "unicorn==2.1.4", "stepMs": 50, "steps": 720, "inputs": inputs,
                     "limits": ["Summon-clock updates and the separate deployment guard run. The deployment state-transition callback is intercepted. Complete state transitions, stun/control eligibility, child placement, allocation and lifetimes are not emulated.",
                                "The real empty-buff rate helper runs. Buff collection/ranking is not tested.",
                                "Clock profiles are explicit inputs matching archived rows; CSV inheritance and row loading are outside this fragment."],
                     "blocks": blocks, "cases": cases, "deploymentCases": deployment_cases}, indent=2) + "\n"
path = Path("reference/client/spawn-clock-native-trace.json")
if args.check:
    if path.read_text() != output:
        raise RuntimeError("Native spawn clock capture differs")
else:
    path.write_text(output)
print(json.dumps({"cases": len(cases), "deploymentGuards": len(deployment_cases), "updates": len(cases) * 720, "events": sum(len(c["events"]) for c in cases), "firstEvents": {c["name"]: c["events"][:3] for c in cases}}))
