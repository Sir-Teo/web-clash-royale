"""Native sight getter and candidate sight gate, with explicit scan boundaries.

The world query supplies one eligible dummy target. Execution stops at the
successful sight gate, before the remainder of target ranking and attack-range
validation. This does not emulate complete candidate acquisition or movement.
"""
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EIP


def capture(env):
    cpu, heap, body, data, component = [env[k] for k in ["cpu", "heap", "body", "data", "component"]]
    read, write, run, return_hook = [env[k] for k in ["read", "write", "run", "return_hook"]]
    config, target, vtable = heap + 0xa000, heap + 0x8000, heap + 0xd000
    handle, grid, collection, pointers = [heap + 0xe000 + i * 0x100 for i in range(4)]
    radius_callback = env["stop"] + 0x100
    class_callbacks = {env["stop"] + 0x200 + i * 0x10: slot for i, slot in enumerate([0x60, 0x64, 0x68])}
    globals_path = "reference/logic/globals.csv"
    globals_bytes = Path(globals_path).read_bytes()
    globals_rows = {r["Name"]: r for r in csv.DictReader(io.StringIO(globals_bytes.decode()))}
    extra_building = int(globals_rows["EXTRA_SIGHT_RANGE_TO_BUILDING"]["NumberValue"])
    extra_crown = int(globals_rows["EXTRA_SIGHT_RANGE_TO_CROWN_TOWERS"]["NumberValue"])
    source_flag = globals_rows["ADD_CHARACTER_RANGE_TO_RADIUS"]["BooleanValue"]
    if source_flag not in ["TRUE", "FALSE"]:
        raise RuntimeError("Unexpected archived own-radius flag")
    hooks = [0x25fa2a, 0x25faf2, 0x1e6cee, 0x21f5f6, 0x25d7c2, 0x219e0a,
             radius_callback, *class_callbacks]
    env["allowed"].extend([
        (0x25d95e, 0x25ddad), (0x1ddbe0, 0x1ddbf3), (0x1de2d8, 0x1de2eb),
        (0x1de3f0, 0x1de403), (0x219b26, 0x219b36), (0x21a0bc, 0x21a0f0),
        (0x35d620, 0x35d66f), (0x35d330, 0x35d423), (0x35bd10, 0x35bd52),
        *((address, address + 1) for address in hooks),
    ])
    target_radius, expected_query, query_radius = 0, 0, None
    type_flags, passed = {}, False

    def hook(_cpu, address, _size, _data):
        nonlocal query_radius, passed
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if address in [0x25fa2a, 0x25faf2]:
            if read(sp + 4) != component:
                raise RuntimeError("Unexpected sight component owner")
            return_hook(body if address == 0x25fa2a else handle)
        elif address == 0x1e6cee:
            return_hook(config)
        elif address == 0x21f5f6:
            if (read(sp) != 0x25da19 or read(sp + 4) != grid or read(sp + 8) != body + 0x20
                    or read(sp + 12) != expected_query or read(sp + 16) or read(sp + 20)):
                raise RuntimeError("Unexpected candidate broadphase query")
            query_radius = read(sp + 12)
            return_hook(collection)
        elif address == 0x25d7c2:
            if [read(sp + 4), read(sp + 8), read(sp + 12)] != [component, target, 0]:
                raise RuntimeError("Unexpected candidate eligibility query")
            return_hook(1)
        elif address == 0x219e0a:
            if [read(sp + 4), read(sp + 8)] != [body, target]:
                raise RuntimeError("Unexpected candidate priority query")
            return_hook(0)
        elif address == radius_callback:
            if read(sp + 4) != target or read(sp) not in [0x25db09, 0x25db4a]:
                raise RuntimeError("Unexpected sight target-radius query")
            return_hook(target_radius)
        elif address in class_callbacks:
            if read(sp + 4) != target:
                raise RuntimeError("Unexpected supplied class-flag owner")
            return_hook(type_flags.get(class_callbacks[address], 0))
        elif address == 0x25db97:
            if read(sp + 0x58) != target:
                raise RuntimeError("Unexpected successful sight-gate candidate")
            passed = True
            # Deliberate bounded halt before later ranking/owner-class work.
            # The next run resets all caller registers and the emulated stack.
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])

    cpu.hook_add(UC_HOOK_CODE, hook)
    profiles = []
    names = {
        "characters": ["Knight", "Archer", "Musketeer", "Giant", "HogRider", "Balloon", "Prince", "InfernoDragon"],
        "buildings": ["Cannon", "Mortar", "InfernoTower", "KingTower", "PrincessTower"],
    }
    for table, source_names in names.items():
        for name in source_names:
            source = env["rows"][f"reference/logic/{table}.csv"][name]
            cpu.mem_write(heap, b"\0" * 0x10000)
            write(body + 0x10, data)
            write(component + 4, body)
            write(handle + 0x30, grid)
            write(collection, pointers)
            write(collection + 8, 1)
            write(pointers, target)
            write(target, vtable)
            write(vtable + 0x38, radius_callback)
            for callback, slot in class_callbacks.items():
                write(vtable + slot, callback)
            write(config + 0x38, extra_building)
            write(config + 0x3c, extra_crown)
            values = {key: int(source[key] or 0) for key in ["SightRange", "MinimumRange", "CollisionRadius"]}
            if values["SightRange"] <= 0 or values["CollisionRadius"] <= 0:
                raise RuntimeError(f"Recheck sight profile: {name}")
            for offset, field in [(0x1a8, "SightRange"), (0x1a4, "MinimumRange"), (0x22c, "CollisionRadius")]:
                write(data + offset, values[field])
            getters, samples = [], []
            for add_radius in [False, True]:
                cpu.mem_write(config + 0x295, bytes([int(add_radius)]))
                sight = run(0x25dd54, component)
                if sight != values["SightRange"] + (values["CollisionRadius"] if add_radius else 0):
                    raise RuntimeError("Native sight getter differs from source fields")
                getters.append({"addOwnRadius": add_radius, "sightRange": sight})
                expected_query = sight + max(extra_building, extra_crown)
                for label, type_flags in [("plain", {}), ("slot60", {0x60: 1}), ("slot64", {0x64: 1}), ("slot68", {0x68: 1})]:
                    extra = extra_crown if type_flags.get(0x60) or type_flags.get(0x64) else extra_building if type_flags.get(0x68) else 0
                    for target_radius in [0, 250, 1000]:
                        reach = sight + target_radius + extra
                        for axis, direction in [("right", 1), ("left", -1)]:
                            for offset in [-1, 0, 1]:
                                x = (reach + offset) * direction
                                write(target + 0x20, x)
                                passed, query_radius = False, None
                                run(0x25d95e, component, 0)
                                if query_radius != expected_query or passed != (offset <= 0):
                                    raise RuntimeError("Native candidate sight gate differs from recovered boundary")
                                samples.append({"addOwnRadius": add_radius, "classFlags": label,
                                                "targetRadius": target_radius, "axis": axis, "offset": offset,
                                                "x": x, "broadphaseRadius": query_radius, "passesSightGate": passed})
            profiles.append({"table": table, "name": name, **values, "getters": getters, "samples": samples})
    static = [
        ("ownRadiusGlobal", 0x1f19fe, 0x1f1a31, "ADD_CHARACTER_RANGE_TO_RADIUS loads Globals+0x295; archived true."),
        ("extraGlobals", 0x1f168f, 0x1f16f7, "EXTRA_SIGHT_RANGE_TO_BUILDING and EXTRA_SIGHT_RANGE_TO_CROWN_TOWERS load Globals+0x38/+0x3c; archived 0/2000."),
        ("sightColumn", 0x1db7e4, 0x1db812, "SightRange at native string 0x613f5c caches GOT+0x17a8."),
        ("sightField", 0x1d9927, 0x1d993f, "The cached SightRange column loads CharacterData+0x1a8."),
        ("sightGetter", 0x1ddbe0, 0x1ddbf3, "The raw SightRange getter reads CharacterData+0x1a8."),
        ("resolvedSight", 0x25dd54, 0x25ddad, "Source sight adds own collision radius under the archived global."),
        ("queryPrelude", 0x25d976, 0x25da26, "Candidate broadphase uses resolved sight plus the larger class extension; the world query is supplied."),
        ("candidateMinimum", 0x25dad2, 0x25db2a, "The scanner's independent minimum branch precedes sight filtering. These outer-boundary inputs remain outside that inner exclusion."),
        ("classExtensions", 0x25db2a, 0x25db97, "After supplied priority, target virtual slots 0x64/0x60 add the crown extension; otherwise slot 0x68 adds the building extension. Maximum sight equality passes."),
        ("unitDistance", 0x21a0bc, 0x21a0f0, "Native squared distance reads both bodies' integer coordinates."),
        ("distanceWrapper", 0x35d620, 0x35d66f, "Native point-to-point wrapper."),
        ("squaredDistance", 0x35d330, 0x35d423, "Native saturating integer squared distance; supplied coordinates do not saturate."),
    ]
    blocks = []
    for name, start, end, meaning in static:
        assembly = subprocess.check_output(["objdump", "-d", "-Mintel", f"--start-address={start:#x}", f"--stop-address={end:#x}", str(env["args"].library)], text=True)
        instructions = [re.sub(r"\s+<[^>]+>", "", line.strip()) for line in assembly.splitlines() if re.match(r"\s+[0-9a-f]+:", line)]
        blocks.append({"name": name, "start": hex(start), "end": hex(end), "interpretation": meaning, "instructions": instructions})
    output = json.dumps({"source": "apk/1.8.1/x86/libg.so", "sha256": env["sha"], "emulator": "unicorn==2.1.4",
                         "addCharacterRangeToRadius": source_flag == "TRUE",
                         "extraSightToBuilding": extra_building, "extraSightToCrownTowers": extra_crown,
                         "inputs": [*env["inputs"][:2], {"path": globals_path, "sha256": hashlib.sha256(globals_bytes).hexdigest()}],
                         "limits": ["Captures the native resolved-sight getter and candidate sight gate only. A successful gate halts at 0x25db97 before subsequent ranking and attack-range validation; passing is not acquiring a target.",
                                    "Owner/Globals/world-grid resolution, candidate collection, eligibility, priority and virtual class/radius callbacks are supplied. One eligible dummy is returned by the intercepted world query; native broadphase spatial indexing is not emulated.",
                                    "Virtual type slots are controlled independently and labeled by slot, not asserted to be actual runtime class identities. Other Globals fields remain zero; no full inherited/global/card profile or movement state machine is recovered.",
                                    "Source MinimumRange fields are loaded, but these outer-boundary samples do not establish candidate minimum behavior. Native integer coordinates do not establish browser quantization equivalence."],
                         "blocks": blocks, "profiles": profiles}, indent=2) + "\n"
    path = Path("reference/client/sight-range-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native sight-range capture differs")
    else:
        path.write_text(output)
    print(json.dumps({"profiles": len(profiles), "getters": sum(len(p["getters"]) for p in profiles),
                      "samples": sum(len(p["samples"]) for p in profiles), "blocks": len(blocks)}))
