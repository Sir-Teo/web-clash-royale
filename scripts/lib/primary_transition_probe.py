"""Native primary nominations through actual target-setter effects.

The shared source-class geometry, scanner and setter execute. Candidate arrays,
common eligibility, distant fallback and initial clocks are controlled; complete
world/control/owner state machines, movement and damage remain out of scope.
"""

import hashlib
import json
from pathlib import Path
import re
import subprocess

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX


def capture(env, context):
    cpu, body, data, component = [
        env[key] for key in ["cpu", "body", "data", "component"]
    ]
    read, write, run = [env[key] for key in ["read", "write", "run"]]
    initialize, acquire, predict, active = [
        context[key] for key in ["initialize", "acquire", "predict", "active"]
    ]
    env["allowed"].extend(
        [
            (0x25C3E6, 0x25C4F9),
            (0x25F9BA, 0x25FA0C),
            (0x35D220, 0x35D245),
            (0x35D250, 0x35D281),
            (0x25D4B0, 0x25D6F2),
            (0x1DEC32, 0x1DEC46),
            (0x1DE724, 0x1DE73E),
        ]
    )
    range_results = []

    def range_hook(_cpu, _address, _size, _data):
        range_results.append(bool(cpu.reg_read(UC_X86_REG_EAX) & 0xFF))

    cpu.hook_add(UC_HOOK_CODE, range_hook, begin=0x25D4F6, end=0x25D4F6)
    fields = {
        "elapsedMs": 0xC,
        "reloadMs": 0x10,
        "raw14": 0x14,
        "raw20": 0x20,
        "finishMs": 0x28,
        "lastX": 0x34,
        "lastY": 0x38,
        "raw40": 0x40,
    }

    def state():
        pointer = read(component + 8)
        if pointer != 0 and pointer not in active():
            raise RuntimeError("Primary transition stored an unknown target")
        return {
            "target": active()[pointer]["id"] if pointer else None,
            **{key: read(component + offset) for key, offset in fields.items()},
            "flag1d": cpu.mem_read(component + 0x1D, 1)[0],
        }

    def in_range(owner, candidate, add_radius):
        own = int(owner["CollisionRadius"]) if add_radius else 0
        radius = context["targets"][candidate["name"]]["CollisionRadius"]
        maximum = int(owner["Range"]) + own + radius
        minimum = int(owner["MinimumRange"] or 0)
        inner = abs(minimum + own - radius) if minimum > 0 and add_radius else minimum
        squared = candidate["x"] ** 2 + candidate["y"] ** 2
        return inner**2 <= squared <= maximum**2

    def sample(
        owner,
        label,
        candidates,
        current,
        fallback,
        team,
        add_radius,
        elapsed,
        finish,
        owner_state=2,
    ):
        resolved_clip = initialize(owner, candidates, team, add_radius, current)
        current_pointer = read(component + 8)
        load = int(owner["LoadTime"] or 0)
        interval = int(owner["HitSpeed"])
        if owner["LoadFirstHit"]:
            raise RuntimeError("Recheck actual primary-transition first-load profile")
        write(data + 0x1FC, load)
        write(data + 0x198, interval)
        variable = all(
            int(owner[field] or 0) > 0
            for field in ["VariableDamageTime1", "VariableDamageTime2"]
        )
        cpu.mem_write(data + 0x17D, bytes([int(variable)]))
        cpu.mem_write(data + 0x288, b"\0")
        run(0x25C3E6, component, body)
        if read(component + 4) != body or read(component + 0x10) != 0:
            raise RuntimeError("Unexpected primary-transition constructor")
        write(component + 8, current_pointer)
        write(body + 0x60, owner_state)
        for offset, value in [
            (0xC, elapsed),
            (0x10, max(0, load - 17)),
            (0x14, 131),
            (0x20, 197),
            (0x28, finish),
            (0x34, -37),
            (0x38, 53),
            (0x40, 97),
        ]:
            write(component + offset, value)
        cpu.mem_write(component + 0x1D, b"\1")
        for pointer, candidate in active().items():
            write(pointer + 0xAC, candidate.get("fieldAC", 0))
        before = state()
        range_results.clear()
        result = acquire(fallback)
        after = state()
        nominated, requests, fallback_calls = predict(
            owner, candidates, add_radius, team, owner_state, fallback
        )
        expected_selection = {
            "nominated": nominated,
            "setterRequests": requests,
            "fallbackCalls": fallback_calls,
            "queryCalls": int(owner_state not in [3, 4, 6]),
        }
        if result != expected_selection:
            raise RuntimeError(
                json.dumps(
                    {
                        "owner": owner["Name"],
                        "case": label,
                        "expectedSelection": expected_selection,
                        "actualSelection": result,
                    }
                )
            )
        expected, expected_ranges = dict(before), []
        if requests:
            if len(requests) != 1:
                raise RuntimeError("Unexpected repeated primary transition")
            candidate = next(
                candidate for candidate in candidates if candidate["id"] == requests[0]
            )
            expected["target"] = candidate["id"]
            if candidate["id"] != before["target"]:
                reachable = in_range(owner, candidate, add_radius)
                expected_ranges.append(reachable)
                if not reachable:
                    expected.update(elapsedMs=0, flag1d=0, raw14=0, raw40=0, finishMs=0)
            expected.update(lastX=candidate["x"], lastY=candidate["y"])
        if after != expected or range_results != expected_ranges:
            raise RuntimeError(
                json.dumps(
                    {
                        "owner": owner["Name"],
                        "case": label,
                        "expected": [expected, expected_ranges],
                        "actual": [after, range_results],
                    }
                )
            )
        return {
            "owner": owner["Name"],
            "case": label,
            "teamIndex": team,
            "addOwnRadius": add_radius,
            "ownerState": owner_state,
            "variableDamage": variable,
            "loadTimeMs": load,
            "hitSpeedMs": interval,
            "resolvedSightClip": resolved_clip,
            "candidates": candidates,
            "initialCurrent": current,
            "controlledFallback": fallback,
            "before": before,
            **result,
            "setterRangeResults": list(range_results),
            "after": after,
        }

    cases, controls = [], []
    for name, owner in context["sources"].items():
        for team in [0, 1]:
            front = 1 if team == 0 else -1
            for add_radius in [False, True]:
                own = int(owner["CollisionRadius"]) if add_radius else 0
                near = (
                    5000
                    if int(owner["MinimumRange"] or 0)
                    else max(1, (int(owner["Range"]) + own + 600) * 3 // 5)
                )

                def candidate(id, kind, y, eligible=True, bias=0):
                    return {
                        "id": id,
                        "name": kind,
                        "x": 0,
                        "y": y * front,
                        "eligible": eligible,
                        "fieldAC": bias,
                    }

                distant = candidate("a", "KingTower", 20000)
                nearby = candidate("b", "Cannon", near)
                outside = candidate(
                    "b", "PrincessTower", int(owner["Range"]) + own + 1001
                )
                bias = (near + 100) ** 2 - near**2 + 1
                scenarios = [
                    (
                        "same-target-refresh",
                        [candidate("a", "Cannon", near)],
                        "a",
                        None,
                    ),
                    ("replace-with-in-range", [distant, nearby], "a", None),
                    ("replace-with-out-of-range", [distant, outside], "a", None),
                    ("empty-nearby-preserves-lock", [distant], "a", None),
                    (
                        "ineligible-nearby-preserves-lock",
                        [distant, candidate("b", "Cannon", near, False)],
                        "a",
                        None,
                    ),
                    (
                        "controlled-fallback-replacement",
                        [
                            candidate("a", "KingTower", 21000),
                            candidate("b", "KingTower", 20000),
                        ],
                        "a",
                        "b",
                    ),
                    (
                        "controlled-ineligible-fallback",
                        [distant, candidate("b", "KingTower", 21000, False)],
                        "a",
                        "b",
                    ),
                    (
                        "adjusted-score-replacement",
                        [
                            candidate("a", "Cannon", near),
                            candidate("b", "Cannon", near + 100, bias=bias),
                        ],
                        "a",
                        None,
                    ),
                    (
                        "exact-tie-retains-first",
                        [
                            candidate("a", "Cannon", near),
                            candidate("b", "Cannon", near),
                        ],
                        "a",
                        None,
                    ),
                    ("empty-null-stays-null", [], None, None),
                ]
                for elapsed in [0, int(owner["HitSpeed"]) + 17]:
                    for finish in [0, 123]:
                        for label, candidates, current, fallback in scenarios:
                            for reverse in (
                                [False, True] if len(candidates) > 1 else [False]
                            ):
                                cases.append(
                                    sample(
                                        owner,
                                        label,
                                        (
                                            list(reversed(candidates))
                                            if reverse
                                            else candidates
                                        ),
                                        current,
                                        fallback,
                                        team,
                                        add_radius,
                                        elapsed,
                                        finish,
                                    )
                                )
                if team == 0 and add_radius:
                    for owner_state in [0, 1, 3, 4, 5, 6, 9]:
                        controls.append(
                            sample(
                                owner,
                                "owner-state-control",
                                [distant, nearby],
                                "a",
                                None,
                                team,
                                add_radius,
                                1117,
                                123,
                                owner_state,
                            )
                        )
    paths = [
        "reference/logic/globals.csv",
        "reference/client/sight-target-types-native-trace.json",
        "reference/client/target-switch-native-trace.json",
    ]
    static = [
        (
            "primaryAcquisition",
            0x25DEB6,
            0x25E310,
            "Actual source-class geometry, score ranking, nominee/fallback selection and call into the real setter.",
        ),
        (
            "targetSetter",
            0x25D4B0,
            0x25D6F2,
            "Actual setter pointer/clock/position effects with native attack range and supplied common eligibility.",
        ),
        (
            "attackRange",
            0x25D6F2,
            0x25D75C,
            "Actual maximum/minimum attack geometry executes for each changed non-null target.",
        ),
        (
            "rangeGeometry",
            0x25DDAE,
            0x25DEB6,
            "Source own/target radius and minimum/maximum range helpers.",
        ),
        (
            "constructor",
            0x25C3E6,
            0x25C4F9,
            "Actual attack construction precedes explicit initial target/clock seeds.",
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
                "entryPoint": "0x25deb6",
                "inputs": [
                    *env["inputs"],
                    *[
                        {
                            "path": path,
                            "sha256": hashlib.sha256(
                                Path(path).read_bytes()
                            ).hexdigest(),
                        }
                        for path in paths
                    ],
                ],
                "limits": [
                    "Source-selected minimal class/Data profiles and candidate arrays are supplied; complete CSV inheritance, world registration, spatial indexing and collection order are not emulated.",
                    "Actual attack/base/point construction precedes explicit initial pointer, clocks, flags and finish/raw field seeds. These are scalar controls, not naturally reached combat states.",
                    "Actual primary scanner, score/sight/class/radius getters, target setter, attack range and last-position stores execute together. Common eligibility and distant fallback remain supplied providers.",
                    "Owner/world resolution and broadphase are intercepted. Movement component is absent; movement effects, full owner/control/attack-loop gates, native death/removal and damage do not execute.",
                    "No setter request leaves the seeded lock unchanged. This does not establish that a complete native combat tick retains an ineligible/out-of-sight lock.",
                ],
                "blocks": blocks,
                "cases": cases,
                "controls": controls,
            },
            indent=2,
        )
        + "\n"
    )
    path = Path("reference/client/primary-transition-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native primary-transition capture differs")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "cases": len(cases),
                "controls": len(controls),
                "blocks": len(blocks),
                "setterRequests": sum(
                    len(row["setterRequests"]) for row in cases + controls
                ),
                "rangeChecks": sum(
                    len(row["setterRangeResults"]) for row in cases + controls
                ),
            }
        )
    )
