"""Native projectile destination refresh with supplied target references.

Actual Homing, XYZ and source-vtable zero-result getters run. Construction,
target reference lifecycle, motion, hit/removal and world scheduling are excluded.
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


def capture(env, context):
    cpu, heap, body, data = [env[k] for k in ["cpu", "heap", "body", "data"]]
    read, write, run, ret = [env[k] for k in ["read", "write", "run", "return_hook"]]
    paths = [
        "reference/client/projectile-motion-native-trace.json",
        "reference/client/world-step-native-trace.json",
        "reference/client/projectile-range-native-trace.json",
        "reference/logic/projectiles.csv",
    ]
    inputs = [
        {"path": p, "sha256": hashlib.sha256(Path(p).read_bytes()).hexdigest()}
        for p in paths
    ]
    for path in paths[:-1]:
        prior = json.loads(Path(path).read_text())
        if prior["sha256"] != env["sha"]:
            raise RuntimeError("Projectile target binary differs")
        for entry in prior["inputs"]:
            if (
                hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
                != entry["sha256"]
            ):
                raise RuntimeError("Projectile target provenance differs")
    range_source = json.loads(Path(paths[2]).read_text())
    homing = next(c for c in range_source["sourceColumns"] if c["name"] == "Homing")
    if (
        homing["dataOffset"] != 0x78
        or bytes(cpu.mem_read(homing["string"], 7)) != b"Homing\0"
    ):
        raise RuntimeError("Projectile Homing column binding differs")
    vtable, virtual = 0x7B364C, 0x21453C
    if read(vtable + 0x38) != virtual:
        raise RuntimeError("Projectile refresh vtable binding differs")
    env["allowed"].extend(
        [
            (0x21E9FE, 0x21EA7A),
            (0x1FB83A, 0x1FB84B),
            (0x21453C, 0x214548),
        ]
    )
    target = heap + 0x8000
    calls, data_reads, current = Counter(), [], None
    names = {
        0x21960E: "projectileData",
        0x1FB83A: "homing",
        0x219AF6: "targetX",
        0x219B06: "targetY",
        0x219B16: "targetZ",
        virtual: "projectileVirtual38",
    }

    def hook(_cpu, pc, _size, _data):
        name = names[pc]
        sp = cpu.reg_read(UC_X86_REG_ESP)
        expected = (
            data if name == "homing" else target if name.startswith("target") else body
        )
        if read(sp + 4) != expected:
            raise RuntimeError(f"Unexpected projectile refresh argument: {name}")
        calls[name] += 1
        if pc == virtual and current["virtualResult"] is not None:
            ret(current["virtualResult"])

    def memory(_cpu, _access, address, size, _value, _data):
        data_reads.append([address - data, size])

    for pc in names:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)
    cpu.hook_add(UC_HOOK_MEM_READ, memory, begin=data, end=data + 0x7FF)
    rows = [
        r
        for r in csv.DictReader(io.StringIO(Path(paths[-1]).read_text()))
        if r["Name"] not in ["", "string"]
    ]
    profiles = [
        {"sourceName": r["Name"], "homing": r["Homing"].lower() == "true"} for r in rows
    ]

    def signed(value):
        return (value + 0x80000000) % 0x100000000 - 0x80000000

    def sample(profile, origin, scenario, override=None):
        nonlocal current
        current = {
            "homingByte": int(profile["homing"]),
            "virtualResult": None,
            **(override or {}),
        }
        cpu.mem_write(heap, bytes((i * 13 + 47) % 256 for i in range(0x10000)))
        for pointer, value in [(body, vtable), (body + 0x10, data)]:
            write(pointer, value)
        cpu.mem_write(data + 0x78, bytes([current["homingByte"]]))
        initial = [731 + origin, -487 - origin, 1723]
        for offset, value in zip([0x5C, 0x60, 0x64], initial):
            write(body + offset, value)
        expected_goal = list(initial)
        positions = [
            [15000 + origin, 16000 - origin, 0],
            [15013 + origin, 15983 - origin, 1800],
            [15031 + origin, 15969 - origin, -701],
            [15067 + origin, 15947 - origin, 3001],
            [15109 + origin, 15889 - origin, -1],
        ]
        if "targetZ" in current:
            for point in positions:
                point[2] = current["targetZ"]
        frames = []
        for index, point in enumerate(positions):
            present = scenario != "null" and (
                scenario != "lostAndRebound" or index not in [2, 3]
            )
            write(body + 0x58, target if present else 0)
            for offset, value in zip([0x20, 0x24, 0x30], point):
                write(target + offset, value)
            before = bytes(cpu.mem_read(heap, 0x10000))
            calls.clear()
            data_reads.clear()
            run(0x21E9FE, body)
            refresh = present and current["homingByte"] != 0
            if refresh:
                delta = current["virtualResult"] or 0
                half = abs(delta) // 2 * (-1 if delta < 0 else 1)
                expected_goal = [point[0], point[1], signed(point[2] + half)]
            expected_heap = bytearray(before)
            for offset, value in zip([0x5C, 0x60, 0x64], expected_goal):
                struct.pack_into("<i", expected_heap, body - heap + offset, value)
            expected_calls = {}
            if present:
                expected_calls.update({"projectileData": 1, "homing": 1})
            if refresh:
                expected_calls.update(
                    {"targetX": 1, "targetY": 1, "targetZ": 1, "projectileVirtual38": 1}
                )
            expected_reads = [[0x78, 1]] if present else []
            goal = [read(body + offset) for offset in [0x5C, 0x60, 0x64]]
            if (
                goal != expected_goal
                or dict(calls) != expected_calls
                or data_reads != expected_reads
            ):
                raise RuntimeError("Native projectile target refresh differs")
            if bytes(cpu.mem_read(heap, 0x10000)) != bytes(expected_heap):
                raise RuntimeError("Projectile refresh changed unrelated heap")
            frames.append(
                {
                    "index": index,
                    "providedTargetPresent": present,
                    "providedTargetPoint": point,
                    "goal": goal,
                    "refreshed": refresh,
                    "getters": dict(calls),
                    "dataReads": list(data_reads),
                    "unrelatedHeapUnchanged": True,
                }
            )
        return {
            "sourceName": profile["sourceName"],
            "sourceHoming": profile["homing"],
            "origin": origin,
            "scenario": scenario,
            "kind": "control" if override else "source",
            "homingByte": current["homingByte"],
            "providedVirtualResult": current["virtualResult"],
            **({"providedTargetZ": current["targetZ"]} if "targetZ" in current else {}),
            "initialGoal": initial,
            "frames": frames,
        }

    cases = [
        sample(p, o, s)
        for p in profiles
        for o in [0, 1333]
        for s in ["live", "null", "lostAndRebound"]
    ]
    controls = [
        sample(profiles[0], 0, scenario, {"homingByte": raw, "virtualResult": value})
        for scenario in ["live", "null", "lostAndRebound"]
        for raw, value in [
            (0, 731),
            (1, -3),
            (1, -1),
            (1, 3),
            (2, 2147483647),
            (255, -2147483648),
        ]
    ]
    controls += [
        sample(
            profiles[0],
            0,
            "live",
            {"homingByte": 1, "virtualResult": value, "targetZ": z},
        )
        for value in [-3, -1, 1, 3]
        for z in [-2147483648, 2147483647]
    ]
    definitions = [
        (
            "targetRefresh",
            0x21E9FE,
            0x21EA7A,
            "Actual null-target/Homing gates, target XYZ reads and destination stores.",
        ),
        (
            "projectileDataGetter",
            0x21960E,
            0x21961E,
            "Actual GameObject Data pointer getter.",
        ),
        (
            "homingGetter",
            0x1FB83A,
            0x1FB84B,
            "Actual byte read at Data+0x78, as bound by the pinned range capture.",
        ),
        (
            "homingColumnBinding",
            0x1FACDD,
            0x1FAD08,
            "Retained Homing column/GOT binding; native CSV loading is not executed.",
        ),
        (
            "homingColumnStore",
            0x1FA24B,
            0x1FA260,
            "Retained source byte store at Data+0x78; table allocation/loading is supplied.",
        ),
        ("targetCoordinates", 0x219AF6, 0x219B26, "Actual target X/Y/Z field getters."),
        (
            "sourceVirtual38",
            0x21453C,
            0x214548,
            "Actual source projectile vtable slot +0x38 returns zero; synthetic controls supply signed results at its boundary.",
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
        if not instructions:
            raise RuntimeError("Projectile target instruction block is empty")
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
        "vtableBinding": {
            "vtable": hex(vtable),
            "slot": "0x38",
            "function": hex(virtual),
            "sourceResult": 0,
        },
        "sourceColumn": homing,
        "limits": [
            "Actual bounded target refresh runs with supplied projectile/Data/target records. Target references and point changes, including null/lost/rebound sequences, are explicit input states rather than natural lifecycle execution.",
            "Source profiles supply the archived Homing flag. All source projectiles use the retained projectile vtable slot +0x38 returning zero, so a present homing target replaces destination XYZ with target XYZ. Null references or false Homing retain the prior destination.",
            "Synthetic raw Homing bytes and provided virtual results exercise branch truthiness, signed truncation toward zero and 32-bit addition. These controls do not describe naturally created source classes or physical height semantics.",
            "Every getter argument/count, Data read, stored destination and full 64-KiB heap mutation matches an independent scalar model. Construction/initialization, source table loading, owner/target removal notification, eligibility/death, movement, hit resolution, world cadence and visuals remain outside this refresh-only capture. Application rules remain 43.",
        ],
        "profiles": profiles,
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    output = json.dumps(result, indent=2) + "\n"
    path = Path("reference/client/projectile-target-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native projectile target capture differs")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "profiles": len(profiles),
                "cases": len(cases),
                "controls": len(controls),
                "refreshCalls": sum(len(r["frames"]) for r in cases + controls),
            }
        )
    )
