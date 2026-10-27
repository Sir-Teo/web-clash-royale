"""Capture bounded native 1.8.1 Inferno stage and active attack-clock behavior.

Requires unicorn==2.1.4 for regeneration. Executes the archived x86 library in
isolated memory; owner/world resolution, table reads and reset notification are
intercepted. This does not emulate target eligibility or complete attacks.
"""
import argparse
import csv
import hashlib
import importlib.metadata
import io
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
parser.add_argument("--attack-loop", action="store_true", help="Capture controlled target-loss/reacquisition through the larger attack loop")
parser.add_argument("--range-loss", action="store_true", help="Use native range geometry and acquire through the main loop's scan gate")
parser.add_argument("--target-switches", action="store_true", help="Execute native target-setter clock, coordinate and notification branches")
parser.add_argument("--first-attacks", action="store_true", help="Execute native attack constructors and controlled first-attack clocks across source profiles")
parser.add_argument("--roster-first-attacks", action="store_true", help="Extend controlled first-attack clocks to every archived positive HitSpeed row")
parser.add_argument("--attack-range", action="store_true", help="Capture maximum attack geometry across troop, building and Crown Tower profiles")
parser.add_argument("--minimum-range", action="store_true", help="Capture minimum-range boundaries instead of maximum-range boundaries")
parser.add_argument("--sight-range", action="store_true", help="Capture native sight getters and the bounded candidate sight gate")
parser.add_argument("--candidate-minimum", action="store_true", help="Capture candidate minimum-range boundaries through the sight scanner")
parser.add_argument("--native-target-types", action="store_true", help="Run sight gates with native target vtables, source class flags and radius getters")
parser.add_argument("--candidate-ranking", action="store_true", help="Run the native extra-target scanner through ranking and final attack-range validation")
parser.add_argument("--electro-bolts", action="store_true", help="Capture Electro Wizard's native primary/extra-hit dispatch loop and fallback")
parser.add_argument("--primary-acquisition", action="store_true", help="Capture the native primary-lock scanner through its setter-dispatch boundary")
parser.add_argument("--primary-transitions", action="store_true", help="Execute primary acquisition through real target-setter clock effects")
parser.add_argument("--spawn-priority", action="store_true", help="Trace projectile child-spawn priority fields into native primary acquisition")
parser.add_argument("--target-eligibility", action="store_true", help="Execute native eligibility through source air/ground, target component and team gates")
parser.add_argument("--primary-geometry", action="store_true", help="Capture exact primary sight, rear/side clipping and adjusted minimum boundaries")
parser.add_argument("--distant-targets", action="store_true", help="Execute native default-target reference, lane scoring and partial tower collections")
parser.add_argument("--lane-assignment", action="store_true", help="Load archived lane maps and execute native grid selection and spawn lane storage")
parser.add_argument("--terrain-grid", action="store_true", help="Execute archived terrain predicates and bounded non-water coordinate repair")
parser.add_argument("--position-repair", action="store_true", help="Execute body position predicate, coordinate repair and real position stores")
parser.add_argument("--tower-layout", action="store_true", help="Execute archived Crown layout selection, coordinate scaling and position stores")
parser.add_argument("--crown-owners", action="store_true", help="Continue source King placements through native owner selection and stores")
parser.add_argument("--placement-bounds", action="store_true", help="Execute source building deployment masks and ground-group Y bounds")
parser.add_argument("--group-formation", action="store_true", help="Execute ordinary group owner/radius/lane/formation and factory argument bindings")
parser.add_argument("--projectile-formation", action="store_true", help="Execute projectile child formation, map lane and factory coordinate arguments")
parser.add_argument("--spawn-lanes", action="store_true", help="Execute all direct spawn caller lane-hint argument bindings")
args = parser.parse_args()
if args.range_loss and not args.attack_loop:
    parser.error("--range-loss requires --attack-loop")
if args.first_attacks and (not args.attack_loop or args.range_loss):
    parser.error("--first-attacks requires --attack-loop without --range-loss")
if args.roster_first_attacks and not args.first_attacks:
    parser.error("--roster-first-attacks requires --attack-loop --first-attacks")
