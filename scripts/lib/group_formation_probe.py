"""Native ordinary group owner/radius/lane/formation and factory bindings.

Source-selected Data fields and two/four opaque account records are supplied.
Actual group entry, lookup/parity, radius precedence, map lane search, geometry,
child selection, factory arguments, lane fallback and iteration execute. Body
allocation, levels/buffs, registration, visual scheduling and collision do not.
"""

import csv
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EIP


def create_collector(env, _grid):
    cpu, heap, world, data, component = [
        env[key] for key in ["cpu", "heap", "world", "data", "component"]
    ]
    read, write, run, ret = [
        env[key] for key in ["read", "write", "run", "return_hook"]
    ]
    config = heap + 0xC000
    paths = [
        "reference/logic/spells_characters.csv",
        "reference/logic/characters.csv",
        "reference/logic/globals.csv",
        "public/assets/ui/cards/cards.json",
        "src/game/formation-data.json",
        "tests/fixtures/native-formation-golden.json",
        "tests/fixtures/native-mixed-formation-golden.json",
        "reference/client/lane-assignment-native-trace.json",
    ]
    source_bytes = [Path(path).read_bytes() for path in paths]
    spells, characters, globals_rows = [
        {row["Name"]: row for row in csv.DictReader(io.StringIO(value.decode()))}
        for value in source_bytes[:3]
    ]
    portraits, formation, golden, mixed, lane_trace = [
        json.loads(value) for value in source_bytes[3:]
    ]
    if any(trace["sha256"] != env["sha"] for trace in [golden, mixed, lane_trace]):
        raise RuntimeError("Group formation input uses another native binary")
    sequence = (
        globals_rows["LOGIC_LANE_ID_BASED_DEPLOY_SEQUENCE"]["BooleanValue"] == "TRUE"
    )
    if not sequence or formation["sineTable"] != [
        read(0x642208 + index * 4) for index in range(91)
    ]:
        raise RuntimeError("Recheck group formation globals/sine table")
    profiles = {}
    for card in [*formation["cards"], "skeleton-army", "goblin-gang"]:
        spell = spells[portraits["portraits"][card]["row"]]
        primary = characters[spell["SummonCharacter"]]
        secondary = characters.get(spell["SummonCharacterSecond"])
        count = int(spell["SummonNumber"])
        override, spawn, collision = (
            int(spell["SummonRadius"] or 0),
            int(primary["SpawnRadius"] or 0),
            int(primary["CollisionRadius"]),
        )
        profile = {
            "card": card,
            "sourceSpell": spell["Name"],
            "primary": primary["Name"],
            "secondary": secondary["Name"] if secondary else None,
            "count": count,
            "collisionRadius": collision,
            "spawnRadius": spawn,
            "radiusOverride": override,
            "radius": override or spawn or collision,
            "angleShift": int(primary["SpawnAngleShift"] or 0),
        }
        if card in formation["cards"]:
            expected = formation["cards"][card]
            if (
                any(
                    profile[key] != expected[key]
                    for key in ["count", "radius", "angleShift"]
                )
                or profile["primary"] != expected["source"]
            ):
                raise RuntimeError(
                    "Source group profile differs from retained geometry"
                )
        profiles[card] = profile
    env["allowed"].extend(
        [
            (0x1CC99C, 0x1CCC00),
            (0x1CCC92, 0x1CCC96),
            (0x1CCD8E, 0x1CCD9F),
            (0x1CCE0C, 0x1CCE2D),
            (0x1DE3F0, 0x1DE404),
            (0x1DE8BA, 0x1DE8CE),
            (0x35D220, 0x35D245),
            (0x35D250, 0x35D281),
            (0x1CCE2E, 0x1CD028),
            (0x35BE60, 0x35BEB3),
            (0x35BEC0, 0x35C117),
            (0x1E6CEE, 0x1E6CEF),
            (0x1C959A, 0x1C959B),
        ]
    )
    current, points, arguments = None, [], []

    def hook(_cpu, address, _size, _data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if address == 0x1E6CEE:
            ret(config)
        elif address == 0x1CCE2E:
            if read(sp) != 0x1CCADB:
                raise RuntimeError("Unexpected ordinary group geometry caller")
            args = [read(sp + offset) for offset in [4, 8, 12, 16, 20, 24]]
            expected = [
                len(arguments),
                current["count"],
                current["radius"],
                int(current["owner"] % 2 == 0),
                current["lane"],
                current["angleShift"],
            ]
            if args != expected:
                raise RuntimeError(
                    json.dumps({"expectedArguments": expected, "actualArguments": args})
                )
            arguments.append(args)
        elif address == 0x1C959A:
            if read(sp) != 0x1CCBE4:
                raise RuntimeError("Unexpected ordinary group factory return")
            args = [read(sp + offset) for offset in range(4, 36, 4)]
            names = {data: current["primary"], component: current["secondary"]}
            if (
                args[0] != world
                or args[1] not in names
                or args[4] != heap + 0xD000 + current["owner"] * 8
                or args[5:8] != [0, 1, current["x"]]
            ):
                raise RuntimeError("Unexpected ordinary group factory binding")
            index = len(points)
            child = heap + 0xD100 + index * 0x150
            write(child + 0x8C, current["factoryLane"])
            points.append(
                {
                    "index": index,
                    "character": names[args[1]],
                    "x": args[2],
                    "y": args[3],
                    "hint": args[7],
                    "providedFactoryLane": current["factoryLane"],
                    "pointer": child,
                }
            )
            ret(child)
        elif address == 0x1CCBFF:
            if not points:
                raise RuntimeError("Group lane check without a returned child")
            points[-1]["storedLane"] = read(points[-1]["pointer"] + 0x8C)
            # Skip level/buff/registration setup, then retain the actual primary
            # Data restore before the next iteration's radius-selection getter.
            cpu.reg_write(UC_X86_REG_EIP, 0x1CCC92)
        elif address == 0x1CCC95:
            cpu.reg_write(UC_X86_REG_EIP, 0x1CCD8E)
        elif address == 0x1CCD9E:
            # Keep actual first-child retention and index/loop/return control.
            cpu.reg_write(UC_X86_REG_EIP, 0x1CCE0C)

    for address in [0x1E6CEE, 0x1CCE2E, 0x1C959A, 0x1CCBFF, 0x1CCC95, 0x1CCD9E]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=address, end=address)
    cpu.mem_write(config + 0x2C4, b"\1")
    cases, controls = [], []

    def sample(
        section,
        card,
        owner,
        x,
        y,
        factory_lane=1,
        account_count=2,
        override=None,
        spawn=None,
        count=None,
    ):
        nonlocal current, points, arguments
        profile = profiles[card]
        radius_override = profile["radiusOverride"] if override is None else override
        spawn_radius = profile["spawnRadius"] if spawn is None else spawn
        body_count = profile["count"] if count is None else count
        radius = radius_override or spawn_radius or profile["collisionRadius"]
        lane = 1 if int(x / 500) < 18 else 2
        current = {
            **profile,
            "owner": owner,
            "x": x,
            "y": y,
            "factoryLane": factory_lane,
            "count": body_count,
            "radius": radius,
            "lane": lane,
        }
        for pointer, name in [
            (data, profile["primary"]),
            (component, profile["secondary"]),
        ]:
            if name is None:
                continue
            row = characters[name]
            write(pointer + 0x22C, int(row["CollisionRadius"]))
            write(
                pointer + 0xC4,
                spawn_radius if pointer == data else int(row["SpawnRadius"] or 0),
            )
            write(pointer + 0x160, int(row["SpawnAngleShift"] or 0))
        write(world + 0x1C, account_count)
        for index in range(account_count):
            account = heap + 0xD000 + index * 8
            write(world + 0xC + index * 4, account)
            write(account, 100 + index)
            write(account + 4, 200 + index)
        points, arguments = [], []
        try:
            returned = run(
                0x1CC99C,
                world,
                data,
                0,
                x,
                y,
                body_count,
                heap + 0xD000 + owner * 8,
                0,
                0,
                0,
                0,
                0,
                component if profile["secondary"] else 0,
                radius_override,
                instruction_budget=max(1000000, body_count * 250000),
            )
        except RuntimeError as error:
            raise RuntimeError(
                json.dumps(
                    {
                        "case": current,
                        "eip": hex(cpu.reg_read(UC_X86_REG_EIP)),
                        "points": len(points),
                        "arguments": arguments[-2:],
                    }
                )
            ) from error
        if len(points) != body_count or len(arguments) != body_count:
            raise RuntimeError("Native group loop count differs")
        expected_pointer = heap + 0xD100 if body_count else 0
        if returned != expected_pointer:
            raise RuntimeError("Native group first-child return differs")
        if body_count:
            if profile["secondary"]:
                reference = next(
                    row
                    for row in mixed["cases"]
                    if row["ownerIndex"] == owner
                    and row["lane"] == (1 if lane == 1 else 0)
                )
                expected_points = [
                    (row["x"], row["y"], row["character"])
                    for row in reference["points"]
                ]
            else:
                reference = next(
                    row
                    for row in golden["cases"]
                    if row["count"] == body_count
                    and row["radius"] == radius
                    and row["angleShift"] == profile["angleShift"]
                    and row["flipY"] == (owner % 2 == 0)
                    and row["lane"] == (1 if lane == 1 else 0)
                )
                expected_points = [
                    (dx, dy, profile["primary"]) for dx, dy in reference["points"]
                ]
            expected = [
                {
                    "index": index,
                    "character": name,
                    "x": x + dx,
                    "y": y + dy,
                    "hint": x,
                    "providedFactoryLane": factory_lane,
                    "storedLane": factory_lane if factory_lane > 0 else lane,
                }
                for index, (dx, dy, name) in enumerate(expected_points)
            ]
        else:
            expected = []
        observed = [
            {key: value for key, value in point.items() if key != "pointer"}
            for point in points
        ]
        if observed != expected:
            raise RuntimeError(
                json.dumps({"case": current, "expected": expected, "actual": observed})
            )
        return {
            "section": section,
            "card": card,
            "ownerIndex": owner,
            "accountSlots": account_count,
            "center": {"x": x, "y": y},
            "profile": profile,
            "effectiveCount": body_count,
            "effectiveSpawnRadius": spawn_radius,
            "effectiveRadiusOverride": radius_override,
            "effectiveRadius": radius,
            "formationArguments": arguments,
            "children": observed,
            "returnsFirstChild": bool(returned),
        }

    def collect(_mode, section):
        for card in profiles:
            if section != "Map" and card not in [
                "archers",
                "goblins",
                "bats",
                "skeleton-army",
                "goblin-gang",
            ]:
                continue
            for owner in [0, 1]:
                for x in [3500, 14500]:
                    cases.append(sample(section, card, owner, x, 16000))
        for owner in [0, 1]:
            for card in ["archers", "goblins", "bats"]:
                for x in [8999, 9000, 9001]:
                    controls.append(
                        {
                            "control": "midpoint",
                            **sample(section, card, owner, x, 16000),
                        }
                    )
            for factory_lane in [-1, 0, 2]:
                controls.append(
                    {
                        "control": "supplied-factory-lane",
                        **sample(
                            section,
                            "archers",
                            owner,
                            3500,
                            16000,
                            factory_lane=factory_lane,
                        ),
                    }
                )
            for override, spawn in [(0, 700), (500, 700)]:
                controls.append(
                    {
                        "control": "synthetic-radius-precedence",
                        **sample(
                            section,
                            "archers",
                            owner,
                            3500,
                            16000,
                            override=override,
                            spawn=spawn,
                        ),
                    }
                )
            for count in [0, 1]:
                controls.append(
                    {
                        "control": "synthetic-count",
                        **sample(section, "archers", owner, 3500, 16000, count=count),
                    }
                )
        for owner in [2, 3]:
            controls.append(
                {
                    "control": "synthetic-four-accounts",
                    **sample(section, "archers", owner, 3500, 16000, account_count=4),
                }
            )

    def finish(maps):
        ranges = [
            (
                "groupAccountEntry",
                0x1CC99C,
                0x1CCA1B,
                "Actual entry/prologue, opaque account-ID lookup, point construction and nonpositive count guard.",
            ),
            (
                "groupRadiusAndLane",
                0x1CCA1B,
                0x1CCA9B,
                "Actual owner parity/Y reflection, collision/spawn/override radius precedence, index initialization and map-backed lane selection.",
            ),
            (
                "groupFormationAndSelection",
                0x1CCA9B,
                0x1CCBAB,
                "Actual helper arguments, fixed-point geometry, offset addition, account recheck and optional mixed-character selection. Extra Y-override pointer is supplied null.",
            ),
            (
                "groupFactoryAndLaneFallback",
                0x1CCBAB,
                0x1CCC02,
                "Actual factory argument preparation and nonpositive returned-lane fallback; factory allocation and natural lane initialization are supplied.",
            ),
            (
                "groupPrimaryRestore",
                0x1CCC92,
                0x1CCC95,
                "Retain actual primary Data restore before the next iteration.",
            ),
            (
                "groupFirstChild",
                0x1CCD8E,
                0x1CCD9E,
                "Actual first-child pointer retention.",
            ),
            (
                "groupIteration",
                0x1CCE0C,
                0x1CCE2D,
                "Actual count comparison, child index increment, loop and first-child return.",
            ),
        ]
        blocks = []
        for name, start, end, interpretation in ranges:
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
                        for path, value in zip(paths, source_bytes)
                    ],
                    "profiles": list(profiles.values()),
                    "maps": maps,
                    "limits": [
                        "Actual group entry, opaque account-ID lookup/parity, radius precedence, map-backed lane selection, fixed-point formation, child selection, factory arguments, lane fallback, first-child retention and loop control execute.",
                        "Source-selected minimal Data fields, source summon count/radius and two opaque account IDs are supplied. Complete table inheritance, card/level selection, placement permissions and world construction do not execute.",
                        "Factory allocation and returned lane fields are supplied; levels/buffs, registration, visual scheduling, collision adjustment and optional Y override are skipped. Requested positions are not final collision-resolved body positions.",
                        "Positive supplied factory lanes remain unchanged; nonpositive controls execute the actual origin-lane fallback. This does not recover natural factory lane initialization.",
                        "Four account slots and altered radius/count/lane fields are synthetic controls without inferred game-mode or lifecycle meaning. Raw owner indices alone do not establish native team colors.",
                    ],
                    "blocks": blocks,
                    "cases": cases,
                    "controls": controls,
                },
                indent=2,
            )
            + "\n"
        )
        path = Path("reference/client/group-formation-native-trace.json")
        if env["args"].check:
            if path.read_text() != output:
                raise RuntimeError("Native group-formation capture differs")
        else:
            path.write_text(output)
        print(
            json.dumps(
                {
                    "profiles": len(profiles),
                    "cases": len(cases),
                    "controls": len(controls),
                    "blocks": len(blocks),
                    "children": sum(len(row["children"]) for row in cases + controls),
                }
            )
        )

    return collect, finish
