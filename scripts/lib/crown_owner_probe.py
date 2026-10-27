"""Execute native King owner selection after source coordinate placement.

The caller frame, allocated body, world dimension object and King classification
are supplied. Actual height threshold, Y getter, ordinal/side branches, occupied
slot checks, owner setter and world slot stores execute. Duplicate diagnostics
and the subsequent source-identity verification/presentation are boundaries.
"""

import hashlib
import json
from pathlib import Path
import re
import subprocess

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import (
    UC_X86_REG_EBP,
    UC_X86_REG_EIP,
    UC_X86_REG_ESI,
    UC_X86_REG_ESP,
)


def create_collector(env):
    cpu, heap, world = [env[key] for key in ["cpu", "heap", "world"]]
    read, write, run = [env[key] for key in ["read", "write", "run"]]
    frame, dimensions, body = [heap + value for value in [0xA000, 0xA100, 0xA200]]
    env["allowed"].extend(
        [
            (0x1C8D9C, 0x1C8DBC),
            (0x1C8E28, 0x1C8EEF),
            (0x1C8F21, 0x1C8F32),
            (0x21999C, 0x2199AF),
            (0x219B06, 0x219B16),
        ]
    )
    current = None
    reports = []
    cases, controls = [], []

    def hook(_cpu, address, _size, _data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if current is None:
            raise RuntimeError("Unexpected King ownership fragment")
        if address == 0x1C8D9C:
            cpu.reg_write(UC_X86_REG_EBP, frame)
            cpu.reg_write(UC_X86_REG_ESI, body)
            write(frame + 8, world)
            write(sp + 0x24, current["ordinal"])
        elif address == 0x1C8DBB:
            # The source caller's King classification is supplied. Do not run
            # its orientation/component lookup or global source-identity check.
            cpu.reg_write(UC_X86_REG_EIP, 0x1C8E28)
        elif address in [0x1C8E4D, 0x1C8EA7]:
            reports.append(
                "occupiedPrimary" if address == 0x1C8E4D else "occupiedSecondary"
            )
            cpu.reg_write(UC_X86_REG_EIP, 0x1C8F31)
        elif address in [0x1C8EEE, 0x1C8F31]:
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])

    for address in [0x1C8D9C, 0x1C8DBB, 0x1C8E4D, 0x1C8EA7, 0x1C8EEE, 0x1C8F31]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=address, end=address)

    def sample(point, ordinal, accounts, occupied=False, height=64):
        nonlocal current, reports
        current = {"ordinal": ordinal}
        reports = []
        previous_dimension = read(world + 4)
        write(world + 4, dimensions)
        write(dimensions + 4, height)
        write(world + 0x1C, accounts)
        before = [0x123400 + index if occupied else 0 for index in range(4)]
        for index, value in enumerate(before):
            write(world + 0x50 + index * 4, value)
        write(body + 0x20, point["x"])
        write(body + 0x24, point["y"])
        write(body + 0x1C, -7)
        try:
            run(0x1C8D9C)
            actual = {
                "ownerIndex": read(body + 0x1C),
                "worldSlots": [read(world + 0x50 + index * 4) for index in range(4)],
                "reports": reports.copy(),
            }
        finally:
            write(world + 4, previous_dimension)
        side = int(point["y"] >= height * 250)
        owner = side + (2 if ordinal > 1 else 0)
        expected_slots = before.copy()
        if not occupied:
            expected_slots[owner] = body
        expected = {
            "ownerIndex": -7 if occupied else owner,
            "worldSlots": expected_slots,
            "reports": (
                [("occupiedSecondary" if ordinal > 1 else "occupiedPrimary")]
                if occupied
                else []
            ),
        }
        if actual != expected:
            raise RuntimeError(
                json.dumps(
                    {
                        "input": current,
                        "point": point,
                        "actual": actual,
                        "expected": expected,
                    }
                )
            )
        current = None
        return {
            "nativePoint": point,
            "providedKingOrdinal": ordinal,
            "providedAccountCount": accounts,
            "providedGridHeight": height,
            "providedOccupiedSlots": occupied,
            "expectedOwnerIndex": owner,
            **actual,
        }

    def collect(source, ordinal, accounts):
        cases.append(
            {
                "section": source["section"],
                "mapSection": source["mapSection"],
                "sourceCharacter": source["sourceCharacter"],
                **sample(source["nativePoint"], ordinal, accounts),
            }
        )

    def finish():
        for accounts in [2, 4]:
            for ordinal in range(4):
                for y in [15999, 16000, 16001]:
                    controls.append(
                        {
                            "kind": "midpointAndOrdinal",
                            **sample({"x": 9000, "y": y}, ordinal, accounts),
                        }
                    )
        for ordinal in range(4):
            for y in [3000, 29000]:
                controls.append(
                    {
                        "kind": "occupiedSlot",
                        **sample({"x": 9000, "y": y}, ordinal, 4, True),
                    }
                )
        for height in [62, 66]:
            for y in [height * 250 - 1, height * 250, height * 250 + 1]:
                controls.append(
                    {
                        "kind": "syntheticHeight",
                        **sample({"x": 9000, "y": y}, 0, 2, height=height),
                    }
                )
        if len(cases) != 6 or [row["ownerIndex"] for row in cases] != [
            0,
            1,
            0,
            1,
            2,
            3,
        ]:
            raise RuntimeError("Recheck source King owner inventory")
        static = [
            (
                "heightAndY",
                0x1C8D9C,
                0x1C8DBB,
                "Actual supplied-grid height times 500 divided by two and native Y getter; component orientation and King classification are skipped.",
            ),
            (
                "kingSlotSelection",
                0x1C8E28,
                0x1C8EEE,
                "Actual ordinal and Y-side selection, occupied-slot checks, primary world slot and owner writes. Diagnostic string/report calls are intercepted.",
            ),
            (
                "secondaryOwnerStore",
                0x1C8F21,
                0x1C8F31,
                "Actual secondary slot and owner setter call. The source-identity verification between these instruction blocks is skipped.",
            ),
            (
                "ownerSetter",
                0x21999C,
                0x2199AF,
                "Actual owner-index store at body+0x1c.",
            ),
            ("yGetter", 0x219B06, 0x219B16, "Actual Y-coordinate getter at body+0x24."),
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
        paths = [
            "reference/locations/manifest.json",
            "reference/locations/tilemap.csv",
            "reference/client/tower-layout-native-trace.json",
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
                        "Source KingTower placements first execute the retained coordinate capture. This continuation receives a supplied allocated body, caller ordinal, world dimension object and King classification.",
                        "Actual native height threshold, Y getter, ordinal/side selection, occupied-slot checks, world slots and owner setter execute. Natural world initialization, classification, account construction and Princess ownership are not recovered.",
                        "Duplicate diagnostic requests are counted without running string/report effects; subsequent global source-identity verification, registration, levels, orientation and presentation are skipped.",
                        "The two-player source King at Y3000 receives owner0 and Y29000 receives owner1. Browser red/top and blue/bottom use these physical halves; native color artwork/account presentation is not asserted.",
                        "Four-player cases retain source King owners0/1/2/3; KingTowerMiddle and complete team-game roles remain outside this capture. Synthetic ordinals, heights and occupied slots are controls, not claims about naturally constructed worlds.",
                    ],
                    "blocks": blocks,
                    "cases": cases,
                    "controls": controls,
                },
                indent=2,
            )
            + "\n"
        )
        path = Path("reference/client/crown-owner-native-trace.json")
        if env["args"].check:
            if path.read_text() != output:
                raise RuntimeError("Native King ownership capture differs")
        else:
            path.write_text(output)
        print(
            json.dumps(
                {
                    "sourceKings": len(cases),
                    "controls": len(controls),
                    "diagnosticRequests": sum(len(row["reports"]) for row in controls),
                    "blocks": len(blocks),
                }
            )
        )

    return collect, finish