if args.target_switches and (not args.attack_loop or args.range_loss or args.first_attacks):
    parser.error("--target-switches requires --attack-loop without another continuation")
if args.attack_range and args.attack_loop:
    parser.error("--attack-range and --attack-loop are separate captures")
if args.minimum_range and not args.attack_range:
    parser.error("--minimum-range requires --attack-range")
if args.sight_range and (args.attack_range or args.attack_loop):
    parser.error("--sight-range is a separate capture")
if args.candidate_minimum and not args.sight_range:
    parser.error("--candidate-minimum requires --sight-range")
if args.native_target_types and (not args.sight_range or args.candidate_minimum):
    parser.error("--native-target-types requires --sight-range without --candidate-minimum")
if args.candidate_ranking and (not args.sight_range or args.candidate_minimum or args.native_target_types):
    parser.error("--candidate-ranking requires --sight-range without another sight mode")
if args.electro_bolts and not args.candidate_ranking:
    parser.error("--electro-bolts requires --sight-range --candidate-ranking")
if args.primary_acquisition and (not args.sight_range or args.candidate_minimum or args.native_target_types or args.candidate_ranking):
    parser.error("--primary-acquisition requires --sight-range without another sight mode")
if args.spawn_priority and not args.primary_acquisition:
    parser.error("--spawn-priority requires --sight-range --primary-acquisition")
if args.target_eligibility and (not args.primary_acquisition or args.spawn_priority):
    parser.error("--target-eligibility requires --sight-range --primary-acquisition without --spawn-priority")
if args.primary_geometry and (not args.primary_acquisition or args.spawn_priority or args.target_eligibility):
    parser.error("--primary-geometry requires --sight-range --primary-acquisition without another continuation")
if args.distant_targets and (not args.primary_acquisition or args.spawn_priority or args.target_eligibility or args.primary_geometry):
    parser.error("--distant-targets requires --sight-range --primary-acquisition without another continuation")
if args.primary_transitions and (not args.primary_acquisition or args.spawn_priority or args.target_eligibility or args.primary_geometry or args.distant_targets):
    parser.error("--primary-transitions requires --sight-range --primary-acquisition without another continuation")
if args.lane_assignment and (not args.sight_range or args.candidate_minimum or args.native_target_types or args.candidate_ranking or args.primary_acquisition):
    parser.error("--lane-assignment requires --sight-range without another sight mode")
if args.terrain_grid and (not args.lane_assignment or args.tower_layout or args.spawn_lanes or args.projectile_formation or args.group_formation):
    parser.error("--terrain-grid requires --sight-range --lane-assignment without another continuation")
if args.position_repair and not args.terrain_grid:
    parser.error("--position-repair requires --sight-range --lane-assignment --terrain-grid")
if args.tower_layout and not args.lane_assignment:
    parser.error("--tower-layout requires --sight-range --lane-assignment")
if args.crown_owners and not args.tower_layout:
    parser.error("--crown-owners requires --sight-range --lane-assignment --tower-layout")
if args.placement_bounds and (not args.sight_range or args.attack_loop or args.attack_range or args.lane_assignment or args.candidate_minimum or args.native_target_types or args.candidate_ranking or args.primary_acquisition):
    parser.error("--placement-bounds requires --sight-range without another capture mode")
if args.spawn_lanes and (not args.lane_assignment or args.tower_layout):
    parser.error("--spawn-lanes requires --sight-range --lane-assignment without --tower-layout")
if args.projectile_formation and (not args.lane_assignment or args.tower_layout or args.spawn_lanes):
    parser.error("--projectile-formation requires --sight-range --lane-assignment without another continuation")
if args.group_formation and (not args.lane_assignment or args.tower_layout or args.spawn_lanes or args.projectile_formation):
    parser.error("--group-formation requires --sight-range --lane-assignment without another continuation")
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
heap, stack, stop = 0x1000000, 0x2000000, 0x3000000
cpu.mem_map(heap, 0x10000)
cpu.mem_map(stack, 0x100000)
cpu.mem_map(stop, 0x1000, UC_PROT_READ | UC_PROT_EXEC)
body, data, component, world, buffs, array = [heap + i * 0x1000 for i in range(6)]
registers = [UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EDX, UC_X86_REG_ESI, UC_X86_REG_EDI, UC_X86_REG_EBP]
from lib.instruction_ranges import InstructionRanges

