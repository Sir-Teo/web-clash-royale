"""Execute the native projectile shoot wrapper through its launch request.

Source actor Data and position, selected projectile body, target/reference/level
arguments are supplied. Actual muzzle getters, integer square root and signed
normalization execute. The full projectile initializer and later hits do not.
"""

import hashlib
import itertools
import json
import math
from pathlib import Path
import random
import re
import subprocess
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_READ
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EIP


def capture(env, context):
    cpu, heap, body, data = [env[k] for k in ["cpu", "heap", "body", "data"]]
    read, write, run, initialize = [
        env[k] for k in ["read", "write", "run", "initialize"]
    ]
    paths = [
        "reference/client/target-loss-request-native-trace.json",
        "reference/logic/characters.csv",
        "reference/logic/buildings.csv",
    ]
    inputs = [
        {"path": path, "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest()}
        for path in paths
    ]
    prior = json.loads(Path(paths[0]).read_text())
    if prior["sha256"] != env["sha"]:
        raise RuntimeError("Projectile launch reference uses another binary")
    for entry in prior["inputs"]:
        if (
            hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
            != entry["sha256"]
        ):
            raise RuntimeError("Projectile launch reference input differs")
    columns = [
        {
            "name": "ProjectileStartRadius",
            "string": 0x6142D5,
            "dataOffset": 0x128,
            "gotOffset": 0x18BC,
        },
        {
            "name": "ProjectileStartZ",
            "string": 0x6142EB,
            "dataOffset": 0x12C,
            "gotOffset": 0x18C0,
        },
        {"name": "ProjectileYOffset", "string": 0x6137DD, "dataOffset": 0x2A0},
    ]
    for column in columns:
        encoded = column["name"].encode() + b"\0"
        if bytes(cpu.mem_read(column["string"], len(encoded))) != encoded:
            raise RuntimeError("Projectile launch column string differs")
    env["allowed"].extend(
        [
            (0x21CE96, 0x21CFD2),
            (0x21CFF6, 0x21CFF7),
            (0x1DEAF6, 0x1DEB1D),
            (0x1DF07E, 0x1DF091),
            (0x219AF6, 0x219B26),
            (0x35C120, 0x35C4DB),
        ]
    )
    packet, counts, data_reads = None, {}, set()
    getter_names = {
        0x2147C8: "actorData",
        0x21960E: "bodyData",
        0x219AF6: "actorX",
        0x219B06: "actorY",
        0x219B16: "actorZ",
        0x1DEAF6: "radius",
        0x1DF07E: "yOffset",
        0x1DEB0A: "zOffset",
        0x35C120: "integerSqrt",
    }

    def hook(_cpu, pc, _size, _data):
        nonlocal packet
        if pc == 0x21CFF6:
            sp = cpu.reg_read(UC_X86_REG_ESP)
            packet = [read(sp + 4 + i * 4) for i in range(12)]
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        else:
            name = getter_names[pc]
            counts[name] = counts.get(name, 0) + 1

    def memory(_cpu, _access, address, size, _value, _data):
        data_reads.add((address - data, size))

    for pc in [*getter_names, 0x21CFF6]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)
    cpu.hook_add(UC_HOOK_MEM_READ, memory, begin=data, end=data + 0x7FF)
    profiles, cases, controls = [], [], []

    def sample(
        profile, owner, origin, delta, target_present, overrides=None, kind="source"
    ):
        nonlocal packet, counts, data_reads
        table, name = profile["sourceTable"], profile["sourceName"]
        source = env["rows"][f"reference/logic/{table}.csv"][name]
        initialize({**source, "LoadTime": source["LoadTime"] or "0"})
        values = {
            column["name"]: int(source[column["name"]] or 0) for column in columns
        }
        values.update(overrides or {})
        actor = {
            "x": 9000 + origin,
            "y": 16000 + origin,
            "z": int(source.get("FlyingHeight") or 0),
        }
        goal = {"x": actor["x"] + delta[0], "y": actor["y"] + delta[1]}
        for offset, value in [
            (0x1C, owner),
            (0x20, actor["x"]),
            (0x24, actor["y"]),
            (0x30, actor["z"]),
        ]:
            write(body + offset, value)
        # Distinguish the actual Z getter (+0x30) from unrelated raw +0x28.
        write(body + 0x28, -713)
        for column in columns:
            write(data + column["dataOffset"], values[column["name"]])
        target = context["target_a"] if target_present else 0
        selected_body, auxiliary = heap + 0xF000, heap + 0xD000
        arguments = [
            selected_body,
            body,
            target,
            goal["x"],
            goal["y"],
            body,
            auxiliary,
            7,
            -23,
        ]
        before = bytes(cpu.mem_read(heap, 0x10000))
        packet, counts, data_reads = None, {}, set()
        run(0x21CE96, *arguments, instruction_budget=10000)
        dx, dy = delta
        distance = math.isqrt(dx * dx + dy * dy)
        radius = values["ProjectileStartRadius"]

        # Native idiv truncates toward zero. Keep the arithmetic oracle integer.
        def divide(numerator, denominator):
            return (-1 if numerator < 0 else 1) * (abs(numerator) // denominator)

        sx = divide(dx * radius, distance) if distance else dx
        sy = divide(dy * radius, distance) if distance else dy
        y_offset = values["ProjectileYOffset"] * (1 if owner == 0 else -1)
        start = {
            "x": actor["x"] + sx,
            "y": actor["y"] + sy + y_offset,
            "z": actor["z"] + values["ProjectileStartZ"],
        }
        expected = [
            selected_body,
            body,
            start["x"],
            start["y"],
            start["z"],
            target,
            goal["x"],
            goal["y"],
            body,
            auxiliary,
            7,
            -23,
        ]
        if packet != expected:
            raise RuntimeError(
                f"Native projectile launch differs: {name} {delta} {packet} != {expected}"
            )
        expected_counts = {
            name: (2 if name in ["actorX", "actorY"] else 1)
            for name in getter_names.values()
        }
        if counts != expected_counts:
            raise RuntimeError(f"Projectile launch getter calls differ: {counts}")
        if data_reads != {(column["dataOffset"], 4) for column in columns}:
            raise RuntimeError(f"Projectile launch Data read differs: {data_reads}")
        if bytes(cpu.mem_read(heap, 0x10000)) != before:
            raise RuntimeError("Projectile launch prefix mutated supplied heap")
        return {
            "kind": kind,
            "sourceTable": table,
            "sourceName": name,
            "owner": owner,
            "actorPoint": actor,
            "goal": goal,
            "targetPresent": target_present,
            "fields": values,
            "integerDistance": distance,
            "arguments": arguments,
            "request": packet,
            "start": start,
            "getterCalls": dict(counts),
            "heapUnchanged": True,
        }

    vectors = [
        (0, 0),
        (0, 3000),
        (0, -3000),
        (4000, 0),
        (-4000, 0),
        (3000, 4000),
        (-3000, -4000),
        (667, -333),
        (-1, 1),
        (17000, 30000),
    ]
    for table in ["characters", "buildings"]:
        for name, source in env["rows"][f"reference/logic/{table}.csv"].items():
            if name in ["", "string"] or not source["Projectile"]:
                continue
            profile = {
                "sourceTable": table,
                "sourceName": name,
                "projectile": source["Projectile"],
                **{
                    column["name"]: int(source[column["name"]] or 0)
                    for column in columns
                },
            }
            profiles.append(profile)
            for owner, origin, delta in itertools.product(
                [0, 1], [0, 1333, -9125], vectors
            ):
                cases.append(sample(profile, owner, origin, delta, delta[0] % 2 == 0))
    for profile in [
        profiles[0],
        next(p for p in profiles if p["sourceName"] == "KingTower"),
    ]:
        for radius, y, z, owner in itertools.product(
            [0, -400, 1555], [-700, 0, 800], [-200, 0, 3000], [0, 1]
        ):
            controls.append(
                sample(
                    profile,
                    owner,
                    0,
                    (667, -333),
                    False,
                    {
                        "ProjectileStartRadius": radius,
                        "ProjectileYOffset": y,
                        "ProjectileStartZ": z,
                    },
                    "fieldOverride",
                )
            )
    rng = random.Random(3401)
    for _ in range(96):
        delta = (rng.randint(-18000, 18000), rng.randint(-32000, 32000))
        controls.append(
            sample(profiles[0], 0, 0, delta, True, kind="integerNormalization")
        )
    assembly = subprocess.check_output(
        ["objdump", "-d", "-Mintel", str(env["args"].library)], text=True
    )
    definitions = [
        (
            "launchWrapperPrefix",
            0x21CE96,
            0x21CFD2,
            "Actual shoot wrapper computes launch XY/Z and prepares twelve initializer arguments; stop at initializer entry.",
        ),
        ("radiusGetter", 0x1DEAF6, 0x1DEB0A, "Actual Data+0x128 radius getter."),
        ("zGetter", 0x1DEB0A, 0x1DEB1E, "Actual Data+0x12c Z offset getter."),
        ("yGetter", 0x1DF07E, 0x1DF092, "Actual Data+0x2a0 Y offset getter."),
        (
            "bodyPointGetters",
            0x219AF6,
            0x219B26,
            "Actual X/Y/Z getters read body+0x20/+0x24/+0x30.",
        ),
        (
            "integerSqrt",
            0x35C120,
            0x35C4DB,
            "Actual integer square root uses pinned lookup table and native arithmetic.",
        ),
        (
            "radiusColumn",
            0x1DD079,
            0x1DD0D7,
            "ProjectileStartRadius string initializes GOT+0x18bc.",
        ),
        (
            "zColumn",
            0x1DD0D7,
            0x1DD135,
            "ProjectileStartZ string initializes GOT+0x18c0.",
        ),
        (
            "radiusZStores",
            0x1D91A7,
            0x1D91D7,
            "Actual loader reads indexed columns and stores radius/Z fields.",
        ),
        (
            "yColumnStore",
            0x1D904D,
            0x1D9078,
            "ProjectileYOffset named lookup stores Data+0x2a0.",
        ),
    ]
    blocks = []
    for name, start, end, interpretation in definitions:
        instructions = [
            line.strip()
            for line in assembly.splitlines()
            if (match := re.match(r"\s*([0-9a-f]+):", line))
            and start <= int(match[1], 16) < end
        ]
        if not instructions:
            raise RuntimeError("Projectile launch instruction block is empty")
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
        "limits": [
            "Actual bounded shoot wrapper, actor/Data/coordinate getters, integer square root and signed normalization execute to the full projectile initializer boundary. Selected projectile body, actor Data, positions, owner, target, goal, auxiliary, level and scalar arguments are supplied.",
            "Both raw owner indices, three translated origins and source muzzle fields cover every archived primary-projectile actor row. Actor Z is supplied from FlyingHeight or zero; natural owner/height/deployment progression is not executed. Tiny/long vectors characterize arithmetic without asserting natural target reachability.",
            "All twelve request arguments, getter counts, exact Data read set and unchanged supplied heap are checked against an independent integer oracle. Field overrides and deterministic random vectors are synthetic controls. Column initialization/load blocks are retained bindings, not executed CSV loading.",
            "Execution stops before 0x21cff6. Projectile allocation/initializer, target registration, subsequent special linkage, trajectories, collision, hits, visuals and full attack/world execution remain excluded. Application rules remain unchanged.",
        ],
        "profiles": profiles,
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    output = json.dumps(result, indent=2) + "\n"
    path = Path("reference/client/projectile-launch-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native projectile launch capture differs")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "profiles": len(profiles),
                "cases": len(cases),
                "controls": len(controls),
                "requests": len(cases) + len(controls),
                "blocks": len(blocks),
            }
        )
    )
