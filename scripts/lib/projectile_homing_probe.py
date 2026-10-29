"""Initialized native linear movement with supplied live/null target paths.

Actual bounds/height fragments, target refresh and ordinary movement execute.
Reference changes and target points are supplied; arrival damage is excluded.
"""

from collections import Counter
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import re
import struct
import subprocess

from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_READ
from unicorn.x86_const import (
    UC_X86_REG_EBP,
    UC_X86_REG_EIP,
    UC_X86_REG_ESI,
    UC_X86_REG_ESP,
)


def capture(env, context):
    cpu, heap, body, data = [env[k] for k in ["cpu", "heap", "body", "data"]]
    read, write, run = [env[k] for k in ["read", "write", "run"]]
    paths = [
        "reference/client/projectile-motion-native-trace.json",
        "reference/client/projectile-target-native-trace.json",
        "reference/client/projectile-range-native-trace.json",
        "reference/logic/projectiles.csv",
    ]
    inputs = [
        {"path": p, "sha256": hashlib.sha256(Path(p).read_bytes()).hexdigest()}
        for p in paths
    ]
    for path in paths[:-1]:
        prior = json.loads(Path(path).read_text())
        if prior["sha256"] != env["sha"]:
            raise RuntimeError("Projectile homing binary differs")
        for entry in prior["inputs"]:
            if (
                hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
                != entry["sha256"]
            ):
                raise RuntimeError("Projectile homing provenance differs")
    vtable, zero_function = 0x7B364C, 0x21453C
    if read(vtable + 0x10) != 0x21D796 or read(vtable + 0x38) != zero_function:
        raise RuntimeError("Projectile homing vtable differs")
    env["allowed"].extend(
        [
            (0x21D172, 0x21D2C5),
            (0x21D3A1, 0x21D3A2),
            (0x21D3C8, 0x21D3C9),
            (0x21D577, 0x21D5CC),
            (0x21D796, 0x21DBAD),
            (0x21E9F6, 0x21EA7A),
            (0x21961E, 0x219628),
            (0x219AAE, 0x219B32),
            (0x1FB78E, 0x1FB79E),
            (0x1FB488, 0x1FB4D6),
            (0x1FB83A, 0x1FB84B),
            (0x21453C, 0x214548),
            (0x35D250, 0x35D50A),
            (0x35D550, 0x35D66F),
            (0x35C120, 0x35C4DB),
        ]
    )
    targets = {"a": heap + 0x8000, "b": heap + 0x9000}
    stage, arrived, reference, expected_position = "", False, None, None
    calls, data_reads = Counter(), []
    names = {
        0x21960E: "Data",
        0x1FB78E: "speed",
        0x1FB488: "radiusRangePolicy",
        0x1FB83A: "homing",
        0x21961E: "baseNoop",
        0x21E9FE: "targetRefresh",
        0x219B26: "pointReference",
        0x35D5D0: "distance",
        0x219AF6: "X",
        0x219B06: "Y",
        0x219B16: "Z",
        0x219AAE: "positionStore",
        zero_function: "projectileVirtual38",
    }

    def hook(_cpu, pc, _size, _data):
        nonlocal arrived
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if pc in [0x21D172, 0x21D577]:
            cpu.reg_write(UC_X86_REG_EBP, sp + 0x600)
            write(sp + 0x608, body)
            write(sp + 0x634, -23)
            cpu.reg_write(UC_X86_REG_ESI, body)
            write(sp + 0x28, body + 0x68)
            write(sp + 0x2C, body + 0x5C)
        elif pc in [0x21D2C4, 0x21D3A1, 0x21D3C8, 0x21D5CB]:
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        elif pc == 0x21D83C:
            arrived = True
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        elif stage == "motion":
            name, pointer = names[pc], read(sp + 4)
            if name in ["X", "Y", "Z"]:
                if pointer == body:
                    name = "projectile" + name
                elif reference and pointer == targets[reference]:
                    name = "target" + name
                else:
                    raise RuntimeError("Unexpected homing coordinate getter owner")
            else:
                expected = (
                    data
                    if name in ["speed", "radiusRangePolicy", "homing"]
                    else body + 0x5C if name == "distance" else body
                )
                if pointer != expected:
                    raise RuntimeError(f"Unexpected homing getter argument: {name}")
            if name == "distance" and read(sp + 8) != body + 0x20:
                raise RuntimeError("Unexpected homing distance point")
            if (
                name == "positionStore"
                and [read(sp + i) for i in [8, 12, 16]] != expected_position
            ):
                raise RuntimeError("Unexpected homing position-store arguments")
            calls[name] += 1

    def memory(_cpu, _access, address, size, _value, _data):
        if stage == "motion":
            data_reads.append((address - data, size))

    for pc in [
        0x21D172,
        0x21D577,
        0x21D2C4,
        0x21D3A1,
        0x21D3C8,
        0x21D5CB,
        0x21D83C,
        *names,
    ]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)
    cpu.hook_add(UC_HOOK_MEM_READ, memory, begin=data, end=data + 0x7FF)
    rows = [
        r
        for r in csv.DictReader(io.StringIO(Path(paths[-1]).read_text()))
        if r["Name"] not in ["", "string"]
    ]
    profiles = []
    for row in rows:
        if row["Homing"].lower() != "true":
            continue
        if int(row["Speed"] or 0) <= 0 or any(
            int(row[k] or 0)
            for k in [
                "ProjectileRadius",
                "ProjectileRange",
                "PingpongVisualTime",
                "SpawnCharacterCount",
                "ConstantHeight",
                "MinDistance",
                "MaxDistance",
            ]
        ):
            raise RuntimeError("Recheck ordinary source homing profile")
        profiles.append(
            {
                "sourceName": row["Name"],
                "speedPerUpdate": int(row["Speed"]),
                "homing": True,
                "projectileRadius": 0,
                "pingpongVisualTime": 0,
                "constantHeight": 0,
                "minimum": 0,
                "maximum": 0,
            }
        )

    def divide(numerator, denominator):
        return (-1 if numerator < 0 else 1) * (abs(numerator) // denominator)

    def sample(profile, origin, scenario, overrides=None, max_updates=80):
        nonlocal stage, arrived, reference, expected_position
        values = {**profile, **(overrides or {})}
        cpu.mem_write(heap, bytes((i * 17 + 53) % 256 for i in range(0x10000)))
        launch = [8000 + origin, 18000 - origin, 1723]
        initial_goal = [launch[0] + 6000, launch[1] - 8000, 1800]
        target_origin = list(initial_goal)
        if "providedInitialDistance" in values:
            initial_goal[:2] = [
                launch[0] + values["providedInitialDistance"],
                launch[1],
            ]
        for pointer, value in [
            (body, vtable),
            (body + 0x10, data),
            (body + 0x58, targets["a"]),
            (body + 0x74, 0),
            (body + 0x88, 0),
            (data + 0x54, values["speedPerUpdate"]),
            (data + 0x98, 0),
            (data + 0x4C, 0),
            (data + 0x94, values["constantHeight"]),
            (data + 0x80, values["minimum"]),
            (data + 0x84, values["maximum"]),
        ]:
            write(pointer, value)
        cpu.mem_write(data + 0x78, bytes([int(values["homing"])]))
        for offsets, point in [
            ([0x20, 0x24, 0x30], launch),
            ([0x68, 0x6C, 0x70], launch),
            ([0x5C, 0x60, 0x64], initial_goal),
            ([0x28, 0x2C, 0x34], [-713, -719, -727]),
        ]:
            for offset, value in zip(offsets, point):
                write(body + offset, value)
        goal = list(initial_goal)
        for bound, minimum in [(values["minimum"], True), (values["maximum"], False)]:
            dx, dy = goal[0] - launch[0], goal[1] - launch[1]
            distance = math.isqrt(dx * dx + dy * dy)
            if (
                bound
                and distance
                and (distance < bound if minimum else distance > bound)
            ):
                goal[:2] = [
                    launch[0] + divide(dx * bound, distance),
                    launch[1] + divide(dy * bound, distance),
                ]
        position = list(launch)
        if values["constantHeight"]:
            position[2] = goal[2] = values["constantHeight"]
        expected_heap = bytearray(cpu.mem_read(heap, 0x10000))
        for offset, value in zip([0x5C, 0x60, 0x64], goal):
            struct.pack_into("<i", expected_heap, offset, value)
        struct.pack_into("<i", expected_heap, 0x30, position[2])
        struct.pack_into("<i", expected_heap, 0x70, position[2])
        stage = "prepare"
        run(0x21D172, instruction_budget=10000)
        run(0x21D577, instruction_budget=2000)
        if bytes(cpu.mem_read(heap, 0x10000)) != bytes(expected_heap):
            raise RuntimeError("Homing destination/height preparation differs")
        initialized = {
            "position": list(position),
            "goal": list(goal),
            "target": "a",
            "unrelatedHeapUnchanged": True,
        }
        frames = []
        stage = "motion"
        for update in range(1, max_updates + 1):
            reference = (
                None
                if scenario == "null"
                or (scenario == "lost" and update >= 3)
                or (scenario == "rebound" and update in [3, 4])
                else "b" if scenario == "rebound" and update >= 5 else "a"
            )
            drift = scenario != "stationary"
            a = [
                target_origin[0] + (45 * update if drift else 0),
                target_origin[1] + (20 * update if drift else 0),
                1800 + (((update % 7) - 3) * 131 if drift else 0),
            ]
            b = [
                target_origin[0] - 37 * update,
                target_origin[1] + 90 * update,
                4300 - 17 * update,
            ]
            if update == 1 and "providedFirstTargetDistance" in values:
                a[:2] = [launch[0] + values["providedFirstTargetDistance"], launch[1]]
            for label, point in [("a", a), ("b", b)]:
                for offset, value in zip([0x20, 0x24, 0x30], point):
                    write(targets[label] + offset, value)
            write(body + 0x58, targets[reference] if reference else 0)
            before = bytes(cpu.mem_read(heap, 0x10000))
            if reference and values["homing"]:
                goal = list(a if reference == "a" else b)
            dx, dy = goal[0] - position[0], goal[1] - position[1]
            distance = math.isqrt(dx * dx + dy * dy)
            should_arrive = distance <= values["speedPerUpdate"]
            if not should_arrive:
                position = [
                    p + divide((g - p) * values["speedPerUpdate"], distance)
                    for p, g in zip(position, goal)
                ]
            expected_position = list(position)
            expected_heap = bytearray(before)
            for offsets, point in [
                ([0x20, 0x24, 0x30], position),
                ([0x5C, 0x60, 0x64], goal),
            ]:
                for offset, value in zip(offsets, point):
                    struct.pack_into("<i", expected_heap, offset, value)
            calls.clear()
            data_reads.clear()
            arrived = False
            run(0x21D796, body, instruction_budget=10000)
            expected_calls = {
                "baseNoop": 1,
                "targetRefresh": 1,
                "pointReference": 1,
                "distance": 1,
                "speed": 1,
                "Data": (2 if should_arrive else 7) + int(reference is not None),
            }
            if reference:
                expected_calls["homing"] = 1
                if values["homing"]:
                    expected_calls.update(
                        {
                            "targetX": 1,
                            "targetY": 1,
                            "targetZ": 1,
                            "projectileVirtual38": 1,
                        }
                    )
            if not should_arrive:
                expected_calls.update(
                    {
                        "projectileX": 1,
                        "projectileY": 1,
                        "projectileZ": 1,
                        "radiusRangePolicy": 1,
                        "positionStore": 1,
                    }
                )
            expected_reads = Counter(
                {(0x54, 4): 1, (0x98, 4): 1 if should_arrive else 5}
            )
            if not should_arrive:
                expected_reads[(0x4C, 4)] = 1
            if reference:
                expected_reads[(0x78, 1)] = 1
            if (
                bytes(cpu.mem_read(heap, 0x10000)) != bytes(expected_heap)
                or arrived != should_arrive
            ):
                raise RuntimeError(
                    f"Native homing movement differs: {profile['sourceName']} {scenario} update {update}"
                )
            if dict(calls) != expected_calls or Counter(data_reads) != expected_reads:
                raise RuntimeError(
                    f"Homing getters/reads differ: {dict(calls)} {data_reads}"
                )
            frames.append(
                {
                    "update": update,
                    "providedReference": reference,
                    "providedTargets": {"a": a, "b": b},
                    "goal": list(goal),
                    "position": list(position),
                    "distance": distance,
                    "branch": "arrivalGate" if arrived else "linearMove",
                    "getterCalls": dict(calls),
                    "dataReads": {
                        f"{hex(o)}/{size}": count
                        for (o, size), count in sorted(expected_reads.items())
                    },
                    "unrelatedHeapUnchanged": True,
                }
            )
            if arrived:
                break
        return {
            "sourceName": profile["sourceName"],
            "kind": "control" if overrides else "source",
            "origin": origin,
            "scenario": scenario,
            "fields": values,
            "providedLaunch": launch,
            "providedGoal": initial_goal,
            "initialized": initialized,
            "frames": frames,
            "reachedArrivalGate": arrived,
        }

    cases = [
        sample(profile, origin, scenario)
        for profile in profiles
        for origin in [0, 1333]
        for scenario in ["stationary", "drift", "null", "lost", "rebound"]
    ]
    arrow = next(p for p in profiles if p["sourceName"] == "ArcherArrow")
    controls = [
        sample(
            arrow,
            0,
            scenario,
            override,
            max_updates=6 if "speedPerUpdate" in override else 80,
        )
        for scenario in ["drift", "null", "rebound"]
        for override in [
            {"homing": False},
            {"speedPerUpdate": 0},
            {"speedPerUpdate": 1},
            {"minimum": 12000},
            {"maximum": 4000},
            {"constantHeight": 3000},
        ]
    ]
    controls += [
        sample(
            arrow,
            0,
            "drift",
            {"providedFirstTargetDistance": arrow["speedPerUpdate"] + delta},
        )
        for delta in [-1, 0, 1]
    ]
    for scenario, extra in [("drift", {}), ("null", {}), ("drift", {"homing": False})]:
        controls.append(
            sample(
                arrow,
                0,
                scenario,
                {
                    "providedInitialDistance": arrow["speedPerUpdate"] - 1,
                    "providedFirstTargetDistance": 6000,
                    **extra,
                },
            )
        )
    if not all(row["reachedArrivalGate"] for row in cases):
        raise RuntimeError("Source homing case did not reach its bounded arrival gate")
    definitions = [
        (
            "ordinaryUpdate",
            0x21D796,
            0x21DBAD,
            "Actual base call, target refresh, linear movement and pre-effect arrival branch.",
        ),
        ("updateReturn", 0x21E9F6, 0x21E9FE, "Actual moving update epilogue."),
        (
            "targetRefresh",
            0x21E9FE,
            0x21EA7A,
            "Actual reference/Homing gates and target XYZ destination stores.",
        ),
        (
            "destinationBounds",
            0x21D172,
            0x21D2C4,
            "Actual min/max initializer fragment; caller frame is supplied.",
        ),
        (
            "constantHeight",
            0x21D577,
            0x21D5CB,
            "Actual later ConstantHeight fragment; caller frame is supplied.",
        ),
        (
            "sourceVirtual38",
            0x21453C,
            0x214548,
            "Actual source projectile virtual slot +0x38 returns zero.",
        ),
        ("homingGetter", 0x1FB83A, 0x1FB84B, "Actual byte getter at Data+0x78."),
        (
            "speedGetter",
            0x1FB78E,
            0x1FB79E,
            "Actual native Speed getter, per invoked update.",
        ),
        (
            "inactiveRadiusRangePolicy",
            0x1FB488,
            0x1FB4D6,
            "Actual source-zero ProjectileRadius gate excludes moving collision.",
        ),
        (
            "positionAndXYZ",
            0x219AAE,
            0x219B32,
            "Actual position stores, XYZ getters and point reference getter.",
        ),
    ]
    blocks = []
    for name, start, end, meaning in definitions:
        asm = subprocess.check_output(
            [
                "objdump",
                "-d",
                "-Mintel",
                f"--start-address={start}",
                f"--stop-address={end}",
                str(env["args"].library),
            ],
            text=True,
        )
        instructions = [
            line.strip()
            for line in asm.splitlines()
            if re.match(r"\s*[0-9a-f]+:", line)
        ]
        if not instructions:
            raise RuntimeError("Projectile homing instruction block is empty")
        blocks.append(
            {
                "name": name,
                "start": hex(start),
                "end": hex(end),
                "interpretation": meaning,
                "instructions": instructions,
            }
        )
    result = {
        "source": "apk/1.8.1/x86/libg.so",
        "sha256": env["sha"],
        "emulator": "unicorn==2.1.4",
        "inputs": inputs,
        "limits": [
            "Actual bounded min/max and ConstantHeight initialization precedes ordinary source projectile updates with supplied Data/header/reference records. Source profiles have positive Speed, true Homing, zero ProjectileRadius/Range, no return mode/children/height/bounds. Constructor, earlier initializer work, tables and reference lifecycle remain supplied.",
            "Target points and reference sequences are explicit inputs. Actual refresh selects current XYZ from a present homing reference; actual movement uses integer XY distance and signed truncated XYZ increments. Null/lost references preserve the previous goal. Rebound controls switch from one independently supplied target record to another.",
            "The actual source projectile virtual slot +0x38 returns zero. Source XYZ destination refresh therefore copies target XYZ without identifying natural actor Z/height or claiming complete target geometry. Synthetic bounds/height/Homing/speed controls do not describe source combinations.",
            "Exact getter arguments/counts, position-store arguments, Data reads, initialized state and every full 64-KiB heap mutation match independent integer calculations. Arrival is intercepted before arrived flags, hit effects/damage and removal. Native world cadence, allocation/registration, target eligibility/death, natural reference removal/reassignment, collisions and visuals remain outside scope; raw Speed remains per update. Application rules remain 43.",
        ],
        "profiles": profiles,
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    output = json.dumps(result, indent=2) + "\n"
    path = Path("reference/client/projectile-homing-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native projectile homing capture differs")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "profiles": len(profiles),
                "cases": len(cases),
                "controls": len(controls),
                "updates": sum(len(r["frames"]) for r in cases + controls),
                "blocks": len(blocks),
            }
        )
    )
