"""Native early projectile range/target binding followed by min/max bounds.

Caller frame, initialized muzzle/caster points, Data and table results are
supplied. Actual radius/range/homing predicate, normalization and stores execute.
Stops precede later owner/target-height, collision and world work.
"""

import csv
import hashlib
import io
import itertools
import json
import math
from pathlib import Path
import re
import struct
import subprocess
from collections import Counter
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_READ
from unicorn.x86_const import (
    UC_X86_REG_ESI,
    UC_X86_REG_EDI,
    UC_X86_REG_EAX,
    UC_X86_REG_EBP,
    UC_X86_REG_ESP,
    UC_X86_REG_EIP,
)


def capture(env, context):
    cpu, heap, body, data = [env[k] for k in ["cpu", "heap", "body", "data"]]
    read, write, run, initialize = [
        env[k] for k in ["read", "write", "run", "initialize"]
    ]
    paths = [
        "reference/client/attack-projectile-goals-native-trace.json",
        "reference/client/projectile-distance-native-trace.json",
        "reference/logic/projectiles.csv",
    ]
    inputs = [
        {"path": p, "sha256": hashlib.sha256(Path(p).read_bytes()).hexdigest()}
        for p in paths
    ]
    for path in paths[:2]:
        prior = json.loads(Path(path).read_text())
        if prior["sha256"] != env["sha"]:
            raise RuntimeError("Projectile range binary differs")
        for entry in prior["inputs"]:
            if (
                hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
                != entry["sha256"]
            ):
                raise RuntimeError("Projectile range provenance differs")
    columns = [
        {"name": "ProjectileRadius", "string": 0x6192EA, "dataOffset": 0x4C},
        {"name": "ProjectileRange", "string": 0x619572, "gotOffset": 0x1BE4},
        {"name": "Homing", "string": 0x619505, "gotOffset": 0x1B9C, "dataOffset": 0x78},
    ]
    for column in columns:
        value = column["name"].encode() + b"\0"
        if bytes(cpu.mem_read(column["string"], len(value))) != value:
            raise RuntimeError("Projectile range source column differs")
    actor, table, auxiliary = heap + 0xF000, heap + 0xE000, heap + 0xD000
    vector = env["stack"] + 0xF0000 + 0x40
    exits = {
        0x21D2C4: "ownerGate",
        0x21D3A1: "targetHeightGate",
        0x21D3C8: "laterInitializer",
    }
    env["allowed"].extend(
        [
            (0x21D0B2, 0x21D2C5),
            (0x21D3A1, 0x21D3A2),
            (0x21D3C8, 0x21D3C9),
            (0x1FB488, 0x1FB4D6),
            (0x1FBB9C, 0x1FBBD0),
            (0x219AF6, 0x219B26),
            (0x35D250, 0x35D50A),
            (0x35D550, 0x35D5C7),
            (0x35C120, 0x35C4DB),
        ]
    )
    names = {
        0x21960E: "projectileData",
        0x1FB488: "radiusRangePolicy",
        0x1FBB9C: "rangeGetter",
        0x219AF6: "x",
        0x219B06: "y",
        0x219B16: "z",
        0x35D250: "pointConstructor",
        0x35D290: "pointLength",
        0x35D470: "normalize",
        0x35D430: "pointSet",
        0x35D550: "pointAdd",
        0x35D590: "pointSubtract",
        0x35C120: "integerSqrt",
    }
    current, calls, reads, table_calls, exit_name = None, Counter(), [], [], None

    def hook(_cpu, pc, _size, _data):
        nonlocal exit_name
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if pc == 0x21D0B2:
            bp = sp + 0x600
            cpu.reg_write(UC_X86_REG_EBP, bp)
            for i, value in enumerate(current["arguments"]):
                write(bp + 8 + i * 4, value)
            write(sp + 0x30, current["callerStart"]["x"])
            cpu.reg_write(UC_X86_REG_ESI, body)
            cpu.reg_write(UC_X86_REG_EDI, current["target"])
        elif pc in [0x1FB4B8, 0x1FBBC5]:
            arguments = [read(sp), read(sp + 4)]
            if arguments != [table, read(0x7B8A14 + 0x1BE4)]:
                raise RuntimeError("Unexpected ProjectileRange table arguments")
            table_calls.append(
                {
                    "callSite": hex(pc),
                    "arguments": arguments,
                    "providedResult": current["fields"]["projectileRange"],
                }
            )
            cpu.reg_write(UC_X86_REG_EAX, current["fields"]["projectileRange"])
            cpu.reg_write(UC_X86_REG_EIP, pc + 5)
        elif pc in exits:
            exit_name = exits[pc]
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        else:
            name = names[pc]
            pointer = read(sp + 4)
            if name in ["radiusRangePolicy", "rangeGetter"]:
                expected = [data]
            elif name in ["x", "y"]:
                expected = [body] + ([actor] if current["actorPresent"] else [])
            elif name == "z" or name == "projectileData":
                expected = [body]
            elif name in ["normalize", "pointLength"]:
                expected = [vector, body + 0x5C]
            elif name in ["pointSet", "pointAdd"]:
                expected = [body + 0x5C]
            else:
                expected = [vector]
            if name != "integerSqrt" and pointer not in expected:
                raise RuntimeError(
                    f"Unexpected range getter/point: {name} {pointer:#x}"
                )
            if name in ["pointAdd", "pointSubtract"] and read(sp + 8) != body + 0x68:
                raise RuntimeError("Unexpected stored launch operand")
            calls[name] += 1

    def memory(_cpu, _access, address, size, _value, _data):
        reads.append((address - data, size))

    for pc in [0x21D0B2, 0x1FB4B8, 0x1FBBC5, *exits, *names]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)
    cpu.hook_add(UC_HOOK_MEM_READ, memory, begin=data, end=data + 0x7FF)
    rows = [
        r
        for r in csv.DictReader(io.StringIO(Path(paths[2]).read_text()))
        if r["Name"] not in ["", "string"]
    ]
    profiles = [
        {
            "sourceName": r["Name"],
            "projectileRadius": int(r["ProjectileRadius"] or 0),
            "projectileRange": int(r["ProjectileRange"] or 0),
            "homing": r["Homing"].lower() == "true",
            "minimum": int(r["MinDistance"] or 0),
            "maximum": int(r["MaxDistance"] or 0),
        }
        for r in rows
    ]
    if len(profiles) != 38 or {
        p["sourceName"]
        for p in profiles
        if p["projectileRadius"] > 0 and p["projectileRange"] > 0 and not p["homing"]
    } != {"BowlerProjectile", "LogProjectileRolling", "AxeManProjectile"}:
        raise RuntimeError("Recheck source range profiles")
    source = env["rows"]["reference/logic/characters.csv"]["Knight"]
    cases, controls = [], []

    def divide(numerator, denominator):
        return (-1 if numerator < 0 else 1) * (abs(numerator) // denominator)

    def distance(x, y):
        squared = x * x + y * y
        return (
            65535
            if abs(x) > 46340 or abs(y) > 46340 or squared >= 0x7FFFFFFF
            else math.isqrt(squared)
        )

    def normalize(x, y, bound):
        d = distance(x, y)
        return (divide(x * bound, d), divide(y * bound, d)) if d else (x, y)

    def sample(profile, origin, delta, present, live, overrides=None, kind="source"):
        nonlocal current, calls, reads, table_calls, exit_name
        fields = {**profile, **(overrides or {})}
        initialize({**source, "LoadTime": source["LoadTime"] or "0"})
        caster_point = {"x": 9000 + origin, "y": 16000 - origin}
        launch = {"x": caster_point["x"] + 250, "y": caster_point["y"] + 50, "z": 1723}
        caller_start = {
            "x": launch["x"] + fields.get("callerDx", 0),
            "y": launch["y"] + fields.get("callerDy", 0),
        }
        goal = {"x": caster_point["x"] + delta[0], "y": caster_point["y"] + delta[1]}
        target = context["target_a"] if live else 0
        owner = actor if fields.get("ownerPresent", True) else 0
        arguments = [
            body,
            actor if present else 0,
            caller_start["x"],
            caller_start["y"],
            launch["z"],
            target,
            goal["x"],
            goal["y"],
            owner,
            auxiliary,
            1,
            0,
        ]
        current = {
            "arguments": arguments,
            "target": target,
            "callerStart": caller_start,
            "fields": fields,
            "actorPresent": present,
        }
        write(data + 8, table)
        for offset, value in [
            (0x4C, fields["projectileRadius"]),
            (0x80, fields["minimum"]),
            (0x84, fields["maximum"]),
        ]:
            write(data + offset, value)
        cpu.mem_write(data + 0x78, bytes([fields["homing"]]))
        for offset, value in [
            (0x20, launch["x"]),
            (0x24, launch["y"]),
            (0x30, launch["z"]),
            (0x28, -713),
            (0x2C, -719),
            (0x34, -727),
            (0x54, -733),
            (0x58, -739),
            (0x5C, -743),
            (0x60, -751),
            (0x68, -757),
            (0x6C, -761),
            (0x70, -769),
            (0x7C, -773),
        ]:
            write(body + offset, value)
        write(actor + 0x20, caster_point["x"])
        write(actor + 0x24, caster_point["y"])
        before = bytes(cpu.mem_read(heap, 0x10000))
        active = (
            fields["projectileRadius"] > 0
            and fields["projectileRange"] > 0
            and not fields["homing"]
        )
        reference = caster_point if present else caller_start
        x, y = goal["x"], goal["y"]
        if active:
            dx, dy = normalize(
                x - reference["x"], y - reference["y"], fields["projectileRange"]
            )
            x, y = reference["x"] + dx, reference["y"] + dy
        range_goal = {"x": x, "y": y}
        x, y = x - launch["x"], y - launch["y"]
        minimum, maximum = fields["minimum"], fields["maximum"]
        min_clamp = bool(minimum and distance(x, y) < minimum)
        if min_clamp:
            x, y = normalize(x, y, minimum)
        max_clamp = bool(maximum and distance(x, y) > maximum)
        if max_clamp:
            x, y = normalize(x, y, maximum)
        expected_goal = {"x": launch["x"] + x, "y": launch["y"] + y}
        expected_heap = bytearray(before)
        for offset, value in [
            (0x54, owner),
            (0x58, 0 if active else target),
            (0x5C, expected_goal["x"]),
            (0x60, expected_goal["y"]),
            (0x68, launch["x"]),
            (0x6C, launch["y"]),
            (0x70, launch["z"]),
            (0x7C, auxiliary),
        ]:
            expected_heap[offset : offset + 4] = struct.pack("<i", value)
        calls, reads, table_calls, exit_name = Counter(), [], [], None
        run(0x21D0B2, instruction_budget=16000)
        if bytes(cpu.mem_read(heap, 0x10000)) != bytes(expected_heap):
            raise RuntimeError(
                f"Native range destination/heap differs: {fields} {delta} {present} {live}"
            )
        clamps = int(min_clamp) + int(max_clamp)
        expected_calls = {
            "projectileData": 2,
            "radiusRangePolicy": 1,
            "x": 1 + int(active and present),
            "y": 1 + int(active and present),
            "z": 1,
        }
        expected_reads = [(0x4C, 4)]
        expected_tables = []
        if fields["projectileRadius"] > 0:
            expected_reads.append((8, 4))
            expected_tables.append(
                {
                    "callSite": "0x1fb4b8",
                    "arguments": [table, read(0x7B8A14 + 0x1BE4)],
                    "providedResult": fields["projectileRange"],
                }
            )
            if fields["projectileRange"] > 0:
                expected_reads.append((0x78, 1))
        if active:
            expected_calls["rangeGetter"] = 1
            expected_reads.append((8, 4))
            expected_tables.append(
                {
                    "callSite": "0x1fbbc5",
                    "arguments": [table, read(0x7B8A14 + 0x1BE4)],
                    "providedResult": fields["projectileRange"],
                }
            )
        if minimum or maximum:
            expected_calls["projectileData"] = (
                3 + int(not minimum) + int(bool(minimum)) + int(bool(maximum)) + clamps
            )
            expected_calls.update({"pointConstructor": 1, "pointSubtract": 1})
            field_reads = {
                0x80: 2 + int(bool(minimum)) + int(min_clamp),
                0x84: int(not minimum) + 1 + int(bool(maximum)) + int(max_clamp),
            }
        else:
            field_reads = {0x80: 1, 0x84: 1}
        expected_calls["projectileData"] += 1 + int(active)
        expected_reads.extend(
            (offset, 4) for offset, count in field_reads.items() for _ in range(count)
        )
        lengths = (
            int(bool(minimum)) + int(bool(maximum)) + clamps
            if minimum or maximum
            else 0
        ) + int(active)
        if lengths:
            expected_calls.update({"pointLength": lengths, "integerSqrt": lengths})
        if clamps + int(active):
            expected_calls["normalize"] = clamps + int(active)
        if clamps:
            expected_calls.update({"pointSet": clamps, "pointAdd": clamps})
        expected_exit = (
            "laterInitializer"
            if not minimum and not maximum
            else "targetHeightGate" if not maximum else "ownerGate"
        )
        if (
            dict(calls) != expected_calls
            or sorted(reads) != sorted(expected_reads)
            or table_calls != expected_tables
            or exit_name != expected_exit
        ):
            raise RuntimeError(
                f"Native range calls/reads/exit differ: {dict(calls)} {expected_calls} {reads} {expected_reads} {table_calls} {exit_name}"
            )
        return {
            "kind": kind,
            "sourceName": profile["sourceName"],
            "fields": fields,
            "actorPresent": present,
            "liveTarget": live,
            "actorPoint": caster_point,
            "providedLaunch": launch,
            "callerStart": caller_start,
            "providedGoal": goal,
            "referencePoint": reference,
            "rangeApplied": active,
            "rangeGoal": range_goal,
            "minimumApplied": min_clamp,
            "maximumApplied": max_clamp,
            "initializedGoal": expected_goal,
            "targetCleared": active,
            "arguments": arguments,
            "tableRequests": list(table_calls),
            "getterCalls": dict(calls),
            "dataReads": {
                f"{offset:#x}/{size}": count
                for (offset, size), count in sorted(Counter(reads).items())
            },
            "stopBoundary": exit_name,
            "unrelatedHeapUnchanged": True,
        }

    vectors = [(0, 0), (1, 1), (250, 50), (3000, 4000), (-3000, 4000), (9000, 0)]
    for p, origin, delta, present, live in itertools.product(
        profiles, [0, -9125], vectors, [False, True], [False, True]
    ):
        cases.append(sample(p, origin, delta, present, live))
    rolling = [p for p in profiles if p["projectileRadius"] > 0]
    for p in rolling:
        for radius, length_value, homing in itertools.product(
            [-1, 0, 1, p["projectileRadius"]],
            [-1, 0, 1, p["projectileRange"]],
            [False, True],
        ):
            controls.append(
                sample(
                    p,
                    1333,
                    (3000, 4000),
                    True,
                    True,
                    {
                        "projectileRadius": radius,
                        "projectileRange": length_value,
                        "homing": homing,
                    },
                    "predicateOverride",
                )
            )
        for minimum, maximum in [
            (0, 0),
            (9000, 0),
            (0, 2500),
            (9000, 2500),
            (-1, 0),
            (0, -500),
        ]:
            for present in [False, True]:
                controls.append(
                    sample(
                        p,
                        1333,
                        (3000, -4000),
                        present,
                        True,
                        {"minimum": minimum, "maximum": maximum},
                        "boundsOverride",
                    )
                )
    axe = next(p for p in profiles if p["sourceName"] == "AxeManProjectile")
    for present, live, owner_present, caller_offset in itertools.product(
        [False, True], repeat=4
    ):
        controls.append(
            sample(
                axe,
                -9125,
                (3000, 4000),
                present,
                live,
                {
                    "ownerPresent": owner_present,
                    "callerDx": 313 if caller_offset else 0,
                    "callerDy": -619 if caller_offset else 0,
                },
                "referenceOverride",
            )
        )
    for p in [
        rolling[0],
        next(p for p in profiles if p["sourceName"] == "ArcherArrow"),
    ]:
        for delta in [(50000, 0), (-50000, 10000), (0, 50000)]:
            controls.append(sample(p, 0, delta, True, True, kind="largeVectorOverride"))
    asm = subprocess.check_output(
        ["objdump", "-d", "-Mintel", str(env["args"].library)], text=True
    )
    definitions = [
        (
            "rangeAndLaunchBinding",
            0x21D0B2,
            0x21D172,
            "Actual radius/range/homing selection, caster-or-caller direction normalization, target clearing and launch/owner/aux stores; earlier initialized body/frame supplied.",
        ),
        (
            "laterDistanceBounds",
            0x21D172,
            0x21D2C4,
            "Actual subsequent minimum/maximum bounds relative to stored muzzle, ending before owner/target-height work.",
        ),
        (
            "radiusRangePredicate",
            0x1FB488,
            0x1FB4D6,
            "Actual ProjectileRadius>0, supplied indexed ProjectileRange>0 and !Homing gate; table lookup callee is intercepted at its call site.",
        ),
        (
            "rangeGetter",
            0x1FBB9C,
            0x1FBBD0,
            "Actual ProjectileRange indexed lookup argument preparation; table result supplied at call site.",
        ),
        (
            "radiusColumnStore",
            0x1FA4A7,
            0x1FA4CF,
            "Named ProjectileRadius lookup stores Data+0x4c.",
        ),
        (
            "rangeColumnBinding",
            0x1FB36D,
            0x1FB3B1,
            "ProjectileRange source name initializes GOT+0x1be4.",
        ),
        (
            "homingColumnBinding",
            0x1FACDD,
            0x1FAD08,
            "Homing source name initializes GOT+0x1b9c.",
        ),
        (
            "homingColumnStore",
            0x1FA24B,
            0x1FA260,
            "Indexed source bool stores Data+0x78.",
        ),
        (
            "pointNormalize",
            0x35D430,
            0x35D50A,
            "Actual point set and signed integer normalization; zero direction remains zero.",
        ),
        (
            "pointLength",
            0x35D290,
            0x35D330,
            "Actual integer point length delegates squared saturation and square root.",
        ),
        (
            "minimumColumnStore",
            0x1FA707,
            0x1FA732,
            "Named MinDistance lookup stores Data+0x80.",
        ),
        (
            "maximumColumnStore",
            0x1FA73A,
            0x1FA765,
            "Named MaxDistance lookup stores Data+0x84.",
        ),
    ]
    blocks = []
    for name, start, end, interpretation in definitions:
        instructions = [
            line.strip()
            for line in asm.splitlines()
            if (m := re.match(r"\s*([0-9a-f]+):", line))
            and start <= int(m[1], 16) < end
        ]
        if not instructions:
            raise RuntimeError("Projectile range instruction block is empty")
        blocks.append(
            {
                "name": name,
                "start": hex(start),
                "end": hex(end),
                "interpretation": interpretation,
                "instructions": instructions,
            }
        )
    result = {
        "source": "apk/1.8.1/x86/libg.so",
        "sha256": env["sha"],
        "emulator": "unicorn==2.1.4",
        "inputs": inputs,
        "sourceColumns": columns,
        "limits": [
            "Actual early projectile initialization starts with supplied caller frame, initialized projectile/muzzle, caster/current points, target/owner/aux references and source Data. Earlier construction, target-height preparation and full wrapper/initializer execution are excluded.",
            "The actual radius/range/homing predicate and indexed range getter prepare source-row/column arguments. Calls to the generic indexed integer table lookup are intercepted at explicit call sites and receive the archived ProjectileRange value. Named source bindings are retained, not executed CSV loading or native table allocation.",
            "Positive ProjectileRadius and ProjectileRange with false Homing normalize goal minus caster center to ProjectileRange, add the caster center and clear the target. Null caster uses supplied caller-start XY instead. Subsequent native min/max bounds use the actual stored muzzle. Owner and auxiliary references are stored without natural resolution.",
            "Every stored target/owner/aux/launch/goal, table request/result, guarded getter/point argument, exact call/Data-read count, stop boundary and complete heap mutation matches independent integer calculations. Source rows include data-only spell/unused entries without claiming natural creation; changed predicate/bounds/references and large vectors are synthetic controls.",
            "Stops precede applicable owner/terrain, target-height or later initializer work. Later ConstantHeight, native movement/collision/arrival, damage, registration, world cadence and visuals remain separate. This captures source range initialization, not a complete natural flight. The application remains at rules 41.",
        ],
        "profiles": profiles,
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    output = json.dumps(result, indent=2) + "\n"
    path = Path("reference/client/projectile-range-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native projectile range capture differs")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "profiles": len(profiles),
                "cases": len(cases),
                "controls": len(controls),
                "rangeInitializations": sum(
                    r["rangeApplied"] for r in cases + controls
                ),
                "tableRequests": sum(len(r["tableRequests"]) for r in cases + controls),
                "blocks": len(blocks),
            }
        )
    )
