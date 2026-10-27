"""Native extra-target scan return with controlled eligibility/collection.

Class flags, target radii, priority, source sight clipping, ranking and the final
attack predicate execute. The multi-target hit caller uses this scanner, rather
than the separate primary-lock scan. This is not a complete acquisition caller,
world query, movement state machine or inherited native card profile.
"""
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import re
import subprocess
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EIP, UC_X86_REG_EDX


def capture(env):
    cpu, heap, body, data, component = [env[k] for k in ["cpu", "heap", "body", "data", "component"]]
    read, write, run, return_hook = [env[k] for k in ["read", "write", "run", "return_hook"]]
    config, handle, grid, collection, pointers = [heap + offset for offset in [0xa000, 0xe000, 0xe100, 0xe200, 0xe300]]
    globals_path = "reference/logic/globals.csv"
    global_bytes = Path(globals_path).read_bytes()
    settings = {r["Name"]: r for r in csv.DictReader(io.StringIO(global_bytes.decode()))}
    extras = {"building": int(settings["EXTRA_SIGHT_RANGE_TO_BUILDING"]["NumberValue"]),
              "crown": int(settings["EXTRA_SIGHT_RANGE_TO_CROWN_TOWERS"]["NumberValue"])}
    types_path = "reference/client/sight-target-types-native-trace.json"
    types_bytes = Path(types_path).read_bytes()
    types = json.loads(types_bytes)
    if types["sha256"] != env["sha"]:
        raise RuntimeError("Target type capture uses another native binary")
    sources = {p["name"]: env["rows"][f'reference/logic/{p["table"]}.csv'][p["name"]] for p in types["targets"]}
    targets = {p["name"]: p for p in types["targets"]}
    for vtable in types["vtables"]:
        for slot, function in vtable["slots"].items():
            if read(int(vtable["address"], 16) + int(slot, 16)) != int(function, 16):
                raise RuntimeError("Native target vtable differs from class capture")
    for delta, text in [(0x1a50a0, "SightClip"), (0x1a5096, "SightClipSide"), (0x1a4afc, "TargetOnlyBuildings")]:
        address = 0x7b8a14 - delta
        if bytes(cpu.mem_read(address, len(text) + 1)) != text.encode() + b"\0":
            raise RuntimeError("Native source field string differs")
    hooks = [0x25fa2a, 0x25faf2, 0x25fa9c, 0x1e6cee, 0x21f5f6, 0x25d7c2]
    env["allowed"].extend([
        (0x25d95e, 0x25deb6), (0x25d6f2, 0x25d75c),
        (0x1ddbe0, 0x1ddbf3), (0x1ddbf4, 0x1ddc08), (0x1de2c4, 0x1de2ec),
        (0x1de3f0, 0x1de404), (0x1def40, 0x1def68), (0x1dd78c, 0x1dd7b3),
        (0x219b26, 0x219b36), (0x219af6, 0x219b16), (0x219a04, 0x219a33),
        (0x2198d8, 0x21991f), (0x219e0a, 0x219e64), (0x218c24, 0x218c34),
        (0x21a0bc, 0x21a0f0), (0x21a2d0, 0x21a376),
        (0x35d620, 0x35d66f), (0x35d330, 0x35d423), (0x35bd10, 0x35bd52),
        (0x35be20, 0x35be5a), (0x217804, 0x217842),
        (0x21a404, 0x21a410), (0x2243e4, 0x2243f3),
        (0x2172ae, 0x2172e0), (0x2184bc, 0x2184ee),
        (0x1de24a, 0x1de25e), (0x1dd6d0, 0x1dd6ea),
        *((address, address + 1) for address in hooks),
    ])
    active, expected_query, broadphase_calls, nominations = {}, 0, [], []

    def hook(_cpu, address, _size, _data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if address in [0x25fa2a, 0x25faf2, 0x25fa9c]:
            if read(sp + 4) != component:
                raise RuntimeError("Unexpected scan component owner")
            return_hook({0x25fa2a: body, 0x25faf2: handle, 0x25fa9c: data}[address])
        elif address == 0x1e6cee:
            return_hook(config)
        elif address == 0x21f5f6:
            if [read(sp + i) for i in [0, 4, 8, 12, 16, 20]] != [0x25da19, grid, body + 0x20, expected_query, 0, 0]:
                raise RuntimeError("Unexpected native candidate query")
            broadphase_calls.append(read(sp + 12))
            return_hook(collection)
        elif address == 0x25d7c2:
            candidate = read(sp + 8)
            if read(sp + 4) != component or read(sp + 12) != 0 or candidate not in active:
                raise RuntimeError("Unexpected eligibility boundary")
            return_hook(int(active[candidate].get("eligible", True)))
        elif address == 0x1dd78c:
            if read(sp + 4) != data:
                raise RuntimeError("Unexpected source clipping initialization")
            cpu.reg_write(UC_X86_REG_EDX, data)
        elif address == 0x1dd7b2:
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        elif address == 0x25dd10:
            nominations.append(read(sp + 0x34))

    cpu.hook_add(UC_HOOK_CODE, hook)
    bool_value = lambda row, key: row[key].lower() == "true"

    def initialize(owner, candidates, team, add_radius, current):
        nonlocal active, expected_query, broadphase_calls, nominations
        cpu.mem_write(heap, b"\0" * 0x10000)
        kind = "king" if owner["Name"] == "KingTower" else "character"
        write(body, next(int(v["address"], 16) for v in types["vtables"] if v["kind"] == kind))
        write(body + 0x10, data)
        write(body + 0x1c, team)
        write(body + 0x60, 2)
        write(component + 4, body)
        write(handle + 0x30, grid)
        write(collection, pointers)
        write(collection + 8, len(candidates))
        for offset, key in [(0x190, "Speed"), (0x1a0, "Range"), (0x1a4, "MinimumRange"),
                            (0x1a8, "SightRange"), (0x22c, "CollisionRadius"), (0x238, "SightClip"), (0x23c, "SightClipSide")]:
            write(data + offset, int(owner[key] or 0))
        cpu.mem_write(data + 0x28f, bytes([int(bool_value(owner, "TargetOnlyBuildings"))]))
        run(0x1dd78c, data)
        expected_clip = 0 if int(owner["Speed"] or 0) == 0 else int(owner["SightClip"] or 1000)
        if read(data + 0x238) != expected_clip:
            raise RuntimeError("Native sight-clip default differs")
        write(config + 0x38, extras["building"])
        write(config + 0x3c, extras["crown"])
        cpu.mem_write(config + 0x295, bytes([int(add_radius)]))
        expected_query = int(owner["SightRange"]) + (int(owner["CollisionRadius"]) if add_radius else 0) + max(extras.values())
        active, broadphase_calls, nominations = {}, [], []
        for index, candidate in enumerate(candidates):
            pointer, model = heap + 0x8000 + index * 0x200, heap + 0xb000 + index * 0x400
            source = sources[candidate["name"]]
            write(pointer, int(targets[source["Name"]]["vtable"], 16))
            write(pointer + 0x10, model)
            write(pointer + 0x20, candidate["x"])
            write(pointer + 0x24, candidate["y"])
            write(pointer + 0x60, 2)
            write(model + 0x190, int(source["Speed"] or 0))
            write(model + 0x22c, int(source["CollisionRadius"]))
            cpu.mem_write(model + 0x28a, bytes([int(bool_value(source, "IsSummonerTower"))]))
            write(pointers + index * 4, pointer)
            active[pointer] = candidate
            if candidate["id"] == current:
                write(component + 8, pointer)
        return expected_clip

    def predict(owner, candidates, team, add_radius, current=None, depth=0):
        own = int(owner["CollisionRadius"]) if add_radius else 0
        sight = int(owner["SightRange"]) + own
        clip = 0 if int(owner["Speed"] or 0) == 0 else int(owner["SightClip"] or 1000)
        side = int(owner["SightClipSide"] or 0)
        previous = predict(owner, candidates, team, add_radius, current, depth - 1)[1] if depth else None
        choices = []
        for candidate in candidates:
            if candidate["id"] in [current, previous] or not candidate.get("eligible", True):
                continue
            victim = targets[candidate["name"]]
            radius, flags = victim["CollisionRadius"], victim["flags"]
            minimum = int(owner["MinimumRange"] or 0)
            inner = abs(minimum + own - radius) if minimum > 0 and add_radius else minimum
            distance2 = candidate["x"] ** 2 + candidate["y"] ** 2
            extra = extras["crown"] if flags["0x60"] or flags["0x64"] else extras["building"] if flags["0x68"] else 0
            reach = sight + radius + extra
            if distance2 < inner ** 2 or distance2 > reach ** 2:
                continue
            if clip > 0 and int(owner["Speed"] or 0) != 0:
                limit = max(0, reach - clip)
                if (team == 0 and candidate["y"] < -limit) or (team == 1 and candidate["y"] > limit):
                    continue
            if side > 0 and abs(candidate["x"]) > max(0, reach - side):
                continue
            priority = int(bool_value(owner, "TargetOnlyBuildings") and bool(flags["0x68"]))
            choices.append((-priority, distance2, candidate))
        if not choices:
            return None, None
        nominee = min(choices, key=lambda choice: choice[:2])[2]
        radius = targets[nominee["name"]]["CollisionRadius"]
        maximum = int(owner["Range"]) + own + radius
        minimum = int(owner["MinimumRange"] or 0)
        inner = max(0, minimum + own - radius) if minimum > 0 else 0
        distance2 = nominee["x"] ** 2 + nominee["y"] ** 2
        selected = nominee["id"] if inner ** 2 <= distance2 <= maximum ** 2 else None
        return nominee["id"], selected

    if env["args"].electro_bolts:
        from lib.electro_bolts_probe import capture as capture_bolts
        capture_bolts(env, {"initialize": initialize, "predict": predict, "sources": sources,
                            "candidate_id": lambda pointer: active[pointer]["id"] if pointer in active else None})
        return

    cases = []
    for name, owner in sources.items():
        for add_radius in [False, True]:
            own = int(owner["CollisionRadius"]) if add_radius else 0
            reach = int(owner["Range"]) + own
            near = 5000 if int(owner["MinimumRange"] or 0) else max(1, math.floor((reach + 500) * 0.6))
            for team in [0, 1]:
                front = 1 if team == 0 else -1
                def candidate(id, kind, distance, eligible=True):
                    return {"id": id, "name": kind, "x": 0, "y": distance * front, "eligible": eligible}
                def lateral(id, kind, distance):
                    return {"id": id, "name": kind, "x": distance, "y": 0, "eligible": True}
                scenarios = [
                    ("center-over-edge", [lateral("a", "Knight", -near), lateral("b", "Giant", near + 100)], None, 0),
                    ("stable-center-tie", [lateral("a", "Knight", -near), lateral("b", "Giant", near)], None, 0),
                    ("native-building-priority", [candidate("a", "Knight", near), candidate("b", "Cannon", near + 200)], None, 0),
                    ("final-range-veto", [candidate("a", "PrincessTower", reach + 1001), candidate("b", "KingTower", reach + 1101)], None, 0),
                    ("farther-king-alone", [candidate("b", "KingTower", reach + 1101)], None, 0),
                    ("current-exclusion", [candidate("a", "Knight", near), candidate("b", "Giant", near + 100)], "a", 0),
                    ("eligibility-exclusion", [candidate("a", "Knight", near, False), candidate("b", "Giant", near + 100)], None, 0),
                    ("next-result-depth", [candidate("a", "Knight", near), candidate("b", "Giant", near + 100)], None, 1),
                    ("empty", [], None, 0),
                ]
                if int(owner["MinimumRange"] or 0) > 0:
                    inner = int(owner["MinimumRange"]) + (own - 500 if add_radius else 0)
                    for offset in [-1, 0, 1]:
                        scenarios.append((f"minimum-before-ranking-{offset}",
                                          [lateral("a", "Knight", -(inner + offset)), lateral("b", "Giant", inner + offset + 100)], None, 0))
                clip = 0 if int(owner["Speed"] or 0) == 0 else int(owner["SightClip"] or 1000)
                rear = max(0, int(owner["SightRange"]) + own + 500 - clip)
                for offset in [-1, 0, 1]:
                    scenarios.append((f"rear-clip-{offset}", [candidate("a", "Knight", -(rear + offset))], None, 0))
                if int(owner["SightClipSide"] or 0) > 0:
                    side = max(0, int(owner["SightRange"]) + own + 500 - int(owner["SightClipSide"]))
                    for offset in [-1, 0, 1]:
                        scenarios.append((f"side-clip-{offset}", [{"id": "a", "name": "Knight", "x": side + offset, "y": 0}], None, 0))
                for label, candidates, current, depth in scenarios:
                    for reverse in ([False, True] if len(candidates) > 1 else [False]):
                        ordered = candidates[::-1] if reverse else candidates
                        resolved_clip = initialize(owner, ordered, team, add_radius, current)
                        try:
                            selected = run(0x25d95e, component, depth, instruction_budget=16000)
                        except RuntimeError as error:
                            raise RuntimeError(json.dumps({"owner": name, "case": label, "depth": depth,
                                                           "eip": hex(cpu.reg_read(UC_X86_REG_EIP))})) from error
                        actual = active[selected]["id"] if selected in active else None
                        if selected and selected not in active:
                            raise RuntimeError("Native scanner returned an unknown pointer")
                        nominated = active[nominations[-1]]["id"] if nominations and nominations[-1] in active else None
                        expected = predict(owner, ordered, team, add_radius, current, depth)
                        if (nominated, actual) != expected:
                            raise RuntimeError(json.dumps({"owner": name, "case": label, "addOwnRadius": add_radius,
                                                           "team": team, "candidates": ordered, "expected": expected,
                                                           "nominated": nominated, "selected": actual}))
                        cases.append({"owner": name, "case": label, "addOwnRadius": add_radius, "teamIndex": team,
                                      "resolvedSightClip": resolved_clip, "candidates": ordered, "current": current, "depth": depth,
                                      "queryCalls": len(broadphase_calls), "nominated": nominated, "selected": actual})

    static = [
        ("buildingPriorityColumn", 0x1db5ec, 0x1db61a, "TargetOnlyBuildings string0x613f18 caches GOT+0x178c."),
        ("buildingPriorityField", 0x1d9297, 0x1d92af, "The source boolean loads Data+0x28f."),
        ("buildingPriorityGetter", 0x1de2c4, 0x1de2d8, "Reads Data+0x28f."),
        ("ownerClass", 0x218c24, 0x218c34, "Base character virtual+0x2c returns5."),
        ("nativePriority", 0x219e0a, 0x219e64, "Character owners with TargetOnlyBuildings prefer stationary targets; otherwise priority0."),
        ("clipColumnsAndFields", 0x1d993f, 0x1d999d, "SightClip/SightClipSide at strings0x613974/0x61397e load Data+0x238/+0x23c."),
        ("clipDefaults", 0x1dd78c, 0x1dd7b2, "Missing/zero SightClip becomes1000, then zero-speed owners clear it. This fragment executes with the source Data pointer."),
        ("clipGetters", 0x1def40, 0x1def68, "Read resolved rear/side clipping amounts."),
        ("ownerTeam", 0x2198d8, 0x21991f, "With the buff mask controlled zero, returns body+0x1c team index."),
        ("teamOrientation", 0x219a04, 0x219a33, "Returns true for even team index; source coordinates retain native orientation."),
        ("absoluteSideDistance", 0x35be20, 0x35be5a, "Native absolute integer lateral distance for side clipping."),
        ("clipAndRank", 0x25db97, 0x25dd10, "Apply directional clipping, then prefer larger priority and strictly smaller squared center distance; ties retain collection order."),
        ("currentAndRecursiveExclusion", 0x25da2c, 0x25daae, "Skip assigned current target and, when depth>0, the preceding recursive scan result."),
        ("finalAttackValidation", 0x25dd10, 0x25dd54, "Revalidate eligibility and native attack range only for the nominated candidate; return null on failure without retrying the next candidate."),
        ("nativeAttackPredicate", 0x25d6f2, 0x25d75c, "Resolve source maximum/minimum bounds and execute actual target geometry."),
        ("extraTargetCaller", 0x25d00b, 0x25d062, "The hit loop calls this scanner with recursive depth, applies hit index+1, and iterates Data+0x2e4 minus one. Primary lock acquisition instead calls0x25deb6."),
    ]
    blocks = []
    for name, start, end, meaning in static:
        assembly = subprocess.check_output(["objdump", "-d", "-Mintel", f"--start-address={start:#x}", f"--stop-address={end:#x}", str(env["args"].library)], text=True)
        instructions = [re.sub(r"\s+<[^>]+>", "", line.strip()) for line in assembly.splitlines() if re.match(r"\s+[0-9a-f]+:", line)]
        blocks.append({"name": name, "start": hex(start), "end": hex(end), "interpretation": meaning, "instructions": instructions})
    output = json.dumps({
        "source": "apk/1.8.1/x86/libg.so", "sha256": env["sha"], "emulator": "unicorn==2.1.4", "instructionBudget": 16000,
        "entryPoint": "0x25d95e", "role": "extra-target scan from the multi-target hit loop",
        "sourceGlobals": {"addCharacterRangeToRadius": settings["ADD_CHARACTER_RANGE_TO_RADIUS"]["BooleanValue"] == "TRUE",
                          "extraSightToBuilding": extras["building"], "extraSightToCrownTowers": extras["crown"]},
        "inputs": [*env["inputs"][:2], {"path": globals_path, "sha256": hashlib.sha256(global_bytes).hexdigest()},
                   {"path": types_path, "sha256": hashlib.sha256(types_bytes).hexdigest()}],
        "limits": [
            "Executes the native scanner through its actual return, class/radius/priority methods, clipping default fragment and final attack predicate. One supplied candidate array and per-candidate eligibility are controlled; spatial indexing and full native eligibility are not emulated.",
            "Minimal source-selected objects/Data are supplied as in the pinned target-type capture. Source Range/MinimumRange/SightRange/Speed/CollisionRadius/TargetOnlyBuildings/SightClip/SightClipSide are supplied, with other profile/Globals modifiers zero. Complete Data loading, movement and inherited profiles remain outside scope.",
            "Native team indices0/1 are numeric controls, not mapped to browser player colors. Buff mask zero excludes team inversion. Bodies use controlled state2; this does not establish the full live caller or state machine.",
            "Collection order, current-target exclusion and recursion depth are controlled. Browser movement destinations or existing-lock retention must not be inferred directly from this attack scanner.",
            "The retained caller identifies this as extra-target selection during multi-target hits. It is not the primary-lock scanner at0x25deb6; its center-distance comparison and final-range veto must not be generalized to primary acquisition.",
        ], "blocks": blocks,
        "owners": [{"table": targets[name]["table"], "name": name,
                    **{key: int(owner[key] or 0) for key in ["Range", "MinimumRange", "SightRange", "Speed", "CollisionRadius", "SightClip", "SightClipSide"]},
                    "TargetOnlyBuildings": bool_value(owner, "TargetOnlyBuildings")}
                   for name, owner in sources.items()],
        "cases": cases,
    }, indent=2) + "\n"
    path = Path("reference/client/candidate-ranking-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native candidate ranking capture differs")
    else:
        path.write_text(output)
    print(json.dumps({"owners": len(sources), "cases": len(cases), "blocks": len(blocks),
                      "finalRangeVetoes": sum(c["case"] == "final-range-veto" and c["nominated"] is not None and c["selected"] is None for c in cases)}))
