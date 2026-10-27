"""Execute a bounded body position check/repair/store caller on source maps.

Body allocation, manager/level references and caller frame are supplied. Outer
owner/class/control state and the rest of the enclosing update do not execute.
"""

import hashlib
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


def create_collector(env, grid):
    cpu, heap, world, body = [env[k] for k in ["cpu", "heap", "world", "body"]]
    read, write, run = [env[k] for k in ["read", "write", "run"]]
    frame, manager, level = [heap + x for x in [0xE100, 0xE200, 0xE300]]
    trace_path = "reference/client/terrain-grid-native-trace.json"
    trace_bytes = Path(trace_path).read_bytes()
    trace = json.loads(trace_bytes)
    if trace["sha256"] != env["sha"]:
        raise RuntimeError("Position repair input uses another binary")
    for entry in trace["inputs"]:
        if (
            hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
            != entry["sha256"]
        ):
            raise RuntimeError("Position repair source differs")
    env["allowed"].extend(
        [
            (0x2158EA, 0x21599D),
            (0x21984A, 0x219874),
            (0x21AF26, 0x21AF36),
            (0x23BDFE, 0x23BEA2),
            (0x219AF6, 0x219B16),
            (0x219AAE, 0x219AE2),
        ]
    )
    current = None
    events = []
    cases = []
    controls = []

    def hook(_cpu, address, _size, _data):
        if current is None:
            return
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if address == 0x2158EA:
            cpu.reg_write(UC_X86_REG_EBP, frame)
            write(frame + 8, body)
            write(sp + 0x64, 0x12345)
        elif address == 0x21592E:
            events.append(
                {
                    "kind": "blockedPredicate",
                    "result": bool(cpu.reg_read(UC_X86_REG_EAX)),
                }
            )
        elif address == 0x1C93AE:
            args = [read(sp + i) for i in [4, 8, 12]]
            if args != [world, current["x"], current["y"]]:
                raise RuntimeError("Position repair helper arguments differ")
            events.append({"kind": "repairRequest", "x": args[1], "y": args[2]})
        elif address == 0x219AAE:
            args = [read(sp + i) for i in [4, 8, 12, 16]]
            if args[0] != body or args[3] != 0:
                raise RuntimeError("Position repair setter arguments differ")
            events.append(
                {"kind": "positionStore", "x": args[1], "y": args[2], "flag": args[3]}
            )
        elif address == 0x21599C:
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])

    for address in [0x2158EA, 0x21592E, 0x1C93AE, 0x219AAE, 0x21599C]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=address, end=address)

    def collect(_mode, name):
        nonlocal current, events
        terrain = next(t for t in trace["terrain"] if t["section"] == name)
        witnesses = {
            tuple(r["input"].values()): r
            for r in [*trace["cases"], *trace["controls"]]
            if r["section"] == name
            and r["kind"] in ["sourceRiverAndBridge", "outsideArenaInput"]
        }
        previous_level = read(world + 4)
        write(world + 4, level)
        write(level, 36)
        write(level + 4, 64)
        write(level + 12, grid)
        write(manager + 0x28, world)
        write(body + 0x14, manager)

        def blocked(x, y, bits=None):
            if x < 0 or y < 0 or x >= 18000 or y >= 32000:
                return True
            if bits is not None:
                return bool(bits & (16 | 32 | 64))
            return terrain["passable"][y // 500][x // 500] == "0"

        def sample(x, y, kind, bits=None):
            nonlocal current, events
            current = {"x": x, "y": y}
            events = []
            write(body + 0x20, x)
            write(body + 0x24, y)
            write(body + 0x28, 1234)
            write(body + 0x2C, 5678)
            is_blocked = blocked(x, y, bits)
            if not is_blocked:
                expected = {"x": x, "y": y}
            elif bits is not None:
                expected = {"x": 8750, "y": 7750} if bits & 32 else {"x": x, "y": y}
            elif (x, y) in witnesses:
                expected = witnesses[(x, y)]["nativePoint"]
            else:
                expected = {"x": max(250, min(17750, x)), "y": max(250, min(31750, y))}
                gx, gy = expected["x"] // 500, expected["y"] // 500
                if terrain["water"][gy][gx] == "1":
                    raise RuntimeError(
                        "New repair oracle needs a retained water witness"
                    )
            run(0x2158EA, instruction_budget=250000)
            actual = {"x": read(body + 0x20), "y": read(body + 0x24)}
            expected_events = [{"kind": "blockedPredicate", "result": is_blocked}]
            if is_blocked:
                expected_events.extend(
                    [
                        {"kind": "repairRequest", "x": x, "y": y},
                        {"kind": "positionStore", **expected, "flag": 0},
                    ]
                )
            history = {"x": read(body + 0x28), "y": read(body + 0x2C)}
            expected_history = (
                expected if x == 2147483647 and is_blocked else {"x": 1234, "y": 5678}
            )
            if (
                actual != expected
                or events != expected_events
                or history != expected_history
            ):
                raise RuntimeError(
                    json.dumps(
                        {
                            "section": name,
                            "input": current,
                            "bits": bits,
                            "actual": actual,
                            "expected": expected,
                            "events": events,
                            "expectedEvents": expected_events,
                            "history": history,
                            "expectedHistory": expected_history,
                        }
                    )
                )
            record = {
                "kind": kind,
                "section": name,
                "input": current.copy(),
                "blocked": is_blocked,
                "point": actual,
                "history": history,
                "events": events.copy(),
            }
            if bits is not None:
                record["providedCellBits"] = bits
            (cases if kind == "sourceRiverAndBridge" else controls).append(record)
            current = None

        for x in [250, 3500, 9000, 14500, 17750]:
            for y in [14500, 15000, 15750, 16000, 17000, 17500]:
                sample(x, y, "sourceRiverAndBridge")
        for witness in trace["controls"]:
            if witness["section"] == name and witness["kind"] == "outsideArenaInput":
                sample(
                    witness["input"]["x"], witness["input"]["y"], "outsideArenaInput"
                )
        for x, y in [
            (100, 8000),
            (17900, 8000),
            (9000, 100),
            (9000, 31900),
            (2147483647, 8000),
            (9000, 2147483647),
        ]:
            sample(x, y, "conditionalClampAndHistory")
        cells = read(grid + 0x70)
        cell = cells + (16 * 36 + 18) * 4
        original = read(cell)
        for value in range(128):
            write(cell, value)
            actual = bool(run(0x23BDFE, level, 9000, 8000))
            if actual != bool(value & (16 | 32 | 64)):
                raise RuntimeError("Native position predicate bit matrix differs")
            controls.append(
                {
                    "kind": "providedPredicateBits",
                    "section": name,
                    "providedCellBits": value,
                    "blocked": actual,
                }
            )
        for value in [0, 1, 2, 16, 32, 64, 48, 96, 80, 127]:
            write(cell, value)
            sample(9000, 8000, "providedPipelineBits", value)
        write(cell, original)
        write(world + 4, previous_level)

    def finish(maps):
        static = [
            (
                "callerPipeline",
                0x2158EA,
                0x21599C,
                "Actual world/level reference, position getters, blocked predicate, conditional repair, packed decode and real position store execute. Earlier caller state and subsequent source predicate/update are excluded.",
            ),
            (
                "blockedPredicate",
                0x23BDFE,
                0x23BEA2,
                "Actual arena bounds and source special/water predicates execute.",
            ),
            (
                "worldReference",
                0x21984A,
                0x219874,
                "Actual body manager/world reference getter.",
            ),
            ("managerWorld", 0x21AF26, 0x21AF36, "Actual manager+0x28 world getter."),
            ("positionGetters", 0x219AF6, 0x219B16, "Actual current X/Y getters."),
            (
                "positionSetter",
                0x219AAE,
                0x219AE2,
                "Actual current position stores and MAX_INT initial-X history handling.",
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
        result = {
            "source": "apk/1.8.1/x86/libg.so",
            "sha256": env["sha"],
            "emulator": "unicorn==2.1.4",
            "inputs": [
                {"path": trace_path, "sha256": hashlib.sha256(trace_bytes).hexdigest()}
            ],
            "limits": [
                "Both source maps load through the native shared collector. Allocated body, manager/world/level references and caller frame are supplied; the full enclosing character update and its earlier state/class/air/control gates do not execute.",
                "Actual bounds/special/water predicate, conditional coordinate repair, packed decode, position setter and history stores execute. Body position and first-history fields are supplied as explicit states.",
                "The helper runs only for blocked/out-of-arena points. Interior nonblocked points need not receive its quarter-cell clamp. The synthetic opaque caller local is not assigned gameplay meaning.",
                "Retained helper witnesses supply expected water-point results; a separate source bit/arena calculation supplies the caller predicate. All source terrain input hashes are validated.",
                "Unusual packed edge results are preserved, not repaired. Synthetic cell bits and MAX_INT history controls do not establish naturally reachable units. Complete movement/pathfinding, collision, flying/Hog/knockback lifecycle and surrounding caller behavior remain outside scope. No gameplay change is made.",
            ],
            "maps": maps,
            "blocks": blocks,
            "cases": cases,
            "controls": controls,
        }
        path = Path("reference/client/position-repair-native-trace.json")
        output = json.dumps(result, indent=2) + "\n"
        if env["args"].check:
            if path.read_text() != output:
                raise RuntimeError("Native position repair pipeline differs")
        else:
            path.write_text(output)
        print(
            json.dumps(
                {
                    "cases": len(cases),
                    "controls": len(controls),
                    "predicateQueries": len(cases) + len(controls),
                    "repairCalls": sum(
                        any(e["kind"] == "repairRequest" for e in r.get("events", []))
                        for r in [*cases, *controls]
                    ),
                    "blocks": len(blocks),
                }
            )
        )

    return collect, finish
