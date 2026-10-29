"""Bounded native area pulse amounts and per-target damage selection.

One due pulse, Data/header locals and Damage table results are supplied. Actual
area getters, Crown arithmetic, request preparation and target class selection
execute. World scanning, hit eligibility and downstream damage remain excluded.
"""

from collections import Counter
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess

from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_READ
from unicorn.x86_const import (
    UC_X86_REG_EBP,
    UC_X86_REG_EDI,
    UC_X86_REG_EIP,
    UC_X86_REG_ESP,
)


def require(condition, detail):
    if not condition:
        raise RuntimeError(str(detail))


def capture(env, context):
    cpu, heap, body, data, world = [
        env[k] for k in ["cpu", "heap", "body", "data", "world"]
    ]
    read, write, run, ret = [env[k] for k in ["read", "write", "run", "return_hook"]]
    paths = [
        "reference/client/projectile-hit-damage-native-trace.json",
        "reference/logic/area_effect_objects.csv",
        "reference/logic/characters.csv",
        "reference/logic/buildings.csv",
    ]
    inputs = [
        {"path": p, "sha256": hashlib.sha256(Path(p).read_bytes()).hexdigest()}
        for p in paths
    ]
    prior = json.loads(Path(paths[0]).read_text())
    require(prior["sha256"] == env["sha"], "Area Crown binary differs")
    for entry in prior["inputs"]:
        require(
            hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
            == entry["sha256"],
            f"Area Crown input differs: {entry['path']}",
        )
    columns = [
        {"name": "Damage", "string": 0x613019, "gotOffset": 0x16CC},
        {
            "name": "CrownTowerDamagePercent",
            "string": 0x7B8A14 - 0x1A5B65,
            "dataOffset": 0x58,
        },
    ]
    for col in columns:
        name = col["name"].encode() + b"\0"
        require(
            bytes(cpu.mem_read(col["string"], len(name))) == name,
            "Area Crown named column differs",
        )
    target, target_data, row_pointer, health = (
        heap + 0x8000,
        heap + 0xA000,
        heap + 0xC000,
        heap + 0xD000,
    )
    raw_column = read(0x7B8A14 + 0x16CC)
    for vt in [0x7B34A0, 0x7B36D8]:
        require(
            read(vt + 0x44) == 0x219DAE and read(vt + 0x64) == 0x2172AE,
            "Area target methods differ",
        )
    env["allowed"].extend(
        [
            (0x21398C, 0x213B05),
            (0x1D3900, 0x1D398E),
            (0x1D39C6, 0x1D3A16),
            (0x1D3CB6, 0x1D3CDA),
            (0x1D3CEC, 0x1D3D6D),
            (0x219874, 0x219884),
            (0x219AF6, 0x219B16),
            (0x20205A, 0x20205B),
            (0x21BCE6, 0x21BCE7),
            (0x35BD10, 0x35BD52),
            (0x21BE9E, 0x21BF76),
            (0x21C04A, 0x21C04B),
            (0x219DAE, 0x219DC6),
            (0x21A404, 0x21A410),
            (0x2243E4, 0x2243F3),
            (0x2172AE, 0x2172E0),
            (0x1DE24A, 0x1DE25E),
            (0x25FF6E, 0x25FF6F),
        ]
    )
    current, phase, events, reads, calls, packet = None, None, [], [], Counter(), None
    methods = {
        0x1D3900: "radius",
        0x1D3954: "pushback",
        0x1D397A: "maximumTargets",
        0x1D3968: "onlyEnemies",
        0x1D39C6: "baseAmount",
        0x1D3CEC: "crownAmount",
        0x1D3CB6: "hitsAir",
        0x1D3CC8: "hitsGround",
        0x219874: "world",
        0x219AF6: "x",
        0x219B06: "y",
        0x219DAE: "component",
        0x21A404: "ordinaryClass60",
        0x2243E4: "kingClass60",
        0x2172AE: "class64",
        0x1DE24A: "summonerFlag",
        0x21960E: "Data",
        0x35BD10: "maximum",
    }

    def hook(_cpu, pc, _size, _data):
        nonlocal packet
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if pc == 0x21398C:
            cpu.reg_write(UC_X86_REG_EDI, body)
            cpu.reg_write(UC_X86_REG_EBP, sp + 0x600)
            for off, value in [(0x608, body), (0x84, data), (0x58, 1), (0x54, 0)]:
                write(sp + off, value)
        elif pc == 0x20205A:
            args = [read(sp + off) for off in [4, 8, 12, 16, 20]]
            require(
                args
                == [row_pointer, raw_column, current["level"], 1, current["rarity"]],
                "Area Damage table arguments differ",
            )
            calls["providedDamageTable"] += 1
            events.append(
                ["damageTable", current["level"], current["rarity"], current["damage"]]
            )
            ret(current["damage"])
        elif pc == 0x21BCE6:
            packet = [read(sp + off) for off in range(4, 69, 4)]
            require(
                packet
                == [
                    world,
                    *current["point"],
                    current["radius"],
                    0,
                    current["damage"],
                    body,
                    current["pushback"],
                    *current["point"],
                    current["maximumTargets"],
                    current["onlyEnemies"] ^ 1,
                    current["hitsAir"],
                    current["hitsGround"],
                    current["crown"],
                    0,
                    0,
                ],
                "Area damage request arguments differ",
            )
            events.append(["areaRequest", *packet[1:6], "area", *packet[7:]])
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        elif pc == 0x213B04:
            events.append(["noDamage"])
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        elif pc == 0x21BE9E:
            require(packet is not None, "Target selection without a pulse request")
            cpu.reg_write(UC_X86_REG_EDI, target)
            cpu.reg_write(UC_X86_REG_EBP, sp + 0x600)
            for i, value in enumerate(packet):
                write(sp + 0x608 + 4 * i, value)
            for off, value in [
                (0x48, current["alreadyKing"]),
                (0x4C, 0),
                (0x20, current["payload"]),
            ]:
                write(sp + off, value)
        elif pc == 0x25FF6E:
            args = [read(sp + off) for off in [4, 8, 12, 16, 20, 24]]
            require(
                args == [health, current["selected"], body, current["payload"], 0, 0],
                "Area target damage arguments differ",
            )
            events.append(
                ["hit", current["selected"], "area", current["payload"], 0, 0]
            )
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        elif pc in [0x21BF1C, 0x21BF75, 0x21C04A]:
            events.append(
                [
                    "skip",
                    {
                        0x21BF1C: "component",
                        0x21BF75: "nonpositive",
                        0x21C04A: "kingAlreadyHit",
                    }[pc],
                ]
            )
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        else:
            name = methods[pc]
            pointer = read(sp + 4)
            expected = (
                data
                if name
                in [
                    "radius",
                    "pushback",
                    "maximumTargets",
                    "onlyEnemies",
                    "baseAmount",
                    "crownAmount",
                    "hitsAir",
                    "hitsGround",
                ]
                else (
                    body
                    if name in ["world", "x", "y"]
                    else (
                        target_data
                        if name == "summonerFlag"
                        else current["percent"] + 100 if name == "maximum" else target
                    )
                )
            )
            require(pointer == expected, f"Area getter owner differs: {name}")
            if name == "maximum":
                require(read(sp + 8) == 0, "Area Crown clamp differs")
            calls[name] += 1

    def memory(_cpu, _access, address, size, _value, _data):
        name, base = (
            ("area", data)
            if data <= address < data + 0x800
            else ("target", target_data)
        )
        reads.append((name, address - base, size))

    for pc in [
        0x21398C,
        0x20205A,
        0x21BCE6,
        0x213B04,
        0x21BE9E,
        0x25FF6E,
        0x21BF1C,
        0x21BF75,
        0x21C04A,
        *methods,
    ]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)
    for start in [data, target_data]:
        cpu.hook_add(UC_HOOK_MEM_READ, memory, begin=start, end=start + 0x7FF)
    rows = [
        r
        for r in csv.DictReader(io.StringIO(Path(paths[1]).read_text()))
        if r["Name"] not in ["", "string"]
    ]
    profiles = [
        {
            "sourceName": r["Name"],
            "damage": int(r["Damage"] or 0),
            "percent": int(r["CrownTowerDamagePercent"] or 0),
            "radius": int(r["Radius"] or 0),
            "pushback": int(r["Pushback"] or 0),
            "maximumTargets": int(r["MaximumTargets"] or 0),
            **{
                k: int(r[col].lower() == "true")
                for k, col in [
                    ("onlyEnemies", "OnlyEnemies"),
                    ("hitsAir", "HitsAir"),
                    ("hitsGround", "HitsGround"),
                ]
            },
        }
        for r in rows
    ]
    require(len(profiles) == 12, "Recheck archived area profiles")
    target_rows = {}
    for path in paths[2:]:
        target_rows.update(
            {
                r["Name"]: r
                for r in csv.DictReader(io.StringIO(Path(path).read_text()))
                if r["Name"] not in ["", "string"]
            }
        )
    pattern = bytes((i * 19 + 61) % 256 for i in range(0x10000))

    def sample(profile, origin=0, level=0, override=None):
        nonlocal current, phase, packet
        current = {
            **profile,
            "level": level,
            "rarity": 0,
            "componentPresent": True,
            "componentFlags": 4,
            "alreadyKing": 0,
            "payload": -23,
            **(override or {}),
        }
        current["point"] = [15000 + origin, 16000 - origin]
        current["crown"] = (
            current["damage"] * max(0, 100 + current["percent"]) + 99
        ) // 100
        fields = current.copy()
        cpu.mem_write(heap, pattern)
        for ptr, value in [
            (body, 0),
            (body + 0x10, data),
            (body + 0x14, world),
            (body + 0x20, current["point"][0]),
            (body + 0x24, current["point"][1]),
            (body + 0x50, current["level"]),
            (data + 8, row_pointer),
            (data + 0xA8, current["rarity"]),
            (data + 0x58, current["percent"]),
            (data + 0x84, current["radius"]),
            (data + 0x88, current["pushback"]),
            (data + 0x8C, current["maximumTargets"]),
        ]:
            write(ptr, value)
        for offset, value in [
            (0x60, current["onlyEnemies"]),
            (0x5E, current["hitsAir"]),
            (0x5D, current["hitsGround"]),
        ]:
            cpu.mem_write(data + offset, bytes([value]))
        before = bytes(cpu.mem_read(heap, 0x10000))
        phase = "pulse"
        packet = None
        events.clear()
        reads.clear()
        calls.clear()
        run(0x21398C, body, instruction_budget=2000)
        require(
            bytes(cpu.mem_read(heap, 0x10000)) == before,
            "Area pulse modified supplied heap",
        )
        positive = current["damage"] > 0
        expected_events = [
            ["damageTable", current["level"], current["rarity"], current["damage"]]
        ]
        expected_calls = {
            "radius": 1,
            "pushback": 1,
            "maximumTargets": 1,
            "onlyEnemies": 1,
            "baseAmount": 1,
            "providedDamageTable": 1,
        }
        expected_reads = Counter(
            {
                ("area", 0x84, 4): 1,
                ("area", 0x88, 4): 1,
                ("area", 0x8C, 4): 1,
                ("area", 0x60, 1): 1,
                ("area", 8, 4): 1,
                ("area", 0xA8, 4): 1,
            }
        )
        if positive:
            require(packet is not None, "Missing positive area request")
            expected_events += [
                ["damageTable", current["level"], current["rarity"], current["damage"]],
                ["areaRequest", *packet[1:6], "area", *packet[7:]],
            ]
            expected_calls.update(
                {
                    "providedDamageTable": 2,
                    "crownAmount": 1,
                    "maximum": 1,
                    "hitsAir": 1,
                    "hitsGround": 1,
                    "world": 1,
                    "x": 2,
                    "y": 2,
                }
            )
            expected_reads.update(
                {
                    ("area", 8, 4): 1,
                    ("area", 0xA8, 4): 1,
                    ("area", 0x58, 4): 1,
                    ("area", 0x5E, 1): 1,
                    ("area", 0x5D, 1): 1,
                }
            )
        else:
            expected_events.append(["noDamage"])
        require(
            events == expected_events
            and dict(calls) == expected_calls
            and Counter(reads) == expected_reads,
            f"Area pulse inventory differs: {events}, {dict(calls)}, {reads}",
        )
        pulse = {
            "events": list(events),
            "getters": dict(calls),
            "dataReads": {
                f"{n}/{hex(o)}/{s}": count
                for (n, o, s), count in sorted(expected_reads.items())
            },
            "unrelatedHeapUnchanged": True,
        }
        victims = []
        if positive:
            for name in ["Knight", "Cannon", "PrincessTower", "KingTower"]:
                king = name == "KingTower"
                summoner = target_rows[name]["IsSummonerTower"].lower() == "true"
                current["selected"] = (
                    current["crown"] if king or summoner else current["damage"]
                )
                for ptr, value in [
                    (target, 0x7B36D8 if king else 0x7B34A0),
                    (target + 0x10, target_data),
                    (target + 0x38, current["componentFlags"]),
                    (target + 0x44, health if current["componentPresent"] else 0),
                ]:
                    write(ptr, value)
                cpu.mem_write(target_data + 0x28A, bytes([summoner]))
                before = bytes(cpu.mem_read(heap, 0x10000))
                phase = "target"
                events.clear()
                reads.clear()
                calls.clear()
                run(0x21BE9E, body, instruction_budget=1000)
                require(
                    bytes(cpu.mem_read(heap, 0x10000)) == before,
                    "Area target selection modified supplied heap",
                )
                expected_calls = {"component": 1}
                expected_reads = Counter()
                active = current["componentPresent"] and bool(
                    current["componentFlags"] & 4
                )
                if active:
                    expected_calls["kingClass60" if king else "ordinaryClass60"] = 2
                    if not king:
                        expected_calls.update(
                            {"class64": 1, "Data": 1, "summonerFlag": 1}
                        )
                        expected_reads[("target", 0x28A, 1)] = 1
                    expected_events = (
                        [["skip", "kingAlreadyHit"]]
                        if king and current["alreadyKing"] & 1
                        else (
                            [["skip", "nonpositive"]]
                            if current["selected"] <= 0
                            else [
                                [
                                    "hit",
                                    current["selected"],
                                    "area",
                                    current["payload"],
                                    0,
                                    0,
                                ]
                            ]
                        )
                    )
                else:
                    expected_events = [["skip", "component"]]
                require(
                    events == expected_events
                    and dict(calls) == expected_calls
                    and Counter(reads) == expected_reads,
                    f"Area target inventory differs: {name}, {events}, {dict(calls)}, {reads}",
                )
                victims.append(
                    {
                        "targetSource": name,
                        "events": list(events),
                        "getters": dict(calls),
                        "dataReads": {
                            f"{n}/{hex(o)}/{s}": count
                            for (n, o, s), count in sorted(expected_reads.items())
                        },
                        "unrelatedHeapUnchanged": True,
                    }
                )
        return {
            "sourceName": profile["sourceName"],
            "origin": origin,
            "fields": fields,
            "pulse": pulse,
            "targets": victims,
        }

    cases = [
        sample(p, origin, level)
        for p in profiles
        for origin in [0, 100000]
        for level in [0, 8]
    ]
    zap = next(p for p in profiles if p["sourceName"] == "Zap")
    controls = [
        sample(zap, override={"damage": damage, "percent": percent})
        for damage in [0, 1, 75, 161, 192, 689]
        for percent in [-101, -100, -99, -60, 0, 1, 250]
    ]
    controls += [
        sample(zap, level=level, override={"rarity": rarity})
        for level in [-3, 1, 8, 11]
        for rarity in [-1, 0, 1, 3]
    ]
    controls += [
        sample(zap, override={"componentFlags": flag})
        for flag in [-1, 0, 1, 2, 3, 4, 5, 8, 255]
    ]
    controls += [sample(zap, override={"componentPresent": False})]
    controls += [sample(zap, override={"alreadyKing": flag}) for flag in [1, 2, 255]]
    controls += [
        sample(zap, override={field: flag})
        for field in ["onlyEnemies", "hitsAir", "hitsGround"]
        for flag in [0, 1, 2, 255]
    ]
    definitions = [
        (
            "pulseDamageRequest",
            0x21398C,
            0x213B05,
            "Actual due-pulse radius/amount/flags preparation; stop before world-area iteration or the following buff branch.",
        ),
        (
            "areaBaseDamage",
            0x1D39C6,
            0x1D3A16,
            "Actual generic Damage table argument preparation; table/level result is supplied.",
        ),
        (
            "areaCrownDamage",
            0x1D3CEC,
            0x1D3D6D,
            "Actual ceil-positive Crown arithmetic and generic Damage table arguments.",
        ),
        (
            "crownColumnStore",
            0x1D2EDD,
            0x1D2F0D,
            "Retained named CrownTowerDamagePercent loader/store at Data+0x58; CSV loading is not executed.",
        ),
        (
            "candidateDamageChoice",
            0x21BE9E,
            0x21BF75,
            "Actual component gate and ordinary/Crown amount selection, including already-hit King suppression; stop at damage receiver entry.",
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
        require(bool(instructions), "Empty area Crown instruction block")
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
            "A supplied single due pulse enters the actual bounded area update after earlier lifetime/cadence/state work. Source Data/header values, level, raw rarity and row descriptor are supplied. All 12 archived area rows are represented; the unused positive-Damage row is data coverage, not a natural caller claim.",
            "The generic Damage table getter at 0x20205a is a supplied-result boundary; exact row, raw image Damage-column/GOT word, level, mode and rarity arguments are checked. Native table/rarity/level projection and dynamic relocation are excluded. Source episodes provide archived base Damage at both raw levels without claiming level scaling.",
            "Actual area base and Crown helpers, source getters and world-area request argument preparation execute. Crown math uses ceil(base * max(0, 100 + percent)/100). Supplied normalized-damage controls 192 and 161 request 77 and 65 respectively at -60 percent.",
            "Already-eligible target records then enter the actual per-candidate component/class amount selector using the prepared pulse packet. Source-selected Knight/Cannon/Princess/King vtables, IsSummonerTower and King-already-hit bits execute; geometry, world scanning, target eligibility and their collection order are excluded.",
            "Execution stops at world request entry and at downstream damage receiver 0x25ff6e entry (or the explicit skip branches). Health, shields, stun/buffs, effects and full object lifetime do not execute. Exact ordered events, getter/provider arguments/counts, Data read inventories and complete supplied 64-KiB heap preservation are checked for both stages. Application rules remain 44.",
        ],
        "profiles": profiles,
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    path = Path("reference/client/area-crown-native-trace.json")
    output = json.dumps(result, indent=2) + "\n"
    if env["args"].check:
        require(path.read_text() == output, "Area Crown capture differs")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "profiles": len(profiles),
                "cases": len(cases),
                "controls": len(controls),
                "pulses": len(cases + controls),
                "targets": sum(len(r["targets"]) for r in cases + controls),
                "blocks": len(blocks),
            }
        )
    )
