"""Execute projectile child coordinates through native formation and lane math.

Projectile constructor/landing fields and source Data are supplied. Actual
bounded coordinate stores, lane search, formation/trig, factory arguments and
priority stores execute; allocation/collision/deployment/registration are skipped.
"""

import csv
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import (
    UC_X86_REG_EBP,
    UC_X86_REG_EDI,
    UC_X86_REG_ESI,
    UC_X86_REG_ESP,
    UC_X86_REG_EIP,
)


def create_collector(env, grid, store_spawn_lane):
    cpu, heap, world, data, component = [
        env[key] for key in ["cpu", "heap", "world", "data", "component"]
    ]
    read, write, run, ret = [
        env[key] for key in ["read", "write", "run", "return_hook"]
    ]
    projectile, frame, config, reference = (
        heap + 0x400,
        heap + 0x8100,
        heap + 0xC000,
        heap + 0xF000,
    )
    source_paths = [
        "reference/logic/projectiles.csv",
        "reference/logic/characters.csv",
        "reference/logic/globals.csv",
        "src/game/formation-data.json",
        "reference/client/formation-native-trace.json",
        "reference/client/lane-assignment-native-trace.json",
    ]
    source_bytes = [Path(path).read_bytes() for path in source_paths]
    projectile_rows, characters, globals_rows = [
        {row["Name"]: row for row in csv.DictReader(io.StringIO(value.decode()))}
        for value in source_bytes[:3]
    ]
    source = projectile_rows["GoblinBarrelSpell"]
    goblin = characters[source["SpawnCharacter"]]
    profile = {
        "count": int(source["SpawnCharacterCount"]),
        "radius": int(goblin["CollisionRadius"]),
        "angleShift": int(goblin["SpawnAngleShift"] or 0),
        "spawnConstPriority": source["SpawnConstPriority"].lower() == "true",
        "laneSequenceEnabled": globals_rows["LOGIC_LANE_ID_BASED_DEPLOY_SEQUENCE"][
            "BooleanValue"
        ]
        == "TRUE",
    }
    if source["SpawnCharacter"] != "Goblin" or profile != {
        "count": 3,
        "radius": 500,
        "angleShift": 0,
        "spawnConstPriority": True,
        "laneSequenceEnabled": True,
    }:
        raise RuntimeError("Recheck native Barrel formation source profile")
    formation = json.loads(source_bytes[3])
    if formation["sineTable"] != [read(0x642208 + index * 4) for index in range(91)]:
        raise RuntimeError("Recheck native formation sine table")
    env["allowed"].extend(
        [
            (0x21D0C7, 0x21D0D4),
            (0x21DCC8, 0x21DCDA),
            (0x21E3A2, 0x21E52C),
            (0x21E5A7, 0x21E5C1),
            (0x21984A, 0x219874),
            (0x219894, 0x21991F),
            (0x21AF26, 0x21AF36),
            (0x1CD216, 0x1CD263),
            (0x1FBACA, 0x1FBADA),
            (0x1FBAFA, 0x1FBB0A),
            (0x1DE3F0, 0x1DE404),
            (0x35D220, 0x35D245),
            (0x35D250, 0x35D281),
            (0x1CCE2E, 0x1CD028),
            (0x35BEC0, 0x35C117),
            (0x1E6CEE, 0x1E6CEF),
            (0x1C959A, 0x1C959B),
        ]
    )
    points, formation_arguments, current = [], [], None

    def hook(_cpu, address, _size, _data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if address in [0x21D0C7, 0x21DCC8, 0x21E3A2]:
            cpu.reg_write(UC_X86_REG_EBP, frame)
            cpu.reg_write(
                UC_X86_REG_ESI if address == 0x21D0C7 else UC_X86_REG_EDI, projectile
            )
        elif address in [0x21D0D3, 0x21DCD9, 0x21E5C0]:
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        elif address == 0x1E6CEE:
            ret(config)
        elif address == 0x1CCE2E:
            if read(sp) != 0x21E49A:
                raise RuntimeError("Unexpected projectile formation caller")
            args = [read(sp + offset) for offset in [4, 8, 12, 16, 20, 24]]
            expected_index = len(formation_arguments)
            if args != [
                expected_index,
                current["count"],
                current["radius"],
                int(current["owner"] == 0),
                current["lane"],
                current["angleShift"],
            ]:
                raise RuntimeError("Unexpected native projectile formation arguments")
            formation_arguments.append(args)
        elif address == 0x1C959A:
            if read(sp) != 0x21E50B:
                raise RuntimeError("Unexpected projectile factory return")
            args = [read(sp + offset) for offset in range(4, 36, 4)]
            index = len(points)
            if (
                args[0:2] != [world, component]
                or args[4] != heap + 0xD000 + current["owner"] * 8
                or args[5:8] != [0, 0, current["x"]]
            ):
                raise RuntimeError("Unexpected projectile factory binding")
            child = heap + 0xD100 + index * 0x200
            write(child + 0xAC, 0)
            points.append(
                {
                    "index": index,
                    "x": args[2],
                    "y": args[3],
                    "hint": args[7],
                    "pointer": child,
                }
            )
            ret(child)
        elif address == 0x21E52B:
            if not points or cpu.reg_read(UC_X86_REG_ESI) != points[-1]["pointer"]:
                raise RuntimeError("Unexpected projectile child priority owner")
            points[-1]["fieldAC"] = read(points[-1]["pointer"] + 0xAC)
            cpu.reg_write(UC_X86_REG_EIP, 0x21E5A7)

    for address in [
        0x21D0C7,
        0x21D0D3,
        0x21DCC8,
        0x21DCD9,
        0x21E3A2,
        0x21E5C0,
        0x1E6CEE,
        0x1CCE2E,
        0x1C959A,
        0x21E52B,
    ]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=address, end=address)

    def sine(angle):
        degree = angle % 360
        if degree <= 90:
            return formation["sineTable"][degree]
        if degree < 180:
            return formation["sineTable"][180 - degree]
        if degree <= 270:
            return -formation["sineTable"][degree - 180]
        return -formation["sineTable"][360 - degree]

    def offset(index, count, radius, angle, owner, lane, sequence):
        if count == 1:
            return (0, 0)
        if count == 2:
            angle += 90
        elif count == 3:
            angle += 180
        elif count == 4:
            angle += 45
        else:
            raise RuntimeError("Unsupported projectile formation control")
        if count >= 3:
            radius = int(radius * 1000 / int(sine(int(180 / count)) * 1000 / 1024))
        angle += int(index * 360 / count) + 90
        x, y = int(sine(angle + 90) * radius / 1024), int(sine(angle) * radius / 1024)
        if sequence and lane == 1:
            x = -x
        if owner == 0:
            y = -y
        return x, y

    cases, controls = [], []

    def sample(
        section, x, y, owner, count=3, radius=500, angle=0, enabled=True, sequence=True
    ):
        nonlocal points, formation_arguments, current
        lane = run(0x1C9114, world, x, y, -1, instruction_budget=1000000)
        current = {
            "x": x,
            "y": y,
            "owner": owner,
            "count": count,
            "radius": radius,
            "angleShift": angle,
            "lane": lane,
        }
        write(projectile + 0x10, data)
        write(projectile + 0x14, reference)
        write(projectile + 0x1C, owner)
        write(projectile + 0x38, 0)
        write(reference + 0x28, world)
        write(world + 0x1C, 2)
        for raw_owner in [0, 1]:
            account = heap + 0xD000 + raw_owner * 8
            write(world + 0xC + raw_owner * 4, account)
            write(account, 100 + raw_owner)
            write(account + 4, 200 + raw_owner)
        write(data + 0x28, component)
        write(data + 0x30, count)
        cpu.mem_write(data + 0x8B, bytes([int(enabled)]))
        write(component + 0x22C, radius)
        write(component + 0x160, angle)
        cpu.mem_write(config + 0x2C4, bytes([int(sequence)]))
        write(frame + 8, projectile)
        write(frame + 0x20, x)
        write(frame + 0x24, y)
        points, formation_arguments = [], []
        run(0x21D0C7, instruction_budget=100)
        if (read(projectile + 0x5C), read(projectile + 0x60)) != (x, y):
            raise RuntimeError("Projectile constructor coordinate stores differ")
        run(0x21DCC8, instruction_budget=100)
        run(0x21E3A2, instruction_budget=1000000)
        expected = []
        for index in range(count):
            dx, dy = offset(index, count, radius, angle, owner, lane, sequence)
            expected.append(
                {
                    "index": index,
                    "x": x + dx,
                    "y": y + dy,
                    "hint": x,
                    "fieldAC": (index * 20) ** 2 if enabled else 0,
                }
            )
        observed = [
            {key: value for key, value in point.items() if key != "pointer"}
            for point in points
        ]
        if observed != expected or len(formation_arguments) != count:
            raise RuntimeError(
                json.dumps({"case": current, "expected": expected, "actual": observed})
            )
        for point in observed:
            point["storedLane"] = store_spawn_lane(
                point["x"], point["y"], point["hint"]
            )
        return {
            "section": section,
            "ownerIndex": owner,
            "center": {"x": x, "y": y},
            "lane": lane,
            "count": count,
            "collisionRadius": radius,
            "angleShift": angle,
            "spawnConstPriority": enabled,
            "laneSequenceEnabled": sequence,
            "formationArguments": formation_arguments,
            "children": observed,
        }

    def collect(_mode, section):
        for owner in [0, 1]:
            for x in [
                250,
                3500,
                8994,
                8995,
                8999,
                9000,
                9001,
                9494,
                9495,
                14500,
                17750,
            ]:
                for y in [250, 6500, 16000, 25500, 31750]:
                    cases.append(sample(section, x, y, owner))
            for count in [0, 1, 2, 4]:
                controls.append(
                    {
                        "control": "synthetic-count",
                        **sample(section, 9000, 16000, owner, count=count),
                    }
                )
            for radius in [250, 750]:
                controls.append(
                    {
                        "control": "synthetic-radius",
                        **sample(section, 9000, 16000, owner, radius=radius),
                    }
                )
            for angle in [45, 90]:
                controls.append(
                    {
                        "control": "synthetic-angle",
                        **sample(section, 9000, 16000, owner, angle=angle),
                    }
                )
            for field, kwargs in [
                ("synthetic-priority-off", {"enabled": False}),
                ("synthetic-sequence-off", {"sequence": False}),
            ]:
                controls.append(
                    {"control": field, **sample(section, 3500, 16000, owner, **kwargs)}
                )

    def finish(maps):
        static = [
            (
                "projectileCoordinateStore",
                0x21D0C7,
                0x21D0D3,
                "Actual constructor argument stores set projectile+0x5c/+0x60.",
            ),
            (
                "projectileCoordinateBinding",
                0x21DCC8,
                0x21DCD9,
                "Actual reads copy projectile coordinates into the later spawn frame.",
            ),
            (
                "projectileChildGeometry",
                0x21E3A2,
                0x21E50B,
                "Actual child lookup/count, owner/world/account reference, native lane selector, CollisionRadius/SpawnAngleShift formation arguments, offset addition and factory call preparation.",
            ),
            (
                "projectileChildPriority",
                0x21E50B,
                0x21E52B,
                "Actual ordinal-square store uses the supplied factory return.",
            ),
            (
                "projectileChildIncrement",
                0x21E5A7,
                0x21E5C0,
                "Actual child index/priority ordinal increments drive every iteration.",
            ),
            (
                "formationGeometry",
                0x1CCE2E,
                0x1CD028,
                "Actual fixed-point trigonometry and lane/owner reflections generate child offsets.",
            ),
            (
                "childProfileGetters",
                0x1FBACA,
                0x1FBB0A,
                "Actual child-pointer and count getters read projectile Data.",
            ),
        ]
        blocks = []
        for name, start, end, interpretation in static:
            assembly = subprocess.check_output(
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
            instructions = [
                re.sub(r"\s+<[^>]+>", "", line.strip())
                for line in assembly.splitlines()
                if re.match(r"\s+[0-9a-f]+:", line)
            ]
            blocks.append(
                {
                    "name": name,
                    "start": hex(start),
                    "end": hex(end),
                    "interpretation": interpretation,
                    "instructions": instructions,
                }
            )
        output = (
            json.dumps(
                {
                    "source": "apk/1.8.1/x86/libg.so",
                    "sha256": env["sha"],
                    "emulator": "unicorn==2.1.4",
                    "inputs": [
                        {"path": path, "sha256": hashlib.sha256(value).hexdigest()}
                        for path, value in zip(source_paths, source_bytes)
                    ],
                    "sourceProfile": profile,
                    "maps": maps,
                    "limits": [
                        "Actual map copying/lane selection, bounded projectile coordinate stores/reads, child formation/trig, account reference resolution, factory argument preparation and priority stores execute.",
                        "Projectile owner/Data/reference, two opaque account IDs and constructor coordinate arguments are supplied. Full projectile construction, travel, target selection and natural landing-coordinate updates do not execute.",
                        "Child factory return is a supplied zero-priority body. Complete body allocation, collision adjustment/clamping, deployment, level assignment and world registration are skipped; child coordinates are requested factory positions, not final collision-resolved positions.",
                        "Observed factory coordinates/hint separately execute the bounded native lane/store fragment. That does not reconstruct the omitted factory's coordinate adjustment or lane overrides.",
                        "Raw owner indices0/1 execute; these alone do not establish browser team-color ownership. Counts/radii/angles and false flags outside the archived three-Goblin profile are explicitly synthetic controls.",
                    ],
                    "blocks": blocks,
                    "cases": cases,
                    "controls": controls,
                },
                indent=2,
            )
            + "\n"
        )
        path = Path("reference/client/projectile-formation-native-trace.json")
        if env["args"].check:
            if path.read_text() != output:
                raise RuntimeError("Native projectile-formation capture differs")
        else:
            path.write_text(output)
        print(
            json.dumps(
                {
                    "cases": len(cases),
                    "controls": len(controls),
                    "blocks": len(blocks),
                    "children": sum(len(row["children"]) for row in cases + controls),
                }
            )
        )

    return collect, finish
