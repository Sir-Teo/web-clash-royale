"""Native projectile spawn ordinal and primary-target score continuation.

Child geometry/allocation/deployment callbacks are skipped explicitly. Actual
count/init/increment, priority-field store/getter and primary scanner execute.
"""
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ESI, UC_X86_REG_EDI, UC_X86_REG_ESP, UC_X86_REG_EIP


def capture(env, context):
    cpu, heap = env["cpu"], env["heap"]
    read, write, run = [env[k] for k in ["read", "write", "run"]]
    initialize, sources, targets, active, acquire = [context[k] for k in ["initialize", "sources", "targets", "active", "acquire"]]
    path = "reference/logic/projectiles.csv"
    projectile_bytes = Path(path).read_bytes()
    projectile_rows = list(csv.DictReader(io.StringIO(projectile_bytes.decode())))
    enabled_rows = [row for row in projectile_rows if row["SpawnConstPriority"].lower() == "true"]
    if len(enabled_rows) != 1 or enabled_rows[0]["Name"] != "GoblinBarrelSpell":
        raise RuntimeError("Recheck archived constant spawn-priority rows")
    source = enabled_rows[0]
    if source["SpawnCharacter"] != "Goblin" or source["SpawnCharacterCount"] != "3":
        raise RuntimeError("Recheck Goblin Barrel child profile")
    string = b"SpawnConstPriority\0"
    if bytes(cpu.mem_read(0x6194f2, len(string))) != string:
        raise RuntimeError("Unexpected native projectile priority column")
    owner_names = list(sources)
    goblin = env["rows"]["reference/logic/characters.csv"][source["SpawnCharacter"]]
    if int(goblin["Speed"]) <= 0 or goblin["IsSummonerTower"]:
        raise RuntimeError("Recheck ordinary Goblin target class")
    sources["Goblin"] = goblin
    targets["Goblin"] = {**targets["Knight"], "name": "Goblin", "Speed": int(goblin["Speed"]),
                         "CollisionRadius": int(goblin["CollisionRadius"])}
    projectile, model = heap + 0x6000, heap + 0x6800
    env["allowed"].extend([
        (0x21e3da, 0x21e409), (0x21e409, 0x21e40a),
        (0x21e50b, 0x21e52c), (0x21e5a7, 0x21e5c1),
        (0x1fbafa, 0x1fbb0a), (0x214688, 0x214693),
    ])
    count, field_pointer, spawn_steps = 0, 0, []
    current_child = None

    def hook(_cpu, address, _size, _data):
        nonlocal current_child
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if address == 0x214688:
            if read(sp + 4) != field_pointer:
                raise RuntimeError("Unexpected child constructor field owner")
            cpu.reg_write(UC_X86_REG_ESI, field_pointer)
        elif address == 0x214692:
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        elif address == 0x21e3da:
            cpu.reg_write(UC_X86_REG_EDI, projectile)
            # Unused by the retained prefix/store; poison proves real init.
            write(sp + 0x6c, 12345)
        elif address == 0x21e409:
            index, ordinal = read(sp + 0x80), read(sp + 0x6c)
            if index < 0 or index >= count or ordinal != index * 20:
                raise RuntimeError("Unexpected native spawn ordinal")
            pointer = next(pointer for pointer, candidate in active().items() if candidate["id"] == f"g{index}")
            # Controlled child allocation return, after skipping its geometry.
            current_child = {"index": index, "ordinal": ordinal, "pointer": pointer,
                             "before": read(pointer + 0xac)}
            cpu.reg_write(UC_X86_REG_EAX, pointer)
            cpu.reg_write(UC_X86_REG_EIP, 0x21e50b)
        elif address == 0x21e52b:
            if current_child is None:
                raise RuntimeError("Priority store without a child boundary")
            pointer = current_child["pointer"]
            if cpu.reg_read(UC_X86_REG_ESI) != pointer:
                raise RuntimeError("Unexpected native spawned child")
            spawn_steps.append({key: value for key, value in current_child.items() if key != "pointer"} | {"fieldAC": read(pointer + 0xac)})
            current_child = None
            # Skip deployment/world registration; retain real loop increment.
            cpu.reg_write(UC_X86_REG_EIP, 0x21e5a7)
        elif address == 0x21e5c0:
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])

    cpu.hook_add(UC_HOOK_CODE, hook)

    def spawn_fields(enabled, child_count):
        nonlocal count, field_pointer, spawn_steps
        count, spawn_steps = child_count, []
        write(projectile + 0x10, model)
        write(model + 0x30, count)
        cpu.mem_write(model + 0x8b, bytes([enabled]))
        for field_pointer in active():
            write(field_pointer + 0xac, 999)
            run(0x214688, field_pointer)
            if read(field_pointer + 0xac) != 0:
                raise RuntimeError("Native child constructor did not zero priority")
        run(0x21e3da, instruction_budget=4000)
        if len(spawn_steps) != count:
            raise RuntimeError("Native child loop count differs")
        for step in spawn_steps:
            if step["fieldAC"] != ((step["index"] * 20) ** 2 if enabled else 0):
                raise RuntimeError("Native child priority differs")
        for pointer, candidate in active().items():
            if run(0x218c44, pointer) != read(pointer + 0xac):
                raise RuntimeError("Native target priority getter differs")
            candidate["fieldAC"] = read(pointer + 0xac)
        return list(spawn_steps)

    cases = []
    for name in owner_names:
        owner = sources[name]
        for add_radius in [False, True]:
            for team in [0, 1]:
                front = 1 if team == 0 else -1
                near = 5000
                layouts = {
                    "equal-center-distance": [(-near, 0), (0, near), (near, 0)],
                    "distance-beats-bias": [(near - 1, 0), (near, 0), (near + 1, 0)],
                    "adjusted-score-tie": [(near, 0), (near, 20), (near, 40)],
                    "zero-clamp-tie": [(0, 0), (0, 0), (0, 0)],
                }
                for label, points in layouts.items():
                    # Mortar's actual candidate minimum excludes the origin.
                    minimum_rejects = label == "zero-clamp-tie" and int(owner["MinimumRange"] or 0) > 0
                    for enabled in [False, True]:
                        for reverse in [False, True]:
                            candidates = [{"id": f"g{i}", "name": "Goblin", "x": x, "y": y * front} for i, (x, y) in enumerate(points)]
                            if reverse:
                                candidates.reverse()
                            initialize(owner, candidates, team, add_radius, None)
                            steps = spawn_fields(enabled, 3)
                            result = acquire()
                            expected = None if minimum_rejects else min(candidates, key=lambda candidate: max(0, candidate["x"] ** 2 + candidate["y"] ** 2 - candidate["fieldAC"]))["id"]
                            if result["setterRequests"] != ([expected] if expected is not None else []):
                                raise RuntimeError(json.dumps({"owner": name, "layout": label, "enabled": enabled, "reverse": reverse, "expected": expected, "actual": result}))
                            cases.append({"owner": name, "case": label, "teamIndex": team, "addOwnRadius": add_radius,
                                          "spawnConstPriority": enabled, "sourceControl": "archived" if enabled else "synthetic-false",
                                          "reverseCollection": reverse, "spawnSteps": steps, "candidates": candidates, **result})
    controls = []
    for enabled in [False, True]:
        for child_count in [0, 1, 2, 4]:
            candidates = [{"id": f"g{i}", "name": "Goblin", "x": 1000, "y": 0} for i in range(child_count)]
            initialize(sources["Cannon"], candidates, 0, True, None)
            steps = spawn_fields(enabled, child_count)
            controls.append({"spawnConstPriority": enabled, "syntheticCount": child_count, "spawnSteps": steps})

    static = [
        ("priorityColumnAndField", 0x1fab07, 0x1fab37, "SpawnConstPriority string0x6194f2 loads the boolean at projectile Data+0x8b."),
        ("childCountGetter", 0x1fbafa, 0x1fbb0a, "Reads projectile Data+0x30."),
        ("childLoopInitialization", 0x21e3da, 0x21e409, "Actual count gate stores count and initializes priority ordinal/index to zero."),
        ("childAllocationBoundary", 0x21e4c2, 0x21e50b, "Child allocation1c959a is outside the capture; its controlled returned body enters the actual priority store."),
        ("childPriorityStore", 0x21e50b, 0x21e52b, "If SpawnConstPriority is true, square the current loop ordinal and store child+0xac."),
        ("childLoopIncrement", 0x21e5a7, 0x21e5c0, "Actual loop advances child index by one and priority ordinal by20 until source count."),
        ("constructorFieldZero", 0x214688, 0x214692, "Actual base-constructor field fragment initializes child+0xac to zero."),
        ("targetPriorityGetter", 0x218c44, 0x218c58, "Actual target virtual+0x80 reads the stored child+0xac value."),
        ("primaryScore", 0x25e020, 0x25e0a2, "Actual primary scanner subtracts the getter from squared center distance, clamps zero, then checks candidate minimum."),
        ("primaryRanking", 0x25e21a, 0x25e27d, "Adjusted-score equality preserves supplied collection order."),
    ]
    blocks = []
    for name, start, end, meaning in static:
        assembly = subprocess.check_output(["objdump", "-d", "-Mintel", f"--start-address={start:#x}", f"--stop-address={end:#x}", str(env["args"].library)], text=True)
        instructions = [re.sub(r"\s+<[^>]+>", "", line.strip()) for line in assembly.splitlines() if re.match(r"\s+[0-9a-f]+:", line)]
        blocks.append({"name": name, "start": hex(start), "end": hex(end), "interpretation": meaning, "instructions": instructions})
    inputs = ["reference/logic/characters.csv", "reference/logic/buildings.csv", "reference/logic/globals.csv", path,
              "reference/client/sight-target-types-native-trace.json", "reference/client/primary-acquisition-native-trace.json"]
    output = json.dumps({"source": "apk/1.8.1/x86/libg.so", "sha256": env["sha"], "emulator": "unicorn==2.1.4",
                         "sourceProjectile": {key: source[key] for key in ["Name", "SpawnCharacter", "SpawnCharacterCount", "SpawnConstPriority"]},
                         "inputs": [{"path": path, "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest()} for path in inputs],
                         "limits": [
                             "Actual projectile count gate, ordinal initialization/increment, conditional squared-field store, base-constructor field zero, target getter and primary acquisition scanner execute.",
                             "Child geometry/allocation and deployment/world-registration work are skipped at explicit boundaries. Supplied child bodies/positions are minimal source-selected Goblin profiles; this does not recover natural Barrel landing positions, creation collision adjustment or complete constructors.",
                             "Only archived GoblinBarrelSpell enables SpawnConstPriority. False-flag cases and child counts0/1/2/4 are synthetic controls; archived count is3.",
                             "Primary eligibility/collection and owner state2 remain supplied; full native target state/movement and target-setter side effects are not emulated. Giant/Hog building-target eligibility is deliberately not inferred from supplied Goblin candidates.",
                             "This identifies one concrete live write to target+0xac, not every possible writer or native save/restore behavior. The score adjustment is an ordinal square, not a collision-radius square or a global card statistic.",
                             "Equal-distance and adjusted-score layouts are controlled arithmetic witnesses, not natural formation claims. No gameplay or replay behavior changes follow automatically from this evidence.",
                         ], "blocks": blocks, "cases": cases, "countControls": controls}, indent=2) + "\n"
    target = Path("reference/client/spawn-priority-native-trace.json")
    if env["args"].check:
        if target.read_text() != output:
            raise RuntimeError("Native spawn-priority capture differs")
    else:
        target.write_text(output)
    print(json.dumps({"cases": len(cases), "countControls": len(controls),
                      "spawnedChildren": sum(len(case["spawnSteps"]) for case in cases),
                      "priorityStores": sum(len(case["spawnSteps"]) for case in cases if case["spawnConstPriority"]),
                      "blocks": len(blocks)}))
