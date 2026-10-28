"""Execute bounded native buff clocks, refresh and damage/heal requests.

Buff state, Data fields, owner and table rates are supplied. Actual timer,
period counter, amount helpers and class/component gates execute. Receivers
are checked supplied boundaries; natural buff application/removal is excluded.
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
from unicorn.x86_const import UC_X86_REG_ESP


def require(condition, detail):
    if not condition:
        raise RuntimeError(str(detail))


def trunc(value, divisor):
    return value // divisor if value >= 0 else -((-value) // divisor)


def capture(env, _context):
    cpu, heap, body, target_data, component = [
        env[k] for k in ["cpu", "heap", "body", "data", "component"]
    ]
    read, write, run, ret = [env[k] for k in ["read", "write", "run", "return_hook"]]
    paths = [
        "reference/client/area-crown-native-trace.json",
        "reference/logic/character_buffs.csv",
        "reference/logic/characters.csv",
        "reference/logic/buildings.csv",
    ]
    inputs = [
        {"path": p, "sha256": hashlib.sha256(Path(p).read_bytes()).hexdigest()}
        for p in paths
    ]
    prior = json.loads(Path(paths[0]).read_text())
    require(prior["sha256"] == env["sha"], "Buff tick binary differs")
    for entry in prior["inputs"]:
        require(
            hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
            == entry["sha256"],
            f"Buff tick input differs: {entry['path']}",
        )
    columns = [
        {"name": "DamagePerSecond", "string": 0x61357E, "gotOffset": 0x1710},
        {"name": "HealPerSecond", "string": 0x61358E, "gotOffset": 0x1758},
        {"name": "HitFrequency", "string": 0x61355D, "dataOffset": 0x50},
        {
            "name": "CrownTowerDamagePercent",
            "string": 0x612EAF,
            "dataOffset": 0x58,
        },
    ]
    for col in columns:
        name = col["name"].encode() + b"\0"
        require(
            bytes(cpu.mem_read(col["string"], len(name))) == name,
            "Buff tick named column differs",
        )
    record, data, row_pointer, health = [
        heap + off for off in [0x8000, 0xA000, 0xC000, 0xD000]
    ]
    raw_columns = {
        k: read(0x7B8A14 + off) for k, off in [("damage", 0x1710), ("heal", 0x1758)]
    }
    for vt in [0x7B34A0, 0x7B36D8]:
        require(
            read(vt + 0x44) == 0x219DAE and read(vt + 0x64) == 0x2172AE,
            "Buff target methods differ",
        )
    env["allowed"].extend(
        [
            (0x218F48, 0x21912A),
            (0x21912A, 0x219180),
            (0x1D7E36, 0x1D7F00),
            (0x1D7F9C, 0x1D8078),
            (0x20205A, 0x20205B),
            (0x1E99F2, 0x1E99F3),
            (0x2601AE, 0x2601AF),
            (0x26065E, 0x26065F),
            (0x219DAE, 0x219DC6),
            (0x21A404, 0x21A410),
            (0x2243E4, 0x2243F3),
            (0x2172AE, 0x2172E0),
            (0x1DE24A, 0x1DE25E),
        ]
    )
    current, events, calls, reads = None, [], Counter(), []
    helpers = {
        0x1D7EB4: "baseDamage",
        0x1D7E36: "crownDamage",
        0x1D7F9C: "baseHeal",
        0x1D7FFA: "crownHeal",
        0x219DAE: "component",
        0x21A404: "ordinaryClass60",
        0x2243E4: "kingClass60",
        0x2172AE: "class64",
        0x1DE24A: "summonerFlag",
        0x21960E: "Data",
        0x35BD10: "maximum",
    }
    table_returns = {
        0x1D7EF9: ("damage", False),
        0x1D7E7C: ("damage", True),
        0x1D7FE1: ("heal", False),
        0x1D8040: ("heal", True),
    }

    def hook(_cpu, pc, _size, _data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if pc == 0x20205A:
            kind, crown = table_returns.get(read(sp), (None, None))
            require(kind is not None, "Unexpected buff rate table caller")
            args = [read(sp + off) for off in [4, 8, 12, 16, 20]]
            require(
                args
                == [
                    row_pointer,
                    raw_columns[kind],
                    current["level"],
                    1,
                    current["rarity"],
                ],
                "Buff rate table arguments differ",
            )
            calls["providedRateTable"] += 1
            events.append(
                [
                    "table",
                    kind,
                    crown,
                    current["level"],
                    current["rarity"],
                    current[kind],
                ]
            )
            ret(current[kind])
        elif pc in [0x218FF0, 0x219026, 0x21908B, 0x2190AB, 0x2190F1, 0x219108]:
            # The root harness supplies and checks the owner resolver result.
            require(read(sp) == component, "Buff owner resolver differs")
            calls["providedOwner"] += 1
        elif pc == 0x1E99F2:
            require(read(sp) == 0x2190A1, "Buff request word provider caller differs")
            calls["providedRequestWord"] += 1
            ret(current["requestWord"])
        elif pc == 0x2601AE:
            args = [read(sp + off) for off in [4, 8, 12, 16, 20, 24]]
            require(
                args
                == [
                    health,
                    current["damageAmount"],
                    current["requestWord"],
                    current["payload"],
                    0,
                    0,
                ],
                "Buff damage receiver arguments differ",
            )
            events.append(["damage", *args[1:]])
            calls["providedDamageReceiver"] += 1
            ret()
        elif pc == 0x26065E:
            require(
                [read(sp + 4), read(sp + 8)] == [health, current["healAmount"]],
                "Buff heal receiver arguments differ",
            )
            events.append(["heal", current["healAmount"]])
            calls["providedHealReceiver"] += 1
            ret()
        else:
            name = helpers[pc]
            pointer = read(sp + 4)
            if name in ["baseDamage", "crownDamage", "baseHeal", "crownHeal"]:
                require(
                    pointer == data and read(sp + 8) == current["level"],
                    "Buff amount helper arguments differ",
                )
            elif name == "maximum":
                args = [pointer, read(sp + 8)]
                require(
                    args
                    in [
                        [0, current["beforeRemaining"] - 50],
                        [100 + current["percent"], 0],
                    ],
                    "Buff maximum arguments differ",
                )
            else:
                require(
                    pointer == (target_data if name == "summonerFlag" else body),
                    f"Buff target getter differs: {name}",
                )
            calls[name] += 1

    def memory(_cpu, _access, address, size, _value, _data):
        name, base = (
            ("buff", data)
            if data <= address < data + 0x800
            else ("target", target_data)
        )
        reads.append((name, address - base, size))

    for pc in [
        0x20205A,
        0x218FF0,
        0x219026,
        0x21908B,
        0x2190AB,
        0x2190F1,
        0x219108,
        0x1E99F2,
        0x2601AE,
        0x26065E,
        *helpers,
    ]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)
    for base in [data, target_data]:
        cpu.hook_add(UC_HOOK_MEM_READ, memory, begin=base, end=base + 0x7FF)
    rows = [
        r
        for r in csv.DictReader(io.StringIO(Path(paths[1]).read_text()))
        if r["Name"].lower() not in ["", "string"]
    ]
    profiles = [
        {
            "sourceName": r["Name"],
            "damage": int(r["DamagePerSecond"] or 0),
            "heal": int(r["HealPerSecond"] or 0),
            "frequencyMs": int(r["HitFrequency"] or 0),
            "percent": int(r["CrownTowerDamagePercent"] or 0),
        }
        for r in rows
    ]
    require(len(profiles) == 8, "Recheck archived buff profiles")
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

    def sample(profile, name="Knight", override=None, steps=20, refresh=None):
        nonlocal current
        king = name == "KingTower"
        summoner = target_rows[name]["IsSummonerTower"].lower() == "true"
        current = {
            **profile,
            "targetSource": name,
            "level": 0,
            "rarity": 0,
            "remainingMs": 1000,
            "counter": 0,
            "componentFlags": 4,
            "componentPresent": True,
            "requestWord": -37,
            "payload": -23,
            **(override or {}),
        }
        fields = current.copy()
        crown = king or summoner
        for kind in ["damage", "heal"]:
            current[kind + "Amount"] = (
                (current[kind] * max(0, 100 + current["percent"]) + 99) // 100
                if crown
                else trunc(current[kind] * current["frequencyMs"], 1000)
            )
        cpu.mem_write(heap, pattern)
        for ptr, value in [
            (body, 0x7B36D8 if king else 0x7B34A0),
            (body + 0x10, target_data),
            (body + 0x38, current["componentFlags"]),
            (body + 0x44, health if current["componentPresent"] else 0),
            (record, current["remainingMs"]),
            (record + 4, current["remainingMs"]),
            (record + 8, current["counter"]),
            (record + 0xC, data),
            (record + 0x10, component),
            (record + 0x14, current["level"]),
            (record + 0x18, 0),
            (record + 0x24, current["payload"]),
            (data + 8, row_pointer),
            (data + 0x50, current["frequencyMs"]),
            (data + 0x58, current["percent"]),
            (data + 0x7C, current["rarity"]),
        ]:
            write(ptr, value)
        cpu.mem_write(target_data + 0x28A, bytes([summoner]))
        remaining, counter = current["remainingMs"], current["counter"]
        all_calls, all_reads, frames = Counter(), Counter(), []
        for step in range(1, steps + 1):
            refreshed = refresh.get(step) if refresh else None
            if refreshed is not None:
                expected = bytearray(cpu.mem_read(heap, 0x10000))
                for offset in [0, 4]:
                    struct.pack_into("<i", expected, record - heap + offset, refreshed)
                run(0x21916A, record, refreshed)
                require(
                    bytes(cpu.mem_read(heap, 0x10000)) == expected,
                    "Buff refresh modified counter or unrelated heap",
                )
                remaining = refreshed
            current["beforeRemaining"] = remaining
            before = bytearray(cpu.mem_read(heap, 0x10000))
            remaining = remaining if remaining == -1 else max(0, remaining - 50)
            frequency = current["frequencyMs"]
            pulse = False
            if frequency > 0:
                counter += 1
                pulse = counter >= trunc(frequency, 50)
                if pulse:
                    counter = 0
            for off, value in [(0, remaining), (8, counter)]:
                struct.pack_into("<i", before, record - heap + off, value)
            events.clear()
            calls.clear()
            reads.clear()
            run(0x218F48, record, instruction_budget=3000)
            require(
                bytes(cpu.mem_read(heap, 0x10000)) == before,
                "Buff update modified unexpected heap bytes",
            )
            expected_calls = Counter({"maximum": int(current["beforeRemaining"] != -1)})
            expected_calls += Counter()  # Remove zero entries for exact inventories.
            expected_reads = Counter({("buff", 0x50, 4): 1})
            expected_events = []
            if pulse:
                expected_calls.update(
                    {
                        "baseDamage": 1,
                        "baseHeal": 1,
                        "providedRateTable": 2,
                        "providedOwner": 1,
                        "class64": 1,
                        "Data": 1,
                        "summonerFlag": 1,
                    }
                )
                expected_reads.update(
                    {
                        ("buff", 0x50, 4): 2,
                        ("buff", 8, 4): 2,
                        ("buff", 0x7C, 4): 2,
                        ("target", 0x28A, 1): 1,
                    }
                )
                expected_events += [
                    [
                        "table",
                        kind,
                        False,
                        current["level"],
                        current["rarity"],
                        current[kind],
                    ]
                    for kind in ["damage", "heal"]
                ]
                if not summoner:
                    expected_calls.update(
                        {
                            "providedOwner": 1,
                            "kingClass60" if king else "ordinaryClass60": 1,
                        }
                    )
                if crown:
                    expected_calls.update(
                        {
                            "crownDamage": 1,
                            "crownHeal": 1,
                            "providedRateTable": 2,
                            "maximum": 2,
                        }
                    )
                    expected_reads.update(
                        {("buff", 8, 4): 2, ("buff", 0x7C, 4): 2, ("buff", 0x58, 4): 2}
                    )
                    expected_events += [
                        [
                            "table",
                            kind,
                            True,
                            current["level"],
                            current["rarity"],
                            current[kind],
                        ]
                        for kind in ["damage", "heal"]
                    ]
                active = current["componentPresent"] and bool(
                    current["componentFlags"] & 4
                )
                for kind in ["damage", "heal"]:
                    amount = current[kind + "Amount"]
                    if amount > 0:
                        expected_calls.update({"providedOwner": 1, "component": 1})
                        if active:
                            expected_calls.update(
                                {
                                    "providedOwner": 1,
                                    "component": 1,
                                    (
                                        "providedDamageReceiver"
                                        if kind == "damage"
                                        else "providedHealReceiver"
                                    ): 1,
                                }
                            )
                            if kind == "damage":
                                expected_calls["providedRequestWord"] += 1
                                expected_events.append(
                                    [
                                        "damage",
                                        amount,
                                        current["requestWord"],
                                        current["payload"],
                                        0,
                                        0,
                                    ]
                                )
                            else:
                                expected_events.append(["heal", amount])
            require(
                events == expected_events
                and calls == expected_calls
                and Counter(reads) == expected_reads,
                f"Buff inventory differs: {name}, {step}, {events}, {dict(calls)}, {reads}; expected {expected_events}, {dict(expected_calls)}, {dict(expected_reads)}",
            )
            all_calls.update(calls)
            all_reads.update(reads)
            # Execute the actual empty-reference expiry predicate, without a manager.
            expired = run(0x21912A, record)
            require(
                expired == int(remaining == 0), "Buff empty-reference expiry differs"
            )
            require(
                bytes(cpu.mem_read(heap, 0x10000)) == before,
                "Buff expiry check modified heap",
            )
            frames.append(
                {
                    "step": step,
                    "refreshedMs": refreshed,
                    "remainingMs": remaining,
                    "counter": counter,
                    "pulse": pulse,
                    "expired": bool(expired),
                    "events": list(events),
                }
            )
        return {
            "fields": fields,
            "refresh": {str(k): v for k, v in (refresh or {}).items()},
            "frames": frames,
            "getters": dict(all_calls),
            "dataReads": {
                f"{n}/{hex(o)}/{s}": count
                for (n, o, s), count in sorted(all_reads.items())
            },
            "exactHeapChangesOnly": True,
        }

    cases = [
        sample(p, name, {"level": level})
        for p in profiles
        for name in ["Knight", "Cannon", "PrincessTower", "KingTower"]
        for level in [0, 8]
    ]
    poison = next(p for p in profiles if p["sourceName"] == "Poison")
    controls = [
        sample(
            poison, name, {"damage": damage, "percent": percent, "counter": 19}, steps=1
        )
        for name in ["Knight", "PrincessTower", "KingTower"]
        for damage in [0, 1, 57, 121, 192, 689]
        for percent in [-101, -100, -99, -60, 0, 1, 250]
    ]
    controls += [
        sample(
            poison,
            name,
            {"damage": 121, "heal": 100, "frequencyMs": frequency, "counter": 0},
            steps=22,
        )
        for name in ["Knight", "PrincessTower", "KingTower"]
        for frequency in [-1, 0, 1, 49, 50, 51, 99, 100, 500, 999, 1000, 1001]
    ]
    controls += [
        sample(
            poison,
            "PrincessTower",
            {"counter": 19, "componentFlags": flag, "heal": 100},
            steps=1,
        )
        for flag in [-1, 0, 1, 2, 3, 4, 5, 8, 255]
    ]
    controls += [
        sample(
            poison,
            "KingTower",
            {"counter": 19, "componentPresent": False, "heal": 100},
            steps=1,
        )
    ]
    controls += [
        sample(
            poison, "Knight", {"remainingMs": remaining, "counter": counter}, steps=22
        )
        for remaining in [-1, 0, 1, 49, 50, 51, 999, 1000]
        for counter in [0, 19, 23]
    ]
    controls += [
        sample(
            poison,
            "PrincessTower",
            {"remainingMs": 50, "counter": counter},
            steps=40,
            refresh={1: 1000, 6: 1000, 11: 1000, 16: 1000, 21: 1000, 26: 1000},
        )
        for counter in [0, 4, 19]
    ]
    controls += [
        sample(
            poison,
            "KingTower",
            {
                "level": level,
                "rarity": rarity,
                "counter": 19,
                "requestWord": 517,
                "payload": 911,
            },
            steps=1,
        )
        for level in [-3, 1, 8, 11]
        for rarity in [-1, 0, 1, 3]
    ]
    definitions = [
        (
            "buffUpdate",
            0x218F48,
            0x219129,
            "Actual 50-ms remaining timer, frequency/50 counter, base/Crown amount choice and damage/heal request preparation; receivers supplied.",
        ),
        (
            "emptyReferenceExpiry",
            0x21912A,
            0x219169,
            "Actual expiry predicate with optional reference supplied null; no natural manager/removal.",
        ),
        (
            "refreshDuration",
            0x21916A,
            0x21917F,
            "Actual refresh writes remaining and original duration, preserving periodic counter.",
        ),
        (
            "baseDamageRate",
            0x1D7EB4,
            0x1D7F00,
            "Actual DamagePerSecond table argument preparation; table result supplied.",
        ),
        (
            "crownDamageRate",
            0x1D7E36,
            0x1D7EB4,
            "Actual ceil-positive Crown damage rate arithmetic; table result supplied.",
        ),
        (
            "baseHealRate",
            0x1D7F9C,
            0x1D7FE8,
            "Actual HealPerSecond table argument preparation; table result supplied.",
        ),
        (
            "crownHealRate",
            0x1D7FFA,
            0x1D8078,
            "Actual ceil-positive Crown heal rate arithmetic; table result supplied.",
        ),
        (
            "rateColumnBinding",
            0x1D7518,
            0x1D75A1,
            "Retained named DamagePerSecond/HealPerSecond column bindings to GOT offsets 0x1710/0x1758; loader not executed.",
        ),
        (
            "frequencyColumnStore",
            0x1D7431,
            0x1D7456,
            "Retained named HitFrequency integer loader/store at Data+0x50; loader not executed.",
        ),
        (
            "crownColumnStore",
            0x1D6F35,
            0x1D6F65,
            "Retained named CrownTowerDamagePercent integer loader/store at Data+0x58; loader not executed.",
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
        require(bool(instructions), "Empty buff tick instruction block")
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
            "Supplied buff records, duration, initial counter, source Data fields, raw level/rarity, null optional reference and target header/vtable enter actual native update/refresh/expiry functions. All eight archived buff rows are represented, including zero-rate rows. Calls are controlled 50-ms invocations, not a proof of natural world ordering or eligibility.",
            "The generic table getter 0x20205a is a supplied result boundary. Exact row descriptor, raw unresolved image DamagePerSecond/HealPerSecond GOT word, level, mode 1, rarity and caller are checked. Native table scaling and dynamic relocation are excluded; source rates are supplied at both raw levels without claiming level scaling.",
            "Actual duration subtraction/clamp, permanent -1 duration, positive-frequency gate, frequency/50 period counter, source class methods, component presence gate, base/Crown arithmetic and request arguments execute. Refresh preserves the period counter. Expiry is checked with a null optional reference; controls can explicitly invoke updates after zero remaining duration, without claiming that a natural owner keeps expired records.",
            "Ordinary targets use signed truncation of rate * frequencyMs / 1000. The actual Crown branch selects ceil(rate * max(0, 100 + percent)/100) directly, without ordinary frequency scaling. Synthetic frequency/combined-rate/Crown Heal cases isolate arithmetic; no natural application to otherwise ineligible targets is claimed. Source Poison frequency is 1000 ms, base 57 requests 23 Crown damage, and normalized 121 control requests 49.",
            "Owner resolution is supplied and checked. Actual target class/component getters execute. The no-argument provider at 0x1e99f2 supplies an opaque request word; record+0x24 is forwarded raw. Damage receiver 0x2601ae and heal receiver 0x26065e are checked supplied no-ops, allowing actual native return paths to execute. Health/shields/death, hidden-target lifecycle, natural area refresh cadence, buff construction/application/removal, effects and combat reactions are excluded.",
            "Every invocation checks exact ordered rate/receiver events, getter/provider arguments and counts, Data read inventories, remaining/counter values, expiry result and complete 64-KiB heap changes. Refresh separately checks only the two duration writes. Application rules remain 45.",
        ],
        "profiles": profiles,
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    path = Path("reference/client/buff-ticks-native-trace.json")
    output = json.dumps(result, indent=2) + "\n"
    if env["args"].check:
        require(path.read_text() == output, "Buff tick capture differs")
    else:
        path.write_text(output)
    episodes = cases + controls
    print(
        json.dumps(
            {
                "profiles": len(profiles),
                "cases": len(cases),
                "controls": len(controls),
                "updates": sum(len(r["frames"]) for r in episodes),
                "pulses": sum(f["pulse"] for r in episodes for f in r["frames"]),
                "damageRequests": sum(
                    e[0] == "damage"
                    for r in episodes
                    for f in r["frames"]
                    for e in f["events"]
                ),
                "healRequests": sum(
                    e[0] == "heal"
                    for r in episodes
                    for f in r["frames"]
                    for e in f["events"]
                ),
                "blocks": len(blocks),
            }
        )
    )
