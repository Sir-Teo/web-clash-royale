"""Bounded projectile initialization and null-target movement updates.

Actual min/max/height preparation precedes native movement or ping-pong updates.
Arrival is intercepted before damage/removal work; native world cadence,
allocation, registration, target propagation and collision remain excluded.
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
        "reference/client/projectile-distance-native-trace.json",
        "reference/logic/projectiles.csv",
    ]
    inputs = [
        {"path": path, "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest()}
        for path in paths
    ]
    prior = json.loads(Path(paths[0]).read_text())
    if prior["sha256"] != env["sha"]:
        raise RuntimeError("Projectile motion reference uses another binary")
    for entry in prior["inputs"]:
        if (
            hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
            != entry["sha256"]
        ):
            raise RuntimeError("Projectile motion reference input differs")
    for address, name in [(0x613ECC, "Speed"), (0x619484, "PingpongVisualTime")]:
        value = name.encode() + b"\0"
        if bytes(cpu.mem_read(address, len(value))) != value:
            raise RuntimeError("Projectile motion source string differs")
    sine_address = 0x642208
    sine_bytes = bytes(cpu.mem_read(sine_address, 91 * 4))
    sine_quarter = list(struct.unpack("<91i", sine_bytes))
    if sine_quarter != [round(math.sin(math.radians(a)) * 1024) for a in range(91)]:
        raise RuntimeError("Native sine table differs from independent Q10 rounding")
    vtable = 0x7B364C
    if read(vtable + 0x10) != 0x21D796:
        raise RuntimeError("Projectile vtable update binding differs")
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
            (0x35D250, 0x35D50A),
            (0x35D550, 0x35D66F),
            (0x35C120, 0x35C4DB),
            (0x35BF80, 0x35C08B),
            (0x35BEC0, 0x35BF0A),
        ]
    )
    stage, arrived, midpoint = "", False, False
    calls, data_reads = {}, []
    names = {
        0x21960E: "Data",
        0x1FB78E: "speed",
        0x1FB488: "radiusRangePolicy",
        0x21961E: "baseNoop",
        0x21E9FE: "targetRefresh",
        0x219B26: "pointReference",
        0x35D5D0: "distance",
        0x219AF6: "x",
        0x219B06: "y",
        0x219B16: "z",
        0x219AAE: "positionStore",
        0x35BF80: "sine",
    }

    def hook(_cpu, pc, _size, _data):
        nonlocal arrived, midpoint
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
        elif pc == 0x21D9E6:
            midpoint = True
        else:
            name = names[pc]
            pointer = read(sp + 4)
            expected = (
                data
                if name in ["speed", "radiusRangePolicy"]
                else body + 0x5C if name == "distance" else body
            )
            if name != "sine" and pointer != expected:
                raise RuntimeError(
                    f"Unexpected motion getter argument: {name} {pointer:#x}"
                )
            if name == "distance" and read(sp + 8) != body + 0x20:
                raise RuntimeError("Unexpected current-point argument")
            if stage == "motion":
                calls[name] = calls.get(name, 0) + 1

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
        0x21D9E6,
        *names,
    ]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)
    cpu.hook_add(UC_HOOK_MEM_READ, memory, begin=data, end=data + 0x7FF)
    rows = [
        r
        for r in csv.DictReader(io.StringIO(Path(paths[1]).read_text()))
        if r["Name"] not in ["", "string"]
    ]
    profiles = [
        {
            "sourceName": r["Name"],
            "speedPerUpdate": int(r["Speed"] or 0),
            "pingpongVisualTime": int(r["PingpongVisualTime"] or 0),
            "constantHeight": int(r["ConstantHeight"] or 0),
            "minimum": int(r["MinDistance"] or 0),
            "maximum": int(r["MaxDistance"] or 0),
            "homing": r["Homing"].lower() == "true",
            "sourceProjectileRadius": int(r["ProjectileRadius"] or 0),
            "providedProjectileRadius": 0,
        }
        for r in rows
        if int(r["Speed"] or 0) > 0 and int(r["SpawnCharacterCount"] or 0) == 0
    ]
    source = env["rows"]["reference/logic/characters.csv"]["Knight"]
    cases, controls = [], []
    total_updates = 0

    def divide(numerator, denominator):
        return (-1 if numerator < 0 else 1) * (abs(numerator) // denominator)

    def length(x, y):
        squared = x * x + y * y
        return (
            65535
            if abs(x) > 46340 or abs(y) > 46340 or squared >= 0x7FFFFFFF
            else math.isqrt(squared)
        )

    def sample(profile, origin, delta, overrides=None, kind="source", max_updates=120):
        nonlocal stage, calls, data_reads, arrived, midpoint, total_updates
        values = {**profile, **(overrides or {})}
        speed, duration = values["speedPerUpdate"], values["pingpongVisualTime"]
        initialize({**source, "LoadTime": source["LoadTime"] or "0"})
        launch_x, launch_y = 9000 + origin, 16000 + origin
        incoming_z, target_z = 1723, 1800
        for offset, value in [
            (0x54, speed),
            (0x98, duration),
            (0x94, values["constantHeight"]),
            (0x80, values["minimum"]),
            (0x84, values["maximum"]),
            (0x4C, values["providedProjectileRadius"]),
        ]:
            write(data + offset, value)
        cpu.mem_write(data + 0x78, bytes([values["homing"]]))
        for offset, value in [
            (0x20, launch_x),
            (0x24, launch_y),
            (0x30, incoming_z),
            (0x28, -713),
            (0x2C, -719),
            (0x34, -727),
            (0x5C, launch_x + delta[0]),
            (0x60, launch_y + delta[1]),
            (0x68, launch_x),
            (0x6C, launch_y),
            (0x70, incoming_z),
            (0x64, target_z),
            (0x74, values.get("warmMs", 0)),
            (0x88, values.get("raw88", 0)),
        ]:
            write(body + offset, value)
        dx, dy = delta
        for bound, use in [
            (values["minimum"], "minimum"),
            (values["maximum"], "maximum"),
        ]:
            distance = length(dx, dy)
            if (
                bound
                and (
                    (use == "minimum" and distance < bound)
                    or (use == "maximum" and distance > bound)
                )
                and distance
            ):
                dx, dy = divide(dx * bound, distance), divide(dy * bound, distance)
        goal_x, goal_y = launch_x + dx, launch_y + dy
        z = values["constantHeight"] or incoming_z
        target_z = values["constantHeight"] or target_z
        expected = bytearray(cpu.mem_read(heap, 0x10000))
        for offset, value in [
            (0x5C, goal_x),
            (0x60, goal_y),
            (0x30, z),
            (0x70, z),
            (0x64, target_z),
        ]:
            expected[offset : offset + 4] = struct.pack("<i", value)
        stage = "prepare"
        run(0x21D172, instruction_budget=10000)
        run(0x21D577, instruction_budget=2000)
        if bytes(cpu.mem_read(heap, 0x10000)) != bytes(expected):
            raise RuntimeError(
                "Chained native destination/height initialization differs"
            )
        x, y, timer, raw88 = (
            launch_x,
            launch_y,
            values.get("warmMs", 0),
            values.get("raw88", 0),
        )
        frames = []
        stage = "motion"
        for update in range(max_updates):
            distance = length(goal_x - x, goal_y - y)
            should_arrive = timer >= duration if duration else distance <= speed
            should_midpoint = False
            moved = False
            if not should_arrive:
                if duration:
                    timer += 50
                    half = duration // 2
                    should_midpoint = timer >= half and timer - 50 < half
                    if should_midpoint:
                        raw88 = 0
                    else:
                        angle = divide(timer * 180, duration)
                        weight = round(math.sin(math.radians(angle)) * 1024)
                        x = launch_x + divide((goal_x - launch_x) * weight, 1024)
                        y = launch_y + divide((goal_y - launch_y) * weight, 1024)
                        moved = True
                else:
                    x, y, z = (
                        x + divide((goal_x - x) * speed, distance),
                        y + divide((goal_y - y) * speed, distance),
                        z + divide((target_z - z) * speed, distance),
                    )
                    moved = True
            for offset, value in [
                (0x20, x),
                (0x24, y),
                (0x30, z),
                (0x74, timer),
                (0x88, raw88),
            ]:
                expected[offset : offset + 4] = struct.pack("<i", value)
            calls, data_reads, arrived, midpoint = {}, [], False, False
            run(0x21D796, body, instruction_budget=10000)
            total_updates += 1
            if (
                bytes(cpu.mem_read(heap, 0x10000)) != bytes(expected)
                or arrived != should_arrive
                or midpoint != should_midpoint
            ):
                raise RuntimeError(
                    f"Native projectile movement differs: {profile['sourceName']} update {update}"
                )
            expected_calls = {
                "baseNoop": 1,
                "targetRefresh": 1,
                "pointReference": 1,
                "distance": 1,
                "speed": 1,
                "Data": len(data_reads),
            }
            if moved:
                expected_calls.update(
                    {"x": 1, "y": 1, "z": 1, "radiusRangePolicy": 1, "positionStore": 1}
                )
                if duration:
                    expected_calls["sine"] = 2
            if (
                calls != expected_calls
                or not data_reads
                or any(
                    offset not in [0x54, 0x98, 0x4C] or size != 4
                    for offset, size in data_reads
                )
            ):
                raise RuntimeError(
                    f"Native projectile movement calls/reads differ: {calls} {expected_calls} {data_reads}"
                )
            read_counts = {
                hex(offset): sum(1 for address, _ in data_reads if address == offset)
                for offset in sorted({address for address, _ in data_reads})
            }
            frames.append(
                {
                    "update": update + 1,
                    "position": [x, y, z],
                    "elapsedMs": timer,
                    "raw88": raw88,
                    "branch": (
                        "arrivalGate"
                        if arrived
                        else (
                            "midpointReset"
                            if midpoint
                            else "pingpongMove" if duration else "linearMove"
                        )
                    ),
                    "getterCalls": dict(calls),
                    "dataReads": read_counts,
                    "unrelatedHeapUnchanged": True,
                }
            )
            if arrived:
                break
        return {
            "kind": kind,
            "sourceName": profile["sourceName"],
            "fields": values,
            "providedLaunch": {"x": launch_x, "y": launch_y, "z": incoming_z},
            "providedGoal": {"x": launch_x + delta[0], "y": launch_y + delta[1]},
            "initializedGoal": {"x": goal_x, "y": goal_y, "z": target_z},
            "initializedHeight": values["constantHeight"] or incoming_z,
            "target": None,
            "frames": frames,
            "reachedArrivalGate": arrived,
        }

    vectors = [(0, 0), (1, 1), (3000, 4000), (-3000, 4000), (9000, 0)]
    for profile, origin, delta in itertools.product(
        profiles, [0, 1333, -9125], vectors
    ):
        cases.append(sample(profile, origin, delta))
    axe = next(p for p in profiles if p["sourceName"] == "AxeManProjectile")
    arrow = next(p for p in profiles if p["sourceName"] == "ArcherArrow")
    for profile, duration, warm in itertools.product(
        [axe, arrow], [151, 750, 1500, 2000], [0, 749, 1499]
    ):
        controls.append(
            sample(
                profile,
                0,
                (3000, -4000),
                {"pingpongVisualTime": duration, "warmMs": warm, "raw88": 19},
                "clockOverride",
            )
        )
    controls.append(
        sample(axe, 0, (3000, 4000), {"pingpongVisualTime": 0}, "linearOverride")
    )
    for speed in [0, 1]:
        controls.append(
            sample(
                arrow,
                0,
                (3000, 4000),
                {"speedPerUpdate": speed},
                "speedOverride",
                max_updates=6,
            )
        )
    for profile in [axe, arrow]:
        controls.append(
            sample(
                profile,
                -9125,
                (3000, 4000),
                {"homing": not profile["homing"]},
                "nullTargetHomingOverride",
            )
        )
    for distance in [
        arrow["speedPerUpdate"] - 1,
        arrow["speedPerUpdate"],
        arrow["speedPerUpdate"] + 1,
    ]:
        controls.append(sample(arrow, 0, (distance, 0), kind="arrivalBoundary"))
    asm = subprocess.check_output(
        ["objdump", "-d", "-Mintel", str(env["args"].library)], text=True
    )
    definitions = [
        (
            "nativeUpdateMovingPrefix",
            0x21D796,
            0x21DBAD,
            "Actual no-op/base call, refresh, distance/speed gate, ping-pong timer/reset/sine or linear XYZ update and position store; stop before arrival effects.",
        ),
        (
            "nativeUpdateReturn",
            0x21E9F6,
            0x21E9FE,
            "Actual update epilogue returns without later hit work on moving/reset paths.",
        ),
        (
            "nullTargetRefresh",
            0x21E9FE,
            0x21EA7A,
            "Actual refresh exits for supplied null target; live target behavior is outside this capture.",
        ),
        (
            "speedGetter",
            0x1FB78E,
            0x1FB79E,
            "Actual Data+0x54 speed getter, measured per invoked native update.",
        ),
        (
            "suppressedRadiusRangePolicy",
            0x1FB488,
            0x1FB4D6,
            "Actual radius/range predicate returns false for supplied Data+0x4c zero; that field is ProjectileRadius, not SpawnCharacterCount.",
        ),
        (
            "projectileRadiusColumnStore",
            0x1FA4A7,
            0x1FA4CF,
            "Named ProjectileRadius lookup stores Data+0x4c; capture supplies zero to suppress range/collision behavior, including rows with a positive source radius.",
        ),
        (
            "sineMultiply",
            0x35BF80,
            0x35C08B,
            "Actual signed Q10 sine lookup/multiplication with integer-degree folding.",
        ),
        (
            "speedColumn",
            0x1FAB5E,
            0x1FAB89,
            "Speed column string initializes GOT+0x1b8c.",
        ),
        (
            "speedStore",
            0x1FA236,
            0x1FA24B,
            "Indexed integer source getter stores Data+0x54.",
        ),
        (
            "pingpongColumnStore",
            0x1FA971,
            0x1FA99C,
            "Named PingpongVisualTime lookup stores Data+0x98.",
        ),
        (
            "projectileVtableBinding",
            0x21CB2D,
            0x21CB35,
            "Constructor installs vtable 0x7b364c; its +0x10 entry is the captured update method.",
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
            raise RuntimeError("Projectile motion instruction block is empty")
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
        "sineLookup": {
            "address": hex(sine_address),
            "sha256": hashlib.sha256(sine_bytes).hexdigest(),
            "scale": 1024,
            "quarter": sine_quarter,
        },
        "limits": [
            "Actual bounded min/max and ConstantHeight initialization precede controlled projectile update invocation. Positive-Speed source rows selected without spawned characters supply speed/clocks/bounds/height for translated zero/tiny/cardinal/diagonal goals. ProjectileRadius at Data+0x4c is explicitly overridden to zero in every case, including three positive-radius source rows; the earlier range initializer and rolling collision path are excluded. This field is not SpawnCharacterCount. Projectile/Data, initialized points, target height and null target are supplied; data-only rows do not establish natural construction.",
            "The captured vtable update executes its real no-op base call, null-target refresh, distance/speed decisions, integer linear XYZ motion or positive PingpongVisualTime clock/sine motion, midpoint raw-field reset and position stores. The native elapsed word increments fifty per applicable invocation. Global owner/world update cadence is not executed; raw Speed is measured per update, not assigned a per-second interpretation.",
            "Native Q10 sine lookup is verified against independent rounded sine values for every quarter-wave entry. Every initialized goal/height, frame, selected arrival/midpoint branch, getter count, allowed Data field read and complete heap mutation matches independent integer calculations. Controls alter clocks, speed, null-target homing flags and arrival boundaries.",
            "Arrival stops before the actual arrived-flag, damage/refund/effect/removal path. The supplied zero radius suppresses the native radius/range predicate and its moving collision call; this does not execute full projectile collision, registration, owner/target propagation, child spawning, world cadence or visuals. Stored/native sampled positions are not claims about full natural flights or browser timing. Application rules remain unchanged.",
        ],
        "profiles": profiles,
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    output = json.dumps(result, indent=2) + "\n"
    path = Path("reference/client/projectile-motion-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native projectile motion capture differs")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "profiles": len(profiles),
                "cases": len(cases),
                "controls": len(controls),
                "updates": total_updates,
                "blocks": len(blocks),
            }
        )
    )
