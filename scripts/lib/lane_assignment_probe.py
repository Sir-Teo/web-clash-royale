"""Execute archived map copying, native lane selection and bounded spawn storage.

CSV parsing/section providers and allocation are supplied. Native map selection,
cell copying/getters, lane search and the actual spawn setter fragment execute.
"""

import csv
import hashlib
import io
import json
import re
import struct
import subprocess
from pathlib import Path
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
    cpu, heap, world, body = [env[k] for k in ["cpu", "heap", "world", "body"]]
    read, write, run, ret = [env[k] for k in ["read", "write", "run", "return_hook"]]
    grid, table, section, rows, cells = [
        heap + x for x in [0x6000, 0x7000, 0x7100, 0x7200, 0x9000]
    ]
    manifest = json.loads(Path("reference/locations/manifest.json").read_text())
    for entry in manifest["files"]:
        if (
            hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
            != entry["sha256"]
        ):
            raise RuntimeError("Lane source hash differs")
    matrix = list(
        csv.reader(io.StringIO(Path("reference/locations/tilemap.csv").read_text()))
    )
    datasets = {}
    for name in ["Map", "MapTeamVsTeam"]:
        start = next(i for i, row in enumerate(matrix) if row[0] == name)
        end = next(
            (i for i in range(start + 1, len(matrix)) if matrix[i][0]), len(matrix)
        )
        datasets[name] = [
            [int(value or 0) for value in row[1:]] for row in matrix[start + 3 : end]
        ]
        if len(datasets[name]) != 64 or any(len(row) != 36 for row in datasets[name]):
            raise RuntimeError("Recheck archived lane map dimensions")
    locations = {
        row["Name"]: row
        for row in csv.DictReader(
            io.StringIO(Path("reference/locations/locations.csv").read_text())
        )
    }
    location_bindings = []
    for name in ["PvP_goblin", "TeamVsTeam_royal"]:
        row = locations[name]
        if row["TileDataFileName"] != "locations/tilemap.csv":
            raise RuntimeError("Recheck archived arena tile-map binding")
        location_bindings.append(
            {"name": name, "tileDataFileName": row["TileDataFileName"]}
        )
    current = "Map"
    strings = {}
    reads = 0
    frame = heap + 0x8000
    fragment = None
    case_point = (0, 0, -1)
    hooks = [
        0x2993A0,
        0x351280,
        0x351200,
        0x352590,
        0x352EE0,
        0x352C30,
        0x298FE0,
        0x55EE0,
        0x55EA0,
        0x205515,
        0x1CAD37,
        0x1CC547,
        0x1CAD5C,
        0x1C96F4,
        0x1C9722,
    ]
    env["allowed"].extend(
        [
            (0x2053D2, 0x205548),
            (0x204C88, 0x204CC8),
            (0x1C9114, 0x1C939A),
            (0x2184A6, 0x2184BC),
            (0x1C96F4, 0x1C9723),
            (0x1CAD37, 0x1CAD5D),
            (0x1CC51A, 0x1CC548),
            (0x1CC581, 0x1CC58A),
            *((a, a + 1) for a in hooks),
        ]
    )

    def hook(_cpu, address, size, data):
        nonlocal reads
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if address == 0x1CAD37:
            if fragment != "dimensions":
                raise RuntimeError("Unexpected dimension fragment")
            cpu.reg_write(UC_X86_REG_EDI, grid)
            cpu.reg_write(UC_X86_REG_EBP, frame)
            write(frame + 8, world)
        elif address == 0x1CC547:
            native_frame = cpu.reg_read(UC_X86_REG_EBP)
            if fragment != "dimensions" or [
                read(native_frame + offset) for offset in [8, 12, 16]
            ] != [world, 36, 64]:
                raise RuntimeError("Unexpected spatial-index boundary")
            # Skip the subsequent spatial-index allocation after the actual stores.
            cpu.reg_write(UC_X86_REG_EIP, 0x1CC581)
        elif address == 0x1CAD5C:
            if fragment != "dimensions":
                raise RuntimeError("Unexpected dimension stop")
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        elif address == 0x1C96F4:
            if fragment != "spawn":
                raise RuntimeError("Unexpected spawn fragment")
            cpu.reg_write(UC_X86_REG_EBP, frame)
            cpu.reg_write(UC_X86_REG_ESI, body)
            write(frame + 8, world)
            write(frame + 0x24, case_point[2])
            write(sp + 0x38, case_point[0])
            write(sp + 0x34, case_point[1])
        elif address == 0x1C9722:
            if fragment != "spawn":
                raise RuntimeError("Unexpected spawn stop")
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        elif address == 0x2993A0:
            dest, literal = read(sp + 4), read(sp + 8)
            text = bytes(cpu.mem_read(literal, 20)).split(b"\0")[0].decode()
            if text != current or read(sp) not in [0x205412, 0x205448]:
                raise RuntimeError(("string", text, current))
            strings[dest] = text
            ret()
        elif address == 0x351280:
            if (
                read(sp + 4) != table
                or strings.get(read(sp + 8)) != current
                or read(sp) not in [0x205422, 0x205454]
            ):
                raise RuntimeError("sectionlookup")
            ret(section)
        elif address == 0x351200:
            if read(sp + 4) != section or read(sp) not in [0x20542A, 0x20545C]:
                raise RuntimeError("tablelookup")
            ret(table)
        elif address in [0x352590, 0x352EE0]:
            if read(sp + 4) != table or read(sp) != (
                0x2054B0 if address == 0x352590 else 0x2054BE
            ):
                raise RuntimeError("dimensions")
            ret(36 if address == 0x352590 else 64)
        elif address == 0x352C30:
            if (
                read(sp + 4) != table
                or not 0 <= read(sp + 8) < 64
                or read(sp) != 0x205502
            ):
                raise RuntimeError("rowlookup")
            ret(rows + 8 * read(sp + 8))
        elif address == 0x205515:
            row = (read(sp) - rows) // 8
            col = read(sp + 4)
            if not 0 <= row < 64 or not 0 <= col < 36 or (read(sp) - rows) % 8:
                raise RuntimeError("cellbounds")
            reads += 1
            cpu.reg_write(UC_X86_REG_EAX, datasets[current][row][col])
            cpu.reg_write(UC_X86_REG_EIP, 0x20551A)
        elif address == 0x298FE0:
            if read(sp + 4) not in strings or read(sp) != 0x20546D:
                raise RuntimeError("stringcleanup")
            ret()
        elif address == 0x55EE0:
            if read(sp + 4) != 36 * 64 * 4 or read(sp) != 0x2054E2:
                raise RuntimeError("allocation")
            ret(cells)
        elif address == 0x55EA0:
            if read(sp + 4) != cells or read(sp) != 0x20549E:
                raise RuntimeError("free")
            ret()

    for address in hooks:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=address, end=address)
    write(grid + 0x64, table)
    write(world + 0x44, grid)
    results = []
    maps = []
    controls = []
    hinted = []
    for mode, current in [(0, "Map"), (1, "MapTeamVsTeam")]:
        reads = 0
        run(0x2053D2, grid, mode, instruction_budget=1000000)
        flat = [v for row in datasets[current] for v in row]
        native_bytes = bytes(cpu.mem_read(cells, 2304 * 4))
        if list(struct.unpack("<2304i", native_bytes)) != flat or reads != 2304:
            raise RuntimeError("Native map copy differs")
        fragment = "dimensions"
        run(0x1CAD37, instruction_budget=1000)
        fragment = None
        if (read(world + 0x88), read(world + 0x8C)) != (36, 64):
            raise RuntimeError("Native world dimensions differ")
        labels = []
        for x in range(36):
            for y in range(64):
                label = run(0x204C88, grid, x, y)
                if label != (datasets[current][y][x] & 3):
                    raise RuntimeError("Native grid lane mask differs")
                if label:
                    labels.append((x, y, label))
        maps.append(
            {
                "section": current,
                "mode": mode,
                "width": 36,
                "height": 64,
                "copiedCells": reads,
                "nativeCellSha256": hashlib.sha256(native_bytes).hexdigest(),
                "laneCells": {
                    str(label): sum(cell[2] == label for cell in labels)
                    for label in [1, 2]
                },
            }
        )

        def sample(x, y, hint=-1):
            nonlocal case_point, fragment
            gx, gy = int(x / 500), int(y / 500)

            def nearest(column):
                return min(
                    labels,
                    key=lambda cell: (cell[0] - column) ** 2 + (cell[1] - gy) ** 2,
                )[2]

            expected = nearest(gx)
            # The hinted path compares nearest lanes at both X coordinates.
            # Crossing the width midpoint may flip an otherwise unchanged lane.
            if hint != -1:
                hx, gx5, middle = (
                    int(hint / 500),
                    int((x + 5) / 500),
                    read(world + 0x88) // 2,
                )
                crossed = (hint < x and hx < middle <= gx5) or (
                    hint > x and hx > middle >= gx5
                )
                if crossed and expected == nearest(hx) and expected in [1, 2]:
                    expected = 3 - expected
            result = run(0x1C9114, world, x, y, hint, instruction_budget=1000000)
            if result != expected:
                raise RuntimeError(
                    json.dumps(
                        {
                            "map": current,
                            "point": [x, y],
                            "hint": hint,
                            "actual": result,
                            "expected": expected,
                        }
                    )
                )
            case_point = (x, y, hint)
            fragment = "spawn"
            write(body + 0x8C, 99)
            run(0x1C96F4, instruction_budget=1000000)
            fragment = None
            stored = read(body + 0x8C)
            if stored != expected:
                raise RuntimeError("Native spawn lane setter differs")
            return {
                "section": current,
                "x": x,
                "y": y,
                "hint": hint,
                "gridX": gx,
                "gridY": gy,
                "selectedLane": result,
                "storedLane": stored,
            }

        for x in [250, 4000, 8999, 9000, 9001, 14000, 17750]:
            for y in [250, 6500, 14999, 15000, 16000, 16999, 17000, 25500, 31750]:
                results.append(sample(x, y))
        for x in [8994, 8995, 8999, 9000, 9494, 9495, 9500]:
            for y in [8000, 16000, 24000]:
                for hint in [0, 8995, 9000, 10000]:
                    hinted.append(sample(x, y, hint))
        # Missing/empty grids and the low-bit extraction remain independent controls.
        write(world + 0x44, 0)
        if run(0x1C9114, world, 9000, 16000, -1) != 0:
            raise RuntimeError("Missing grid lane differs")
        write(world + 0x44, grid)
        write(grid + 0x74, 0)
        if run(0x1C9114, world, 9000, 16000, -1) != 0:
            raise RuntimeError("Empty grid lane differs")
        write(grid + 0x74, 36)
        controls.append(
            {"section": current, "case": "missing-and-empty-grid", "selectedLane": 0}
        )
        original = read(cells)
        for value in [0, 1, 2, 3, 4, 16, 17, 18, 32, 33, 34, 63]:
            write(cells, value)
            result = run(0x204C88, grid, 0, 0)
            if result != value & 3:
                raise RuntimeError("Synthetic lane-mask control differs")
            controls.append(
                {
                    "section": current,
                    "case": "synthetic-cell-mask",
                    "value": value,
                    "selectedLane": result,
                }
            )
        write(cells, original)
    static = [
        (
            "mapLoader",
            0x2053D2,
            0x205548,
            "Actual Map/MapTeamVsTeam choice, dimensions, allocation request and sequential integer cell-copy loop execute. CSV section/cell providers and allocation are controlled.",
        ),
        (
            "gridLaneGetter",
            0x204C88,
            0x204CA8,
            "Reads row-major grid integers and masks the two low lane bits.",
        ),
        (
            "gridDimensions",
            0x204CA8,
            0x204CC8,
            "Actual width/height getters read grid+0x74/+0x78.",
        ),
        (
            "worldGridDimensionCaller",
            0x1CAD2E,
            0x1CAD5C,
            "Retains the actual world grid binding and width/height caller.",
        ),
        (
            "worldDimensionStores",
            0x1CC51A,
            0x1CC547,
            "Actual world dimension stores execute before explicitly skipped spatial-index allocation.",
        ),
        (
            "laneSelector",
            0x1C9114,
            0x1C939A,
            "Actual search quantizes source coordinates by500 and scans positive lane cells. Both absent and supplied nonnegative X hints execute, including midpoint crossing and lane-flip controls.",
        ),
        (
            "spawnLaneCaller",
            0x1C96F4,
            0x1C9722,
            "Actual spawn fragment invokes lane selection and stores its result using supplied caller frame/coordinates and a preallocated body.",
        ),
        (
            "bodyLaneSetter",
            0x2184A6,
            0x2184BC,
            "Actual setter stores the supplied selected lane at body+0x8c.",
        ),
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
                "interpretation": meaning,
                "instructions": instructions,
            }
        )
    paths = [
        "reference/locations/manifest.json",
        "reference/locations/tilemap.csv",
        "reference/locations/locations.csv",
    ]
    output = (
        json.dumps(
            {
                "source": "apk/1.8.1/x86/libg.so",
                "sha256": env["sha"],
                "emulator": "unicorn==2.1.4",
                "instructionBudgets": {
                    "mapLoading": 1000000,
                    "laneAndSpawn": 1000000,
                    "dimensionFragment": 1000,
                    "scalarGetter": 4000,
                },
                "inputs": [
                    {
                        "path": path,
                        "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest(),
                    }
                    for path in paths
                ],
                "limits": [
                    "Actual map-section choice, dimensions, integer copying/getters, lane search, world dimension stores and bounded spawn lane setter execute on supplied minimal memory.",
                    "CSV parsing/section/cell providers, borrowed string operations and allocation/free are controlled. Every loaded integer is compared against the pinned archived source. This does not execute the complete game CSV parser.",
                    "World dimensions use the actual getter/caller/store fragment; subsequent spatial-index allocation and world initialization are explicitly skipped.",
                    "Spawn caller frame, coordinates, optional X hint and preallocated body are supplied. Complete constructors, ownership, registration, deployment and movement do not execute. Natural caller choice and lifecycle of the hint remain outside this matrix.",
                    "Coordinates are source units and the grid spans36x64 half-tile cells. Source LayoutPvp/LayoutTeamVsTeam tower placement is retained in the input but not reconstructed by this lane capture. No application layout or replay rule changes.",
                ],
                "maps": maps,
                "locationBindings": location_bindings,
                "blocks": blocks,
                "cases": results,
                "hintedCases": hinted,
                "controls": controls,
            },
            indent=2,
        )
        + "\n"
    )
    path = Path("reference/client/lane-assignment-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native lane-assignment capture differs")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "maps": len(maps),
                "copiedCells": sum(row["copiedCells"] for row in maps),
                "cases": len(results),
                "hintedCases": len(hinted),
                "controls": len(controls),
                "blocks": len(blocks),
            }
        )
    )
