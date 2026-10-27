"""Bounded null-target projectile/shoot and self-area request preparation.

The caller's selected reference, damage/level/auxiliary locals and spread vector
are supplied. Actual point/team/reference getters and call preparation execute.
Factory return, frame notification, level/default reference and auxiliary lookup
are supplied boundaries; shoot/area callees, allocation and hits do not run.
"""

import csv
import hashlib
import io
import itertools
import json
from pathlib import Path
import re
import subprocess
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import (
    UC_X86_REG_EIP,
    UC_X86_REG_ESI,
    UC_X86_REG_EDI,
    UC_X86_REG_ECX,
    UC_X86_REG_EBP,
    UC_X86_REG_ESP,
)


def capture(env, context):
    cpu, heap, body, data, component = [
        env[k] for k in ["cpu", "heap", "body", "data", "component"]
    ]
    read, write, run, initialize, ret = [
        env[k] for k in ["read", "write", "run", "initialize", "return_hook"]
    ]
    projectile_data, projectile_body, auxiliary, level = [
        heap + x for x in [0xE000, 0xF000, 0xD000, 0x7000]
    ]
    paths = [
        "reference/client/target-loss-clock-native-trace.json",
        "reference/client/targetless-policy-native-trace.json",
        "reference/logic/characters.csv",
        "reference/logic/buildings.csv",
        "reference/logic/projectiles.csv",
    ]
    inputs = [
        {"path": path, "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest()}
        for path in paths
    ]
    for path in paths[:2]:
        reference = json.loads(Path(path).read_text())
        if reference["sha256"] != env["sha"]:
            raise RuntimeError("Request reference uses another native binary")
        for entry in reference["inputs"]:
            if (
                hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
                != entry["sha256"]
            ):
                raise RuntimeError("Request reference input differs")
    projectile_rows = {
        r["Name"]: r for r in csv.DictReader(io.StringIO(Path(paths[4]).read_text()))
    }
    if bytes(cpu.mem_read(0x613F07, 17)) != b"AreaDamageRadius\0":
        raise RuntimeError("Recheck native area-radius column string")
    env["allowed"].extend(
        [
            (0x25EB00, 0x25ECED),
            (0x25F00E, 0x25F173),
            (0x25F1EB, 0x25F217),
            (0x25F331, 0x25F332),
            (0x2198D8, 0x21991F),
            (0x21999C, 0x2199B0),
            (0x1DE422, 0x1DE440),
            (0x219AF6, 0x219B26),
            (0x1DDF8E, 0x1DDFA2),
            (0x1DEF2C, 0x1DEF40),
        ]
    )
    boundaries = [0x21A4B0, 0x1E99F2, 0x21A41C, 0x21CE96, 0x25FAF2, 0x21BCE6]
    env["allowed"].extend((pc, pc + 1) for pc in boundaries)
    current, requests, counts = None, [], {}

    def hook(_cpu, pc, _size, _data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if pc in [0x25EB00, 0x25F00E]:
            bp = sp + 0x600
            cpu.reg_write(UC_X86_REG_EBP, bp)
            write(bp + 8, component)
            write(bp + 12, 0)
            write(bp + 16, -1)
            frame = {
                0x60: 100,
                0x70: component + 0x34,
                0x74: 0,
                0x88: 1,
                0x90: 0,
                0x94: 0,
                0x98: auxiliary,
                0x9C: 0,
                0xA0: projectile_data if pc == 0x25EB00 else current["radius"],
                0xA4: 0,
                0xA8: data,
                0xAC: body,
                0xC0: current["offset"][0],
                0xC4: current["offset"][1],
            }
            for offset, value in frame.items():
                write(sp + offset, value)
            cpu.reg_write(UC_X86_REG_ESI, data)
            cpu.reg_write(UC_X86_REG_EDI, body)
            cpu.reg_write(UC_X86_REG_ECX, 0)
        elif pc == 0x21A4B0:
            args = [read(sp + 4), read(sp + 8)]
            if args != [projectile_data, 4]:
                raise RuntimeError("Unexpected projectile factory binding")
            requests.append({"kind": "factory", "arguments": args})
            ret(projectile_body)
        elif pc == 0x1E99F2:
            counts["defaultReference"] = counts.get("defaultReference", 0) + 1
            ret(auxiliary)
        elif pc == 0x21A41C:
            if read(sp + 4) != body:
                raise RuntimeError("Unexpected supplied auxiliary scalar owner")
            counts["auxiliaryScalar"] = counts.get("auxiliaryScalar", 0) + 1
            ret(0)
        elif pc == 0x25FAF2:
            if read(sp + 4) != component:
                raise RuntimeError("Unexpected supplied level owner")
            counts["level"] = counts.get("level", 0) + 1
            ret(level)
        elif pc == 0x25FA0C:
            if [read(sp + 4), read(sp + 8)] != [heap + 0xB000, projectile_data]:
                raise RuntimeError("Unexpected supplied frame notification")
            counts["frameNotification"] = counts.get("frameNotification", 0) + 1
        elif pc in [0x21CE96, 0x21BCE6]:
            args = [read(sp + 4 + i * 4) for i in range(9 if pc == 0x21CE96 else 17)]
            requests.append(
                {"kind": "shoot" if pc == 0x21CE96 else "area", "arguments": args}
            )
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        elif pc == 0x25F331:
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])

    for pc in [0x25EB00, 0x25F00E, *boundaries, 0x25FA0C, 0x25F331]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)
    cases, controls, profiles = [], [], []

    def sample(
        profile,
        owner,
        origin,
        moved,
        raw_override=0,
        offset=(0, 0),
        self_override=None,
        radius_override=None,
        reference_present=True,
        kind="sourceProfile",
    ):
        nonlocal current, requests, counts
        table, name, selected = profile
        row = env["rows"][f"reference/logic/{table}.csv"][name]
        is_projectile = selected is not None
        radius = (
            int(row["AreaDamageRadius"] or 0)
            if radius_override is None
            else radius_override
        )
        self_center = (
            row["SelfAsAoeCenter"].lower() == "true"
            if self_override is None
            else self_override
        )
        actor_point = (
            2000 + origin + (333 if moved else 0),
            2200 - origin - (444 if moved else 0),
        )
        cached = (3000 + origin, 4000 - origin)
        override = (-321 + origin, 9876 - origin)
        initialize({**row, "LoadTime": row["LoadTime"] or "0"})
        write(body + 0x38, 0)
        write(body + 0x48, 0)
        write(body + 0x1C, owner)
        write(body + 0x20, actor_point[0])
        write(body + 0x24, actor_point[1])
        write(body + 0x28, 0)
        write(body + 0x18, heap + 0xB000)
        write(heap + 0xB000, heap + 0xC000)
        write(heap + 0xC000 + 0x1C, 0x25FA0C)
        write(projectile_body + 0x10, projectile_data)
        write(projectile_body + 0x1C, -91)
        write(data + 0x28, projectile_data if is_projectile else 0)
        write(data + 0x50, auxiliary if reference_present else 0)
        cpu.mem_write(data + 0x291, bytes([self_center]))
        write(data + 0x19C, radius)
        write(component + 8, 0)
        write(component + 0x2C, 0)
        write(component + 0x40, raw_override)
        write(component + 0x34, cached[0])
        write(component + 0x38, cached[1])
        write(component + 0x44, override[0])
        write(component + 0x48, override[1])
        current, requests, counts = {"radius": radius, "offset": offset}, [], {}
        before = bytes(cpu.mem_read(heap, 0x10000))
        run(0x25EB00 if is_projectile else 0x25F00E, instruction_budget=20000)
        if is_projectile:
            expected_point = (
                override
                if raw_override > 0
                else (cached[0] + offset[0], cached[1] + offset[1])
            )
            expected = [
                {"kind": "factory", "arguments": [projectile_data, 4]},
                {
                    "kind": "shoot",
                    "arguments": [
                        projectile_body,
                        body,
                        0,
                        *expected_point,
                        body,
                        auxiliary,
                        1,
                        0,
                    ],
                },
            ]
            expected_counts = {"frameNotification": 1, "auxiliaryScalar": 1}
            if not reference_present:
                expected_counts["defaultReference"] = 1
        elif radius > 0:
            expected_point = actor_point if self_center else cached
            expected = [
                {
                    "kind": "area",
                    "arguments": [
                        level,
                        *expected_point,
                        radius,
                        0,
                        100,
                        body,
                        0,
                        *actor_point,
                        -1,
                        0,
                        1,
                        1,
                        0,
                        0,
                        0,
                    ],
                }
            ]
            expected_counts = {"level": 1}
        else:
            expected_point, expected, expected_counts = None, [], {}
        if requests != expected or counts != expected_counts:
            raise RuntimeError(
                json.dumps(
                    {
                        "profile": profile,
                        "requests": requests,
                        "expected": expected,
                        "counts": counts,
                        "expectedCounts": expected_counts,
                    }
                )
            )
        expected_heap = bytearray(before)
        if is_projectile:
            relative = projectile_body + 0x1C - heap
            expected_heap[relative : relative + 4] = owner.to_bytes(
                4, "little", signed=True
            )
        if bytes(cpu.mem_read(heap, 0x10000)) != bytes(expected_heap):
            raise RuntimeError(
                "Unexpected heap mutation outside actual projectile team store"
            )
        return {
            "kind": kind,
            "sourceTable": table,
            "sourceName": name,
            "selectedProjectile": selected,
            "ownerIndex": owner,
            "origin": origin,
            "casterMoved": moved,
            "casterPoint": {"x": actor_point[0], "y": actor_point[1]},
            "cachedPoint": {"x": cached[0], "y": cached[1]},
            "rawOverride40": raw_override,
            "suppliedOffset": {"x": offset[0], "y": offset[1]},
            "overridePoint44": {"x": override[0], "y": override[1]},
            "selfAsAoeCenter": self_center,
            "areaRadius": radius,
            "auxiliaryReferencePresent": reference_present,
            "target": None,
            "expectedRequestPoint": (
                None
                if expected_point is None
                else {"x": expected_point[0], "y": expected_point[1]}
            ),
            "requests": list(requests),
            "boundaryCalls": dict(counts),
            "storedProjectileOwner": (
                read(projectile_body + 0x1C) if is_projectile else None
            ),
            "heapMutationVerified": True,
        }

    entries = [
        ("characters", name) for name in ["Bomber", "Princess", "Bowler", "AxeMan"]
    ] + [("buildings", name) for name in ["Mortar", "BombTower"]]
    for table, name in entries:
        row = env["rows"][f"reference/logic/{table}.csv"][name]
        for field in ["Projectile", "CustomFirstProjectile"]:
            selected = row[field]
            if not selected:
                continue
            if projectile_rows[selected]["Homing"].lower() == "true":
                raise RuntimeError("Recheck selected source non-homing reference")
            profile = (table, name, selected)
            profiles.append(
                {
                    "sourceTable": table,
                    "sourceName": name,
                    "referenceField": field,
                    "selectedProjectile": selected,
                    "sourceProjectileCount": int(row["MultipleProjectiles"] or 1),
                    "homing": False,
                }
            )
            for owner, origin, moved in itertools.product(
                [0, 1], [0, 1333, -9125], [False, True]
            ):
                cases.append(sample(profile, owner, origin, moved))
            for raw_override in [-1, 0, 1]:
                controls.append(
                    sample(
                        profile,
                        1,
                        0,
                        True,
                        raw_override,
                        (123, -456),
                        kind="overrideOffsetControl",
                    )
                )
            controls.append(
                sample(
                    profile,
                    0,
                    0,
                    False,
                    reference_present=False,
                    kind="defaultReferenceControl",
                )
            )
    profile = ("characters", "Valkyrie", None)
    profiles.append(
        {
            "sourceTable": "characters",
            "sourceName": "Valkyrie",
            "selectedProjectile": None,
            "selfAsAoeCenter": True,
            "areaRadius": 2000,
        }
    )
    for owner, origin, moved in itertools.product(
        [0, 1], [0, 1333, -9125], [False, True]
    ):
        cases.append(sample(profile, owner, origin, moved))
        controls.append(
            sample(
                profile,
                owner,
                origin,
                moved,
                self_override=False,
                kind="cachedAreaCenterControl",
            )
        )
    for radius, self_center, owner in itertools.product(
        [-1, 0, 1], [False, True], [0, 1]
    ):
        controls.append(
            sample(
                profile,
                owner,
                0,
                True,
                self_override=self_center,
                radius_override=radius,
                kind="areaRadiusBoundaryControl",
            )
        )
    static = [
        (
            "projectilePreparation",
            0x25EB00,
            0x25EB9F,
            "Actual class-4 factory request, team getter/store and null-target skip of live-target lead adjustment.",
        ),
        (
            "projectilePoint",
            0x25EC63,
            0x25ECED,
            "Actual raw override or cached point plus supplied offset, then shoot argument preparation.",
        ),
        (
            "areaPreparation",
            0x25F00E,
            0x25F173,
            "Actual positive-radius guard, cached/current-caster center selection and area request arguments.",
        ),
        (
            "zeroRadius",
            0x25F1EB,
            0x25F217,
            "Without positive area radius, null target bypasses direct-hit work.",
        ),
        (
            "selfCenterGetter",
            0x1DEF2C,
            0x1DEF40,
            "Actual Data+0x291 self-center getter.",
        ),
        (
            "areaRadiusGetter",
            0x1DDF8E,
            0x1DDFA2,
            "Actual Data+0x19c area-radius getter.",
        ),
        (
            "areaRadiusColumn",
            0x1DB59A,
            0x1DB5C8,
            "Static AreaDamageRadius string lookup retained at GOT+0x1788.",
        ),
        (
            "areaRadiusStore",
            0x1D98DF,
            0x1D98F7,
            "Static source column integer read stores Data+0x19c.",
        ),
        (
            "teamGetter",
            0x2198D8,
            0x21991F,
            "Actual raw owner getter with buff mask controlled zero.",
        ),
        (
            "casterPointGetters",
            0x219AF6,
            0x219B26,
            "Actual caster X/Y/Z field getters used by self-centered area preparation.",
        ),
        (
            "teamStore",
            0x21999C,
            0x2199B0,
            "Actual returned projectile owner store at+0x1c.",
        ),
        (
            "auxiliaryReferenceGetter",
            0x1DE422,
            0x1DE440,
            "Actual supplied primary reference getter and special fallback selection; reference resolution is not reconstructed.",
        ),
    ]
    blocks = []
    for name, start, end, meaning in static:
        asm = subprocess.check_output(
            [
                "objdump",
                "-d",
                "-Mintel",
                f"--start-address={start:#x}",
                f"--stop-address={end:#x}",
                str(env["args"].library),
            ],
            text=True,
        )
        blocks.append(
            {
                "name": name,
                "start": hex(start),
                "end": hex(end),
                "interpretation": meaning,
                "instructions": [
                    re.sub(r"\s+<[^>]+>", "", line.strip())
                    for line in asm.splitlines()
                    if re.match(r"\s+[0-9a-f]+:", line)
                ],
            }
        )
    output = (
        json.dumps(
            {
                "source": "apk/1.8.1/x86/libg.so",
                "sha256": env["sha"],
                "emulator": "unicorn==2.1.4",
                "inputs": inputs,
                "limits": [
                    "Actual bounded request preparation, point/team/reference getters and projectile team store execute. Selected source projectile reference, caller frame, null target, level/damage/auxiliary values and incoming spread vector are supplied.",
                    "The class-4 factory request receives a supplied empty projectile return. Frame notification executes a supplied native no-op method. Level/default-reference lookup and auxiliary scalar are supplied. Factory allocation, shoot/area callees, trajectories, collision, registration, visual effects and hits do not execute.",
                    "Source cases use both raw owner indices, three translated origins and changed/current caster points. Princess primary decorative and custom-first references are separate supplied selections; upstream selection, five-child spread/order and parent loop are excluded.",
                    "Native null-target projectile requests retain cached coordinates plus the supplied offset unless the raw positive override selects alternate cached coordinates. Native self-centered area requests use current caster XY and source radius. Radius/self/override/offset/default-reference overrides are synthetic controls.",
                    "Every raw request tuple, request point, supplied boundary call count and actual stored projectile owner is checked independently. Supplied heap mutation is confined to that actual owner store. These are requests, not constructed projectiles or applied damage; complete natural death/owner execution and application rules remain unchanged.",
                ],
                "profiles": profiles,
                "blocks": blocks,
                "cases": cases,
                "controls": controls,
            },
            indent=2,
        )
        + "\n"
    )
    path = Path("reference/client/target-loss-request-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native target-loss request capture differs")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "profiles": len(profiles),
                "cases": len(cases),
                "controls": len(controls),
                "requests": sum(len(row["requests"]) for row in cases + controls),
                "blocks": len(blocks),
            }
        )
    )
