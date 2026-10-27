"""Execute native building masks, column bounds and ground child Y clamps.

Minimal source Data/vtables, ordered world collection and table providers are
supplied. No whole-world construction, natural removal or placement UI runs.
"""

import csv
import hashlib
import io
import json
import math
from pathlib import Path
import re
import subprocess

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import (
    UC_X86_REG_EAX,
    UC_X86_REG_EBP,
    UC_X86_REG_EDI,
    UC_X86_REG_EIP,
    UC_X86_REG_ESI,
    UC_X86_REG_ESP,
)


def capture(env):
    cpu, heap, body, data, world = [
        env[key] for key in ["cpu", "heap", "body", "data", "world"]
    ]
    read, write, run, ret = [
        env[key] for key in ["read", "write", "run", "return_hook"]
    ]
    controller, manager, collection, pointers, mask, output, frame = [
        heap + value
        for value in [0x5000, 0x6000, 0x6100, 0x6200, 0x6500, 0x6800, 0x6900]
    ]
    paths = [
        "reference/logic/buildings.csv",
        "reference/logic/characters.csv",
        "reference/logic/spells_characters.csv",
        "reference/client/tower-layout-native-trace.json",
        "reference/client/crown-owner-native-trace.json",
    ]
    blobs = [Path(path).read_bytes() for path in paths]
    buildings, characters, spells = [
        {row["Name"]: row for row in csv.DictReader(io.StringIO(blob.decode()))}
        for blob in blobs[:3]
    ]
    layout, owners = [json.loads(blob) for blob in blobs[3:]]
    if any(trace["sha256"] != env["sha"] for trace in [layout, owners]):
        raise RuntimeError("Placement source uses another native binary")
    profiles = {
        name: {**(buildings if name in buildings else characters)[name]}
        for name in ["KingTower", "PrincessTower", "Cannon", "Knight"]
    }
    profile_data = {
        name: heap + 0x9000 + index * 0x1000 for index, name in enumerate(profiles)
    }
    current, table_reads, masks, clamps = None, [], [], []
    allowed = [
        (0x221C44, 0x221E4D),
        (0x223A96, 0x223D2D),
        (0x20AC28, 0x20AC7C),
        (0x21984A, 0x219884),
        (0x2198D8, 0x21991F),
        (0x21AF26, 0x21AF36),
        (0x1C939A, 0x1C93AD),
        (0x1C9576, 0x1C9589),
        (0x1C8ABA, 0x1C8AFA),
        (0x2199C8, 0x219A03),
        (0x21A92A, 0x21A937),
        (0x218C24, 0x218C33),
        (0x219D5E, 0x219DA2),
        (0x219DAE, 0x219DC6),
        (0x25FF56, 0x25FF6D),
        (0x1DD6D0, 0x1DD6EA),
        (0x1DE220, 0x1DE24A),
        (0x1DDBBC, 0x1DDBCC),
        (0x1DE984, 0x1DE9B9),
        (0x1DEB8E, 0x1DEBF6),
        (0x219B26, 0x219B36),
        (0x35BD10, 0x35BDB0),
        (0x202838, 0x202849),
        (0x1C9ABE, 0x1C9ACE),
        (0x1CCB79, 0x1CCBAC),
        (0x1DE69A, 0x1DE6B4),
    ]
    hooks = [
        0x55EE0,
        0x55EA0,
        0x1E9964,
        0x1DEBB7,
        0x1DEBEB,
        0x1CCB79,
        0x1CCBAB,
        0x223A96,
        0x221D4C,
    ]
    env["allowed"].extend([*allowed, *((address, address + 1) for address in hooks)])

    def hook(_cpu, address, _size, _data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if current is None:
            raise RuntimeError("Unexpected placement capture call")
        if address == 0x55EE0:
            if read(sp) != 0x221CB1 or read(sp + 4) != 576:
                raise RuntimeError("Unexpected placement mask allocation")
            ret(mask)
        elif address == 0x55EA0:
            if read(sp) != 0x221E45 or read(sp + 4) != mask:
                raise RuntimeError("Unexpected placement mask free")
            ret()
        elif address == 0x1E9964:
            ret(profile_data["KingTower"])
        elif address in [0x1DEBB7, 0x1DEBEB]:
            handle = read(sp)
            name = next(
                (
                    name
                    for name, pointer in profile_data.items()
                    if pointer + 0x500 == handle
                ),
                None,
            )
            field = "NoDeploySizeW" if address == 0x1DEBB7 else "NoDeploySizeH"
            if name is None:
                raise RuntimeError("Unexpected placement source row handle")
            value = int(profiles[name][field] or 0)
            table_reads.append({"source": name, "field": field, "value": value})
            cpu.reg_write(UC_X86_REG_EAX, value)
            cpu.reg_write(UC_X86_REG_EIP, address + 5)
        elif address == 0x223A96:
            args = [read(sp + offset) for offset in range(4, 32, 4)]
            if args[:3] != [controller, 18, 32] or args[4:] != [
                int(current["owner"] % 2 == 0),
                int(current["canEnemy"]),
                int(current["excludeDeploy"]),
            ]:
                raise RuntimeError("Unexpected mask generator binding")
            if read(args[3]) != mask:
                raise RuntimeError("Unexpected mask vector")
        elif address == 0x221D4C:
            if current.get("maskOverride") is not None:
                cpu.mem_write(mask, current["maskOverride"])
            masks.append(bytes(cpu.mem_read(mask, 576)))
        elif address == 0x1CCB79:
            cpu.reg_write(UC_X86_REG_EBP, frame)
            cpu.reg_write(UC_X86_REG_ESI, data)
            write(frame + 0x34, output if current["useBounds"] else 0)
            write(sp + 0x54, current["y"])
        elif address == 0x1CCBAB:
            clamps.append(cpu.reg_read(UC_X86_REG_EDI))
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])

    for address in hooks:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=address, end=address)

    def initialize(entries, owner, can_enemy, accounts=2):
        cpu.mem_write(heap, b"\0" * 0x10000)
        write(world + 0x88, 36)
        write(world + 0x8C, 64)
        write(world + 0x1C, accounts)
        write(manager + 0x28, world)
        write(manager + 0x2C, controller)
        write(world + 0x24, collection)
        write(controller + 0x24, collection)
        write(controller + 0x78, world)
        write(collection, pointers)
        write(collection + 8, len(entries))
        write(body + 0x14, manager)
        write(body + 0x1C, owner)
        cpu.mem_write(data + 0x72, bytes([int(can_enemy)]))
        for name, pointer in profile_data.items():
            row = profiles[name]
            write(pointer + 8, pointer + 0x500)
            for offset, field in [
                (0x190, "Speed"),
                (0x22C, "CollisionRadius"),
                (0x230, "TileSizeOverride"),
            ]:
                write(pointer + offset, int(row[field] or 0))
        for index, entry in enumerate(entries):
            pointer = heap + 0x7000 + index * 0x180
            write(pointers + index * 4, pointer)
            write(pointer, 0x7B34A0)
            write(pointer + 0x10, profile_data[entry["source"]])
            write(pointer + 0x14, manager)
            write(pointer + 0x1C, entry["owner"])
            write(pointer + 0x20, entry["x"])
            write(pointer + 0x24, entry["y"])
            if entry.get("inactive"):
                cpu.mem_write(pointer + 0x38, b"\x04")
                write(pointer + 0x44, pointer + 0x100)
                write(pointer + 0x108, 0)

    def expected_mask(entries, owner, can_enemy, accounts, exclude):
        result = bytearray(b"\1" * 576)
        for entry in entries:
            row = profiles[entry["source"]]
            king = entry["source"] == "KingTower"
            immobile = not int(row["Speed"] or 0)
            width = int(row["NoDeploySizeW"] or 0)
            if (
                entry.get("inactive")
                or not (immobile or king)
                or (exclude and (immobile or king or width > 0))
            ):
                continue
            if not can_enemy and entry["owner"] % 2 != owner % 2 and width > 0:
                height = int(row["NoDeploySizeH"] or 0)
                if accounts >= 4 and king:
                    width *= 2
            else:
                width = (
                    int(row["TileSizeOverride"] or 0)
                    or (int(row["CollisionRadius"]) + 499) // 500 + 1
                )
                height = width
            left, right = [
                math.trunc((entry["x"] + sign * width * 500) / 1000) for sign in [-1, 1]
            ]
            top, bottom = [
                math.trunc((entry["y"] + sign * height * 500) / 1000)
                for sign in [-1, 1]
            ]
            for y in range(max(0, top), min(32, bottom)):
                for x in range(max(0, left), min(18, right)):
                    result[y * 18 + x] = 0
        return bytes(result)

    def sample(
        entries, owner, x, can_enemy=False, accounts=2, exclude=False, column_rows=None
    ):
        nonlocal current, table_reads, masks
        current = {"owner": owner, "canEnemy": can_enemy, "excludeDeploy": exclude}
        if column_rows is not None:
            current["maskOverride"] = bytes(
                int(row in column_rows) for row in range(32) for _column in range(18)
            )
        table_reads, masks = [], []
        initialize(entries, owner, can_enemy, accounts)
        # The normal bound caller supplies excludeDeploy=false. A separate direct
        # mask invocation below retains the nonzero control without spoofing it.
        if exclude:
            vector = output + 0x20
            write(vector, mask)
            cpu.mem_write(mask, b"\1" * 576)
            run(
                0x223A96,
                controller,
                18,
                32,
                vector,
                int(owner % 2 == 0),
                int(can_enemy),
                1,
                instruction_budget=500000,
            )
            actual_mask = bytes(cpu.mem_read(mask, 576))
            bounds = None
        else:
            run(0x221C44, body, x, 0, output, data, instruction_budget=500000)
            actual_mask = masks[-1]
            bounds = [read(output), read(output + 4)]
        expected = current.get(
            "maskOverride", expected_mask(entries, owner, can_enemy, accounts, exclude)
        )
        if actual_mask != expected:
            differences = [
                index
                for index, (a, b) in enumerate(zip(actual_mask, expected))
                if a != b
            ]
            raise RuntimeError(
                json.dumps(
                    {
                        "maskDifferences": differences[:20],
                        "current": current,
                        "entries": entries,
                    }
                )
            )
        allowed_rows = [
            row for row in range(32) if expected[row * 18 + math.trunc(x / 1000)]
        ]
        expected_bounds = [-2147483648, 2147483647]
        if allowed_rows:
            lo = allowed_rows[0] * 1000 + (499 if owner % 2 else 0)
            hi = allowed_rows[-1] * 1000 + (0 if owner % 2 else 500)
            if hi - lo < 16000:
                expected_bounds = [lo, hi]
        if not exclude and bounds != expected_bounds:
            raise RuntimeError(
                json.dumps(
                    {
                        "actualBounds": bounds,
                        "expectedBounds": expected_bounds,
                        "x": x,
                        "current": current,
                    }
                )
            )
        current = None
        return {
            "ownerIndex": owner,
            "sourceX": x,
            "canDeployOnEnemySide": can_enemy,
            "providedAccountCount": accounts,
            "excludeDeployControl": exclude,
            **({"providedMaskRows": column_rows} if column_rows is not None else {}),
            "entries": entries,
            "blockedCells": sum(not value for value in actual_mask),
            "maskSha256": hashlib.sha256(actual_mask).hexdigest(),
            "allowedColumnRows": allowed_rows,
            "bounds": bounds,
            "tableReads": table_reads.copy(),
        }

    pvp = []
    for point in layout["cases"]:
        if point["section"] != "LayoutPvp":
            continue
        pvp.append(
            {
                "source": point["sourceCharacter"],
                "owner": int(point["nativePoint"]["y"] >= 16000),
                **point["nativePoint"],
            }
        )
    cases, controls = [], []
    for name, entries in [
        ("allCrowns", pvp),
        (
            "upperLeftPrincessGone",
            [
                entry
                for entry in pvp
                if not (
                    entry["source"] == "PrincessTower"
                    and entry["owner"] == 0
                    and entry["x"] < 9000
                )
            ],
        ),
        (
            "upperPrincessesGone",
            [
                entry
                for entry in pvp
                if not (entry["source"] == "PrincessTower" and entry["owner"] == 0)
            ],
        ),
        ("kingsOnly", [entry for entry in pvp if entry["source"] == "KingTower"]),
        ("empty", []),
    ]:
        for owner in [0, 1]:
            for x in [500, 3500, 8500, 9000, 14500, 17500]:
                cases.append({"scenario": name, **sample(entries, owner, x)})
    for owner in [0, 1, 2, 3]:
        for x in [999, 1000, 8999, 9000, 17999]:
            controls.append({"kind": "enemySideAllowed", **sample(pvp, owner, x, True)})
    for entry in [
        {"source": "Cannon", "owner": 0, "x": 4500, "y": 12000},
        {"source": "Knight", "owner": 0, "x": 4500, "y": 12000},
        {**pvp[1], "inactive": True},
    ]:
        for owner in [0, 1]:
            controls.append({"kind": "classOrInactive", **sample([entry], owner, 4500)})
    for owner in [0, 1]:
        controls.append(
            {"kind": "excludedBuildings", **sample(pvp, owner, 3500, exclude=True)}
        )
        controls.append(
            {"kind": "fourAccounts", **sample(pvp, owner, 9000, accounts=4)}
        )
    for owner in [0, 1]:
        for column_rows in [
            [],
            list(range(16)),
            list(range(17)),
            list(range(18)),
            [0, 15],
        ]:
            controls.append(
                {
                    "kind": "suppliedColumnSpan",
                    **sample([], owner, 9000, column_rows=column_rows),
                }
            )
    clamp_cases = []
    for bounds in [[0, 14500], [17499, 31000], [-2147483648, 2147483647]]:
        for flying in [-1, 0, 1, int(characters["Bat"]["FlyingHeight"])]:
            for use in [False, True]:
                for y in [
                    bounds[0] - 1 if bounds[0] > -2147483648 else -100,
                    14500,
                    16000,
                    17499,
                    bounds[1] + 1 if bounds[1] < 2147483647 else 32100,
                ]:
                    current = {"y": y, "useBounds": use}
                    clamps = []
                    write(output, bounds[0])
                    write(output + 4, bounds[1])
                    write(data + 0x13C, flying)
                    run(0x1CCB79)
                    actual = clamps[-1]
                    if actual >= 2147483648:
                        actual -= 4294967296
                    expected = (
                        min(bounds[1], max(bounds[0], y)) if use and flying <= 0 else y
                    )
                    if actual != expected:
                        raise RuntimeError("Native optional ground Y clamp differs")
                    clamp_cases.append(
                        {
                            "bounds": bounds,
                            "flyingHeight": flying,
                            "hasBounds": use,
                            "requestedY": y,
                            "resultY": actual,
                        }
                    )
    current = None
    static = [
        (
            "ordinaryCallerBoundsBinding",
            0x220E08,
            0x220E39,
            "Static point construction and call to column bounds.",
        ),
        (
            "ordinaryGroupBoundArgument",
            0x220E89,
            0x220EFD,
            "Static normal group call supplies the computed bound vector, second character and summon radius.",
        ),
        (
            "columnBounds",
            0x221C44,
            0x221E4D,
            "Actual world dimensions, owner parity, mask construction, column scan, edge offsets and span fallback execute.",
        ),
        (
            "buildingMask",
            0x223A96,
            0x223D2D,
            "Actual ordered body collection, targetability/class/data/owner gates and bounded rectangle writes execute.",
        ),
        (
            "noDeployColumnBindings",
            0x1DD30A,
            0x1DD3B0,
            "Static source NoDeploySizeW/H names resolve into the native getter column globals.",
        ),
        (
            "noDeployGetters",
            0x1DEB8E,
            0x1DEBF6,
            "Native getter bodies execute around supplied source integer table-call results.",
        ),
        (
            "enemySideGetter",
            0x202838,
            0x202849,
            "Actual source-selected spell Data+0x72 getter.",
        ),
        (
            "enemySideSourceBinding",
            0x2019F9,
            0x201A57,
            "Static CanDeployOnEnemySide source loader binding.",
        ),
        (
            "enemySideDataStore",
            0x200B0B,
            0x200B20,
            "Static use of the same source column global stores the boolean at spell Data+0x72.",
        ),
        (
            "physicalTileSize",
            0x1DE984,
            0x1DE9B9,
            "Actual explicit TileSizeOverride or collision-radius-derived footprint getter.",
        ),
        (
            "groundChildClamp",
            0x1CCB79,
            0x1CCBAB,
            "Actual optional-bound pointer, flying-height gate and integer clamp execute.",
        ),
        ("flyingHeightGate", 0x1DE69A, 0x1DE6B4, "Actual positive FlyingHeight test."),
    ]
    blocks = []
    for name, start, end, meaning in static:
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
        blocks.append(
            {
                "name": name,
                "start": hex(start),
                "end": hex(end),
                "interpretation": meaning,
                "instructions": [
                    re.sub(r"\s+<[^>]+>", "", line.strip())
                    for line in assembly.splitlines()
                    if re.match(r"\s+[0-9a-f]+:", line)
                ],
            }
        )
    result = {
        "source": "apk/1.8.1/x86/libg.so",
        "sha256": env["sha"],
        "emulator": "unicorn==2.1.4",
        "inputs": [
            {"path": path, "sha256": hashlib.sha256(blob).hexdigest()}
            for path, blob in zip(paths, blobs)
        ],
        "sourceSpellEnemySideFlags": {
            name: row["CanDeployOnEnemySide"].lower() == "true"
            for name, row in spells.items()
            if row["Name"] and row["Name"] != "string"
        },
        "limits": [
            "Minimal source Data/vtables, allocated arrays, ordered body collection, manager/world pointers, body coordinates/owners and source integer table results are supplied. Complete world construction, native health/removal and inheritance do not execute.",
            "Actual mask traversal, targetability/class/data/owner gates, integer footprints, rectangle writes, column bounds, optional flying gate and clamp execute. Global King identity is supplied. Native table getter column indices are unresolved; table call sites supply pinned NoDeploy source values.",
            "Normal caller-to-group argument bindings are statically retained. Column bounds and child clamp execute separately; the full spell caller, factory allocation/collision/registration and placement UI do not.",
            "Destroyed/missing Crown collections are supplied scenarios. Account parity for Princess rows follows source physical halves but natural Princess ownership construction is outside scope. Alternate owner counts and excludeDeploy are explicit controls.",
            "Supplied column-row masks bypass only the mask-generator result to test empty, discontiguous and half-arena-span fallback boundaries. They are explicit synthetic controls; ordinary cases execute the actual source building masks.",
            "Masks start true and mark source building rectangles false. This captures this helper's contract, not complete card placement permissions, river geometry or pathfinding. No application gameplay changes are made.",
        ],
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
        "clamps": clamp_cases,
    }
    path = Path("reference/client/placement-bounds-native-trace.json")
    encoded = json.dumps(result, indent=2) + "\n"
    if env["args"].check:
        if path.read_text() != encoded:
            raise RuntimeError("Native placement bounds capture differs")
    else:
        path.write_text(encoded)
    print(
        json.dumps(
            {
                "cases": len(cases),
                "controls": len(controls),
                "clamps": len(clamp_cases),
                "blocks": len(blocks),
            }
        )
    )
