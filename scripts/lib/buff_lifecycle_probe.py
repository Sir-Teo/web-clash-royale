"""Bounded retained-Poison component phases, expiry, HP and Tesla hide clocks.

Actor/status records, table rates and active snapshot are supplied. Native
component dispatch, buff iteration/update/removal, HP reduction and hide-clock
arithmetic execute. Actor body/visuals, application and damage reactions remain
excluded; these episodes do not claim a complete natural battle.
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
from unicorn.x86_const import (
    UC_X86_REG_EBP,
    UC_X86_REG_EDI,
    UC_X86_REG_EDX,
    UC_X86_REG_EIP,
    UC_X86_REG_ESP,
)

from lib.buff_tick_probe import require


def capture(env, context):
    cpu, heap, body, data, health, world, buffs, array = [
        env[k]
        for k in ["cpu", "heap", "body", "data", "component", "world", "buffs", "array"]
    ]
    read, write, run, ret = [env[k] for k in ["read", "write", "run", "return_hook"]]
    paths = [
        "reference/client/buff-ticks-native-trace.json",
        "reference/client/health-shield-native-trace.json",
        "reference/client/world-step-native-trace.json",
        "reference/logic/buildings.csv",
        "reference/logic/character_buffs.csv",
    ]
    inputs = [
        {"path": p, "sha256": hashlib.sha256(Path(p).read_bytes()).hexdigest()}
        for p in paths
    ]
    for path in paths[:3]:
        prior = json.loads(Path(path).read_text())
        require(prior["sha256"] == env["sha"], "Buff lifecycle binary differs")
        for entry in prior["inputs"]:
            require(
                hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
                == entry["sha256"],
                f"Buff lifecycle input differs: {entry['path']}",
            )
    columns = [
        {
            "name": "HidesWhenNotAttacking",
            "string": 0x7B8A14 - 0x1A5365,
            "dataOffset": 0x169,
        },
        {
            "name": "HideBeforeFirstHit",
            "string": 0x7B8A14 - 0x1A534F,
            "dataOffset": 0x16A,
        },
        {"name": "HideTimeMs", "string": 0x7B8A14 - 0x1A52F9, "dataOffset": 0x180},
        {"name": "UpTimeMs", "string": 0x7B8A14 - 0x1A52EE, "dataOffset": 0x184},
        {
            "name": "SpeedMultiplier",
            "string": 0x6135BF,
            "dataOffset": 0x48,
            "gotOffset": 0x1720,
        },
        {"name": "Panic", "string": 0x613638, "dataOffset": 0x6A, "gotOffset": 0x173C},
    ]
    for column in columns:
        expected = column["name"].encode() + b"\0"
        require(
            bytes(cpu.mem_read(column["string"], len(expected))) == expected,
            "Lifecycle named column differs",
        )
    rows = [
        {r["Name"]: r for r in csv.DictReader(io.StringIO(Path(p).read_text()))}
        for p in paths[3:]
    ]
    tesla, poison = rows[0]["Tesla"], rows[1]["Poison"]
    require(
        tesla["HidesWhenNotAttacking"] == "true"
        and tesla["HideTimeMs"] == tesla["UpTimeMs"] == "800"
        and tesla["Hitpoints"] == "450",
        "Recheck source Tesla hide fields",
    )
    require(
        poison["DamagePerSecond"] == "57"
        and poison["HitFrequency"] == "1000"
        and not poison["SpeedMultiplier"]
        and not poison["Panic"],
        "Recheck source Poison rate/speed fields",
    )
    record, buff_data, row_pointer, snapshot, health_vt, settings = [
        heap + off for off in [0x8000, 0xA000, 0xC000, 0x7000, 0xD000, 0xE000]
    ]
    require(read(0x79E1CC + 0xC) == 0x25B18E, "Buff component vtable differs")
    require(
        context["constants"].pop(0x25FA2A) == body, "Lifecycle owner provider differs"
    )
    require(
        context["constants"].pop(0x1E6CEE) == context["config"],
        "Lifecycle settings provider differs",
    )
    env["component_resolvers"][buffs] = (body, world)
    env["allowed"].extend(
        [
            (0x21AA0C, 0x21AA55),
            (0x219578, 0x21959A),
            (0x25B18E, 0x25B217),
            (0x25B3E1, 0x25B42B),
            (0x218D8E, 0x218D8F),
            (0x55E90, 0x55E91),
            (0x218F48, 0x21916A),
            (0x1D7EB4, 0x1D7F00),
            (0x1D7F9C, 0x1D7FE8),
            (0x20205A, 0x20205B),
            (0x1E99F2, 0x1E99F3),
            (0x1E6CEE, 0x1E6CEF),
            (0x25FA16, 0x25FA17),
            (0x25FA2A, 0x25FA3A),
            (0x25FF6E, 0x260413),
            (0x26064E, 0x26065D),
            (0x219DAE, 0x219DC6),
            (0x21A404, 0x21A410),
            (0x2172AE, 0x2172E0),
            (0x1DE24A, 0x1DE25E),
            (0x217460, 0x2174E6),
            (0x217322, 0x217343),
            (0x216B6C, 0x216CCC),
            (0x2185C0, 0x21863E),
            (0x1DEF68, 0x1DEF90),
            (0x1DEFC8, 0x1DEFF0),
            (0x25BF86, 0x25C080),
            (0x1D8154, 0x1D8166),
            (0x1D7F20, 0x1D7F30),
            (0x1DD6D0, 0x1DD6EA),
        ]
    )
    current, phase, events, calls, reads = None, None, [], Counter(), Counter()
    methods = {
        0x219578: "indexedComponent",
        0x25B18E: "buffManager",
        0x218F48: "buffUpdate",
        0x21912A: "expiry",
        0x1D7EB4: "baseDamage",
        0x1D7F9C: "baseHeal",
        0x219DAE: "healthComponent",
        0x21A404: "ordinaryClass60",
        0x2172AE: "class64",
        0x1DE24A: "summonerFlag",
        0x21960E: "Data",
        0x25FA2A: "healthOwner",
        0x217322: "state",
        0x217460: "hidden",
        0x216B6C: "hideClock",
        0x2185C0: "hideDesired",
        0x1DEF68: "hideIdleFlag",
        0x1DEF7C: "hideFirstFlag",
        0x1DEFC8: "hideTime",
        0x1DEFDC: "upTime",
        0x1DD6D0: "opaqueHideGate",
        0x25BF86: "hideSpeed",
        0x1D8154: "panicFlag",
        0x1D7F20: "speedModifier",
        0x35BD10: "maximum",
    }

    def hook(_cpu, pc, _size, _data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if pc == 0x21AA0C:
            cpu.reg_write(UC_X86_REG_EDI, snapshot)
            cpu.reg_write(UC_X86_REG_EDX, 1)
            write(sp + 0x14, snapshot)
            write(sp + 0x18, 1)
        elif pc == 0x21AA54:
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        elif pc == 0x25B216:
            require(
                read(cpu.reg_read(UC_X86_REG_EBP) + 8) == buffs,
                "Lifecycle buff return frame differs",
            )
            cpu.reg_write(UC_X86_REG_EIP, 0x25B3E1)
        elif pc == 0x25FA16:
            require(
                read(sp + 4) == health and read(sp) == 0x21AA38,
                "Provided health update differs",
            )
            calls["providedHealthUpdate"] += 1
            ret()
        elif pc == 0x20205A:
            caller = read(sp)
            require(caller in [0x1D7EF9, 0x1D7FE1], "Lifecycle rate caller differs")
            damage = caller == 0x1D7EF9
            expected = [
                row_pointer,
                read(0x7B8A14 + (0x1710 if damage else 0x1758)),
                current["level"],
                1,
                0,
            ]
            require(
                [read(sp + off) for off in [4, 8, 12, 16, 20]] == expected,
                "Lifecycle rate table arguments differ",
            )
            calls["providedRateTable"] += 1
            amount = current["damage"] if damage else 0
            events.append(["rate", "damage" if damage else "heal", amount])
            ret(amount)
        elif pc == 0x1E99F2:
            require(read(sp) == 0x2190A1, "Lifecycle opaque word caller differs")
            calls["providedRequestWord"] += 1
            ret(137)
        elif pc == 0x1E6CEE:
            require(read(sp) == 0x2601D1, "Lifecycle settings caller differs")
            calls["providedSettings"] += 1
            ret(settings)
        elif pc in [0x2601AE, 0x2602D0]:
            require(
                [read(sp + off) for off in [4, 8, 12, 16, 20, 24]]
                == [health, current["damage"], 137, 0, 0, 0],
                "Lifecycle damage receiver arguments differ",
            )
            calls["damageProxy" if pc == 0x2601AE else "damageReducer"] += 1
        elif pc == 0x260412:
            events.append(["hp", read(health + 8)])
            cpu.reg_write(UC_X86_REG_EIP, 0x260655)
        elif pc == 0x25B42A:
            require(
                [read(sp + 4), read(sp + 8)] == [buffs, record],
                "Lifecycle removal notification differs",
            )
            events.append(["remove"])
            calls["providedRemovalNotification"] += 1
            ret()
        elif pc in [0x218D8E, 0x55E90]:
            require(read(sp + 4) == record, "Lifecycle disposal receiver differs")
            name = "providedDestructor" if pc == 0x218D8E else "providedFree"
            events.append([name])
            calls[name] += 1
            ret()
        elif pc in [0x218FF0, 0x219026, 0x21908B, 0x2190AB]:
            require(read(sp) == buffs, "Lifecycle buff owner resolver differs")
            calls["providedBuffOwner"] += 1
        elif pc == 0x260305:
            require(read(sp) == health, "Lifecycle world receiver differs")
            calls["providedWorld"] += 1
        elif pc == 0x25FFAD:
            require(read(sp) == health, "Lifecycle hidden owner receiver differs")
            calls["providedHiddenOwner"] += 1
        else:
            name = methods[pc]
            pointer = read(sp + 4)
            expected = (
                buff_data
                if name in ["baseDamage", "baseHeal", "panicFlag", "speedModifier"]
                else (
                    data
                    if name
                    in [
                        "summonerFlag",
                        "hideIdleFlag",
                        "hideFirstFlag",
                        "hideTime",
                        "upTime",
                        "opaqueHideGate",
                    ]
                    else (
                        buffs
                        if name in ["buffManager", "hideSpeed"]
                        else (
                            record
                            if name in ["buffUpdate", "expiry"]
                            else health if name == "healthOwner" else body
                        )
                    )
                )
            )
            if name == "maximum":
                require(
                    [pointer, read(sp + 8)]
                    in [
                        [0, current["beforeRemaining"] - 50],
                        [current["beforeProgress"] - 50, 0],
                    ],
                    "Lifecycle clamp arguments differ",
                )
            else:
                require(pointer == expected, f"Lifecycle getter owner differs: {name}")
            if name == "indexedComponent":
                require(read(sp + 8) in range(4), "Lifecycle component index differs")
            if name in ["baseDamage", "baseHeal"]:
                require(
                    read(sp + 8) == current["level"], "Lifecycle rate level differs"
                )
            if name == "hideSpeed":
                require(read(sp + 8) == 50, "Lifecycle hide delta differs")
            calls[name] += 1

    def memory(_cpu, _access, address, size, _value, _data):
        owner, start = next(
            (name, base)
            for name, base in [
                ("target", data),
                ("buff", buff_data),
                ("settings", settings),
                ("world", world),
            ]
            if base <= address < base + 0x800
        )
        reads[(owner, address - start, size)] += 1

    for pc in [
        0x21AA0C,
        0x21AA54,
        0x25B216,
        0x25FA16,
        0x20205A,
        0x1E99F2,
        0x1E6CEE,
        0x2601AE,
        0x2602D0,
        0x260412,
        0x25B42A,
        0x218D8E,
        0x55E90,
        0x218FF0,
        0x219026,
        0x21908B,
        0x2190AB,
        0x260305,
        0x25FFAD,
        *methods,
    ]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)
    for base in [data, buff_data, settings, world]:
        cpu.hook_add(UC_HOOK_MEM_READ, memory, begin=base, end=base + 0x7FF)

    def sample(override=None, steps=24):
        nonlocal current, phase
        current = {
            "damage": 57,
            "hp": 450,
            "level": 0,
            "remainingMs": 1000,
            "counter": 15,
            "progress": 600,
            "state": 0,
            "flags": 12,
            "healthPresent": True,
            **(override or {}),
        }
        fields = current.copy()
        cpu.mem_write(heap, b"\0" * 0x10000)
        for ptr, value in [
            (body, 0x7B34A0),
            (body + 0x10, data),
            (body + 0x38, current["flags"]),
            (body + 0x44, health if current["healthPresent"] else 0),
            (body + 0x48, buffs),
            (body + 0x60, current["state"]),
            (body + 0x6C, current["progress"]),
            (data + 0x180, 800),
            (data + 0x184, 800),
            (health, health_vt),
            (health + 4, body),
            (health + 8, current["hp"]),
            (health_vt + 0xC, 0x25FA16),
            (buffs, 0x79E1CC),
            (buffs + 4, body),
            (buffs + 8, array),
            (buffs + 0x10, 1),
            (array, record),
            (snapshot, body),
            (record, current["remainingMs"]),
            (record + 4, current["remainingMs"]),
            (record + 8, current["counter"]),
            (record + 0xC, buff_data),
            (record + 0x10, buffs),
            (record + 0x14, current["level"]),
            (buff_data + 8, row_pointer),
            (buff_data + 0x50, 1000),
            (buff_data + 0x58, -60),
        ]:
            write(ptr, value)
        cpu.mem_write(data + 0x169, b"\1")
        initial = bytes(cpu.mem_read(heap, 0x10000))
        require(
            bool(run(0x217460, body)) == (current["progress"] == 800),
            "Initial native hidden state differs",
        )
        require(
            bytes(cpu.mem_read(heap, 0x10000)) == initial,
            "Initial hidden query modified heap",
        )
        frames, remaining, counter, hp, count, progress = (
            [],
            current["remainingMs"],
            current["counter"],
            current["hp"],
            1,
            current["progress"],
        )
        for step in range(1, steps + 1):
            current["beforeRemaining"], current["beforeProgress"] = remaining, progress
            events.clear()
            calls.clear()
            reads.clear()
            expected = bytearray(cpu.mem_read(heap, 0x10000))
            pulse, removed = False, False
            if count:
                remaining = remaining if remaining == -1 else max(0, remaining - 50)
                counter += 1
                pulse = counter >= 20
                if pulse:
                    counter = 0
                if pulse and current["flags"] & 4 and current["healthPresent"]:
                    hp -= current["damage"]
                require(
                    hp > 0, "Lifecycle fatal cases require a separate death contract"
                )
                removed = remaining == 0
                if removed:
                    count = 0
                for off, value in [
                    (record - heap, remaining),
                    (record - heap + 8, counter),
                    (health - heap + 8, hp),
                    (buffs - heap + 0x10, count),
                ]:
                    struct.pack_into("<i", expected, off, value)
            phase = "components"
            run(0x21AA0C, instruction_budget=6000)
            require(
                bytes(cpu.mem_read(heap, 0x10000)) == expected,
                "Lifecycle component heap differs",
            )
            expected_events = []
            if pulse:
                expected_events = [
                    ["rate", "damage", current["damage"]],
                    ["rate", "heal", 0],
                ]
                if current["flags"] & 4 and current["healthPresent"]:
                    expected_events.append(["hp", hp])
            if removed:
                expected_events += [
                    ["remove"],
                    ["providedDestructor"],
                    ["providedFree"],
                ]
            require(
                events == expected_events,
                f"Lifecycle component events differ: {events}",
            )
            previous = progress
            desired = current["state"] not in [2, 5]
            clamp = desired and progress + 50 >= 800 and progress <= 800
            opaque = not clamp and (desired or previous != 0)
            progress = min(progress + 50, 800) if desired else max(0, progress - 50)
            struct.pack_into("<i", expected, body - heap + 0x6C, progress)
            phase = "hide"
            run(0x216B6C, body)
            require(
                bytes(cpu.mem_read(heap, 0x10000)) == expected,
                "Lifecycle hide clock changed unrelated heap",
            )
            phase = "query"
            hidden = bool(run(0x217460, body))
            require(hidden == (progress == 800), "Lifecycle hidden predicate differs")
            phase = "ordinary"
            if hidden:
                result = run(0x25FF6E, health, 75, 0, 0, 0, 0)
                require(
                    result == 0 and bytes(cpu.mem_read(heap, 0x10000)) == expected,
                    "Ordinary hit passed the hidden gate",
                )
            expected_reads = Counter(
                {
                    ("target", 0x169, 1): 2 + int(hidden),
                    ("target", 0x180, 4): 3 + int(opaque) + int(hidden),
                    ("target", 0x184, 4): 1,
                }
            )
            if opaque:
                expected_reads[("target", 0x190, 4)] = 1
            if count:
                expected_reads.update({("buff", 0x6A, 1): 1, ("buff", 0x48, 4): 1})
            active_before = bool(count or removed)
            if active_before:
                expected_reads[("buff", 0x50, 4)] = 1
            if pulse:
                expected_reads.update(
                    {
                        ("buff", 0x50, 4): 2,
                        ("buff", 8, 4): 2,
                        ("buff", 0x7C, 4): 2,
                        ("target", 0x28A, 1): 1,
                    }
                )
                if current["flags"] & 4 and current["healthPresent"]:
                    expected_reads.update(
                        {("settings", 0x331, 1): 1, ("world", 0xFC, 1): 1}
                    )
            require(
                reads == expected_reads,
                f"Lifecycle Data read inventory differs: {dict(reads)} versus {dict(expected_reads)}",
            )
            # The exact getter inventory also binds direct/virtual dispatch and
            # the supplied phase/health/removal boundaries to this model frame.
            expected_calls = Counter(
                {
                    "indexedComponent": 4,
                    "buffManager": 1,
                    "hideClock": 1,
                    "hideDesired": 1,
                    "hideIdleFlag": 2 + int(hidden),
                    "hideTime": 3 + int(opaque) + int(hidden),
                    "upTime": 1,
                    "hideSpeed": 1,
                    "hidden": 1 + int(hidden),
                    "Data": 6 + 2 * int(opaque) + 2 * int(hidden),
                }
            )
            if current["flags"] & 4 and current["healthPresent"]:
                expected_calls["providedHealthUpdate"] = 1
            if opaque:
                expected_calls["opaqueHideGate"] = 1
            if count:
                expected_calls.update({"panicFlag": 1, "speedModifier": 1})
            if not desired:
                expected_calls["maximum"] += 1
            if active_before:
                expected_calls.update({"buffUpdate": 1, "expiry": 1})
                if current["beforeRemaining"] != -1:
                    expected_calls["maximum"] += 1
            if pulse:
                expected_calls.update(
                    {
                        "baseDamage": 1,
                        "baseHeal": 1,
                        "providedRateTable": 2,
                        "providedBuffOwner": 3,
                        "class64": 1,
                        "summonerFlag": 1,
                        "ordinaryClass60": 1,
                        "healthComponent": 1,
                        "Data": 1,
                    }
                )
                if current["flags"] & 4 and current["healthPresent"]:
                    expected_calls.update(
                        {
                            "providedBuffOwner": 1,
                            "healthComponent": 1,
                            "providedRequestWord": 1,
                            "providedSettings": 1,
                            "damageProxy": 1,
                            "damageReducer": 1,
                            "healthOwner": 1,
                            "providedWorld": 1,
                        }
                    )
            if hidden:
                expected_calls.update({"providedHiddenOwner": 1})
            if removed:
                expected_calls.update(
                    {
                        "providedRemovalNotification": 1,
                        "providedDestructor": 1,
                        "providedFree": 1,
                    }
                )
            require(
                calls == expected_calls,
                f"Lifecycle getter inventory differs: {dict(calls)} versus {dict(expected_calls)}",
            )
            frames.append(
                {
                    "step": step,
                    "remainingMs": remaining,
                    "counter": counter,
                    "buffCount": count,
                    "progress": progress,
                    "hiddenBefore": previous == 800,
                    "hidden": hidden,
                    "hp": hp,
                    "pulse": pulse,
                    "ordinaryHitBlocked": hidden,
                    "events": list(events),
                    "getters": dict(calls),
                    "dataReads": {
                        f"{n}/{hex(o)}/{s}": c for (n, o, s), c in sorted(reads.items())
                    },
                    "exactHeapChangesOnly": True,
                }
            )
        return {"fields": fields, "frames": frames}

    cases = [
        sample(
            {"level": level, "damage": damage, "counter": counter, "progress": progress}
        )
        for level in [0, 8]
        for damage in [57, 121]
        for counter in [0, 15, 19]
        for progress in [600, 750, 800]
    ]
    controls = [
        sample({"remainingMs": duration, "counter": counter})
        for duration in [-1, 0, 1, 49, 50, 51, 250, 999]
        for counter in [0, 19]
    ]
    controls += [
        sample({"state": state, "progress": progress})
        for state in [2, 5]
        for progress in [50, 600, 750]
    ]
    controls += [
        sample({"flags": flags}) for flags in [8, 9, 10, 11, 12, 13, 14, 15, 255]
    ]
    controls += [sample({"healthPresent": False})]
    definitions = [
        (
            "componentPhases",
            0x21AA0C,
            0x21AA54,
            "Actual four indexed component phases on one supplied active snapshot; body loop excluded.",
        ),
        (
            "buffManagerUpdate",
            0x25B18E,
            0x25B216,
            "Actual reverse iteration, buff update, expiry and vector removal; skip later area-buff scheduling and execute the real epilogue.",
        ),
        (
            "buffManagerReturn",
            0x25B3E1,
            0x25B3E9,
            "Actual return through the manager component call frame.",
        ),
        (
            "vectorRemoval",
            0x25B3EA,
            0x25B42A,
            "Actual ordered vector removal; notification/destructor/free are supplied no-ops.",
        ),
        (
            "hideClock",
            0x216B6C,
            0x216CCC,
            "Actual source hide/up timing, desired-state gate and buff-modified delta; selected controls avoid visual callback branches.",
        ),
        (
            "hideDesired",
            0x2185C0,
            0x21863E,
            "Actual raw-state/source hide-mode predicate; numeric states retain opaque labels.",
        ),
        (
            "buffDamageRequest",
            0x219081,
            0x2190E3,
            "Actual component gate and request to the lower damage proxy, bypassing ordinary hit eligibility.",
        ),
        (
            "ordinaryHitGate",
            0x25FF6E,
            0x25FFF4,
            "Actual hidden gate blocks each diagnostic ordinary hit on the same supplied hidden actor.",
        ),
        (
            "hideColumnStores",
            0x1D8BFC,
            0x1D8DA7,
            "Retained named hide-mode/duration loader and Data stores; CSV loading is excluded.",
        ),
        (
            "speedColumnBinding",
            0x1D7692,
            0x1D76BD,
            "Retained named SpeedMultiplier binding to GOT+0x1720; loader excluded.",
        ),
        (
            "speedColumnStore",
            0x1D6F0B,
            0x1D6F20,
            "Retained source speed column word to Data+0x48 store; loader excluded.",
        ),
        (
            "panicColumnBinding",
            0x1D7980,
            0x1D79AB,
            "Retained named Panic binding to GOT+0x173c; loader excluded.",
        ),
        (
            "panicColumnStore",
            0x1D7292,
            0x1D72A7,
            "Retained source Panic column word to Data+0x6a store; loader excluded.",
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
        lines = [
            line.strip()
            for line in asm.splitlines()
            if re.match(r"\s*[0-9a-f]+:", line)
        ]
        require(bool(lines), "Empty lifecycle instruction block")
        blocks.append(
            {
                "name": name,
                "start": hex(start),
                "end": hex(end),
                "interpretation": meaning,
                "instructions": lines,
            }
        )
    result = {
        "source": "apk/1.8.1/x86/libg.so",
        "sha256": env["sha"],
        "emulator": "unicorn==2.1.4",
        "inputs": inputs,
        "sourceColumns": columns,
        "limits": [
            "A supplied single active actor snapshot enters the actual four component phase dispatcher. Source-selected ordinary actor and buff component vtables, indexed header mask lookup, retained buff records and row rates are supplied. Native snapshot admission/allocation, object construction/application, owner outer state and full actor body update are excluded.",
            "The actual buff manager reverse loop, timer/counter update, component/class amount choice, damage request, null-reference expiry and ordered vector removal execute. Later natural area-buff scheduling is skipped through the real manager epilogue. Removal notification, record destructor/free and the health component's own update are checked no-op boundaries.",
            "An actual Tesla hide-clock invocation follows each component phase, as selected by the native actor body's hide-mode branch. Source HidesWhenNotAttacking, HideTimeMs and UpTimeMs are supplied; initial mid-transition/hidden progress, raw states 0/2/5 and opaque Data+0x190=0 are controlled. These cases avoid view/appearance callback branches and do not establish natural state transitions or full body scheduling.",
            "Existing source Poison rate 57 and supplied normalized control 121 execute actual base getters with checked table result arguments. Its source 1000-ms frequency, absent speed modifier and false raw Panic byte are supplied. Native level/rarity/table scaling and dynamic relocation are excluded. Every source-like episode uses the archived Tesla base HP 450, not browser normalization.",
            "Actual lower damage proxy/reducer and HP store execute with null account, zero vector/override, source shields absent, normal settings/world bytes and a provided opaque request word. Owner/world/settings/rate providers are checked. Post-store damage reactions are skipped through the real native return; fatal paths are excluded. Earlier health/shield evidence supplies the separate reducer/death-clamp contract.",
            "Each fully hidden snapshot also runs the actual ordinary hit wrapper with a diagnostic 75-damage request; its hidden gate leaves all supplied heap bytes unchanged. Retained Poison can reduce HP while those ordinary hits are blocked, then the buff manager removes the record at timer expiry. New Poison application to hidden targets, area eligibility, owner removal and a complete natural battle remain excluded.",
            "Every frame checks exact ordered rate/HP/removal/disposal events, getter/provider arguments/counts, exact Data/settings/world reads and complete 64-KiB heap changes through component and hide phases. Application rules remain 46 in this evidence checkpoint.",
        ],
        "profiles": {
            "target": "Tesla",
            "buff": "Poison",
            "sourceDamage": 57,
            "normalizedDamageControl": 121,
            "sourceHp": 450,
            "frequencyMs": 1000,
            "hideTimeMs": 800,
            "upTimeMs": 800,
        },
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    path = Path("reference/client/buff-lifecycle-native-trace.json")
    output = json.dumps(result, indent=2) + "\n"
    if env["args"].check:
        require(path.read_text() == output, "Buff lifecycle capture differs")
    else:
        path.write_text(output)
    episodes = cases + controls
    print(
        json.dumps(
            {
                "cases": len(cases),
                "controls": len(controls),
                "steps": sum(len(r["frames"]) for r in episodes),
                "pulses": sum(f["pulse"] for r in episodes for f in r["frames"]),
                "hiddenPoisonHits": sum(
                    f["hiddenBefore"] and any(e[0] == "hp" for e in f["events"])
                    for r in episodes
                    for f in r["frames"]
                ),
                "ordinaryBlocks": sum(
                    f["ordinaryHitBlocked"] for r in episodes for f in r["frames"]
                ),
                "blocks": len(blocks),
            }
        )
    )
