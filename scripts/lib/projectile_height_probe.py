"""Execute a later projectile initializer's ConstantHeight override branch.

Earlier allocation, registration and initializer work are supplied. The native
field gate, point getters and actual XYZ/history setter execute in isolation.
"""

import csv
import hashlib
import io
import itertools
import json
from pathlib import Path
import re
import subprocess
import struct
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
        "reference/client/projectile-launch-native-trace.json",
        "reference/logic/projectiles.csv",
    ]
    inputs = [
        {"path": path, "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest()}
        for path in paths
    ]
    prior = json.loads(Path(paths[0]).read_text())
    if prior["sha256"] != env["sha"]:
        raise RuntimeError("Projectile height reference uses another binary")
    for entry in prior["inputs"]:
        if (
            hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
            != entry["sha256"]
        ):
            raise RuntimeError("Projectile height reference input differs")
    if bytes(cpu.mem_read(0x619453, 15)) != b"ConstantHeight\0":
        raise RuntimeError("Projectile ConstantHeight column string differs")
    env["allowed"].extend(
        [(0x21D577, 0x21D5CC), (0x219AAE, 0x219AE2), (0x219AF6, 0x219B16)]
    )
    counts, data_reads = {}, []
    names = {
        0x21960E: "projectileData",
        0x219AF6: "projectileX",
        0x219B06: "projectileY",
        0x219AAE: "positionSetter",
    }

    def hook(_cpu, pc, _size, _data):
        if pc == 0x21D577:
            sp = cpu.reg_read(UC_X86_REG_ESP)
            cpu.reg_write(UC_X86_REG_EBP, sp + 0x600)
            write(sp + 0x600 + 0x34, -23)
            cpu.reg_write(UC_X86_REG_ESI, body)
        elif pc == 0x21D5CB:
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        else:
            name = names[pc]
            counts[name] = counts.get(name, 0) + 1

    def memory(_cpu, _access, address, size, _value, _data):
        data_reads.append((address - data, size))

    for pc in [0x21D577, 0x21D5CB, *names]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)
    cpu.hook_add(UC_HOOK_MEM_READ, memory, begin=data, end=data + 0x7FF)
    rows = [
        row
        for row in csv.DictReader(io.StringIO(Path(paths[1]).read_text()))
        if row["Name"] not in ["", "string"]
    ]
    profiles = [
        {"sourceName": row["Name"], "constantHeight": int(row["ConstantHeight"] or 0)}
        for row in rows
    ]
    source = env["rows"]["reference/logic/characters.csv"]["Knight"]
    cases, controls = [], []

    def sample(profile, origin, z, override=None):
        nonlocal counts, data_reads
        initialize({**source, "LoadTime": source["LoadTime"] or "0"})
        height = profile["constantHeight"] if override is None else override
        point = {"x": 9000 + origin, "y": 16000 + origin, "z": z}
        for offset, value in [
            (0x20, point["x"]),
            (0x24, point["y"]),
            (0x30, z),
            (0x28, -713),
            (0x2C, -719),
            (0x34, -727),
            (0x64, 1800),
            (0x68, point["x"]),
            (0x6C, point["y"]),
            (0x70, z),
        ]:
            write(body + offset, value)
        write(data + 0x94, height)
        before = bytes(cpu.mem_read(heap, 0x10000))
        counts, data_reads = {}, []
        run(0x21D577, instruction_budget=2000)
        expected = bytearray(before)
        if height:

            for offset in [0x30, 0x64, 0x70]:
                expected[offset : offset + 4] = struct.pack("<i", height)
        if bytes(cpu.mem_read(heap, 0x10000)) != bytes(expected):
            raise RuntimeError("ConstantHeight native heap mutation differs")
        expected_counts = (
            {
                "projectileData": 2,
                "projectileX": 1,
                "projectileY": 1,
                "positionSetter": 1,
            }
            if height
            else {"projectileData": 1}
        )
        if counts != expected_counts or data_reads != [(0x94, 4)] * (
            2 if height else 1
        ):
            raise RuntimeError("ConstantHeight gate/getter/field reads differ")
        stored = {
            "x": read(body + 0x20),
            "y": read(body + 0x24),
            "z": read(body + 0x30),
            "targetHeight": read(body + 0x64),
            "launchHeight": read(body + 0x70),
        }
        return {
            "kind": "source" if override is None else "heightOverride",
            "sourceName": profile["sourceName"],
            "constantHeight": height,
            "point": point,
            "initialTargetHeight": 1800,
            "stored": stored,
            "getterCalls": dict(counts),
            "dataReads": data_reads,
            "historyUnchanged": True,
            "unrelatedHeapUnchanged": True,
        }

    for profile, origin, z in itertools.product(profiles, [0, 1333, -9125], [0, 1723]):
        cases.append(sample(profile, origin, z))
    selected = [
        next(p for p in profiles if p["sourceName"] == name)
        for name in ["ArcherArrow", "BowlerProjectile", "AxeManProjectile"]
    ]
    for profile, height, origin, z in itertools.product(
        selected, [-500, 0, 1, 4200], [0, -9125], [17, 9000]
    ):
        controls.append(sample(profile, origin, z, height))
    if [p for p in profiles if p["constantHeight"]] != [
        {"sourceName": "AxeManProjectile", "constantHeight": 3000}
    ]:
        raise RuntimeError("Recheck source constant-height profile")
    asm = subprocess.check_output(
        ["objdump", "-d", "-Mintel", str(env["args"].library)], text=True
    )
    definitions = [
        (
            "constantHeightBranch",
            0x21D577,
            0x21D5CB,
            "Actual initializer tests Data+0x94; nonzero replaces target/launch height and calls actual XYZ setter.",
        ),
        (
            "positionSetter",
            0x219AAE,
            0x219AE2,
            "Actual XYZ/history setter preserves ordinary prior history and stores current XYZ.",
        ),
        ("pointGetters", 0x219AF6, 0x219B16, "Actual projectile X/Y getters."),
        (
            "constantHeightColumnStore",
            0x1FA8CC,
            0x1FA8F7,
            "Named ConstantHeight column lookup and Data+0x94 store are retained source binding.",
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
            raise RuntimeError("ConstantHeight instruction block is empty")
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
        "sourceColumn": {
            "name": "ConstantHeight",
            "string": "0x619453",
            "dataOffset": "0x94",
        },
        "limits": [
            "Actual bounded late-initializer ConstantHeight branch, Data/X/Y getters and XYZ/history setter execute. Earlier allocation, registration, Data/position initialization and caller frame are supplied.",
            "Every archived projectile data row is checked with supplied initialized XY, target height, launch height and two incoming Z values at three translated origins. Data rows are not claims of naturally constructed projectiles. Only source AxeManProjectile supplies a nonzero ConstantHeight of 3000.",
            "Zero leaves current/target/launch heights untouched; any nonzero signed override replaces all three with the configured absolute height. Synthetic negative/positive/zero controls verify the raw gate. Ordinary initialized XY and prior XYZ history remain unchanged.",
            "Complete supplied heap mutation, getter counts and exact Data reads are independently checked. Column lookup/store instructions are retained bindings, not executed CSV loading. Earlier/later initializer work, natural actor Z, projectile registration, trajectory/collision/hits and visual coordinate conversion remain excluded. Application rules remain unchanged.",
        ],
        "profiles": profiles,
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    output = json.dumps(result, indent=2) + "\n"
    path = Path("reference/client/projectile-height-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native ConstantHeight capture differs")
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
