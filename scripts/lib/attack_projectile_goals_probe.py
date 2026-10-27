"""Native normal-attack projectile selection, circular offsets and requests.

Actor Data/cached point/caller locals, factory returns, RNG results and world
registration/effect boundaries are supplied. Actual loop/count/selection/math,
team store and request preparation execute; shoot and registration do not.
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
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_READ
from unicorn.x86_const import (
    UC_X86_REG_ESI,
    UC_X86_REG_EDI,
    UC_X86_REG_EBP,
    UC_X86_REG_ESP,
    UC_X86_REG_EIP,
)


def capture(env, context):
    cpu, heap, body, data, component, world = [
        env[k] for k in ["cpu", "heap", "body", "data", "component", "world"]
    ]
    read, write, run, initialize, ret = [
        env[k] for k in ["read", "write", "run", "initialize", "return_hook"]
    ]
    paths = [
        "reference/client/projectile-motion-native-trace.json",
        "reference/client/target-loss-request-native-trace.json",
        "reference/logic/characters.csv",
        "reference/logic/buildings.csv",
        "reference/logic/projectiles.csv",
    ]
    inputs = [
        {"path": path, "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest()}
        for path in paths
    ]
    for path in paths[:2]:
        prior = json.loads(Path(path).read_text())
        if prior["sha256"] != env["sha"]:
            raise RuntimeError("Projectile goal reference uses another binary")
        for entry in prior["inputs"]:
            if (
                hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
                != entry["sha256"]
            ):
                raise RuntimeError("Projectile goal reference input differs")
    projectiles = {
        r["Name"]: r
        for r in csv.DictReader(io.StringIO(Path(paths[4]).read_text()))
        if r["Name"] not in ["", "string"]
    }
    columns = [
        {"name": "MultipleProjectiles", "string": 0x6137BA, "dataOffset": 0x30},
        {"name": "CustomFirstProjectile", "string": 0x6137A4, "dataOffset": 0x2C},
        {"name": "TargetToEdge", "string": 0x619446, "dataOffset": 0x88},
    ]
    for column in columns:
        value = column["name"].encode() + b"\0"
        if bytes(cpu.mem_read(column["string"], len(value))) != value:
            raise RuntimeError("Projectile selection source column differs")
    primary, custom, auxiliary = heap + 0xE000, heap + 0xD000, heap + 0x7000
    env["allowed"].extend(
        [
            (0x25E86A, 0x25EEA7),
            (0x25F333, 0x25F334),
            (0x1DF0F4, 0x1DF114),
            (0x1DDF8E, 0x1DDFA2),
            (0x1DDC08, 0x1DDC26),
            (0x1DE404, 0x1DE440),
            (0x2198D8, 0x21991F),
            (0x21999C, 0x2199B0),
            (0x219874, 0x219884),
            (0x1FB71E, 0x1FB72E),
            (0x35D1C0, 0x35D21B),
            (0x35D8B0, 0x35D971),
            (0x35C790, 0x35C8B0),
            (0x35BF80, 0x35C11F),
            (0x35BEC0, 0x35BF0A),
        ]
    )
    boundaries = [0x21A4B0, 0x1E99F2, 0x21A41C, 0x21CE96, 0x21ACCE, 0x1C7444]
    env["allowed"].extend((pc, pc + 1) for pc in boundaries)
    current, packets, rng, counts, reads = None, [], [], {}, []
    getter_names = {
        0x1DF0F4: "count",
        0x1DF104: "customFirst",
        0x1DDC08: "primary",
        0x1DDF8E: "areaRadius",
        0x1FB71E: "customRadius",
        0x2198D8: "actorOwner",
        0x21999C: "projectileOwnerStore",
        0x1DE422: "auxiliary",
        0x1DE404: "presentationReference",
        0x219874: "actorWorld",
        0x2147C8: "actorData",
        0x25FA0C: "frameNoop",
    }

    def draw_value(bound, index):
        strategy = current["strategy"]
        if strategy == "minimum":
            return 0
        if strategy == "maximum":
            return bound - 1
        if strategy == "middle":
            return bound // 2
        return [0, bound // 3, bound // 2, bound - 1][index % 4]

    def hook(_cpu, pc, _size, _data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if pc == 0x25E86A:
            bp = sp + 0x600
            cpu.reg_write(UC_X86_REG_EBP, bp)
            write(bp + 8, component)
            write(bp + 12, current["target"])
            write(bp + 16, -1)
            for offset, value in {
                0x60: 100,
                0x74: 0,
                0x88: 1,
                0x90: 0,
                0xA0: primary,
                0xA8: data,
                0xAC: body,
            }.items():
                write(sp + offset, value)
            cpu.reg_write(UC_X86_REG_ESI, 0)
            cpu.reg_write(UC_X86_REG_EDI, component)
        elif pc == 0x21A4B0:
            selected, kind = read(sp + 4), read(sp + 8)
            if selected not in [primary, custom] or kind != 4:
                raise RuntimeError("Unexpected selected projectile factory")
            pointer = (
                heap + 0xF000 + sum(p["kind"] == "factory" for p in packets) * 0x100
            )
            write(pointer + 0x10, selected)
            write(pointer + 0x1C, -91)
            packets.append(
                {"kind": "factory", "arguments": [selected, kind], "result": pointer}
            )
            ret(pointer)
        elif pc == 0x1E99F2:
            raise RuntimeError("Unexpected default auxiliary reference")
        elif pc == 0x21A41C:
            if read(sp + 4) != body:
                raise RuntimeError("Unexpected auxiliary-scalar owner")
            ret(0)
        elif pc == 0x21CE96:
            arguments = [read(sp + 4 + i * 4) for i in range(9)]
            packets.append(
                {
                    "kind": "shoot",
                    "selectedData": read(arguments[0] + 0x10),
                    "arguments": arguments,
                }
            )
            ret()
        elif pc == 0x21ACCE:
            packets.append(
                {
                    "kind": "registrationRequest",
                    "arguments": [read(sp + 4 + i * 4) for i in range(3)],
                }
            )
            ret()
        elif pc == 0x1C7444:
            owner, bound = read(sp + 4), read(sp + 8)
            if (
                owner != world
                or bound != current["radius"] - (current["radius"] >> 2)
                or bound <= 0
            ):
                raise RuntimeError("Unexpected bounded world RNG request")
            value = draw_value(bound, len(rng))
            rng.append(
                {"world": owner, "upperExclusive": bound, "providedResult": value}
            )
            ret(value)
        elif pc == 0x25F333:
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        elif pc in [0x25FA3A, 0x25FA64]:
            # The shared boundary hook has already supplied these returns.
            name = "componentWorld" if pc == 0x25FA3A else "componentActor"
            counts[name] = counts.get(name, 0) + 1
        else:
            name = getter_names[pc]
            pointer = read(sp + 4)
            expected = (
                body
                if name in ["actorOwner", "actorWorld", "actorData"]
                else (
                    heap + 0xB000
                    if name == "frameNoop"
                    else custom if name == "customRadius" else data
                )
            )
            if name == "projectileOwnerStore":
                if (
                    pointer
                    not in [p["result"] for p in packets if p["kind"] == "factory"]
                    or read(sp + 8) != current["owner"]
                ):
                    raise RuntimeError("Unexpected native projectile owner store")
            elif pointer != expected:
                raise RuntimeError(f"Unexpected selection getter: {name} {pointer:#x}")
            if name == "frameNoop" and read(sp + 8) not in [primary, custom]:
                raise RuntimeError("Unexpected frame projectile argument")
            counts[name] = counts.get(name, 0) + 1

    def memory(_cpu, _access, address, size, _value, _data):
        if data <= address < data + 0x800:
            reads.append(("character", address - data, size))
        elif primary <= address < primary + 0x100:
            reads.append(("primary", address - primary, size))
        elif custom <= address < custom + 0x100:
            reads.append(("custom", address - custom, size))

    for pc in [0x25E86A, 0x25F333, 0x25FA3A, 0x25FA64, *boundaries, *getter_names]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)
    for begin, end in [
        (data, data + 0x7FF),
        (primary, primary + 0xFF),
        (custom, custom + 0xFF),
    ]:
        cpu.hook_add(UC_HOOK_MEM_READ, memory, begin=begin, end=end)
    profiles, cases, controls = [], [], []
    for table in ["characters", "buildings"]:
        for name, row in env["rows"][f"reference/logic/{table}.csv"].items():
            if name in ["", "string"] or not row["Projectile"]:
                continue
            profiles.append(
                {
                    "sourceTable": table,
                    "sourceName": name,
                    "primary": row["Projectile"],
                    "customFirst": row["CustomFirstProjectile"] or None,
                    "count": max(1, int(row["MultipleProjectiles"] or 0)),
                    "areaRadius": int(row["AreaDamageRadius"] or 0),
                }
            )
    if len(profiles) != 27 or [p["sourceName"] for p in profiles if p["count"] > 1] != [
        "Princess"
    ]:
        raise RuntimeError("Recheck source projectile volley profiles")

    def divide(numerator, denominator):
        return (-1 if numerator < 0 else 1) * (abs(numerator) // denominator)

    def sample(profile, owner, origin, live, overrides=None, kind="source"):
        nonlocal current, packets, rng, counts, reads
        values = {
            **profile,
            "rawPointOverride": 0,
            "strategy": "cycle",
            **(overrides or {}),
        }
        row = env["rows"][f"reference/logic/{profile['sourceTable']}.csv"][
            profile["sourceName"]
        ]
        initialize({**row, "LoadTime": row["LoadTime"] or "0"})
        current = {
            "target": context["target_a"] if live else 0,
            "owner": owner,
            "radius": values["areaRadius"],
            "strategy": values["strategy"],
        }
        cached = {"x": 3000 + origin, "y": 4000 - origin}
        alternate = {"x": -321 + origin, "y": 9876 - origin}
        for offset, value in [
            (0x38, 0),
            (0x48, 0),
            (0x1C, owner),
            (0x14, world),
            (0x20, 2000 + origin),
            (0x24, 2200 - origin),
            (0x18, heap + 0xB000),
        ]:
            write(body + offset, value)
        write(heap + 0xB000, heap + 0xC000)
        write(heap + 0xC000 + 0x1C, 0x25FA0C)
        for offset, value in [
            (0x28, primary),
            (0x2C, custom if values["customFirst"] else 0),
            (0x30, values["count"]),
            (0x19C, values["areaRadius"]),
            (0x50, auxiliary),
            (0x44, 0),
            (0x48, 0),
        ]:
            write(data + offset, value)
        custom_radius = values.get(
            "customRadius",
            (
                int(projectiles[values["customFirst"]]["Radius"] or 0)
                if values["customFirst"]
                else 0
            ),
        )
        if projectiles[values["primary"]]["TargetToEdge"] or (
            values["customFirst"] and projectiles[values["customFirst"]]["TargetToEdge"]
        ):
            raise RuntimeError("Recheck source edge-target flag")
        write(custom + 0x60, custom_radius)
        write(custom + 0xA8, 0)
        for offset, value in [
            (0x34, cached["x"]),
            (0x38, cached["y"]),
            (0x40, values["rawPointOverride"]),
            (0x44, alternate["x"]),
            (0x48, alternate["y"]),
        ]:
            write(component + offset, value)
        write(context["target_a"] + 0x20, 3700 + origin)
        write(context["target_a"] + 0x24, 4300 - origin)
        before = bytes(cpu.mem_read(heap, 0x10000))
        packets, rng, counts, reads = [], [], {}, []
        context["calls"].clear()
        run(0x25E86A, instruction_budget=50000)
        number = max(1, values["count"])
        shoots = [p for p in packets if p["kind"] == "shoot"]
        expected_heap = bytearray(before)
        expected_packets, expected_rng = [], []
        angle_step = 360 // number
        for index in range(number):
            pointer = heap + 0xF000 + index * 0x100
            selected = custom if index == 0 and values["customFirst"] else primary
            dx = dy = 0
            if index:
                bound = values["areaRadius"] - (values["areaRadius"] >> 2)
                value = draw_value(bound, index - 1)
                expected_rng.append(
                    {"world": world, "upperExclusive": bound, "providedResult": value}
                )
                radius = value + (values["areaRadius"] >> 2)
                angle = angle_step * index
                dx = divide(radius * round(math.cos(math.radians(angle)) * 1024), 1024)
                dy = divide(radius * round(math.sin(math.radians(angle)) * 1024), 1024)
            goal = (
                alternate
                if values["rawPointOverride"] > 0
                else {"x": cached["x"] + dx, "y": cached["y"] + dy}
            )
            arguments = [
                pointer,
                body,
                current["target"],
                goal["x"],
                goal["y"],
                body,
                auxiliary,
                1,
                0,
            ]
            expected_packets.extend(
                [
                    {"kind": "factory", "arguments": [selected, 4], "result": pointer},
                    {"kind": "shoot", "selectedData": selected, "arguments": arguments},
                    {"kind": "registrationRequest", "arguments": [world, pointer, 1]},
                ]
            )
            for offset, value in [
                (pointer - heap + 0x10, selected),
                (pointer - heap + 0x1C, owner),
            ]:
                expected_heap[offset : offset + 4] = struct.pack("<i", value)
        if (
            packets != expected_packets
            or rng != expected_rng
            or bytes(cpu.mem_read(heap, 0x10000)) != bytes(expected_heap)
        ):
            raise RuntimeError(
                f"Native selected projectile goals differ: {profile['sourceName']} {values}"
            )
        custom_calls = (2 if values["customFirst"] else 1) + (number - 1) * (
            4
            if values["customFirst"] and live and not custom_radius
            else 2 if values["customFirst"] else 1
        )
        expected_counts = {
            "count": 1,
            "areaRadius": 1,
            "customFirst": custom_calls,
            "actorOwner": number,
            "projectileOwnerStore": number,
            "auxiliary": number,
            "presentationReference": number,
            "actorWorld": number,
            "actorData": number * 2,
            "frameNoop": number,
            "componentActor": number,
        }
        primaries = number - int(bool(values["customFirst"]))
        if primaries:
            expected_counts["primary"] = primaries
        if values["customFirst"] and number > 1:
            expected_counts["customRadius"] = number - 1
        if number > 1:
            expected_counts["componentWorld"] = number - 1
        expected_parent = {"0x25fa2a": number}
        allowed_reads = {
            ("character", o, 4) for o in [0x30, 0x19C, 0x2C, 0x28, 0x50, 0x44]
        } | {
            ("primary", 0x88, 1),
            ("custom", 0x88, 1),
            ("custom", 0x60, 4),
            ("custom", 0xA8, 4),
        }
        if (
            counts != expected_counts
            or context["calls"] != expected_parent
            or any(r not in allowed_reads for r in reads)
        ):
            raise RuntimeError(
                f"Native volley counts/field reads differ: {counts} {expected_counts} {context['calls']} {reads}"
            )
        return {
            "kind": kind,
            "sourceTable": profile["sourceTable"],
            "sourceName": profile["sourceName"],
            "owner": owner,
            "liveTarget": live,
            "cachedPoint": cached,
            "alternatePoint": alternate,
            "fields": values,
            "customRadius": custom_radius,
            "rngRequests": list(rng),
            "requests": list(packets),
            "getterCalls": dict(counts),
            "parentCalls": dict(context["calls"]),
            "dataReads": sorted(set(reads)),
            "unrelatedHeapUnchanged": True,
        }

    for profile, owner, origin, live in itertools.product(
        profiles, [0, 1], [0, 1333, -9125], [False, True]
    ):
        cases.append(sample(profile, owner, origin, live))
    princess = next(p for p in profiles if p["sourceName"] == "Princess")
    for count, owner, live in itertools.product(
        [-1, 0, 1, 3, 7], [0, 1], [False, True]
    ):
        controls.append(
            sample(princess, owner, 0, live, {"count": count}, "countOverride")
        )
    for strategy, radius, live in itertools.product(
        ["minimum", "middle", "maximum"], [1, 3, 2501], [False, True]
    ):
        controls.append(
            sample(
                princess,
                0,
                0,
                live,
                {"strategy": strategy, "areaRadius": radius},
                "rngRadiusOverride",
            )
        )
    for live, present, point in itertools.product(
        [False, True], [False, True], [-1, 0, 1]
    ):
        controls.append(
            sample(
                princess,
                1,
                -9125,
                live,
                {
                    "customFirst": princess["customFirst"] if present else None,
                    "rawPointOverride": point,
                },
                "referencePointOverride",
            )
        )
    for live in [False, True]:
        controls.append(
            sample(princess, 0, 0, live, {"customRadius": 0}, "customRadiusOverride")
        )
    asm = subprocess.check_output(
        ["objdump", "-d", "-Mintel", str(env["args"].library)], text=True
    )
    definitions = [
        (
            "selectionSpreadAndRequests",
            0x25E86A,
            0x25EEA7,
            "Actual normal-attack projectile count/primary/custom-first selection, Q10 circular offsets, owner store and shoot/registration request preparation; caller locals/boundaries supplied.",
        ),
        (
            "countAndCustomGetters",
            0x1DF0F4,
            0x1DF114,
            "Actual character Data+0x30 count and +0x2c custom-first getters.",
        ),
        (
            "primaryGetter",
            0x1DDC08,
            0x1DDC26,
            "Actual supplied-normal primary reference selection from Data+0x28.",
        ),
        (
            "customRadiusGetter",
            0x1FB71E,
            0x1FB72E,
            "Actual custom projectile Radius getter at Data+0x60.",
        ),
        (
            "rotatePoint",
            0x35D8B0,
            0x35D937,
            "Actual signed integer Q10 point rotation.",
        ),
        (
            "customFirstColumnStore",
            0x1D8F9E,
            0x1D8FD2,
            "CustomFirstProjectile column/reference binding stores Data+0x2c.",
        ),
        (
            "multipleColumnStore",
            0x1D8FDA,
            0x1D9012,
            "MultipleProjectiles named lookup is clamped to at least one before Data+0x30 storage.",
        ),
        (
            "edgeColumnStore",
            0x1FA899,
            0x1FA8C4,
            "TargetToEdge named bool binding stores Data+0x88; source values are empty/false.",
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
            raise RuntimeError("Projectile goal instruction block is empty")
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
            "Actual bounded normal-attack count/selection/spread and request loop executes. Character/projectile Data, cached/current/live-target points, level/damage/caller locals and normal-attack flag are supplied. Earlier attack phase/setup, special attacks and natural target sampling are excluded.",
            "Class-4 factory requests receive supplied empty body/header returns. Actual actor owner getter/projectile owner store and frame notification through a supplied native no-op execute. Auxiliary resolution/scalar and post-shot presentation references are supplied; source-optional post-effect references are null. Shoot and world registration callees are recorded boundaries, not executed allocation/registration or hits.",
            "Bounded RNG arguments execute natively, while each RNG result is supplied by a declared strategy. Princess uses a custom first center and four primary decorative references; later offsets use radius floor(area/4)+boundedRng(area-floor(area/4)), integer 360/count angles and native Q10 rotation. This does not execute the world's RNG stream.",
            "Both raw owners, three translated origins and null/live target arguments verify cached-point use. Source TargetToEdge is false. Counts, radius/RNG extremes, custom-reference absence and raw positive alternate-point controls are synthetic; full active edge-target behavior remains outside scope.",
            "Every factory/shoot/registration tuple, selected reference, goal, RNG request, getter/parent count and permitted Data read is independently checked. Heap mutation is confined to supplied factory headers and actual owner stores. Source shoot requests do not establish full natural flight/world behavior; application rules remain unchanged.",
        ],
        "profiles": profiles,
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    output = json.dumps(result, indent=2) + "\n"
    path = Path("reference/client/attack-projectile-goals-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native attack projectile goals differ")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "profiles": len(profiles),
                "cases": len(cases),
                "controls": len(controls),
                "shoots": sum(
                    sum(p["kind"] == "shoot" for p in row["requests"])
                    for row in cases + controls
                ),
                "blocks": len(blocks),
            }
        )
    )
