"""Native target-setter transitions with explicit clock/state seeds.

Range and eligibility results are supplied; actual setter branches, source
getters, coordinate stores and movement-notification dispatch execute. Complete
world state, damage/death and notification effects remain outside this capture.
"""

import hashlib
import json
from pathlib import Path
import re
import subprocess

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP


def capture(env, context):
    cpu, heap, body, data, component = [
        env[key] for key in ["cpu", "heap", "body", "data", "component"]
    ]
    read, write, run, initialize, return_hook = [
        env[key] for key in ["read", "write", "run", "initialize", "return_hook"]
    ]
    target_a, target_b = context["target_a"], context["target_b"]
    movement = heap + 0xE000
    notifications, assertions = [], []
    env["allowed"].extend(
        [
            (0x25C3E6, 0x25C4F9),
            (0x25F9BA, 0x25FA0C),
            (0x35D220, 0x35D245),
            (0x35D250, 0x35D281),
            (0x25D6A5, 0x25D6F2),
            (0x261050, 0x261051),
            (0x356B50, 0x356B51),
        ]
    )
    assertion_text = (
        bytes(cpu.mem_read(0x7B8A14 - 0x1984A0, 160)).split(b"\0")[0].decode()
    )

    if assertion_text != "Not a valid target":
        raise RuntimeError("Unexpected setter assertion text")

    def hook(_cpu, address, _size, _data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if address == 0x261050:
            if read(sp) != 0x25D67D or read(sp + 4) != movement:
                raise RuntimeError("Unexpected setter movement-notification context")
            notifications.append("movement-dispatch")
            return_hook()
        elif address == 0x356B50:
            if read(sp) != 0x25D65B or read(sp + 4) != 0x7B8A14 - 0x1984A0:
                raise RuntimeError("Unexpected setter eligibility assertion")
            assertions.append(assertion_text)
            return_hook()

    for address in [0x261050, 0x356B50]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=address, end=address)

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
    coordinates = {"a": {"x": 3500, "y": 6500}, "b": {"x": 14500, "y": 25500}}
    pointers = {None: 0, "a": target_a, "b": target_b}

    def state():
        target = read(component + 8)
        if target not in pointers.values():
            raise RuntimeError("Unexpected stored setter target")
        return {
            "target": next(key for key, value in pointers.items() if value == target),
            **{name: read(component + offset) for name, offset in fields.items()},
            "flag1d": cpu.mem_read(component + 0x1D, 1)[0],
        }

    def predict(
        before,
        requested,
        in_range,
        first_load,
        variable,
        load,
        interval,
        stop_after,
        owner_state,
        has_movement,
        eligible,
    ):
        result = {**before, "target": requested}
        changed = before["target"] != requested
        expected_assertions, expected_reset = 0, 0
        if changed:
            if requested is not None and not in_range:
                if first_load:
                    if before["elapsedMs"] != 0:
                        result.update(
                            elapsedMs=0,
                            flag1d=0,
                            reloadMs=load - before["elapsedMs"] % interval,
                        )
                else:
                    result.update(elapsedMs=0, flag1d=0, raw40=0, raw14=0, finishMs=0)
            elif requested is None:
                if first_load or variable:
                    result.update(elapsedMs=0, flag1d=0, raw40=0, raw14=0, finishMs=0)
                    if first_load:
                        result["reloadMs"] = load
                elif stop_after > 0 and owner_state != 9:
                    result["raw20"] = 0
                    expected_reset = 1
            if requested is not None and not eligible:
                expected_assertions = 1
        if requested is not None:
            result.update(
                lastX=coordinates[requested]["x"], lastY=coordinates[requested]["y"]
            )
        expected_movement = int(changed and result["finishMs"] == 0 and has_movement)
        return result, expected_movement, expected_assertions, expected_reset

    def sample(
        table,
        name,
        label,
        previous,
        requested,
        in_range,
        elapsed,
        finish,
        first_load=False,
        owner_state=2,
        movement_mode="present",
        eligible=True,
        stop_override=None,
    ):
        source = env["rows"][f"reference/logic/{table}.csv"][name]
        load = int(source["LoadTime"] or 0)
        interval = int(source["HitSpeed"])
        variable = all(
            int(source[field] or 0) > 0
            for field in ["VariableDamageTime1", "VariableDamageTime2"]
        )
        stop_after = (
            int(source["StopTimeAfterAttack"] or 0)
            if stop_override is None
            else stop_override
        )
        initialize({**source, "LoadTime": str(load)})
        cpu.mem_write(data + 0x17D, bytes([int(variable)]))
        cpu.mem_write(data + 0x288, bytes([int(first_load)]))
        write(data + 0x1C4, stop_after)
        write(body + 0x60, owner_state)
        run(0x25C3E6, component, body)
        if read(component + 4) != body or read(component + 0x10) != (
            load if first_load else 0
        ):
            raise RuntimeError("Unexpected setter-profile constructor")
        for target, point in [
            (target_a, coordinates["a"]),
            (target_b, coordinates["b"]),
        ]:
            write(target + 0x20, point["x"])
            write(target + 0x24, point["y"])
        write(body + 0x38, 8 if movement_mode == "flag-clear" else 10)
        write(body + 0x40, 0 if movement_mode == "null-pointer" else movement)
        write(component + 8, pointers[previous])
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
        context["constants"][0x25D6F2] = int(in_range)
        context["constants"][0x25D7C2] = int(eligible)
        notifications.clear()
        assertions.clear()
        context["calls"].clear()
        before = state()
        reset_before = env["reset_calls"]
        run(0x25D4B0, component, pointers[requested], instruction_budget=4000)
        after = state()
        actual_reset = env["reset_calls"] - reset_before
        expected = predict(
            before,
            requested,
            in_range,
            first_load,
            variable,
            load,
            interval,
            stop_after,
            owner_state,
            movement_mode == "present",
            eligible,
        )
        observed = (after, len(notifications), len(assertions), actual_reset)
        if observed != expected:
            raise RuntimeError(
                json.dumps(
                    {
                        "owner": name,
                        "case": label,
                        "expected": expected,
                        "actual": observed,
                    }
                )
            )
        changed = previous != requested
        expected_calls = {}
        if changed and requested is not None:
            expected_calls["0x25d6f2"] = 1
            expected_calls["0x25d7c2"] = 1
            if not in_range:
                expected_calls["0x25fa9c"] = 1
        if changed and after["finishMs"] == 0:
            expected_calls["0x25fa2a"] = 1
        if context["calls"] != expected_calls:
            raise RuntimeError(
                json.dumps(
                    {
                        "owner": name,
                        "case": label,
                        "expectedCalls": expected_calls,
                        "actualCalls": context["calls"],
                    }
                )
            )
        return {
            "sourceTable": table,
            "sourceName": name,
            "case": label,
            "sourceLoadFirstHit": source["LoadFirstHit"].lower() == "true",
            "loadFirstHit": first_load,
            "syntheticFirstLoad": first_load,
            "variableDamage": variable,
            "loadTimeMs": load,
            "hitSpeedMs": interval,
            "stopTimeAfterAttack": stop_after,
            "syntheticStopTime": stop_override is not None,
            "ownerState": owner_state,
            "movement": movement_mode,
            "requested": requested,
            "suppliedInRange": in_range,
            "suppliedEligible": eligible,
            "before": before,
            "after": after,
            "movementNotifications": len(notifications),
            "ownerResetNotifications": actual_reset,
            "assertions": list(assertions),
            "interceptCalls": dict(sorted(context["calls"].items())),
        }

    names = {
        "characters": [
            "Knight",
            "Archer",
            "Musketeer",
            "Giant",
            "HogRider",
            "Balloon",
            "Prince",
            "InfernoDragon",
            "ElectroWizard",
        ],
        "buildings": ["Cannon", "Mortar", "InfernoTower", "KingTower", "PrincessTower"],
    }
    scenarios = [
        ("same-target", "a", "a", True),
        ("same-null", None, None, True),
        ("assign-in-range", None, "b", True),
        ("replace-in-range", "a", "b", True),
        ("assign-out-of-range", None, "b", False),
        ("replace-out-of-range", "a", "b", False),
        ("clear-target", "a", None, True),
    ]
    cases, controls = [], []
    for table, source_names in names.items():
        for name in source_names:
            source = env["rows"][f"reference/logic/{table}.csv"][name]
            if source["LoadFirstHit"] or source["StopTimeAfterAttack"]:
                raise RuntimeError("Recheck actual setter source profile")
            interval = int(source["HitSpeed"])
            for first_load in [False, True]:
                for elapsed in [0, interval - 1, interval + 1]:
                    for finish in [0, 123]:
                        for label, previous, requested, in_range in scenarios:
                            cases.append(
                                sample(
                                    table,
                                    name,
                                    label,
                                    previous,
                                    requested,
                                    in_range,
                                    elapsed,
                                    finish,
                                    first_load,
                                )
                            )
    for owner_state in [2, 9]:
        for finish in [0, 123]:
            controls.append(
                sample(
                    "characters",
                    "Knight",
                    "synthetic-stop-time",
                    "a",
                    None,
                    True,
                    1117,
                    finish,
                    owner_state=owner_state,
                    stop_override=250,
                )
            )
    for mode in ["flag-clear", "null-pointer"]:
        for requested in [None, "b"]:
            controls.append(
                sample(
                    "characters",
                    "Knight",
                    "missing-movement",
                    "a",
                    requested,
                    True,
                    1117,
                    0,
                    movement_mode=mode,
                )
            )
    for previous in [None, "a", "b"]:
        controls.append(
            sample(
                "characters",
                "Knight",
                "supplied-ineligible",
                previous,
                "b",
                True,
                1117,
                0,
                eligible=False,
            )
        )
    static = [
        (
            "targetSetter",
            0x25D4B0,
            0x25D6F2,
            "Actual pointer equality, range/first-load branches, clear/reset clocks, common-eligibility assertion, movement dispatch and last-position stores.",
        ),
        (
            "variableDamageGetter",
            0x1DEC32,
            0x1DEC46,
            "Actual variable-damage flag getter from Data+0x17d.",
        ),
        (
            "stopTimePredicate",
            0x1DE724,
            0x1DE73E,
            "Tests positive Data+0x1c4 StopTimeAfterAttack.",
        ),
        (
            "ownerStateGetter",
            0x217780,
            0x217790,
            "Reads raw owner state+0x60 before the synthetic stop-time notification branch.",
        ),
        (
            "movementGetter",
            0x219B36,
            0x219B4E,
            "Body component flag bit2 gates movement pointer+0x40.",
        ),
        (
            "positionGetters",
            0x219AF6,
            0x219B16,
            "Actual X/Y getters supply setter last-position fields+0x34/+0x38.",
        ),
        (
            "loadTimeGetter",
            0x1DEB6E,
            0x1DEB82,
            "Reads native LoadTime for clear/retarget reload calculations.",
        ),
        (
            "hitSpeedGetter",
            0x1DDF7A,
            0x1DDF8E,
            "Reads HitSpeed for elapsed remainder on synthetic first-load out-of-range switches.",
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
                "entryPoint": "0x25d4b0",
                "inputs": [
                    *env["inputs"],
                    {
                        "path": context["globals_path"],
                        "sha256": hashlib.sha256(context["globals_bytes"]).hexdigest(),
                    },
                ],
                "limits": [
                    "Actual attack/base/point construction precedes explicit pointer, clock, flag, state and last-position seeds. They are scalar controls, not naturally reached combat states.",
                    "Source-selected minimal Data profiles retain actual LoadFirstHit=false and StopTimeAfterAttack=0; true first-load and positive stop-time cases are synthetic controls. Full table inheritance is not emulated.",
                    "Range and common eligibility are supplied results. Their predicates, primary scan caller, world registration, target death/removal and damage do not execute in this capture.",
                    "Actual setter, source getters, raw owner-state getter, movement getter and position getters execute. Owner/world resolution, owner reset callback, movement dispatch and assertion reporting are explicit intercepted boundaries.",
                    "Movement notification requests do not establish movement effects or complete pathfinding. Supplied ineligible controls record the native assertion path, not a valid gameplay target transition. The assertion reporter deliberately returns; native assertion fatality is not established.",
                ],
                "coordinates": coordinates,
                "assertionText": assertion_text,
                "blocks": blocks,
                "cases": cases,
                "controls": controls,
            },
            indent=2,
        )
        + "\n"
    )
    path = Path("reference/client/target-switch-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native target-switch capture differs")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "cases": len(cases),
                "controls": len(controls),
                "blocks": len(blocks),
                "assertions": sum(len(row["assertions"]) for row in cases + controls),
                "movementNotifications": sum(
                    row["movementNotifications"] for row in cases + controls
                ),
                "ownerResetNotifications": sum(
                    row["ownerResetNotifications"] for row in cases + controls
                ),
            }
        )
    )