allowed = InstructionRanges([(0x25f754, 0x25f8d3), (0x25c080, 0x25c152), (0x1d7f10, 0x1d7f20),
           (0x2147c8, 0x2147ef), (0x21960e, 0x21961e), (0x2199b0, 0x2199c8),
           (0x1ddf7a, 0x1ddf8e), (0x1deb6e, 0x1deb82), (0x1cc746, 0x1cc75b),
           (0x1ded02, 0x1ded7d), (0x35bdb0, 0x35be20)])
stack_callbacks = {0x25fa64, 0x25fa3a, 0x356eb0, 0x351d10, 0x21698e}
profile = None
reset_calls = 0


def read(address):
    return struct.unpack("<i", cpu.mem_read(address, 4))[0]


def write(address, value):
    cpu.mem_write(address, struct.pack("<i", value))


def return_hook(value=0):
    sp = cpu.reg_read(UC_X86_REG_ESP)
    destination = read(sp)
    cpu.reg_write(UC_X86_REG_EAX, value)
    cpu.reg_write(UC_X86_REG_ESP, sp + 4)
    cpu.reg_write(UC_X86_REG_EIP, destination)


def instruction(_cpu, address, _size, _data):
    global reset_calls
    sp = cpu.reg_read(UC_X86_REG_ESP) if address in stack_callbacks else 0
    if address == stop:
        cpu.emu_stop()
    elif address in [0x25fa64, 0x25fa3a]:
        if read(sp + 4) != component:
            raise RuntimeError("Unexpected owner/world resolution")
        return_hook(body if address == 0x25fa64 else world)
    elif address == 0x356eb0:
        if read(sp + 4) != 1:
            raise RuntimeError("Native variable-damage assertion failed")
        return_hook()
    elif address == 0x351d10:
        field = {0x1ded4b: "VariableDamageTime1", 0x1ded69: "VariableDamageTime2"}.get(read(sp))
        if field is None or read(sp + 4) != data + 0x800:
            raise RuntimeError("Unexpected native table lookup")
        return_hook(int(profile[field]))
    elif address == 0x21698e:
        if read(sp + 4) != body:
            raise RuntimeError("Unexpected reset notification owner")
        reset_calls += 1
        return_hook()
    elif not allowed.allows(address):
        raise RuntimeError(f"Native instruction escaped clock ranges: {address:#x}")


def interrupt(_cpu, number, _data):
    raise RuntimeError(f"Unexpected emulated interrupt: {number}")


cpu.hook_add(UC_HOOK_CODE, instruction)
cpu.hook_add(UC_HOOK_INTR, interrupt)


def run(start, *arguments, instruction_budget=4000):
    for register in registers:
        cpu.reg_write(register, 0)
    cpu.reg_write(UC_X86_REG_EFLAGS, 2)
    sp = stack + 0xf0000
    write(sp, stop)
    for index, value in enumerate(arguments):
        write(sp + 4 * (index + 1), value)
    cpu.reg_write(UC_X86_REG_ESP, sp)
    cpu.reg_write(UC_X86_REG_EBX, 0x7b8a14)
    cpu.emu_start(start, stop + 1, count=instruction_budget)
    if cpu.reg_read(UC_X86_REG_EIP) != stop:
        raise RuntimeError("Native clock exceeded instruction budget")
    return cpu.reg_read(UC_X86_REG_EAX)


inputs, rows = [], {}
for path in ["reference/logic/characters.csv", "reference/logic/buildings.csv", "reference/logic/character_buffs.csv"]:
    content = Path(path).read_bytes()
    inputs.append({"path": path, "sha256": hashlib.sha256(content).hexdigest()})
    rows[path] = {row["Name"]: row for row in csv.DictReader(io.StringIO(content.decode()))}
buff_rows = rows["reference/logic/character_buffs.csv"]


