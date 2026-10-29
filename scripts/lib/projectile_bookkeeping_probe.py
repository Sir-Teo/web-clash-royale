"""Native initializer target bookkeeping through stationary homing flight.

Damage table/level results, headers, caller locals and targets are supplied.
Native initializer, counter, flight and arrival-prefix operations execute.
"""

import csv
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import subprocess
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import (
    UC_X86_REG_EBP,
    UC_X86_REG_EDI,
    UC_X86_REG_EIP,
    UC_X86_REG_ESI,
    UC_X86_REG_EAX,
    UC_X86_REG_ESP,
)


def require(condition, detail):
    if not condition:
        raise RuntimeError(str(detail))


def capture(env, context):
    root = Path.cwd()
    paths = [
        "reference/client/projectile-arrival-native-trace.json",
        "reference/client/projectile-homing-native-trace.json",
        "reference/logic/projectiles.csv",
    ]
    inputs = [
        {"path": p, "sha256": hashlib.sha256(Path(p).read_bytes()).hexdigest()}
        for p in paths
    ]
    for p in paths[:2]:
        prior = json.loads(Path(p).read_text())
        if prior["sha256"] != env["sha"]:
            raise RuntimeError("Bookkeeping binary differs")
        for entry in prior["inputs"]:
            if (
                hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
                != entry["sha256"]
            ):
                raise RuntimeError("Bookkeeping provenance differs")
    cpu, heap, body, data = [env[k] for k in ["cpu", "heap", "body", "data"]]
    read, write, run, ret = [env[k] for k in ["read", "write", "run", "return_hook"]]
    target, target_data = heap + 0x8000, heap + 0xA000
    env["allowed"].extend(
        [
            (0x21D054, 0x21D0D4),
            (0x21D738, 0x21D796),
            (0x21D796, 0x21DBAD),
            (0x21E9F6, 0x21EA7A),
            (0x21961E, 0x219628),
            (0x219AAE, 0x219B36),
            (0x1FB78E, 0x1FB79E),
            (0x1FB83A, 0x1FB84B),
            (0x1FB488, 0x1FB4D6),
            (0x21453C, 0x214548),
            (0x35D250, 0x35D50A),
            (0x35D550, 0x35D66F),
            (0x35C120, 0x35C4DB),
            (0x21A404, 0x21A410),
            (0x2243E4, 0x2243F3),
            (0x2172AE, 0x2172E0),
            (0x1DE24A, 0x1DE25E),
            (0x2186EA, 0x218754),
            (0x1FB9BA, 0x1FBA1C),
            (0x35BD10, 0x35BD52),
            (0x35BD60, 0x35BDA3),
            (0x1FB664, 0x1FB665),
        ]
    )
    current = None
    events = []
    raw_time = None

    def hook(_cpu, pc, _size, _data):
        nonlocal raw_time
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if pc == 0x21D054:
            cpu.reg_write(UC_X86_REG_ESI, body)
            cpu.reg_write(UC_X86_REG_EDI, target)
            cpu.reg_write(UC_X86_REG_EBP, sp + 0x600)
            for off, value in [
                (0x20, current["goal"][0]),
                (0x24, current["goal"][1]),
                (0x28, 0),
                (0x2C, -23),
            ]:
                write(sp + 0x600 + off, value)
        elif pc in [0x21D0D3, 0x21D904]:
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        elif pc == 0x1FB664:
            require(
                (read(sp + 4) == data and read(sp + 8) == 0),
                "Bookkeeping invariant failed: read(sp + 4) == data and read(sp + 8) == 0",
            )
            events.append(["damage", current["damage"]])
            ret(current["damage"])
        elif pc == 0x2186EA:
            require(
                (read(sp + 4) == target),
                "Bookkeeping invariant failed: read(sp + 4) == target",
            )
            events.append(["counter", read(sp + 8), read(sp + 12)])
        elif pc == 0x21D09F:
            raw_time = cpu.reg_read(UC_X86_REG_EAX)

    for pc in [0x21D054, 0x21D0D3, 0x21D904, 0x1FB664, 0x2186EA, 0x21D09F]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)

    def trunc(n, d):
        return n // d if n >= 0 else -((-n) // d)

    rows = {
        r["Name"]: r
        for r in csv.DictReader((root / "reference/logic/projectiles.csv").open())
        if r["Name"] not in ["", "string"]
    }
    results = []
    profiles = [r for r in rows.values() if r["Homing"].lower() == "true"]
    if len(profiles) != 24 or any(
        int(r["Speed"] or 0) <= 0
        or r["ProjectileRadius"]
        or r["PingpongVisualTime"]
        or r["ConstantHeight"]
        or r["MinDistance"]
        or r["MaxDistance"]
        for r in profiles
    ):
        raise RuntimeError("Recheck source bookkeeping profile constraints")
    inventory = [
        (r["Name"], kind, delta, origin, False, 0)
        for r in profiles
        for kind in ["Knight", "Cannon", "PrincessTower", "KingTower"]
        for delta in [(3000, 4000), (6000, -8000)]
        for origin in [0, 1333]
    ]
    inventory += [
        ("ArcherArrow", kind, (distance, 0), 0, True, 0)
        for kind in ["Knight", "PrincessTower"]
        for distance in [0, 1, 399, 400, 401, 799, 800, 801, 7999, 8000, 8001, 8999]
    ]
    inventory += [
        ("ArcherArrow", "Knight", (distance, 0), 0, True, seed)
        for distance in [0, 399]
        for seed in [-1, 17, 731, 1500]
    ]
    for name, kind, delta, origin, control, time_seed in inventory:
        row = rows[name]
        speed = int(row["Speed"])
        damage = int(row["Damage"] or 0)
        pct = int(row["CrownTowerDamagePercent"] or 0)
        require(
            (
                row["Homing"].lower() == "true"
                and not row["ProjectileRadius"]
                and not row["PingpongVisualTime"]
            ),
            'Bookkeeping invariant failed: row["Homing"].lower() == "true"',
        )
        cpu.mem_write(heap, b"\0" * 0x10000)
        launch = [8000 + origin, 18000 - origin, 1723]
        goal = [launch[0] + delta[0], launch[1] + delta[1], 1800]
        current = {"damage": damage, "goal": goal}
        events.clear()
        raw_time = None
        for pointer, value in [
            (body, 0x7B364C),
            (body + 0x10, data),
            (data + 0x54, speed),
            (data + 0x7C, pct),
            (target, 0x7B36D8 if kind == "KingTower" else 0x7B34A0),
            (target + 0x10, target_data),
            (target + 0x5C, time_seed),
        ]:
            write(pointer, value)
        cpu.mem_write(data + 0x78, b"\1")
        cpu.mem_write(target_data + 0x28A, bytes([kind == "PrincessTower"]))
        for pointer, point, offsets in [
            (body, launch, [0x20, 0x24, 0x30]),
            (body, launch, [0x68, 0x6C, 0x70]),
            (body, [731, -487, 1800], [0x5C, 0x60, 0x64]),
            (target, goal, [0x20, 0x24, 0x30]),
        ]:
            for off, value in zip(offsets, point):
                write(pointer + off, value)
        before = bytes(cpu.mem_read(heap, 0x10000))
        expected = bytearray(before)
        distance = math.isqrt(delta[0] ** 2 + delta[1] ** 2)
        duration = distance * 50 // speed
        horizon = min(1000, max(time_seed, ((duration + 49) // 50) * 50))
        for offset, value in [
            (0x54, 0),
            (0x58, target),
            (0x5C, goal[0]),
            (0x60, goal[1]),
            (target - heap + 0x58, damage),
            (target - heap + 0x5C, horizon),
        ]:
            struct.pack_into("<i", expected, offset, value)
        run(0x21D054, instruction_budget=10000)
        require(
            (
                raw_time == duration
                and events
                == [
                    ["damage", damage],
                    ["counter", damage, duration],
                ]
            ),
            (raw_time, events),
        )
        require(
            (bytes(cpu.mem_read(heap, 0x10000)) == bytes(expected)),
            "registration heap differs",
        )
        registration = {
            "rawTime": raw_time,
            "counter": read(target + 0x58),
            "horizon": read(target + 0x5C),
            "events": list(events),
        }
        position = list(launch)
        frames = []
        crown = kind in ["KingTower", "PrincessTower"]
        amount = (damage * max(100 + pct, 0) + 99) // 100 if crown else damage
        for step in range(1, 81):
            before = bytes(cpu.mem_read(heap, 0x10000))
            expected = bytearray(before)
            distance = math.isqrt(
                (goal[0] - position[0]) ** 2 + (goal[1] - position[1]) ** 2
            )
            arrives = distance <= speed
            if arrives:
                position = [goal[0], goal[1], 0]
                expected[0x78] = 1
                struct.pack_into("<i", expected, target - heap + 0x58, damage - amount)
            else:
                position = [
                    p + trunc((g - p) * speed, distance) for p, g in zip(position, goal)
                ]
            for off, value in zip([0x20, 0x24, 0x30], position):
                struct.pack_into("<i", expected, off, value)
            events.clear()
            run(0x21D796, body, instruction_budget=10000)
            require(
                (bytes(cpu.mem_read(heap, 0x10000)) == bytes(expected)),
                (
                    name,
                    kind,
                    step,
                    "flight heap differs",
                ),
            )
            frames.append(
                {
                    "step": step,
                    "position": list(position),
                    "arrived": arrives,
                    "counter": read(target + 0x58),
                    "horizon": read(target + 0x5C),
                    "events": list(events),
                }
            )
            if not arrives:
                require((events == []), "Bookkeeping invariant failed: events == []")
            if arrives:
                require(
                    (
                        events
                        == (
                            [["damage", damage]] * (2 if crown else 1)
                            + [["counter", -amount, -1]]
                        )
                    ),
                    "Bookkeeping invariant failed: events == (",
                )
                break
        require(
            (frames[-1]["arrived"]),
            'Bookkeeping invariant failed: frames[-1]["arrived"]',
        )
        results.append(
            {
                "source": name,
                "target": kind,
                "delta": delta,
                "origin": origin,
                "kind": "control" if control else "source",
                "speedPerUpdate": speed,
                "providedBaseDamage": damage,
                "crownDamagePercent": pct,
                "providedTimeScalar": time_seed,
                "providedInitialGoal": [731, -487, 1800],
                "registration": registration,
                "frames": frames,
            }
        )

    cases = [r for r in results if r["kind"] == "source"]
    controls = [r for r in results if r["kind"] == "control"]
    definitions = [
        (
            "initializerTargetBookkeeping",
            0x21D054,
            0x21D0D3,
            "Actual Homing/target gate, supplied base Damage request, native flight-time request, positive target-counter update, target/owner/goal stores; earlier/later initializer work is supplied.",
        ),
        (
            "flightTime",
            0x21D738,
            0x21D796,
            "Actual native integer XY distance times fifty divided by source Speed.",
        ),
        (
            "targetCounter",
            0x2186EA,
            0x218754,
            "Actual signed counter addition and nonnegative time rounding/max/cap; arrival passes negative amount with raw -1.",
        ),
        (
            "ordinaryUpdate",
            0x21D796,
            0x21DBAD,
            "Actual refresh, linear movement and arrival prefix; arrival stops before later processing.",
        ),
        (
            "updateReturn",
            0x21E9F6,
            0x21EA7A,
            "Actual movement epilogue and target refresh.",
        ),
        (
            "crownAmount",
            0x1FB9BA,
            0x1FBA1C,
            "Actual Crown percentage arithmetic with a supplied base Damage getter result.",
        ),
    ]
    blocks = []
    for name, start, stop, meaning in definitions:
        asm = subprocess.check_output(
            [
                "objdump",
                "-d",
                "-Mintel",
                f"--start-address={start}",
                f"--stop-address={stop}",
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
            raise RuntimeError("Empty bookkeeping instruction block")
        blocks.append(
            {
                "name": name,
                "start": hex(start),
                "end": hex(stop),
                "interpretation": meaning,
                "instructions": instructions,
            }
        )
    result = {
        "source": "apk/1.8.1/x86/libg.so",
        "sha256": env["sha"],
        "emulator": "unicorn==2.1.4",
        "inputs": inputs,
        "blocks": blocks,
        "limits": [
            "Actual bounded initializer target bookkeeping and target/owner/goal stores execute with supplied caller locals/frame, initial projectile header, source Data and target records. Earlier constructor/initializer work, native table/level Damage projection and complete target construction are supplied.",
            "Actual flight-time helper and target counter method execute. Positive base Damage is added before flight; raw flight quantity is integer XY distance times fifty divided by Speed. Nonnegative counter time is rounded upward to fifty-unit increments, maxed with the existing scalar and capped at 1000. Target actor time advancement/consumption and natural world cadence are outside scope.",
            "Actual ordinary homing movement and arrival prefix execute until the destination is reached. Source-selected class/percentage arithmetic removes base or Crown-adjusted amount and latches arrival. Supplied targets remain stationary; registration, flight and arrival have complete heap checks and exact damage-provider/counter request checks. Other getter/Data-read inventories are covered by prerequisite captures, not reasserted here.",
            "Source data-only spell/unused profiles with supplied non-null targets do not establish natural caller behavior. Arrows source base registration and Crown-adjusted arrival can leave a residual in these controlled states; no natural bug or complete field semantics is inferred. This target bookkeeping is distinct from manager world registration, allocation, removal, later hits/effects and actual health damage, which remain excluded. Application rules remain 43.",
        ],
        "profiles": [
            {
                "name": r["Name"],
                "speedPerUpdate": int(r["Speed"]),
                "providedBaseDamage": int(r["Damage"] or 0),
                "crownDamagePercent": int(r["CrownTowerDamagePercent"] or 0),
            }
            for r in profiles
        ],
        "cases": cases,
        "controls": controls,
    }
    output = json.dumps(result, indent=2) + "\n"
    path = root / "reference/client/projectile-bookkeeping-native-trace.json"
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native bookkeeping trace differs")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "profiles": len(profiles),
                "cases": len(cases),
                "controls": len(controls),
                "updates": sum(len(r["frames"]) for r in results),
                "blocks": len(blocks),
            }
        )
    )
