"""Bounded native arrival bookkeeping, arrived latch and position stores.

Near-arrival headers/targets and damage getter results are supplied. Actual
refresh/arrival/class/counter/math/position methods run before later hit work.
"""

from collections import Counter
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import struct
import subprocess

from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_READ
from unicorn.x86_const import UC_X86_REG_EIP, UC_X86_REG_ESP


def capture(env, context):
    cpu, heap, body, data = [env[k] for k in ["cpu", "heap", "body", "data"]]
    read, write, run, ret = [env[k] for k in ["read", "write", "run", "return_hook"]]
    paths = [
        "reference/client/projectile-homing-native-trace.json",
        "reference/client/sight-target-types-native-trace.json",
        "reference/logic/projectiles.csv",
        "reference/logic/characters.csv",
        "reference/logic/buildings.csv",
    ]
    inputs = [
        {"path": p, "sha256": hashlib.sha256(Path(p).read_bytes()).hexdigest()}
        for p in paths
    ]
    for path in paths[:2]:
        prior = json.loads(Path(path).read_text())
        if prior["sha256"] != env["sha"]:
            raise RuntimeError("Projectile arrival binary differs")
        for entry in prior["inputs"]:
            if (
                hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
                != entry["sha256"]
            ):
                raise RuntimeError("Projectile arrival provenance differs")
    columns = [
        {"name": "Damage", "string": 0x613019, "gotOffset": 0x1BA4},
        {
            "name": "CrownTowerDamagePercent",
            "string": 0x7B8A14 - 0x1A5B65,
            "dataOffset": 0x7C,
        },
    ]
    for column in columns:
        expected = column["name"].encode() + b"\0"
        if bytes(cpu.mem_read(column["string"], len(expected))) != expected:
            raise RuntimeError("Projectile arrival column binding differs")
    vtable, target, target_data = 0x7B364C, heap + 0x8000, heap + 0xA000
    for vt in [0x7B34A0, 0x7B36D8]:
        if read(vt + 0x70) != 0x2186EA:
            raise RuntimeError("Projectile arrival counter vtable differs")
    env["allowed"].extend(
        [
            (0x21D796, 0x21D904),
            (0x21E9FE, 0x21EA7A),
            (0x21F028, 0x21F039),
            (0x21961E, 0x219628),
            (0x219AAE, 0x219B32),
            (0x1FB78E, 0x1FB79E),
            (0x1FB83A, 0x1FB84B),
            (0x21453C, 0x214548),
            (0x35D550, 0x35D66F),
            (0x35D250, 0x35D50A),
            (0x35C120, 0x35C4DB),
            (0x21A404, 0x21A410),
            (0x2243E4, 0x2243F3),
            (0x2172AE, 0x2172E0),
            (0x1DE24A, 0x1DE25E),
            (0x2186EA, 0x218754),
            (0x1FB9BA, 0x1FBA1C),
            (0x35BD10, 0x35BD52),
            (0x1FB664, 0x1FB665),
            (0x21D904, 0x21D905),
        ]
    )
    current, calls, data_reads, events = None, Counter(), [], []
    names = {
        0x21960E: "Data",
        0x1FB78E: "speed",
        0x1FB83A: "homing",
        0x21961E: "baseNoop",
        0x21E9FE: "targetRefresh",
        0x219B26: "pointReference",
        0x35D5D0: "distance",
        0x219AF6: "targetX",
        0x219B06: "targetY",
        0x219B16: "targetZ",
        0x21453C: "projectileVirtual38",
        0x21A404: "ordinaryClass60",
        0x2243E4: "kingClass60",
        0x2172AE: "class64",
        0x1DE24A: "summonerTowerFlag",
        0x1FB664: "providedDamage",
        0x1FB9BA: "crownAmount",
        0x35BD10: "maximum",
        0x2186EA: "targetCounter",
        0x219AAE: "positionStore",
        0x21F028: "arrivedGetter",
    }

    def hook(_cpu, pc, _size, _data):
        if pc == 0x21D904:
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
            return
        name = names[pc]
        sp, pointer = cpu.reg_read(UC_X86_REG_ESP), 0
        pointer = read(sp + 4)
        if name == "Data":
            if pointer not in [body, target]:
                raise RuntimeError("Unexpected arrival Data getter owner")
            name = "projectileData" if pointer == body else "targetData"
        elif name == "maximum":
            if [pointer, read(sp + 8)] != [current["crownPercent"] + 100, 0]:
                raise RuntimeError("Unexpected native Crown amount clamp")
        else:
            expected = (
                data
                if name in ["speed", "homing", "providedDamage", "crownAmount"]
                else (
                    target_data
                    if name == "summonerTowerFlag"
                    else (
                        target
                        if name in ["targetX", "targetY", "targetZ", "targetCounter"]
                        or name in ["ordinaryClass60", "kingClass60", "class64"]
                        else body + 0x5C if name == "distance" else body
                    )
                )
            )
            if pointer != expected:
                raise RuntimeError(f"Unexpected arrival getter argument: {name}")
        calls[name] += 1
        if name == "providedDamage":
            if read(sp + 8) != current["level"]:
                raise RuntimeError("Unexpected provided damage level")
            events.append(
                ["damageRequest", current["level"], current["providedDamage"]]
            )
            ret(current["providedDamage"])
        elif name == "targetCounter":
            args = [read(sp + 8), read(sp + 12)]
            if args != [-current["amount"], -1]:
                raise RuntimeError("Unexpected target counter adjustment")
            events.append(["counter", *args])
        elif name == "positionStore":
            args = [read(sp + offset) for offset in [8, 12, 16]]
            if args != current["landing"]:
                raise RuntimeError("Unexpected arrival position arguments")
            if bytes(cpu.mem_read(body + 0x78, 1)) != b"\1":
                raise RuntimeError("Arrival flag not latched before position store")
            events.append(["position", *args])
        elif name == "distance" and read(sp + 8) != body + 0x20:
            raise RuntimeError("Unexpected arrival distance argument")

    def memory(_cpu, _access, address, size, _value, _data):
        owner = "projectile" if data <= address < data + 0x800 else "target"
        base = data if owner == "projectile" else target_data
        data_reads.append((owner, address - base, size))

    for pc in [0x21D904, *names]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)
    for start in [data, target_data]:
        cpu.hook_add(UC_HOOK_MEM_READ, memory, begin=start, end=start + 0x7FF)
    rows = [
        r
        for r in csv.DictReader(io.StringIO(Path(paths[2]).read_text()))
        if r["Name"] not in ["", "string"]
    ]
    profiles = [
        {
            "sourceName": r["Name"],
            "speed": int(r["Speed"] or 0),
            "homing": r["Homing"].lower() == "true",
            "providedDamage": int(r["Damage"] or 0),
            "crownPercent": int(r["CrownTowerDamagePercent"] or 0),
            "constantHeight": int(r["ConstantHeight"] or 0),
            "pingpong": int(r["PingpongVisualTime"] or 0),
        }
        for r in rows
    ]
    source_targets = {}
    for path in paths[3:]:
        source_targets.update(
            {
                r["Name"]: r
                for r in csv.DictReader(io.StringIO(Path(path).read_text()))
                if r["Name"] not in ["", "string"]
            }
        )

    def signed(value):
        return (value + 0x80000000) % 0x100000000 - 0x80000000

    def sample(profile, victim, origin, present, override=None):
        nonlocal current
        current = {
            **profile,
            "level": 0,
            "counter": 10000,
            "initialArrived": 0,
            **(override or {}),
        }
        cpu.mem_write(heap, bytes((i * 19 + 61) % 256 for i in range(0x10000)))
        king = victim == "KingTower"
        summoner = source_targets[victim]["IsSummonerTower"].lower() == "true"
        crown = king or summoner
        raw = current["providedDamage"]
        current["amount"] = (
            (raw * max(0, current["crownPercent"] + 100) + 99) // 100 if crown else raw
        )
        goal = [15000 + origin, 16000 - origin, current["constantHeight"] or 1800]
        position = [
            goal[0] - min(current["speed"], 137),
            goal[1],
            current["constantHeight"] or 1723,
        ]
        current["landing"] = [goal[0], goal[1], 0]
        for pointer, value in [
            (body, vtable),
            (body + 0x10, data),
            (body + 0x58, target if present else 0),
            (body + 0x74, current["pingpong"]),
            (body + 0x8C, current["level"]),
            (data + 0x54, current["speed"]),
            (data + 0x98, current["pingpong"]),
            (data + 0x7C, current["crownPercent"]),
            (target, 0x7B36D8 if king else 0x7B34A0),
            (target + 0x10, target_data),
            (target + 0x58, current["counter"]),
            (target + 0x5C, 731),
        ]:
            write(pointer, value)
        cpu.mem_write(data + 0x78, bytes([int(current["homing"])]))
        cpu.mem_write(target_data + 0x28A, bytes([summoner]))
        cpu.mem_write(body + 0x78, bytes([current["initialArrived"]]))
        for pointer, point, offsets in [
            (body, position, [0x20, 0x24, 0x30]),
            (body, goal, [0x5C, 0x60, 0x64]),
            (target, goal, [0x20, 0x24, 0x30]),
        ]:
            for offset, value in zip(offsets, point):
                write(pointer + offset, value)
        frames = []
        for visit in [1, 2]:
            before = bytes(cpu.mem_read(heap, 0x10000))
            was_arrived = bool(bytes(cpu.mem_read(body + 0x78, 1))[0])
            adjusts = not was_arrived and current["homing"] and present
            expected = bytearray(before)
            for offset, value in zip([0x20, 0x24, 0x30], current["landing"]):
                struct.pack_into("<i", expected, offset, value)
            expected[0x78] = 1
            counter_before = read(target + 0x58)
            counter_after = (
                signed(counter_before - current["amount"])
                if adjusts
                else counter_before
            )
            struct.pack_into("<i", expected, target - heap + 0x58, counter_after)
            calls.clear()
            data_reads.clear()
            events.clear()
            run(0x21D796, body, instruction_budget=10000)
            actual_arrived = run(0x21F028, body)
            if (
                bytes(cpu.mem_read(heap, 0x10000)) != bytes(expected)
                or actual_arrived != 1
            ):
                raise RuntimeError(
                    f"Native arrival stores differ: {profile['sourceName']} {victim} visit {visit}"
                )
            ping_reads = 3 if current["pingpong"] else 1
            expected_calls = {
                "baseNoop": 1,
                "targetRefresh": 1,
                "pointReference": 1,
                "distance": 1,
                "speed": 1,
                "positionStore": 1,
                "arrivedGetter": 1,
                "projectileData": 1
                + ping_reads
                + int(present)
                + int(not was_arrived)
                + int(adjusts)
                + int(adjusts and crown),
            }
            homing_reads = int(present) + int(not was_arrived)
            if homing_reads:
                expected_calls["homing"] = homing_reads
            if present and current["homing"]:
                expected_calls.update(
                    {"targetX": 1, "targetY": 1, "targetZ": 1, "projectileVirtual38": 1}
                )
            expected_events = []
            if adjusts:
                expected_calls.update(
                    {
                        "providedDamage": 2 if crown else 1,
                        "targetCounter": 1,
                        "kingClass60" if king else "ordinaryClass60": 1,
                    }
                )
                expected_events.append(["damageRequest", current["level"], raw])
                if not king:
                    expected_calls.update(
                        {"class64": 1, "targetData": 1, "summonerTowerFlag": 1}
                    )
                if crown:
                    expected_calls.update({"crownAmount": 1, "maximum": 1})
                    expected_events.append(["damageRequest", current["level"], raw])
                expected_events.append(["counter", -current["amount"], -1])
            expected_events.append(["position", *current["landing"]])
            expected_reads = Counter(
                {("projectile", 0x54, 4): 1, ("projectile", 0x98, 4): ping_reads}
            )
            if homing_reads:
                expected_reads[("projectile", 0x78, 1)] = homing_reads
            if adjusts and crown:
                expected_reads[("projectile", 0x7C, 4)] = 1
            if adjusts and not king:
                expected_reads[("target", 0x28A, 1)] = 1
            if (
                dict(calls) != expected_calls
                or Counter(data_reads) != expected_reads
                or events != expected_events
            ):
                raise RuntimeError(
                    f"Arrival requests/reads differ: {dict(calls)} {expected_calls} {data_reads} {events}"
                )
            frames.append(
                {
                    "visit": visit,
                    "arrivedBefore": was_arrived,
                    "arrivedAfter": actual_arrived,
                    "position": [read(body + o) for o in [0x20, 0x24, 0x30]],
                    "goal": [read(body + o) for o in [0x5C, 0x60, 0x64]],
                    "targetCounterBefore": counter_before,
                    "targetCounterAfter": counter_after,
                    "counterAdjusted": adjusts,
                    "events": list(events),
                    "getters": dict(calls),
                    "dataReads": {
                        f"{owner}/{hex(offset)}/{size}": count
                        for (owner, offset, size), count in sorted(
                            expected_reads.items()
                        )
                    },
                    "unrelatedHeapUnchanged": True,
                }
            )
        return {
            "sourceName": profile["sourceName"],
            "kind": "control" if override else "source",
            "targetSource": victim,
            "origin": origin,
            "providedTargetPresent": present,
            "fields": current.copy(),
            "providedPosition": position,
            "providedGoal": goal,
            "frames": frames,
        }

    cases = [
        sample(p, victim, origin, present)
        for p in profiles
        for victim in ["Knight", "Cannon", "PrincessTower", "KingTower"]
        for origin in [0, 1333]
        for present in [False, True]
    ]
    arrow = next(p for p in profiles if p["sourceName"] == "ArcherArrow")
    fireball = next(p for p in profiles if p["sourceName"] == "FireballSpell")
    controls = [
        sample(
            arrow,
            victim,
            0,
            True,
            {"providedDamage": damage, "crownPercent": pct, "counter": 17},
        )
        for victim in ["PrincessTower", "KingTower"]
        for damage in [1, 115]
        for pct in [-101, -100, -99, -60, 1, 250]
    ]
    controls += [
        sample(arrow, "Knight", 0, True, {"initialArrived": flag})
        for flag in [1, 2, 255]
    ]
    controls += [
        sample(arrow, "Knight", 0, True, {"counter": value})
        for value in [0, -1, -2147483648]
    ]
    controls += [
        sample(arrow, "Knight", 0, True, {"level": level}) for level in [-3, 1, 11]
    ]
    controls += [
        sample(arrow, "Knight", 0, True, {"homing": False}),
        sample(fireball, "KingTower", 0, True, {"homing": True}),
    ]
    definitions = [
        (
            "updateArrivalPrefix",
            0x21D796,
            0x21D904,
            "Actual refresh, arrival decision, target bookkeeping, arrived latch and XY/zero-Z store; stop before later hit/effect work.",
        ),
        (
            "targetRefresh",
            0x21E9FE,
            0x21EA7A,
            "Actual target/Homing gate and XYZ goal refresh.",
        ),
        (
            "arrivedGetter",
            0x21F028,
            0x21F039,
            "Actual projectile object+0x78 byte getter.",
        ),
        (
            "targetCounter",
            0x2186EA,
            0x218754,
            "Actual target scalar+0x58 addition; arrival passes negative amount and -1, skipping its other scalar branch.",
        ),
        (
            "crownAmount",
            0x1FB9BA,
            0x1FBA1C,
            "Actual ceil-positive percentage arithmetic using a supplied base Damage getter result.",
        ),
        (
            "damageColumnBinding",
            0x1FAD98,
            0x1FADCB,
            "Retained named Damage/GOT binding; actual table/level projection is supplied.",
        ),
        (
            "crownPercentColumnStore",
            0x1FA308,
            0x1FA330,
            "Retained named CrownTowerDamagePercent store at Data+0x7c; CSV loading is not executed.",
        ),
        (
            "targetClassFalse",
            0x21A404,
            0x21A410,
            "Actual ordinary source class+0x60 returns zero.",
        ),
        (
            "targetClassTrue",
            0x2243E4,
            0x2243F3,
            "Actual King source class+0x60 returns one.",
        ),
        (
            "targetSummonerClass",
            0x2172AE,
            0x2172E0,
            "Actual class+0x64 reads IsSummonerTower through Data.",
        ),
        (
            "summonerFlag",
            0x1DE24A,
            0x1DE25E,
            "Actual source IsSummonerTower byte getter at Data+0x28a.",
        ),
        ("positionStore", 0x219AAE, 0x219AE2, "Actual current XYZ position stores."),
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
            raise RuntimeError("Projectile arrival instruction block is empty")
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
        "sourceColumns": columns,
        "limits": [
            "Actual ordinary update begins with supplied near-arrival projectile/Data/target records, clock and level. Source projectile data rows are combined with supplied live/null target references and minimal source-selected Knight/Cannon/Princess/King vtables and IsSummonerTower flags; natural creation, initialization and reference lifecycle are excluded.",
            "Base Damage getter execution is an explicit supplied-result boundary. Its argument preparation and level are guarded; source episodes supply the archived row's base Damage value without claiming actual rarity/level projection. Actual CrownTowerDamagePercent arithmetic, class methods, target counter method, arrived flag/getter and current XYZ stores execute.",
            "First arrival with a present homing reference adjusts target scalar+0x58 by negative base/Crown amount through vtable+0x70 with raw second parameter -1. This scalar is not identified as health and full damage is not executed. Repeated/already-marked visits suppress that adjustment; every visit latches the arrived byte and stores destination XY with current Z zero while retaining the goal Z.",
            "Every getter/provider argument/count, ordered request/store event, exact Data read and full 64-KiB heap mutation matches an independent scalar model. Execution stops at 0x21d904 before owner-dependent processing, later damage/hits, area scans, effects, children and removal. Counter registration/consumption and full world cadence remain outside scope. Application rules remain 43.",
        ],
        "profiles": profiles,
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    output = json.dumps(result, indent=2) + "\n"
    path = Path("reference/client/projectile-arrival-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native projectile arrival capture differs")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "profiles": len(profiles),
                "cases": len(cases),
                "controls": len(controls),
                "updates": 2 * (len(cases) + len(controls)),
                "blocks": len(blocks),
            }
        )
    )