def set_buffs(names):
    write(buffs + 8, array)
    write(buffs + 0x10, len(names))
    for index, name in enumerate(names):
        obj = heap + 0x6000 + index * 0x100
        model = obj + 0x40
        write(array + 4 * index, obj)
        write(obj + 0xc, model)
        write(model + 0x44, int(buff_rows[name]["HitSpeedMultiplier"] or 0))


def initialize(source):
    global profile
    profile = source
    cpu.mem_write(heap, b"\0" * 0x10000)
    write(body + 0x10, data)
    write(body + 0x38, 8)
    write(body + 0x48, buffs)
    write(data + 8, data + 0x800)
    cpu.mem_write(data + 0x17d, b"\1")
    write(data + 0x198, int(source["HitSpeed"]))
    write(data + 0x1fc, int(source["LoadTime"]))
    write(component + 4, body)
    write(component + 0xc, 1000)
    set_buffs([])


if args.sight_range:
    if args.placement_bounds:
        from lib.placement_bounds_probe import capture
    elif args.lane_assignment:
        from lib.lane_assignment_probe import capture
    elif args.candidate_ranking or args.primary_acquisition:
        from lib.candidate_ranking_probe import capture
    elif args.native_target_types:
        from lib.sight_type_probe import capture
    else:
        from lib.sight_range_probe import capture
    capture(globals())
    raise SystemExit(0)
if args.attack_range:
    from lib.attack_range_probe import capture
    capture(globals())
    raise SystemExit(0)
if args.attack_loop:
    from lib.inferno_attack_probe import capture
    capture(globals())
    raise SystemExit(0)

profiles = [("inferno-tower", rows["reference/logic/buildings.csv"]["InfernoTower"]),
            ("inferno-dragon", rows["reference/logic/characters.csv"]["InfernoDragon"])]
buff_cases = [[], ["Rage"], ["IceWizardSlowDown"], ["Rage", "IceWizardSlowDown"],
              ["IceWizardSlowDown", "Rage"], ["Freeze"], ["ZapFreeze"],
              ["Rage", "Rage"], ["IceWizardSlowDown", "IceWizardSlowDown"], ["Rage", "Freeze"]]
cases, boundaries, resets, controls, changing = [], [], [], [], []
for name, source in profiles:
    initialize(source)
    for elapsed in [0, 1, 1999, 2000, 2001, 3999, 4000, 4001, 10000]:
        boundaries.append({"card": name, "elapsedMs": elapsed, "stage": run(0x1ded02, data, elapsed)})
    for names in buff_cases:
        initialize(source)
        set_buffs(names)
        delta = run(0x25c080, buffs, 50)
        checkpoints, transitions = [], []
        previous_stage = run(0x1ded02, data, 1000)
        for tick in range(1, 121):
            run(0x25f754, component)
            elapsed = read(component + 0xc)
            stage = run(0x1ded02, data, elapsed)
            if stage != previous_stage:
                transitions.append({"tick": tick, "elapsedMs": elapsed, "stage": stage})
                previous_stage = stage
            if tick in [1, 15, 20, 30, 40, 45, 60, 90, 120]:
                checkpoints.append({"tick": tick, "elapsedMs": elapsed, "stage": stage})
        cases.append({"card": name, "buffs": names, "initialElapsedMs": 1000,
                      "deltaMs": delta, "checkpoints": checkpoints, "transitions": transitions})
    for gate in [0, 1]:
        initialize(source)
        write(component + 0x4c, gate)
        for offset in [0x14, 0x28, 0x40]:
            write(component + offset, 123)
        cpu.mem_write(component + 0x1d, b"\1")
        reset_calls = 0
        run(0x25f87e, component)
        resets.append({"card": name, "gate": gate, "elapsedMs": read(component + 0xc),
                       "fields": {hex(offset): read(component + offset) for offset in [0x14, 0x28, 0x40]},
                       "flag1d": cpu.mem_read(component + 0x1d, 1)[0], "notificationCalls": reset_calls})
    for control in ["world-gate", "flag1e", "deferred40"]:
        initialize(source)
        if control == "world-gate":
            cpu.mem_write(world + 0xfc, b"\1")
        elif control == "flag1e":
            cpu.mem_write(component + 0x1e, b"\1")
        else:
            write(component + 0x40, 123)
        run(0x25f754, component)
        controls.append({"card": name, "control": control, "elapsedMs": read(component + 0xc),
                         "deferred40": read(component + 0x40), "flag1e": cpu.mem_read(component + 0x1e, 1)[0]})
    initialize(source)
    phases = []
    for names in [[], ["Rage"], ["IceWizardSlowDown"], ["Freeze"], ["Rage", "IceWizardSlowDown"], []]:
        set_buffs(names)
        before = read(component + 0xc)
        for _ in range(30):
            run(0x25f754, component)
        elapsed = read(component + 0xc)
        phases.append({"buffs": names, "steps": 30, "beforeMs": before, "afterMs": elapsed,
                       "stage": run(0x1ded02, data, elapsed)})
    changing.append({"card": name, "phases": phases})

