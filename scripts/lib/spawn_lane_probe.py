"""Execute direct spawn caller argument preparation and the native lane store.

Caller frames, coordinates and opaque factory inputs are supplied; full spawn
geometry, allocation, registration and post-spawn lifecycles do not execute.
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
    UC_X86_REG_EAX,
    UC_X86_REG_EBP,
    UC_X86_REG_EDI,
    UC_X86_REG_EIP,
    UC_X86_REG_ESI,
    UC_X86_REG_ESP,
)


# Every direct call to0x1c959a in the pinned disassembly. These starts are
# instruction boundaries containing the final hint assignment/preparation.
CALLERS = [
    (0x1CCBAB, 0x1CCBDF, "formation-frame-x"),
    (0x212F45, 0x212F5D, "no-hint"),
    (0x2137C9, 0x2137D9, "no-hint"),
    (0x215321, 0x215339, "no-hint"),
    (0x215CA7, 0x215CB7, "no-hint"),
    (0x216708, 0x216720, "no-hint"),
    (0x216ED6, 0x216EEE, "no-hint"),
    (0x217CA7, 0x217CBF, "no-hint"),
    (0x2188C5, 0x2188DD, "no-hint"),
    (0x21E4CD, 0x21E506, "projectile-stack-x"),
    (0x21E626, 0x21E63E, "no-hint"),
    (0x220F73, 0x220F8B, "no-hint"),
    (0x221488, 0x2214A0, "no-hint"),
]


def create_collector(env, grid, store_spawn_lane):
    cpu, heap, world, data = [env[k] for k in ["cpu", "heap", "world", "data"]]
    read, write, run = [env[k] for k in ["read", "write", "run"]]
    frame, opaque_account = heap + 0x8100, heap + 0x7F00
    by_start = {start: (call, kind) for start, call, kind in CALLERS}
    env["allowed"].extend(
        [(start, call + 5) for start, call, _kind in CALLERS] + [(0x1C959A, 0x1C959B)]
    )
    current = None
    prepared = None
    cases = []
    source_rows = list(
        csv.reader(io.StringIO(Path("reference/locations/tilemap.csv").read_text()))
    )

    def hook(_cpu, address, _size, _data):
        nonlocal prepared
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if current is None:
            raise RuntimeError("Unexpected spawn caller boundary")
        if address in by_start:
            call, kind = by_start[address]
            if call != current["call"] or kind != current["kind"]:
                raise RuntimeError("Spawn caller start differs")
            # Existing caller arguments are controlled. A sentinel distinguishes
            # the actual final hint write from this supplied argument buffer.
            arguments = [
                world,
                data,
                current["x"],
                current["y"],
                opaque_account,
                0,
                0,
                991,
            ]
            for index, value in enumerate(arguments):
                write(sp + 4 * index, value)
            cpu.reg_write(UC_X86_REG_EBP, frame)
            if kind == "formation-frame-x":
                write(frame + 8, world)
                write(frame + 0x14, current["originX"])
                write(frame + 0x20, opaque_account)
                write(sp + 0x50, current["x"])
                cpu.reg_write(UC_X86_REG_ESI, data)
                cpu.reg_write(UC_X86_REG_EDI, current["y"])
            elif kind == "projectile-stack-x":
                write(frame + 8, heap + 0x7E00)
                write(sp + 0x74, world)
                write(sp + 0x78, data)
                write(sp + 0x84, current["originX"])
                cpu.reg_write(UC_X86_REG_EAX, opaque_account)
                cpu.reg_write(UC_X86_REG_ESI, current["x"])
                cpu.reg_write(UC_X86_REG_EDI, current["y"])
        elif address == 0x1C959A:
            if read(sp) != current["call"] + 5:
                raise RuntimeError("Unexpected spawn call return address")
            args = [read(sp + 4 * index) for index in range(1, 9)]
            expected_hint = -1 if current["kind"] == "no-hint" else current["originX"]
            if (
                args[:5] != [world, data, current["x"], current["y"], opaque_account]
                or args[7] != expected_hint
            ):
                raise RuntimeError(
                    json.dumps(
                        {
                            "caller": hex(current["call"]),
                            "arguments": args,
                            "expectedHint": expected_hint,
                        }
                    )
                )
            prepared = {
                "x": args[2],
                "y": args[3],
                "hint": args[7],
                "argument6": args[5],
                "argument7": args[6],
            }
            # Factory entry is a boundary. The captured arguments are then
            # passed to the separately executing bounded lane-store fragment.
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])

    for address in [*by_start, 0x1C959A]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=address, end=address)

    def collect(_mode, map_name):
        nonlocal current, prepared
        start = next(i for i, row in enumerate(source_rows) if row[0] == map_name)
        end = next(
            (i for i in range(start + 1, len(source_rows)) if source_rows[i][0]),
            len(source_rows),
        )
        cells = [
            [int(value or 0) & 3 for value in row[1:]]
            for row in source_rows[start + 3 : end]
        ]
        labels = [
            (x, y, value)
            for x in range(36)
            for y in range(64)
            if (value := cells[y][x])
        ]
        if not all(cells[y][35 - x] == 3 - value for x, y, value in labels) or not all(
            (value == 1 and x < 18) or (value == 2 and x >= 18)
            for x, _y, value in labels
        ):
            raise RuntimeError("Source lane mirror/half-plane reduction differs")

        def predict(x, y, hint):
            gx, gy = int(x / 500), int(y / 500)
            nearest = lambda column: min(
                labels, key=lambda cell: (cell[0] - column) ** 2 + (cell[1] - gy) ** 2
            )[2]
            result = nearest(gx)
            if hint != -1:
                hx, gx5 = int(hint / 500), int((x + 5) / 500)
                crossed = (hint < x and hx < 18 <= gx5) or (hint > x and hx > 18 >= gx5)
                if crossed and result == nearest(hx):
                    result = 3 - result
            return result

        for start, call, kind in CALLERS:
            points = (
                [(8995, 16000, 4000)]
                if kind == "no-hint"
                else [
                    (origin + offset, y, origin)
                    for origin in [4000, 9000, 10000]
                    for offset in [-500, -5, 0, 5, 500]
                    for y in [8000, 16000]
                ]
            )
            for x, y, origin in points:
                current = {
                    "call": call,
                    "kind": kind,
                    "x": x,
                    "y": y,
                    "originX": origin,
                }
                prepared = None
                run(start, instruction_budget=1000)
                if prepared is None:
                    raise RuntimeError("Native caller did not enter the spawn boundary")
                actual = store_spawn_lane(
                    prepared["x"], prepared["y"], prepared["hint"]
                )
                expected = predict(prepared["x"], prepared["y"], prepared["hint"])
                if actual != expected:
                    raise RuntimeError(
                        "Native caller-hint lane differs from independent grid prediction"
                    )
                cases.append(
                    {
                        "mapSection": map_name,
                        "caller": hex(call),
                        "start": hex(start),
                        "binding": kind,
                        "suppliedOriginX": origin,
                        "prepared": prepared,
                        "storedLane": actual,
                    }
                )
        current = None

    def finish(maps):
        assembly = subprocess.check_output(
            ["objdump", "-d", "-Mintel", str(env["args"].library)], text=True
        )
        direct = {
            int(match.group(1), 16)
            for match in re.finditer(
                r"^\s*([0-9a-f]+):[^\n]*\bcall\s+1c959a\b", assembly, re.M
            )
        }
        if direct != {call for _start, call, _kind in CALLERS}:
            raise RuntimeError("Pinned direct spawn caller inventory differs")
        blocks = []
        for start, call, kind in CALLERS:
            block = subprocess.check_output(
                [
                    "objdump",
                    "-d",
                    "-Mintel",
                    f"--start-address={start:#x}",
                    f"--stop-address={call+5:#x}",
                    str(env["args"].library),
                ],
                text=True,
            )
            instructions = [
                re.sub(r"\s+<[^>]+>", "", line.strip())
                for line in block.splitlines()
                if re.match(r"\s+[0-9a-f]+:", line)
            ]
            blocks.append(
                {
                    "name": f"spawnCaller_{call:x}",
                    "start": hex(start),
                    "end": hex(call + 5),
                    "binding": kind,
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
                        "Actual final argument preparation executes at all thirteen direct calls to the pinned spawn function. Eleven write hint=-1; formation frame+0x14 and projectile local+0x84 supply an X hint.",
                        "Caller frames, origin/spawn coordinates, source Data/world/account pointers and existing argument buffers are supplied. Geometry, random formation offsets, complete caller methods and factory allocation do not execute. No indirect caller inventory is claimed.",
                        "Captured coordinate/hint values are passed to the actual bounded native lane-selector/store fragment. Full constructor clamping, world registration, ownership, levels, hint lifecycle and subsequent field mutation remain outside scope.",
                        "Both archived maps load through the retained native copy path. Mirror/half-plane source label checks support a compact nearest-lane reduction; the full native selector remains the executed authority.",
                    ],
                    "maps": maps,
                    "directCallerCount": len(CALLERS),
                    "blocks": blocks,
                    "cases": cases,
                },
                indent=2,
            )
            + "\n"
        )
        path = Path("reference/client/spawn-lane-native-trace.json")
        if env["args"].check:
            if path.read_text() != output:
                raise RuntimeError("Native spawn-lane capture differs")
        else:
            path.write_text(output)
        print(
            json.dumps(
                {
                    "directCallers": len(CALLERS),
                    "cases": len(cases),
                    "blocks": len(blocks),
                }
            )
        )

    return collect, finish
