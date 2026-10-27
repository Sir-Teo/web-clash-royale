"""Bounded native projectile-initializer minimum/maximum destination rewrite.

The initialized projectile/Data, launch/goal points and caller frame are
supplied. Native point construction, distance, normalization and stores execute.
Later owner/terrain gates, projectile movement, collision and hits do not run.
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
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_READ
from unicorn.x86_const import (
    UC_X86_REG_ESI,
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
        "reference/client/projectile-height-native-trace.json",
        "reference/logic/projectiles.csv",
    ]
    inputs = [
        {"path": path, "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest()}
        for path in paths
    ]
    prior = json.loads(Path(paths[0]).read_text())
    if prior["sha256"] != env["sha"]:
        raise RuntimeError("Projectile distance reference uses another binary")
    for entry in prior["inputs"]:
        if (
            hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
            != entry["sha256"]
        ):
            raise RuntimeError("Projectile distance reference input differs")
    columns = [
        {"name": "MinDistance", "string": 0x61934F, "dataOffset": 0x80},
        {"name": "MaxDistance", "string": 0x61935B, "dataOffset": 0x84},
    ]
    for column in columns:
        encoded = column["name"].encode() + b"\0"
        if bytes(cpu.mem_read(column["string"], len(encoded))) != encoded:
            raise RuntimeError("Projectile distance column string differs")
    exits = {
        0x21D2C4: "ownerGate",
        0x21D3A1: "targetHeightGate",
        0x21D3C8: "laterInitializer",
    }
    env["allowed"].extend(
        [
            (0x21D172, 0x21D2C5),
            (0x21D3A1, 0x21D3A2),
            (0x21D3C8, 0x21D3C9),
            (0x35D250, 0x35D50A),
            (0x35D550, 0x35D5C7),
            (0x35C120, 0x35C4DB),
        ]
    )
    calls, data_reads, exit_name = {}, [], None
    stack_base = env["stack"] + 0xF0000
    vector = stack_base + 0x40
    names = {
        0x21960E: "projectileData",
        0x35D250: "pointConstructor",
        0x35D290: "pointLength",
        0x35D470: "normalize",
        0x35D430: "pointSet",
        0x35D550: "pointAdd",
        0x35D590: "pointSubtract",
        0x35C120: "integerSqrt",
    }

    def hook(_cpu, pc, _size, _data):
        nonlocal exit_name
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if pc == 0x21D172:
            cpu.reg_write(UC_X86_REG_EBP, sp + 0x600)
            write(sp + 0x608, body)
            cpu.reg_write(UC_X86_REG_ESI, body)
            write(sp + 0x28, body + 0x68)
            write(sp + 0x2C, body + 0x5C)
        elif pc in exits:
            exit_name = exits[pc]
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        else:
            name = names[pc]
            pointer = read(sp + 4)
            expected = (
                body
                if name == "projectileData"
                else body + 0x5C if name in ["pointSet", "pointAdd"] else vector
            )
            if name != "integerSqrt" and pointer != expected:
                raise RuntimeError(
                    f"Unexpected distance getter/point argument: {name} {pointer:#x}"
                )
            if name in ["pointAdd", "pointSubtract"] and read(sp + 8) != body + 0x68:
                raise RuntimeError("Unexpected launch-point argument")
            calls[name] = calls.get(name, 0) + 1

    def memory(_cpu, _access, address, size, _value, _data):
        data_reads.append((address - data, size))

    for pc in [0x21D172, *exits, *names]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)
    cpu.hook_add(UC_HOOK_MEM_READ, memory, begin=data, end=data + 0x7FF)
    profiles = [
        {
            "sourceName": row["Name"],
            "minimum": int(row["MinDistance"] or 0),
            "maximum": int(row["MaxDistance"] or 0),
        }
        for row in csv.DictReader(io.StringIO(Path(paths[1]).read_text()))
        if row["Name"] not in ["", "string"]
    ]
    seed_data = env["rows"]["reference/logic/characters.csv"]["Knight"]
    cases, controls = [], []

    def distance(x, y):
        squared = x * x + y * y
        # Actual point squared distance saturates; native sqrt's INT_MAX case
        # returns 65535. Arena-sized source vectors do not use this branch.
        return (
            65535
            if abs(x) > 46340 or abs(y) > 46340 or squared >= 0x7FFFFFFF
            else math.isqrt(squared)
        )

    def normalize(x, y, length):
        d = distance(x, y)
        if not d:
            return x, y

        def divide(numerator):
            return (-1 if numerator < 0 else 1) * (abs(numerator) // d)

        return divide(x * length), divide(y * length)

    def sample(profile, origin, delta, override=None, kind="source"):
        nonlocal calls, data_reads, exit_name
        initialize({**seed_data, "LoadTime": seed_data["LoadTime"] or "0"})
        minimum, maximum = (
            override
            if override is not None
            else (profile["minimum"], profile["maximum"])
        )
        launch = {"x": 9000 + origin, "y": 16000 + origin}
        goal = {"x": launch["x"] + delta[0], "y": launch["y"] + delta[1]}
        write(data + 0x80, minimum)
        write(data + 0x84, maximum)
        for offset, value in [
            (0x20, launch["x"]),
            (0x24, launch["y"]),
            (0x30, 1723),
            (0x28, -713),
            (0x2C, -719),
            (0x34, -727),
            (0x5C, goal["x"]),
            (0x60, goal["y"]),
            (0x68, launch["x"]),
            (0x6C, launch["y"]),
            (0x70, 1723),
            (0x64, 1800),
        ]:
            write(body + offset, value)
        before = bytes(cpu.mem_read(heap, 0x10000))
        x, y = delta
        min_clamp = bool(minimum and distance(x, y) < minimum)
        if min_clamp:
            x, y = normalize(x, y, minimum)
        max_clamp = bool(maximum and distance(x, y) > maximum)
        if max_clamp:
            x, y = normalize(x, y, maximum)
        expected_goal = {"x": launch["x"] + x, "y": launch["y"] + y}
        expected_heap = bytearray(before)
        for offset, value in [(0x5C, expected_goal["x"]), (0x60, expected_goal["y"])]:
            expected_heap[offset : offset + 4] = struct.pack("<i", value)
        calls, data_reads, exit_name = {}, [], None
        run(0x21D172, instruction_budget=10000)
        if bytes(cpu.mem_read(heap, 0x10000)) != bytes(expected_heap):
            raise RuntimeError(
                f"Native distance rewrite differs: {profile['sourceName']} {delta} {minimum} {maximum}"
            )
        expected_calls = {"projectileData": 2}
        if minimum or maximum:
            clamps = int(min_clamp) + int(max_clamp)
            expected_calls = {
                "projectileData": 3
                + int(not minimum)
                + int(bool(minimum))
                + int(bool(maximum))
                + clamps,
                "pointConstructor": 1,
                "pointSubtract": 1,
            }
            lengths = int(bool(minimum)) + int(bool(maximum)) + clamps
            if lengths:
                expected_calls.update({"pointLength": lengths, "integerSqrt": lengths})
            if clamps:
                expected_calls.update(
                    {"normalize": clamps, "pointSet": clamps, "pointAdd": clamps}
                )
            reads = {
                0x80: 2 + int(bool(minimum)) + int(min_clamp),
                0x84: int(not minimum) + 1 + int(bool(maximum)) + int(max_clamp),
            }
        else:
            reads = {0x80: 1, 0x84: 1}
        expected_reads = sorted(
            (offset, 4) for offset, count in reads.items() for _ in range(count)
        )
        expected_exit = (
            "laterInitializer"
            if not minimum and not maximum
            else "targetHeightGate" if not maximum else "ownerGate"
        )
        if (
            calls != expected_calls
            or sorted(data_reads) != expected_reads
            or exit_name != expected_exit
        ):
            raise RuntimeError(
                f"Native distance calls/reads/exit differ: {calls} {expected_calls} {data_reads} {expected_exit}"
            )
        return {
            "kind": kind,
            "sourceName": profile["sourceName"],
            "minimum": minimum,
            "maximum": maximum,
            "launch": launch,
            "goal": goal,
            "initialDistance": distance(*delta),
            "minimumApplied": min_clamp,
            "maximumApplied": max_clamp,
            "storedGoal": expected_goal,
            "exit": exit_name,
            "getterCalls": dict(calls),
            "dataReads": data_reads,
            "unrelatedHeapUnchanged": True,
        }

    vectors = [
        (0, 0),
        (1, 1),
        (-1, 1),
        (300, 400),
        (-300, -400),
        (3000, 4000),
        (-3000, 4000),
        (17000, 30000),
    ]
    for profile in profiles:
        bounds = profile["minimum"]
        points = list(
            dict.fromkeys([*vectors, (bounds - 1, 0), (bounds, 0), (bounds + 1, 0)])
        )
        for origin, delta in itertools.product([0, 1333, -9125], points):
            cases.append(sample(profile, origin, delta))
    selected = [
        next(p for p in profiles if p["sourceName"] == name)
        for name in ["ArcherArrow", "AxeManProjectile", "BowlerProjectile"]
    ]
    bounds = [
        (0, 0),
        (4500, 0),
        (0, 6500),
        (4500, 6500),
        (6500, 4500),
        (-1, 6500),
        (0, -500),
        (4500, -500),
    ]
    for profile, override, origin, delta in itertools.product(
        selected, bounds, [0, -9125], vectors
    ):
        controls.append(sample(profile, origin, delta, override, "boundsOverride"))
    saturated = [
        (46339, 0),
        (46340, 0),
        (46341, 0),
        (32767, 32767),
        (40000, 40000),
        (-46341, 0),
        (0, -46341),
        (52000, -1),
    ]
    for override, delta in itertools.product(
        [(4500, 0), (0, 6500), (4500, 6500)], saturated
    ):
        controls.append(sample(selected[0], 0, delta, override, "saturatedLength"))
    asm = subprocess.check_output(
        ["objdump", "-d", "-Mintel", str(env["args"].library)], text=True
    )
    definitions = [
        (
            "initializerDistanceGate",
            0x21D172,
            0x21D2C4,
            "Actual min/max fields, length comparisons, signed normalization and destination point writes.",
        ),
        ("pointConstructor", 0x35D250, 0x35D281, "Actual local point constructor."),
        (
            "pointLength",
            0x35D290,
            0x35D423,
            "Actual squared-distance saturation and integer-length call chain.",
        ),
        (
            "pointSetNormalize",
            0x35D430,
            0x35D50A,
            "Actual point set and signed integer normalization; zero length is unchanged.",
        ),
        (
            "pointAddSubtract",
            0x35D550,
            0x35D5C7,
            "Actual launch-point addition/subtraction.",
        ),
        (
            "integerSqrt",
            0x35C120,
            0x35C4DB,
            "Actual integer square root, including saturated INT_MAX behavior.",
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
            raise RuntimeError("Projectile distance instruction block is empty")
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
            "Actual bounded initializer distance rewrite, Data getters, point constructor, saturating distance, integer square root, signed normalization and point stores execute. Initialized projectile/Data, launch/goal coordinates and native caller frame are supplied.",
            "All 38 archived projectile rows use three translated origins and cardinal/diagonal/zero/tiny/arena-sized vectors, with exact minimum boundaries. Only four source rows have positive MinDistance; source MaxDistance is empty for every row. Nonzero/negative/reversed bounds and saturated lengths are synthetic controls.",
            "Every destination, minimum/maximum decision, getter count, exact Data read set and exit is checked against an independent integer model. Complete supplied heap mutation is confined to goal XY. Native point squared distance saturates at INT_MAX and the actual square-root helper returns 65535 for that argument; large-vector controls preserve this result without asserting natural reachability.",
            "Zero direction remains zero even when below a positive minimum. Minimum normalization precedes maximum normalization. Caller frame and every getter/point pointer are guarded. Named column lookup/store blocks are retained bindings, not executed CSV loading.",
            "Execution stops at the applicable later-initializer, target-height or owner gate. Natural owner/terrain adjustments, earlier allocation/registration, later initializer work, ProjectileRange-driven movement, trajectories, collision, hits and complete world execution remain excluded. Stored initializer destinations do not establish final traveled endpoints; application rules remain unchanged.",
        ],
        "profiles": profiles,
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    output = json.dumps(result, indent=2) + "\n"
    path = Path("reference/client/projectile-distance-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native projectile distance capture differs")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "profiles": len(profiles),
                "cases": len(cases),
                "controls": len(controls),
                "blocks": len(blocks),
            }
        )
    )
