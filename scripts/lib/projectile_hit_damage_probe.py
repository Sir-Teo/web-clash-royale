"""Bounded native per-candidate projectile hit amount and request arguments.

Candidate scanning/eligibility and caller locals are supplied. Actual component
gate, XY delta construction, Crown classes and amount helper execute. Direction
notification and downstream damage execution are explicit supplied boundaries.
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
    UC_X86_REG_EDI,
    UC_X86_REG_EBP,
    UC_X86_REG_ESP,
    UC_X86_REG_EIP,
)


def require(condition, detail):
    if not condition:
        raise RuntimeError(str(detail))


def capture(env, context):
    cpu, heap, body, data = [env[k] for k in ["cpu", "heap", "body", "data"]]
    read, write, run, ret = [env[k] for k in ["read", "write", "run", "return_hook"]]
    paths = [
        "reference/client/projectile-arrival-native-trace.json",
        "reference/logic/projectiles.csv",
        "reference/logic/characters.csv",
        "reference/logic/buildings.csv",
    ]
    inputs = [
        {"path": p, "sha256": hashlib.sha256(Path(p).read_bytes()).hexdigest()}
        for p in paths
    ]
    prior = json.loads(Path(paths[0]).read_text())
    require(prior["sha256"] == env["sha"], "Hit amount binary differs")
    for entry in prior["inputs"]:
        require(
            hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
            == entry["sha256"],
            f"Hit amount input differs: {entry['path']}",
        )
    for col in prior["sourceColumns"]:
        name = col["name"].encode() + b"\0"
        require(
            bytes(cpu.mem_read(col["string"], len(name))) == name,
            "Hit amount source column differs",
        )
    target, target_data = heap + 0x8000, heap + 0xA000
    notification, notification_vt, damage_component = (
        heap + 0xB000,
        heap + 0xC000,
        heap + 0xD000,
    )
    for vt in [0x7B34A0, 0x7B36D8]:
        require(read(vt + 0x44) == 0x219DAE, "Target damage component method differs")
        require(read(vt + 0x64) == 0x2172AE, "Target summoner method differs")
    require(
        read(0x7B34A0 + 0x60) == 0x21A404 and read(0x7B36D8 + 0x60) == 0x2243E4,
        "Target Crown class methods differ",
    )
    env["allowed"].extend(
        [
            (0x21ECF6, 0x21EDC7),
            (0x21EF4F, 0x21EF50),
            (0x219DAE, 0x219DC6),
            (0x219AF6, 0x219B16),
            (0x35D1C0, 0x35D245),
            (0x21A404, 0x21A410),
            (0x2243E4, 0x2243F3),
            (0x2172AE, 0x2172E0),
            (0x1DE24A, 0x1DE25E),
            (0x1FB9BA, 0x1FBA1C),
            (0x35BD10, 0x35BD52),
            (0x1FB664, 0x1FB665),
            (0x21961E, 0x21961F),
            (0x25FF6E, 0x25FF6F),
        ]
    )
    current, events, reads, calls = None, [], [], Counter()
    names = {
        0x219DAE: "damageComponent",
        0x219AF6: "targetX",
        0x219B06: "targetY",
        0x35D1C0: "deltaConstructor",
        0x21A404: "ordinaryClass60",
        0x2243E4: "kingClass60",
        0x2172AE: "class64",
        0x21960E: "Data",
        0x1DE24A: "summonerFlag",
        0x1FB9BA: "crownAmount",
        0x1FB664: "providedDamage",
        0x35BD10: "maximum",
        0x21961E: "providedNotification",
        0x25FF6E: "hitRequest",
    }

    def hook(_cpu, pc, _size, _data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if pc == 0x21ECF6:
            cpu.reg_write(UC_X86_REG_EDI, target)
            cpu.reg_write(UC_X86_REG_EBP, sp + 0x600)
            write(sp + 0x608, body)
            for off, value in [
                (0x28, current["impact"][0]),
                (0x24, current["impact"][1]),
                (0x20, current["cachedDamage"]),
            ]:
                write(sp + off, value)
            return
        if pc == 0x21EF4F:
            events.append(["skip"])
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
            return
        name = names[pc]
        calls[name] += 1
        pointer = read(sp + 4)
        if name == "Data":
            require(pointer in [body, target], "Hit Data owner differs")
            return
        if name == "deltaConstructor":
            require(
                [read(sp + 8), read(sp + 12)] == current["delta"],
                "Hit XY delta differs",
            )
            current["vector"] = pointer
            return
        expected = (
            data
            if name in ["providedDamage", "crownAmount"]
            else (
                target_data
                if name == "summonerFlag"
                else (
                    notification
                    if name == "providedNotification"
                    else (
                        damage_component
                        if name == "hitRequest"
                        else current["percent"] + 100 if name == "maximum" else target
                    )
                )
            )
        )
        require(pointer == expected, f"Hit argument differs: {name}")
        if name == "providedDamage":
            require(read(sp + 8) == current["level"], "Hit Damage level differs")
            events.append(
                ["damageRequest", current["level"], current["providedDamage"]]
            )
            ret(current["providedDamage"])
        elif name == "maximum":
            require(read(sp + 8) == 0, "Hit percent clamp differs")
        elif name == "providedNotification":
            args = [read(sp + o) for o in [8, 12, 16]]
            require(args == [*current["delta"], 0], "Hit notification arguments differ")
            events.append(["notification", *args])
            ret(current["notificationResult"])
        elif name == "hitRequest":
            vector = read(sp + 20)
            require(vector == current["vector"], "Hit vector pointer differs")
            args = [read(sp + o) for o in [8, 12, 16]]
            delta = [read(vector), read(vector + 4)]
            require(
                args == [current["amount"], body, current["payload"]]
                and delta == current["delta"]
                and read(sp + 24) == 0,
                "Hit request arguments differ",
            )
            events.append(
                ["hit", current["amount"], "projectile", current["payload"], *delta, 0]
            )
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])

    def memory(_cpu, _access, address, size, _value, _data):
        owner, base = (
            ("projectile", data)
            if data <= address < data + 0x800
            else ("target", target_data)
        )
        reads.append((owner, address - base, size))

    for pc in [0x21ECF6, 0x21EF4F, *names]:
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
        }
        for r in rows
    ]
    require(len(profiles) == 38, "Recheck hit amount source profiles")
    targets = {}
    for path in paths[2:]:
        targets.update(
            {
                r["Name"]: r
                for r in csv.DictReader(io.StringIO(Path(path).read_text()))
                if r["Name"] not in ["", "string"]
            }
        )
    pattern = bytes((i * 19 + 61) % 256 for i in range(0x10000))

    def signed(n):
        return (n + 0x80000000) % 0x100000000 - 0x80000000

    def sample(profile, victim, origin=0, delta=(300, -400), override=None):
        nonlocal current
        king = victim == "KingTower"
        current = {
            "providedDamage": profile["damage"],
            "cachedDamage": profile["damage"],
            "percent": profile["percent"],
            "level": 0,
            "componentFlags": 4,
            "componentPresent": True,
            "summonerByte": int(targets[victim]["IsSummonerTower"].lower() == "true"),
            "payload": -23,
            "notificationResult": 0,
            **(override or {}),
        }
        impact = [15000 + origin, 16000 - origin]
        position = [signed(impact[0] + delta[0]), signed(impact[1] + delta[1])]
        actual_delta = [signed(position[i] - impact[i]) for i in range(2)]
        current.update({"impact": impact, "delta": actual_delta})
        active = bool(current["componentFlags"] & 4) and current["componentPresent"]
        crown = king or bool(current["summonerByte"])
        amount = (
            (current["providedDamage"] * max(0, 100 + current["percent"]) + 99) // 100
            if crown
            else current["cachedDamage"]
        )
        current["amount"] = amount
        fields = current.copy()
        cpu.mem_write(heap, pattern)
        for pointer, value in [
            (body, 0x7B364C),
            (body + 0x10, data),
            (body + 0x8C, current["level"]),
            (body + 0x7C, current["payload"]),
            (data + 0x7C, current["percent"]),
            (target, 0x7B36D8 if king else 0x7B34A0),
            (target + 0x10, target_data),
            (target + 0x18, notification),
            (target + 0x38, current["componentFlags"]),
            (target + 0x44, damage_component if current["componentPresent"] else 0),
            (target + 0x20, position[0]),
            (target + 0x24, position[1]),
            (notification, notification_vt),
            (notification_vt + 0x48, 0x21961E),
        ]:
            write(pointer, value)
        cpu.mem_write(target_data + 0x28A, bytes([current["summonerByte"]]))
        before = bytes(cpu.mem_read(heap, 0x10000))
        events.clear()
        reads.clear()
        calls.clear()
        run(0x21ECF6, body, instruction_budget=2000)
        require(
            bytes(cpu.mem_read(heap, 0x10000)) == before,
            "Hit candidate modified supplied heap",
        )
        expected_events = [["skip"]]
        expected_calls = {"damageComponent": 1}
        expected_reads = Counter()
        if active:
            expected_events = [["notification", *actual_delta, 0]]
            expected_calls.update(
                {
                    "targetX": 1,
                    "targetY": 1,
                    "deltaConstructor": 1,
                    "providedNotification": 1,
                    "kingClass60" if king else "ordinaryClass60": 1,
                    "hitRequest": 1,
                }
            )
            if not king:
                expected_calls.update({"class64": 1, "Data": 1, "summonerFlag": 1})
                expected_reads[("target", 0x28A, 1)] = 1
            if crown:
                expected_calls["Data"] = expected_calls.get("Data", 0) + 1
                expected_calls.update(
                    {"crownAmount": 1, "providedDamage": 1, "maximum": 1}
                )
                expected_reads[("projectile", 0x7C, 4)] = 1
                expected_events.append(
                    ["damageRequest", current["level"], current["providedDamage"]]
                )
            expected_events.append(
                ["hit", amount, "projectile", current["payload"], *actual_delta, 0]
            )
        require(
            events == expected_events
            and dict(calls) == expected_calls
            and Counter(reads) == expected_reads,
            f"Hit request/read inventory differs: {events}, {dict(calls)}, {reads}",
        )
        return {
            "sourceName": profile["sourceName"],
            "targetSource": victim,
            "origin": origin,
            "fields": fields,
            "providedTargetPosition": position,
            "requested": active,
            "events": list(events),
            "getters": dict(calls),
            "dataReads": {
                f"{o}/{hex(a)}/{s}": n
                for (o, a, s), n in sorted(expected_reads.items())
            },
            "unrelatedHeapUnchanged": True,
        }

    cases = [
        sample(p, victim, origin, delta)
        for p in profiles
        for victim in ["Knight", "Cannon", "PrincessTower", "KingTower"]
        for origin in [0, 100000]
        for delta in [(0, 0), (300, -400), (-1257, 837)]
    ]
    arrow = next(p for p in profiles if p["sourceName"] == "ArcherArrow")
    controls = [
        sample(arrow, victim, override={"providedDamage": damage, "percent": pct})
        for victim in ["PrincessTower", "KingTower"]
        for damage in [0, 1, 115, 689]
        for pct in [-101, -100, -99, -60, 0, 1, 250]
    ]
    controls += [
        sample(arrow, "Knight", override={"componentFlags": flag})
        for flag in [-1, 0, 1, 2, 3, 4, 5, 8, 255]
    ]
    controls += [
        sample(arrow, victim, override={"componentPresent": False})
        for victim in ["Knight", "KingTower"]
    ]
    controls += [
        sample(arrow, victim, override={"summonerByte": flag})
        for victim in ["Knight", "KingTower"]
        for flag in [0, 1, 2, 255]
    ]
    controls += [
        sample(
            arrow,
            victim,
            override={"cachedDamage": 5, "providedDamage": 689, "level": level},
        )
        for victim in ["Knight", "PrincessTower", "KingTower"]
        for level in [-3, 1, 11]
    ]
    controls += [
        sample(
            arrow, "PrincessTower", override={"payload": value, "notificationResult": 1}
        )
        for value in [-2147483648, -1, 0, 1, 2147483647]
    ]
    controls += [
        sample(arrow, "Knight", delta=delta)
        for delta in [(2147483647, -2147483648), (-2147483648, 2147483647)]
    ]
    definitions = [
        (
            "candidateHitRequest",
            0x21ECF6,
            0x21EDC7,
            "Actual component gate, XY notification preparation, Crown class choice and downstream hit request; stop at the request callee.",
        ),
        (
            "damageComponentGate",
            0x219DAE,
            0x219DC6,
            "Actual target flags+0x38 mask 0x4 selects target+0x44 or null.",
        ),
        ("targetXY", 0x219AF6, 0x219B16, "Actual target XY getters."),
        (
            "deltaVectorConstructor",
            0x35D1C0,
            0x35D245,
            "Actual integer XY vector constructor; subtraction uses signed 32-bit wrap.",
        ),
        (
            "crownAmount",
            0x1FB9BA,
            0x1FBA1C,
            "Actual Crown arithmetic with supplied table/level Damage result.",
        ),
        (
            "ordinaryClass60",
            0x21A404,
            0x21A410,
            "Actual ordinary target class returns zero.",
        ),
        ("kingClass60", 0x2243E4, 0x2243F3, "Actual King target class returns one."),
        (
            "summonerClass64",
            0x2172AE,
            0x2172E0,
            "Actual class method reads target Data IsSummonerTower.",
        ),
        ("summonerFlag", 0x1DE24A, 0x1DE25E, "Actual source flag getter."),
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
        require(bool(instructions), "Empty hit amount instruction block")
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
        "sourceColumns": prior["sourceColumns"],
        "limits": [
            "Supplied already-eligible candidate and caller locals enter the actual bounded per-candidate hit fragment. Natural creation, owner/world state, scanning, filtering and area timing are excluded.",
            "Actual source target vtables choose the flags/component gate, XY fields, King and IsSummonerTower classes. Target+0x18 notification receiver/vtable and its no-op result are supplied; callback arguments are checked, but notification side effects do not execute.",
            "Non-Crown targets use the supplied caller's cached base Damage. Crown targets recompute through the actual percentage helper with a supplied Damage getter result at the raw projectile level. Native rarity/level table projection is excluded.",
            "Execution stops at entry to 0x25ff6e after checking receiver, amount, projectile, raw projectile+0x7c payload, integer XY delta vector and zero trailing argument. The downstream damage function and health/shield/death effects do not execute.",
            "Every source profile is paired with supplied Knight/Cannon/Princess/King records, translated origins and three deltas. Controls vary header bits, null component, raw IsSummonerTower bytes, percent clamps, exact/remainder arithmetic, unequal cached/getter damage, raw level, payload, callback result and signed coordinate wrap. Exact ordered events, getter counts, Data reads and the complete supplied 64-KiB heap are checked. Application rules remain 44.",
        ],
        "profiles": profiles,
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    path = Path("reference/client/projectile-hit-damage-native-trace.json")
    output = json.dumps(result, indent=2) + "\n"
    if env["args"].check:
        require(path.read_text() == output, "Native hit amount capture differs")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "profiles": len(profiles),
                "cases": len(cases),
                "controls": len(controls),
                "requests": sum(r["requested"] for r in cases + controls),
                "blocks": len(blocks),
            }
        )
    )