static = [
    ("buffColumn", 0x1d7634, 0x1d7692, "HitSpeedMultiplier at 0x6135ac caches at GOT+0x1718."),
    ("buffField", 0x1d6ef6, 0x1d6f0b, "The cached HitSpeedMultiplier loads into BuffData+0x44."),
    ("buffGetter", 0x1d7f10, 0x1d7f20, "Read BuffData+0x44."),
    ("attackDelta", 0x25c080, 0x25c152, "Strongest positive and strongest negative buffs apply in two integer divisions; duplicate buffs do not stack."),
    ("stageSelector", 0x1ded02, 0x1ded7d, "Threshold equality advances the stage; Time2 is added to Time1."),
    ("damageClockConsumer", 0x25e75f, 0x25e78c, "The attack damage path passes AttackComponent+0x0c to the stage selector."),
    ("activeClock", 0x25f754, 0x25f87e, "An already-active clock normally adds buff-adjusted 50 ms. Zero delta holds it; world gate clears it; controlled flags can redirect advancement."),
    ("resetHelper", 0x25f87e, 0x25f8d3, "With gate +0x4c zero, clear elapsed and related state, then notify owner. Caller eligibility is outside this capture."),
]
blocks = []
for name, start, end, meaning in static:
    assembly = subprocess.check_output(["objdump", "-d", "-Mintel", f"--start-address={start:#x}", f"--stop-address={end:#x}", str(args.library)], text=True)
    instructions = [re.sub(r"\s+<[^>]+>", "", line.strip()) for line in assembly.splitlines() if re.match(r"\s+[0-9a-f]+:", line)]
    blocks.append({"name": name, "start": hex(start), "end": hex(end), "interpretation": meaning, "instructions": instructions})
output = json.dumps({"source": "apk/1.8.1/x86/libg.so", "sha256": sha,
                     "emulator": "unicorn==2.1.4", "stepMs": 50, "steps": 120, "inputs": inputs,
                     "limits": ["Bounded active attack-clock and stage-selector execution, with explicit memory profiles matching archived CSV values. CSV loading/inheritance is not emulated.",
                                "Owner/world resolution, two threshold table reads, assertion reporting and reset notification are intercepted. All other execution must stay in listed native ranges.",
                                "Initial elapsed is 1000 ms, bypassing first-load behavior. Actual pulses, damage allocation, targeting, control eligibility, Freeze/Zap reset callers and complete state transitions are not emulated.",
                                "Freeze and ZapFreeze cases show only zero-delta clock-helper behavior, not complete spell effects. Controlled fields have no inferred gameplay trigger.",
                                "Native integer 50 ms updates do not establish equivalence with the browser's floating-point 30 Hz simulation."],
                     "blocks": blocks, "boundaries": boundaries, "cases": cases,
                     "resetCases": resets, "controlledCases": controls, "changingBuffCases": changing}, indent=2) + "\n"
path = Path("reference/client/inferno-clock-native-trace.json")
if args.check:
    if path.read_text() != output:
        raise RuntimeError("Native Inferno clock capture differs")
else:
    path.write_text(output)
print(json.dumps({"cases": len(cases), "updates": len(cases) * 120 + len(changing) * 180, "boundaries": len(boundaries),
                  "resets": len(resets), "controls": len(controls),
                  "deltasMs": [{"buffs": case["buffs"], "deltaMs": case["deltaMs"]} for case in cases[:len(buff_cases)]]}))
