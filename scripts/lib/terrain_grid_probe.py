"""Native terrain flags and bounded non-water point repair on both source maps.

The shared lane collector executes map loading/copying and world dimensions.
This continuation executes actual grid predicates and the point helper, without
full movement, collision, caller gates or pathfinding state construction.
"""

import csv
import hashlib
import io
import json
import math
from pathlib import Path
import re
import subprocess


def create_collector(env, grid):
    cpu, world = [env[key] for key in ["cpu", "world"]]
    read, write, run = [env[key] for key in ["read", "write", "run"]]
    env["allowed"].extend(
        [
            (0x204CC8, 0x204D80),
            (0x1C93AE, 0x1C9576),
            (0x35BD10, 0x35BDA2),
            (0x35C990, 0x35CA5D),
        ]
    )
    if env["args"].position_repair:
        from lib.position_repair_probe import create_collector

        return create_collector(env, grid)
    rows = list(
        csv.reader(io.StringIO(Path("reference/locations/tilemap.csv").read_text()))
    )
    outputs, cases, controls = [], [], []

    def predicates(x, y, option):
        return {
            "passable": bool(run(0x204CC8, grid, x, y, option)),
            "water": bool(run(0x204D06, grid, x, y)),
            "specialBlocked": bool(run(0x204D2C, grid, x, y)),
        }

    def expected_predicate(value, option):
        return {
            "passable": not bool(value & 32)
            and (bool(option) or not bool(value & (16 | 64))),
            "water": bool(value & 32),
            "specialBlocked": bool(value & (16 | 64)),
        }

    def collect(_mode, name):
        start = next(i for i, row in enumerate(rows) if row[0] == name)
        end = next((i for i in range(start + 1, len(rows)) if rows[i][0]), len(rows))
        matrix = [
            [int(value or 0) for value in row[1:]] for row in rows[start + 3 : end]
        ]
        cells = read(grid + 0x70)
        flat = [value for row in matrix for value in row]
        encoded = {
            key: [] for key in ["passable", "passableOption", "water", "specialBlocked"]
        }
        for y in range(64):
            strings = {key: "" for key in encoded}
            for x in range(36):
                actual = predicates(x, y, 0)
                option = bool(run(0x204CC8, grid, x, y, 1))
                if (
                    actual != expected_predicate(matrix[y][x], 0)
                    or option != expected_predicate(matrix[y][x], 1)["passable"]
                ):
                    raise RuntimeError("Native terrain predicates differ")
                for key, value in {**actual, "passableOption": option}.items():
                    strings[key] += str(int(value))
            for key in encoded:
                encoded[key].append(strings[key])
        outputs.append(
            {
                "section": name,
                "width": 36,
                "height": 64,
                **encoded,
                "counts": {
                    key: sum(row.count("1") for row in value)
                    for key, value in encoded.items()
                },
            }
        )
        original = read(cells)
        for value in range(128):
            write(cells, value)
            for option in [0, 1]:
                actual = predicates(0, 0, option)
                if actual != expected_predicate(value, option):
                    raise RuntimeError("Synthetic terrain bit control differs")
                controls.append(
                    {
                        "kind": "providedCellBits",
                        "section": name,
                        "value": value,
                        "option": option,
                        **actual,
                    }
                )
        write(cells, original)

        def expected_point(x, y):
            x = max(250, min(17750, x))
            y = max(250, min(31750, y))
            original = {"x": x, "y": y}
            if not flat[math.trunc(y / 500) * 36 + math.trunc(x / 500)] & 32:
                return original, 0, False
            best = 2147483647
            result = original
            queries = 0
            outside = False
            for dy in range(-2250, 2251, 500):
                for dx in range(-2250, 2251, 500):
                    cx, cy = x + dx, y + dy
                    gx, gy = math.trunc(cx / 500), math.trunc(cy / 500)
                    outside |= not (0 <= gx < 36 and 0 <= gy < 64)
                    index = gy * 36 + gx
                    if not 0 <= index < len(flat):
                        raise RuntimeError(
                            "Point oracle escaped supplied source allocation"
                        )
                    queries += 1
                    if flat[index] & 32:
                        continue
                    distance = max(abs(dx), abs(dy)) + min(abs(dx), abs(dy)) * 53 // 128
                    if distance < best:
                        best = distance
                        result = {"x": cx, "y": cy}
            return result, queries, outside

        def sample(x, y, kind):
            expected, queries, outside = expected_point(x, y)
            raw = run(0x1C93AE, world, x, y, instruction_budget=200000)
            packed = ((expected["y"] << 16) | expected["x"]) & 0xFFFFFFFF
            if raw != packed:
                raise RuntimeError(
                    json.dumps(
                        {
                            "section": name,
                            "input": [x, y],
                            "expected": expected,
                            "expectedPacked": packed,
                            "actualPacked": raw,
                        }
                    )
                )
            py = raw >> 16
            if py >= 32768:
                py -= 65536
            target = cases if kind == "sourceRiverAndBridge" else controls
            target.append(
                {
                    "kind": kind,
                    "section": name,
                    "input": {"x": x, "y": y},
                    "nativePoint": {"x": raw & 65535, "y": py},
                    "packed": raw,
                    "oracleCandidatePoint": expected,
                    "candidateQueries": queries,
                    "linearReadsOutsideColumns": outside,
                }
            )

        for x in [
            250,
            500,
            2500,
            2750,
            3000,
            3500,
            4000,
            4250,
            4500,
            8750,
            9000,
            13750,
            14000,
            14500,
            15000,
            15250,
            15500,
            17500,
            17750,
        ]:
            for y in [
                14500,
                14750,
                14999,
                15000,
                15250,
                15500,
                15750,
                16000,
                16250,
                16500,
                16750,
                16999,
                17000,
                17250,
                17500,
            ]:
                sample(x, y, "sourceRiverAndBridge")
        for x, y in [
            (-1000, -1000),
            (0, 0),
            (100, 100),
            (18000, 32000),
            (20000, 35000),
            (-1000, 16000),
            (20000, 16000),
            (9000, -1000),
            (9000, 35000),
        ]:
            sample(x, y, "outsideArenaInput")
        # A fully blocked local neighborhood retains its initial clamped point.
        saved = bytes(cpu.mem_read(cells, 36 * 64 * 4))
        for index in range(36 * 64):
            write(cells + index * 4, 32)
        x, y = 9000, 16000
        raw = run(0x1C93AE, world, x, y, instruction_budget=200000)
        if raw != ((y << 16) | x):
            raise RuntimeError("Native all-water fallback differs")
        controls.append(
            {
                "kind": "providedAllWater",
                "section": name,
                "input": {"x": x, "y": y},
                "packed": raw,
                "nativePoint": {"x": raw & 65535, "y": raw >> 16},
            }
        )
        cpu.mem_write(cells, saved)

    def finish(maps):
        static = [
            (
                "passability",
                0x204CC8,
                0x204D05,
                "Actual bit32 veto, optional bit16/64 gate and supplied fourth argument.",
            ),
            ("water", 0x204D06, 0x204D2B, "Actual bit32 predicate."),
            ("specialBlocked", 0x204D2C, 0x204D60, "Actual bit16/64 predicate."),
            (
                "coordinateRepair",
                0x1C93AE,
                0x1C9576,
                "Actual quarter-cell arena clamp, water check, ordered ten-by-ten candidate scan, distance minimum and packed return.",
            ),
            (
                "approximateDistance",
                0x35C990,
                0x35CA5D,
                "Actual max plus floor53min/128 metric.",
            ),
            (
                "sourceCallerA",
                0x213514,
                0x213549,
                "Static world/coordinate call and unsigned-low/signed-high decode; full caller state/gates do not execute.",
            ),
            (
                "sourceCallerB",
                0x215936,
                0x21599C,
                "Static world/position-getter binding, decode and setter arguments; full caller state/gates do not execute.",
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
        paths = [
            "reference/locations/manifest.json",
            "reference/locations/tilemap.csv",
            "reference/client/lane-assignment-native-trace.json",
        ]
        result = {
            "source": "apk/1.8.1/x86/libg.so",
            "sha256": env["sha"],
            "emulator": "unicorn==2.1.4",
            "inputs": [
                {
                    "path": path,
                    "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest(),
                }
                for path in paths
            ],
            "limits": [
                "Actual native map loading/copying and world dimensions execute through the retained shared collector. CSV providers and allocation are supplied; all copied integers and lane-mask reads are checked.",
                "Actual terrain predicates and bounded coordinate helper execute. The fourth passability argument is supplied as0/1; its complete natural caller meaning is not inferred.",
                "Coordinate repair receives supplied world/coordinates, clamps to quarter-cell arena bounds, checks water, searches ten-by-ten half-cell offsets and returns packed16-bit coordinates. Full movement/pathfinding/collision and natural caller gates are outside scope.",
                "Candidate grid reads have no explicit per-column bounds check in this helper. Linear allocation reads that wrap across source row edges are retained and labeled; no broader arena legality is inferred.",
                "Synthetic cell bits0..127, all-water maps and out-of-arena inputs are controls. Full owner/air/Hog/knockback/deployment state construction and artwork alignment remain outside scope. No application rule changes are made.",
            ],
            "maps": maps,
            "terrain": outputs,
            "blocks": blocks,
            "cases": cases,
            "controls": controls,
        }
        path = Path("reference/client/terrain-grid-native-trace.json")
        output = json.dumps(result, indent=2) + "\n"
        if env["args"].check:
            if path.read_text() != output:
                raise RuntimeError("Native terrain-grid capture differs")
        else:
            path.write_text(output)
        print(
            json.dumps(
                {
                    "maps": len(outputs),
                    "predicateResults": len(outputs) * 36 * 64 * 4,
                    "cases": len(cases),
                    "controls": len(controls),
                    "blocks": len(blocks),
                }
            )
        )

    return collect, finish
