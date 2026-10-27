"""Native layout choice and Crown coordinate stores with explicit row/factory providers."""

import csv
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import (
    UC_X86_REG_EAX,
    UC_X86_REG_EBP,
    UC_X86_REG_EIP,
    UC_X86_REG_ESP,
)


def create_collector(env, grid, section, selected_sections):
    cpu, heap, body, data, world = [
        env[k] for k in ["cpu", "heap", "body", "data", "world"]
    ]
    read, write, run, ret = [env[k] for k in ["read", "write", "run", "return_hook"]]
    frame, row_handle = heap + 0x8100, heap + 0x8200
    env["allowed"].extend(
        [
            (0x2055BA, 0x205630),
            (0x1C8D28, 0x1C8D8C),
            (0x219AAE, 0x219AE2),
            (0x219AF6, 0x219B16),
            (0x21A528, 0x21A529),
        ]
    )
    point = None
    cell_reads = []
    rows = list(
        csv.reader(io.StringIO(Path("reference/locations/tilemap.csv").read_text()))
    )
    cases = []

    def hook(_cpu, address, _size, _data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if point is None:
            raise RuntimeError("Unexpected Crown layout fragment")
        if address == 0x1C8D28:
            cpu.reg_write(UC_X86_REG_EAX, row_handle)
            cpu.reg_write(UC_X86_REG_EBP, frame)
            write(frame + 8, world)
            write(sp + 0x2C, data)
        elif address in [0x1C8D35, 0x1C8D4F]:
            column = 0 if address == 0x1C8D35 else 1
            if [read(sp), read(sp + 4)] != [row_handle, column]:
                raise RuntimeError("Unexpected Crown CSV coordinate provider")
            cell_reads.append(column)
            cpu.reg_write(UC_X86_REG_EAX, point[column])
            cpu.reg_write(UC_X86_REG_EIP, 0x1C8D3A if column == 0 else 0x1C8D54)
        elif address == 0x21A528:
            if [read(sp), read(sp + 4)] != [0x1C8D6A, data]:
                raise RuntimeError("Unexpected supplied Crown factory")
            ret(body)
        elif address == 0x1C8D8B:
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])

    for address in [0x1C8D28, 0x1C8D35, 0x1C8D4F, 0x21A528, 0x1C8D8B]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=address, end=address)

    def collect(mode, map_name):
        nonlocal point, cell_reads
        expected_section = "LayoutPvp" if mode == 0 else "LayoutTeamVsTeam"
        result = run(0x2055BA, grid, mode)
        if result != section or selected_sections[-1] != expected_section:
            raise RuntimeError("Native Crown layout selection differs")
        start = next(i for i, row in enumerate(rows) if row[0] == expected_section)
        end = next((i for i in range(start + 1, len(rows)) if rows[i][0]), len(rows))
        kind = None
        for row in rows[start + 1 : end]:
            if row[1]:
                kind = row[1]
                continue
            if not row[2] or row[2] in ["x", "int"]:
                continue
            point = (int(row[2]), int(row[3]))
            cell_reads = []
            write(body + 0x20, 0x7FFFFFFF)
            write(body + 0x24, 0x7FFFFFFF)
            run(0x1C8D28, instruction_budget=4000)
            x, y = run(0x219AF6, body), run(0x219B06, body)
            if (x, y) != (point[0] * 500, point[1] * 500) or cell_reads != [0, 1]:
                raise RuntimeError("Native Crown coordinate scaling/store differs")
            if [read(body + offset) for offset in [0x28, 0x2C]] != [x, y]:
                raise RuntimeError("Native first-position history differs")
            cases.append(
                {
                    "section": expected_section,
                    "mapSection": map_name,
                    "sourceCharacter": kind,
                    "gridPoint": {"x": point[0], "y": point[1]},
                    "nativePoint": {"x": x, "y": y},
                    "sourceUnitsPerCell": 500,
                    "cellReads": cell_reads.copy(),
                    "firstPositionHistory": {
                        "x": read(body + 0x28),
                        "y": read(body + 0x2C),
                    },
                }
            )
        point = None

    def finish(maps):
        if len(cases) != 16 or sum(row["section"] == "LayoutPvp" for row in cases) != 6:
            raise RuntimeError("Recheck native Crown layout source inventory")
        static = [
            (
                "layoutSectionSelection",
                0x2055BA,
                0x205630,
                "Actual mode0/1 selects LayoutPvp/LayoutTeamVsTeam through the supplied pinned CSV section provider.",
            ),
            (
                "layoutLoopCaller",
                0x1C8C9A,
                0x1C8D28,
                "Static loop binding branches on account count>3 and obtains the selected source character group/coordinate row. Full world construction and ownership are not emulated.",
            ),
            (
                "coordinateAndPositionCaller",
                0x1C8D28,
                0x1C8D8B,
                "Actual two source integer reads, 500-unit scaling, supplied factory-body return and native position setter execute.",
            ),
            (
                "positionSetter",
                0x219AAE,
                0x219AE2,
                "Stores current coordinates and initializes previous coordinates when the supplied initial-X sentinel is MAX_INT.",
            ),
            (
                "coordinateGetters",
                0x219AF6,
                0x219B16,
                "Actual X/Y getters return body+0x20/+0x24.",
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
            "reference/client/lane-assignment-native-trace.json",
        ]
        output = (
            json.dumps(
                {
                    "source": "apk/1.8.1/x86/libg.so",
                    "sha256": env["sha"],
                    "emulator": "unicorn==2.1.4",
                    "inputs": [
                        {
                            "path": path,
                            "sha256": hashlib.sha256(
                                Path(path).read_bytes()
                            ).hexdigest(),
                        }
                        for path in paths
                    ],
                    "limits": [
                        "Actual layout section choice, integer coordinate scaling, position storage/history and coordinate getters execute on supplied minimal objects. Both source maps are loaded by the separately retained native grid-copy path.",
                        "CSV parsing, section/row/cell providers and factory allocation are controlled. Source character names identify archived placement rows; full native factory/class/health construction and source inheritance do not execute.",
                        "The position fragment receives a supplied caller frame and a preallocated body with a MAX_INT initial-position sentinel. Full world initialization, owner assignment, registration, levels and movement remain outside scope.",
                        "Source LayoutTeamVsTeam contains extra KingTower and KingTowerMiddle rows; their natural object roles/lifecycle are not inferred from placement alone. Browser tower IDs, positions, art and replay rules remain unchanged.",
                    ],
                    "maps": maps,
                    "blocks": blocks,
                    "cases": cases,
                },
                indent=2,
            )
            + "\n"
        )
        path = Path("reference/client/tower-layout-native-trace.json")
        if env["args"].check:
            if path.read_text() != output:
                raise RuntimeError("Native Crown layout capture differs")
        else:
            path.write_text(output)
        print(
            json.dumps(
                {
                    "cases": len(cases),
                    "pvpCrowns": 6,
                    "teamLayoutBodies": 10,
                    "blocks": len(blocks),
                }
            )
        )

    return collect, finish
