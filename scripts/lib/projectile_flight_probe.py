"""Bounded native rolling/returning initialization, motion and collision requests.

Data, caller/muzzle/caster points and table results are supplied. The moving
collision handler and arrival effects are intercepted; natural hits do not run.
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
    read, write, run, initialize, ret = [
        env[k] for k in ["read", "write", "run", "initialize", "return_hook"]
    ]
    paths = [
        "reference/client/projectile-range-native-trace.json",
        "reference/client/projectile-motion-native-trace.json",
        "reference/client/projectile-height-native-trace.json",
        "reference/logic/projectiles.csv",
    ]
    inputs = [
        {"path": p, "sha256": hashlib.sha256(Path(p).read_bytes()).hexdigest()}
        for p in paths
    ]
    references = [json.loads(Path(p).read_text()) for p in paths[:3]]
    for prior in references:
        if prior["sha256"] != env["sha"]:
            raise RuntimeError("Projectile flight binary differs")
        for entry in prior["inputs"]:
            if (
                hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
                != entry["sha256"]
            ):
                raise RuntimeError("Projectile flight provenance differs")
    rows = {
        r["Name"]: r
        for r in csv.DictReader(io.StringIO(Path(paths[3]).read_text()))
        if r["Name"] not in ["", "string"]
    }
    profiles = [
        {
            **p,
            "speedPerUpdate": int(rows[p["sourceName"]]["Speed"] or 0),
            "pingpongVisualTime": int(rows[p["sourceName"]]["PingpongVisualTime"] or 0),
            "constantHeight": int(rows[p["sourceName"]]["ConstantHeight"] or 0),
        }
        for p in references[0]["profiles"]
        if p["projectileRadius"] > 0 and p["projectileRange"] > 0 and not p["homing"]
    ]
    if len(profiles) != 3 or any(
        rows[p["sourceName"]]["SpawnProjectile"]
        or int(rows[p["sourceName"]]["RandomAngle"] or 0)
        or p["maximum"]
        for p in profiles
    ):
        raise RuntimeError("Recheck supported late initializer source fields")
    profile_by_name = {p["sourceName"]: p for p in profiles}
    quarter = list(struct.unpack("<91i", bytes(cpu.mem_read(0x642208, 91 * 4))))
    if quarter != [round(math.sin(math.radians(a)) * 1024) for a in range(91)]:
        raise RuntimeError("Native flight Q10 sine table differs")
    columns = [
        {
            "name": "SpawnProjectile",
            "string": 0x619582,
            "gotOffset": 0x1BE8,
            "dataOffset": 0x44,
        },
        {"name": "RandomAngle", "string": 0x619497, "dataOffset": 0xA0},
    ]
    for c in columns:
        value = c["name"].encode() + b"\0"
        if bytes(cpu.mem_read(c["string"], len(value))) != value:
            raise RuntimeError("Late initializer source column differs")
    actor, table = heap + 0xF000, heap + 0xE000
    vector = env["stack"] + 0xF0000 + 0x40
    env["allowed"].extend(
        [
            (0x21D0B2, 0x21D5CC),
            (0x21D796, 0x21DBAD),
            (0x21E9F6, 0x21EA7B),
            (0x21961E, 0x219628),
            (0x219AAE, 0x219B32),
            (0x1FB78E, 0x1FB79E),
            (0x1FB488, 0x1FB4D6),
            (0x1FBB9C, 0x1FBBD0),
            (0x35D250, 0x35D50A),
            (0x35D550, 0x35D66F),
            (0x35C120, 0x35C4DB),
            (0x35BF80, 0x35C08B),
            (0x35BEC0, 0x35BF0A),
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
        0x219AAE: "positionSetter",
        0x21961E: "baseNoop",
        0x21E9FE: "targetRefresh",
        0x219B26: "pointReference",
        0x35D5D0: "distance",
        0x1FB78E: "speed",
        0x35BF80: "sine",
    }
    current, stage, calls, reads, tables, collisions, arrived, midpoint = (
        None,
        "",
        Counter(),
        [],
        [],
        [],
        False,
        False,
    )

    def hook(_cpu, pc, _size, _data):
        nonlocal arrived, midpoint
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if pc == 0x21D0B2:
            bp = sp + 0x600
            cpu.reg_write(UC_X86_REG_EBP, bp)
            for i, value in enumerate(current["arguments"]):
                write(bp + 8 + i * 4, value)
            write(sp + 0x30, current["callerStart"]["x"])
            cpu.reg_write(UC_X86_REG_ESI, body)
            cpu.reg_write(UC_X86_REG_EDI, current["arguments"][5])
        elif pc in [0x1FB4B8, 0x1FBBC5]:
            args = [read(sp), read(sp + 4)]
            if args != [table, read(0x7B8A14 + 0x1BE4)]:
                raise RuntimeError("Unexpected flight range table arguments")
            tables.append(
                {
                    "callSite": hex(pc),
                    "arguments": args,
                    "providedResult": current["fields"]["projectileRange"],
                }
            )
            cpu.reg_write(UC_X86_REG_EAX, current["fields"]["projectileRange"])
            cpu.reg_write(UC_X86_REG_EIP, pc + 5)
        elif pc == 0x21D5CB:
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        elif pc == 0x21D83C:
            arrived = True
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        elif pc == 0x21D9E6:
            midpoint = True
        elif pc == 0x21EA7A:
            # The callee reads slots 1/2/3/5. Slot 4 is unused stack content.
            request = {
                "projectile": read(sp + 4),
                "x": read(sp + 8),
                "y": read(sp + 12),
                "modeFlag": read(sp + 20),
            }
            if request["projectile"] != body:
                raise RuntimeError("Unexpected moving collision owner")
            collisions.append(request)
            ret()
        else:
            name = names[pc]
            pointer = read(sp + 4)
            if name in ["radiusRangePolicy", "rangeGetter", "speed"]:
                expected = [data]
            elif name in ["normalize", "pointLength"]:
                expected = [vector, body + 0x5C]
            elif name in ["pointSet", "pointAdd", "distance"]:
                expected = [body + 0x5C]
            elif name in ["pointConstructor", "pointSubtract"]:
                expected = [vector]
            elif name in ["x", "y"] and stage == "initialize":
                expected = [body, actor] if current["actorPresent"] else [body]
            else:
                expected = [body]
            if name not in ["integerSqrt", "sine"] and pointer not in expected:
                raise RuntimeError(
                    f"Unexpected flight getter/point: {name} {pointer:#x}"
                )
            if name in ["pointAdd", "pointSubtract"] and read(sp + 8) != body + 0x68:
                raise RuntimeError("Unexpected flight launch operand")
            if name == "distance" and read(sp + 8) != body + 0x20:
                raise RuntimeError("Unexpected flight current-point operand")
            calls[name] += 1

    def memory(_cpu, _access, address, size, _value, _data):
        reads.append((address - data, size))

    for pc in [
        0x21D0B2,
        0x1FB4B8,
        0x1FBBC5,
        0x21D5CB,
        0x21D83C,
        0x21D9E6,
        0x21EA7A,
        *names,
    ]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)
    cpu.hook_add(UC_HOOK_MEM_READ, memory, begin=data, end=data + 0x7FF)
    source = env["rows"]["reference/logic/characters.csv"]["Knight"]
    cases, controls = [], []
    total_updates = 0
    total_collisions = 0

    def divide(n, d):
        return (-1 if n < 0 else 1) * (abs(n) // d)

    def distance(x, y):
        return math.isqrt(x * x + y * y)

    def normalized(x, y, bound):
        d = distance(x, y)
        return (divide(x * bound, d), divide(y * bound, d)) if d else (x, y)

    def write_expected(expected, offset, value):
        expected[offset : offset + 4] = struct.pack("<i", value)

    def decode_reads(value):
        return Counter(
            {
                (int(k.split("/")[0], 16), int(k.split("/")[1])): v
                for k, v in value.items()
            }
        )

    def table_request(site):
        return {
            "callSite": site,
            "arguments": [table, read(0x7B8A14 + 0x1BE4)],
            "providedResult": current["fields"]["projectileRange"],
        }

    def sample(reference, overrides=None, kind="source", max_updates=120):
        nonlocal current, stage, calls, reads, tables, collisions, arrived, midpoint, total_updates, total_collisions
        profile = profile_by_name[reference["sourceName"]]
        fields = {**profile, **(overrides or {})}
        current = {**reference, "fields": fields}
        initialize({**source, "LoadTime": source["LoadTime"] or "0"})
        launch = reference["providedLaunch"]
        origin = reference["referencePoint"]
        goal = reference["providedGoal"]
        dx, dy = normalized(
            goal["x"] - origin["x"], goal["y"] - origin["y"], fields["projectileRange"]
        )
        gx, gy = origin["x"] + dx, origin["y"] + dy
        dx, dy = gx - launch["x"], gy - launch["y"]
        if fields["minimum"] and distance(dx, dy) < fields["minimum"]:
            dx, dy = normalized(dx, dy, fields["minimum"])
        gx, gy = launch["x"] + dx, launch["y"] + dy
        if {"x": gx, "y": gy} != reference["initializedGoal"]:
            raise RuntimeError("Independent flight range model differs")
        write(data + 8, table)
        for offset, value in [
            (0x44, 0),
            (0x4C, fields["projectileRadius"]),
            (0x54, fields["speedPerUpdate"]),
            (0x80, fields["minimum"]),
            (0x84, fields["maximum"]),
            (0x94, fields["constantHeight"]),
            (0x98, fields["pingpongVisualTime"]),
            (0xA0, 0),
        ]:
            write(data + offset, value)
        cpu.mem_write(data + 0x78, b"\0")
        timer = fields.get("warmMs", 0)
        raw88 = fields.get("raw88", 0)
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
            (0x64, 1800),
            (0x68, -757),
            (0x6C, -761),
            (0x70, -769),
            (0x74, timer),
            (0x7C, -773),
            (0x88, raw88),
        ]:
            write(body + offset, value)
        write(actor + 0x20, reference["actorPoint"]["x"])
        write(actor + 0x24, reference["actorPoint"]["y"])
        expected = bytearray(cpu.mem_read(heap, 0x10000))
        z = fields["constantHeight"] or launch["z"]
        for offset, value in [
            (0x54, reference["arguments"][8]),
            (0x58, 0),
            (0x5C, gx),
            (0x60, gy),
            (0x64, z),
            (0x68, launch["x"]),
            (0x6C, launch["y"]),
            (0x70, z),
            (0x7C, reference["arguments"][9]),
            (0x30, z),
        ]:
            write_expected(expected, offset, value)
        calls, reads, tables, collisions, arrived, midpoint = (
            Counter(),
            [],
            [],
            [],
            False,
            False,
        )
        stage = "initialize"
        run(0x21D0B2, instruction_budget=20000)
        h = int(bool(fields["constantHeight"]))
        expected_calls = Counter(reference["getterCalls"])
        expected_calls.update({"projectileData": 5 + h, "radiusRangePolicy": 2})
        if h:
            expected_calls.update({"x": 1, "y": 1, "positionSetter": 1})
        expected_reads = decode_reads(reference["dataReads"])
        expected_reads.update(
            {
                (0xA0, 4): 1,
                (0x44, 4): 1,
                (0x4C, 4): 2,
                (8, 4): 2,
                (0x78, 1): 2,
                (0x94, 4): 1 + h,
            }
        )
        expected_tables = [
            *reference["tableRequests"],
            table_request("0x1fb4b8"),
            table_request("0x1fb4b8"),
        ]
        if (
            bytes(cpu.mem_read(heap, 0x10000)) != bytes(expected)
            or calls != expected_calls
            or Counter(reads) != expected_reads
            or tables != expected_tables
            or collisions
        ):
            raise RuntimeError(
                f"Native late initializer differs: {fields} {dict(calls)} {dict(expected_calls)} {Counter(reads)} {expected_reads}"
            )
        initialization = {
            "goal": {"x": gx, "y": gy},
            "position": {"x": launch["x"], "y": launch["y"], "z": z},
            "targetHeight": z,
            "launchHeight": z,
            "target": None,
            "getterCalls": dict(calls),
            "dataReads": {
                f"{o:#x}/{s}": n for (o, s), n in sorted(Counter(reads).items())
            },
            "tableRequests": list(tables),
            "unrelatedHeapUnchanged": True,
        }
        x, y = launch["x"], launch["y"]
        speed = fields["speedPerUpdate"]
        duration = fields["pingpongVisualTime"]
        frames = []
        stage = "motion"
        for update in range(max_updates):
            d = distance(gx - x, gy - y)
            old_timer = timer
            old_x, old_y = x, y
            should_arrive = timer >= duration if duration else d <= speed
            should_midpoint = False
            moved = False
            time_reads = int(d <= speed)
            if not (d <= speed and not duration):
                time_reads += 1 + int(old_timer >= duration)
                if not should_arrive:
                    time_reads += 2
                    if duration:
                        timer += 50
                        half = duration // 2
                        time_reads += 1 + int(timer >= half)
                        should_midpoint = timer >= half and old_timer < half
                        if should_midpoint:
                            raw88 = 0
                    if not should_midpoint:
                        moved = True
                        time_reads += 1
                        if duration:
                            time_reads += 2
                            angle = divide(timer * 180, duration)
                            weight = round(math.sin(math.radians(angle)) * 1024)
                            x = launch["x"] + divide((gx - launch["x"]) * weight, 1024)
                            y = launch["y"] + divide((gy - launch["y"]) * weight, 1024)
                        else:
                            x += divide((gx - x) * speed, d)
                            y += divide((gy - y) * speed, d)
            for offset, value in [
                (0x20, x),
                (0x24, y),
                (0x30, z),
                (0x74, timer),
                (0x88, raw88),
            ]:
                write_expected(expected, offset, value)
            calls, reads, tables, collisions, arrived, midpoint = (
                Counter(),
                [],
                [],
                [],
                False,
                False,
            )
            run(0x21D796, body, instruction_budget=20000)
            total_updates += 1
            expected_calls = Counter(
                {
                    "baseNoop": 1,
                    "targetRefresh": 1,
                    "pointReference": 1,
                    "distance": 1,
                    "integerSqrt": 1,
                    "speed": 1,
                    "projectileData": 1 + time_reads + int(moved),
                }
            )
            expected_reads = Counter({(0x54, 4): 1, (0x98, 4): time_reads})
            expected_collisions = []
            expected_tables = []
            if moved:
                expected_calls.update(
                    {
                        "x": 1,
                        "y": 1,
                        "z": 1,
                        "radiusRangePolicy": 1,
                        "positionSetter": 1,
                    }
                )
                if duration:
                    expected_calls["sine"] = 2
                expected_reads.update({(0x4C, 4): 1, (8, 4): 1, (0x78, 1): 1})
                expected_tables = [table_request("0x1fb4b8")]
                expected_collisions = [
                    {
                        "projectile": body,
                        "x": x if duration else x - old_x,
                        "y": y if duration else y - old_y,
                        "modeFlag": 0 if duration else 1,
                    }
                ]
            if (
                bytes(cpu.mem_read(heap, 0x10000)) != bytes(expected)
                or arrived != should_arrive
                or midpoint != should_midpoint
                or calls != expected_calls
                or Counter(reads) != expected_reads
                or tables != expected_tables
                or collisions != expected_collisions
            ):
                raise RuntimeError(
                    f"Native rolling/returning frame differs: {fields} {update+1} {dict(calls)} {dict(expected_calls)} {Counter(reads)} {expected_reads} {collisions} {expected_collisions}"
                )
            total_collisions += len(collisions)
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
                    "collisionRequests": list(collisions),
                    "tableRequests": list(tables),
                    "getterCalls": dict(calls),
                    "dataReads": {
                        f"{o:#x}/{s}": n for (o, s), n in sorted(Counter(reads).items())
                    },
                    "unrelatedHeapUnchanged": True,
                }
            )
            if arrived:
                break
        return {
            "kind": kind,
            "sourceName": profile["sourceName"],
            "fields": fields,
            "actorPresent": reference["actorPresent"],
            "liveTargetArgument": reference["liveTarget"],
            "actorPoint": reference["actorPoint"],
            "providedLaunch": launch,
            "callerStart": reference["callerStart"],
            "providedGoal": goal,
            "arguments": reference["arguments"],
            "initialized": initialization,
            "frames": frames,
            "reachedArrivalGate": arrived,
        }

    sources = [r for r in references[0]["cases"] if r["sourceName"] in profile_by_name]
    if len(sources) != 144:
        raise RuntimeError("Recheck source flight inventory")
    for ref in sources:
        cases.append(sample(ref))

    def reference(name):
        return next(
            r
            for r in sources
            if r["sourceName"] == name
            and r["actorPresent"]
            and r["liveTarget"]
            and r["actorPoint"] == {"x": 9000, "y": 16000}
            and r["providedGoal"] == {"x": 12000, "y": 20000}
        )

    for name, duration, warm in itertools.product(
        ["AxeManProjectile", "BowlerProjectile"], [151, 750, 1500, 2000], [0, 749, 1499]
    ):
        controls.append(
            sample(
                reference(name),
                {"pingpongVisualTime": duration, "warmMs": warm, "raw88": 19},
                "clockOverride",
            )
        )
    for speed in [0, 1]:
        controls.append(
            sample(
                reference("BowlerProjectile"),
                {"speedPerUpdate": speed},
                "speedOverride",
                6,
            )
        )
    for height in [-300, 0, 1, 4200]:
        controls.append(
            sample(
                reference("AxeManProjectile"),
                {"constantHeight": height},
                "heightOverride",
            )
        )
    controls.append(
        sample(
            reference("AxeManProjectile"), {"pingpongVisualTime": 0}, "linearOverride"
        )
    )
    asm = subprocess.check_output(
        ["objdump", "-d", "-Mintel", str(env["args"].library)], text=True
    )
    definitions = [
        (
            "rangeThroughLateHeight",
            0x21D0B2,
            0x21D5CB,
            "Actual range/minimum, launch, zero-RandomAngle/no-child reference gates, radius/range target height and ConstantHeight; stop before level/debug and chained-hit bookkeeping.",
        ),
        (
            "nativeMotion",
            0x21D796,
            0x21DBAD,
            "Actual null-target moving update; arrival and moving collision handler are boundaries.",
        ),
        (
            "movingCollisionCalleeContract",
            0x21EA7A,
            0x21EF69,
            "Retained callee reads frame slots +8/+c/+10/+18 and does not read +14; request records omit that unused stack word. Callee itself does not execute.",
        ),
        (
            "radiusRangePredicate",
            0x1FB488,
            0x1FB4D6,
            "Actual source radius/range/non-homing predicate, indexed table result supplied.",
        ),
        (
            "spawnProjectileColumn",
            0x1FB3CA,
            0x1FB3F2,
            "SpawnProjectile initializes GOT+0x1be8.",
        ),
        (
            "spawnProjectileStore",
            0x1FA5E8,
            0x1FA609,
            "Indexed projectile-reference resolution stores Data+0x44; all selected source rows have no reference.",
        ),
        (
            "randomAngleStore",
            0x1FA9A4,
            0x1FA9D7,
            "Named RandomAngle lookup stores Data+0xa0; selected source values are zero.",
        ),
        (
            "constantHeightStore",
            0x1FA8CC,
            0x1FA8F7,
            "Named ConstantHeight lookup stores Data+0x94.",
        ),
        ("sineMotion", 0x35BF80, 0x35C08B, "Actual signed Q10 sine math."),
        ("nativeUpdateReturn", 0x21E9F6, 0x21E9FE, "Actual moving update return."),
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
            raise RuntimeError("Native flight block is empty")
        if name == "movingCollisionCalleeContract" and any(
            "[ebp+0x14]" in line for line in instructions
        ):
            raise RuntimeError("Recheck unused collision stack slot")
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
        "sineQuarter": quarter,
        "limits": [
            "Actual early range/minimum initialization continues through supported late position initialization and ConstantHeight, then actual moving updates. Projectile/Data, caller/muzzle/caster points, targets/owner/aux references and indexed range results are supplied. Earlier allocation/target-height preparation and final level/debug/chained-hit bookkeeping are excluded.",
            "Selected source Bowler/rolling Log/Executioner rows have positive ProjectileRadius/ProjectileRange, false Homing, zero RandomAngle, no SpawnProjectile reference and zero MaxDistance. All 144 translated/point/reference source cases execute their actual source radius/range gate; this replaces the supplied-zero-radius limitation of the earlier controlled-motion capture for these profiles.",
            "Generic integer table lookup is intercepted at explicit call sites, with actual row/column argument preparation and archived values. Actual movement calls the moving collision handler; that handler is recorded and supplied an empty return. The recorded source payload uses absolute next XY with mode zero for ping-pong and step XY increments with mode one for linear motion. These are request payloads, not claims about the unexecuted handler's hit semantics.",
            "The collision callee's retained body reads argument slots 1/2/3/5; slot four is unused stack content and omitted from request records. No native collision scan, hit cache updates, damage, pushback, target removal or world registration executes. Arrival is intercepted before arrived flags/effects/removal; supplied warm/raw fields and changed speed/clocks/heights are synthetic controls.",
            "Every initialized goal/height/target/store, frame, midpoint hold/reset, table request/result, observed collision payload, guarded getter/point argument, exact Data read/call count and complete heap mutation matches independent integer calculations and verified prior initializer witnesses. Native elapsed time advances fifty per applicable call; real world cadence, full natural hits and browser timing remain unestablished. Application rules remain at 41.",
        ],
        "profiles": profiles,
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    output = json.dumps(result, indent=2) + "\n"
    path = Path("reference/client/projectile-flight-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native projectile flight trace differs")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "profiles": len(profiles),
                "cases": len(cases),
                "controls": len(controls),
                "updates": total_updates,
                "collisionRequests": total_collisions,
                "blocks": len(blocks),
            }
        )
    )
