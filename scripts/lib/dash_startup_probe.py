"""Complete native attack updates through supplied-target Bandit startup.

Native admission, clocks, target-range cancellation, launch and state entry run.
Acquisition/validity, notifications, world scheduling and navigation are bounded
providers. Actual movement is held during charging; later travel is excluded.
"""

from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP


def capture(env, context, lifecycle, goal):
    def require(condition, message):
        if not condition:
            raise RuntimeError(message)

    (
        cpu,
        heap,
        body,
        data,
        health,
        world,
        buffs,
        attack,
        movement,
        view,
        view_vt,
        settings,
    ) = [
        goal[k]
        for k in [
            "cpu",
            "heap",
            "body",
            "data",
            "health",
            "world",
            "buffs",
            "attack",
            "movement",
            "view",
            "view_vt",
            "settings",
        ]
    ]
    target, target_data, target_health, manager, row = [
        goal[k] for k in ["target", "target_data", "target_health", "manager", "row"]
    ]
    read, write, ret, snapshot, put, exact, invoke, inventory = [
        goal[k]
        for k in [
            "read",
            "write",
            "ret",
            "snapshot",
            "put",
            "exact",
            "invoke",
            "inventory",
        ]
    ]
    events, calls, extra_calls = [goal[k] for k in ["events", "calls", "extra_calls"]]
    source = env["rows"]["reference/logic/characters.csv"]["Assassin"]
    require(
        source["HitSpeed"] == "1000"
        and source["LoadTime"] == "600"
        and not source["LoadFirstHit"]
        and not source["AttackDashTime"],
        "Recheck Bandit ordinary clock fields",
    )
    for pc, expected in [(0x25D7C2, 1), (0x25DEB6, 0), (0x25D95E, 0)]:
        require(
            context["constants"].pop(pc) == expected, "Startup shared provider differs"
        )
    env["allowed"].extend(
        [
            (0x264488, 0x2644C2),
            (0x1DDBCC, 0x1DDBE0),
            (0x1DEA5C, 0x1DEA70),
            (0x1DE7EE, 0x1DE802),
            (0x35D330, 0x35D423),
            (0x25D4B0, 0x25D6F2),
        ]
    )
    names = {
        0x25C60C: "fullAttack",
        0x25D852: "admission",
        0x25C080: "buffClock",
        0x25D4B0: "targetSetter",
        0x21698E: "providedReset",
        0x25D7C2: "providedValidity",
        0x25DEB6: "providedPrimaryScan",
        0x25D95E: "providedExtraScan",
    }
    startup_calls = Counter()

    def hook(_cpu, pc, _size, _data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        startup_calls[names[pc]] += 1
        if pc in [0x25D7C2, 0x25DEB6, 0x25D95E]:
            require(read(sp + 4) == attack, "Startup provider owner differs")
            if pc == 0x25D7C2:
                require(
                    read(sp + 8) == target and read(sp + 12) == 0,
                    "Startup supplied validity request differs",
                )
            ret(1 if pc == 0x25D7C2 else 0)
        elif pc == 0x21698E:
            # Root notification provider already popped its return word.
            require(read(sp) == body, "Startup reset owner differs")
            events.append(["providedReset"])
        elif pc in [0x25C60C, 0x25D852, 0x25D4B0]:
            require(read(sp + 4) == attack, "Startup native driver owner differs")
            if pc == 0x25D852:
                require(read(sp + 8) == target, "Startup admission target differs")
            if pc == 0x25D4B0:
                require(read(sp + 8) == 0, "Unexpected startup target assignment")
        elif pc == 0x25C080:
            require(read(sp) in [0x25CCC0, 0x2161C3], "Startup clock caller differs")
            require(
                [read(sp + 4), read(sp + 8)] == [buffs, 50],
                "Startup native clock input differs",
            )

    for pc in names:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)

    def set_buffs(names):
        array = heap + 0x5000
        write(buffs + 8, array)
        write(buffs + 0x10, len(names))
        for index, name in enumerate(names):
            record = heap + 0x5200 + index * 0x100
            model = record + 0x40
            fields = env["buff_rows"][name]
            require(not fields["Panic"], "Startup source Panic branch unsupported")
            write(array + index * 4, record)
            write(record + 0xC, model)
            write(model + 0x44, int(fields["HitSpeedMultiplier"] or 0))
            write(model + 0x48, int(fields["SpeedMultiplier"] or 0))
            write(model + 0x6C, int(fields["AttractPercentage"] or 0))

    def buff_delta(names, field):
        values = [int(env["buff_rows"][name][field] or 0) for name in names]
        positive = max([100, *[v for v in values if v > 0]])
        negative = max([0, *[-v for v in values if v < 0]])
        return math.trunc(
            math.trunc(50 * positive / 100) * max(0, min(100, 100 - negative)) / 100
        )

    def episode(
        direction=(1, 0),
        initial_distance=5000,
        initial_clock=0,
        initial_buffs=(),
        changes=(),
        steps=50,
    ):
        dx, dy = direction
        cpu.mem_write(heap, b"\0" * 0x10000)
        for ptr, value in [
            (body, 0x7B34A0),
            (body + 0x10, data),
            (body + 0x14, manager),
            (manager + 0x28, world),
            (world + 0x88, 36),
            (body + 0x18, view),
            (view, view_vt),
            (view_vt + 0x5C, 0x25FA16),
            (view_vt + 0x24, 0x25FA16),
            (body + 0x20, 8250),
            (body + 0x24, 8250),
            (body + 0x38, 15),
            (body + 0x3C, attack),
            (attack + 4, body),
            (attack + 8, target),
            (attack + 0x20, initial_clock),
            (body + 0x40, movement),
            (movement + 4, body),
            (body + 0x44, health),
            (health + 4, body),
            (health + 8, 750),
            (body + 0x48, buffs),
            (body + 0x60, 2),
            (data + 8, row),
            (data + 0x190, 90),
            (data + 0x198, 1000),
            (data + 0x1FC, 600),
            (data + 0x1A0, 750),
            (data + 0x1C4, 1000),
            (data + 0x1DC, 4000),
            (data + 0x1F8, 6000),
            (data + 0x1E0, 500),
            (data + 0x22C, 600),
            (target, 0x7B34A0),
            (target + 0x10, target_data),
            (target + 0x20, 8250 + initial_distance * dx),
            (target + 0x24, 8250 + initial_distance * dy),
            (target + 0x38, 4),
            (target + 0x44, target_health),
            (target_health + 4, target),
            (target_health + 8, 1000),
            (target_data + 0x22C, 500),
        ]:
            write(ptr, value)
        cpu.mem_write(settings + 0x295, b"\1")
        active_buffs = list(initial_buffs)
        set_buffs(active_buffs)
        clock, state, has_target, distance, goal_tile = (
            initial_clock,
            2,
            True,
            initial_distance,
            0,
        )
        frames = []
        for step in range(1, steps + 1):
            for change in changes:
                if change["step"] != step:
                    continue
                if "distance" in change:
                    distance = change["distance"]
                    write(target + 0x20, 8250 + distance * dx)
                    write(target + 0x24, 8250 + distance * dy)
                if "target" in change:
                    has_target = change["target"]
                    require(not has_target, "Startup reacquisition control unsupported")
                    write(attack + 8, 0)
                if "buffs" in change:
                    active_buffs = list(change["buffs"])
                    set_buffs(active_buffs)
            before = snapshot()
            expected = bytearray(before)
            expected_events = []
            target_before, canceled = has_target, False
            was_dashing, launched, countdown = state == 4, False, False
            if has_target:
                put(expected, attack + 0x34, 8250 + distance * dx)
                put(expected, attack + 0x38, 8250 + distance * dy)
                if clock > 0 and distance > 7500:
                    canceled = True
                    has_target, clock = False, 0
                    put(expected, attack + 8, 0)
                    expected_events += [["providedReset"], ["providedPathRefresh"]]
            attraction = any(
                int(env["buff_rows"][name]["AttractPercentage"] or 0) > 0
                for name in active_buffs
            )
            eligible = (
                has_target
                and not attraction
                and (
                    clock > 0
                    or (
                        buff_delta(active_buffs, "SpeedMultiplier") > 0
                        and 4100 <= distance <= 6500
                    )
                )
            )
            if not eligible:
                clock = 0
                if not was_dashing:
                    expected_events.append(["providedReset"])
            if was_dashing:
                clock = 0
            elif eligible:
                countdown = True
                if clock <= 0:
                    clock = 1000
                    expected_events.append(["providedView", "start"])
                clock = max(0, clock - buff_delta(active_buffs, "HitSpeedMultiplier"))
                if clock == 0:
                    launched, state, clock = True, 4, 1000
                    target_xy = [8250 + distance * dx, 8250 + distance * dy]
                    launch = [target_xy[0] - 1100 * dx, target_xy[1] - 1100 * dy]
                    goal_tile = math.trunc(launch[1] / 500) * 36 + math.trunc(
                        launch[0] / 500
                    )
                    put(expected, body + 0x60, 4)
                    put(expected, movement + 0x10, 1)
                    put(expected, movement + 0x14, goal_tile)
                    put(expected, movement + 0x1CC, -1)
                    expected_events += [
                        ["providedAllocate", 8],
                        ["goal", *launch],
                        ["providedFree"],
                        ["stateRequest", 4],
                        ["providedView", "state"],
                    ]
            put(expected, attack + 0x20, clock)
            events.clear()
            calls.clear()
            extra_calls.clear()
            startup_calls.clear()
            context["calls"].clear()
            invoke("startup", 0x25C60C, attack)
            exact(expected, "complete startup attack update")
            require(
                events == expected_events,
                f"Startup native event order differs ({direction}, {initial_distance}, step {step}): {events} != {expected_events}",
            )
            require(
                startup_calls["fullAttack"] == 1
                and extra_calls["countdownFragment"] == int(countdown),
                "Startup native driver count differs",
            )
            require(
                calls["stateSetter"] == int(launched)
                and extra_calls["goalSetter"] == int(launched),
                "Startup launch driver count differs",
            )
            require(
                startup_calls["admission"]
                == int(has_target) * (1 if was_dashing else 2)
                and startup_calls["buffClock"] == int(countdown) + int(launched)
                and startup_calls["targetSetter"] == int(canceled)
                and startup_calls["providedValidity"] == int(target_before)
                and startup_calls["providedPrimaryScan"] == 1
                and extra_calls["attackRange"]
                == int(target_before) + int(has_target and not was_dashing),
                "Startup query/clock/provider inventory differs",
            )
            held = clock > 0
            if held:
                invoke("movement", 0x260C2C, movement)
                exact(expected, "startup movement frame hold")
                require(
                    calls["movementFrame"] == 1 and calls["movementUpdate"] == 0,
                    "Startup frame did not hold movement",
                )
            frames.append(
                {
                    "step": step,
                    "state": state,
                    "clockMs": clock,
                    "targetPresent": has_target,
                    "target": [read(target + 0x20), read(target + 0x24)],
                    "buffs": list(active_buffs),
                    "xy": [read(body + 0x20), read(body + 0x24)],
                    "goalTile": goal_tile,
                    "movementHeld": held,
                    "events": list(events),
                    "calls": dict(
                        sorted((Counter(inventory()) + startup_calls).items())
                    ),
                    "exactHeapChangesOnly": True,
                }
            )
            if was_dashing:
                break
        return {
            "fields": {
                "direction": list(direction),
                "initialDistance": initial_distance,
                "initialClockMs": initial_clock,
                "initialBuffs": list(initial_buffs),
                "changes": list(changes),
                "stepLimit": steps,
            },
            "frames": frames,
        }

    cases = [
        episode(direction=d, initial_buffs=b)
        for d in [(1, 0), (-1, 0), (0, 1), (0, -1)]
        for b in [(), ("Rage",), ("IceWizardSlowDown",), ("Rage", "IceWizardSlowDown")]
    ]
    controls = []
    for direction in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
        for distance in [4099, 4100, 6500, 6501]:
            controls.append(
                episode(direction=direction, initial_distance=distance, steps=24)
            )
        for initial_clock in [50, 500]:
            controls.append(episode(direction=direction, initial_clock=initial_clock))
        for distance in [2000, 6501, 7499, 7500, 7501]:
            controls.append(
                episode(
                    direction=direction,
                    changes=[{"step": 6, "distance": distance}],
                    steps=32,
                )
            )
        controls.append(
            episode(
                direction=direction, changes=[{"step": 6, "target": False}], steps=12
            )
        )
    for buff in ["Freeze", "ZapFreeze", "Clone", "Tornado"]:
        controls.append(episode(initial_buffs=[buff], steps=12))
        controls.append(
            episode(changes=[{"step": 6, "buffs": [buff]}, {"step": 10, "buffs": []}])
        )
    controls.append(episode(changes=[{"step": 6, "buffs": ["Rage"]}]))
    controls.append(episode(changes=[{"step": 6, "buffs": ["IceWizardSlowDown"]}]))

    definitions = [
        (
            "completeAttack",
            0x25C60C,
            0x25D068,
            "Complete actual attack update and epilogue; no countdown register injection or internal early stop.",
        ),
        (
            "targetSetter",
            0x25D4B0,
            0x25D6F2,
            "Actual null assignment and dash-clock reset when pending target exceeds the retention window.",
        ),
        (
            "admission",
            0x25D852,
            0x25D946,
            "Actual admission helper; separate capture proves its pure-query boundaries.",
        ),
        (
            "movementHold",
            0x260C2C,
            0x260D98,
            "Actual movement frame driver remains held by a positive charging/launch clock.",
        ),
        (
            "movementFlags",
            0x264488,
            0x2644C2,
            "Actual movement preparation flags read by the complete attack update; supplied zero.",
        ),
    ]
    blocks = []
    for name, start, end, meaning in definitions:
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
        instructions = [
            line.strip()
            for line in asm.splitlines()
            if re.match(r"\s*[0-9a-f]+:", line)
        ]
        require(bool(instructions), "Empty startup instruction block")
        blocks.append(
            {
                "name": name,
                "start": hex(start),
                "end": hex(end),
                "interpretation": meaning,
                "instructions": instructions,
            }
        )
    prerequisites = [
        "reference/client/dash-admission-native-trace.json",
        "reference/client/dash-goals-native-trace.json",
    ]
    for path in prerequisites:
        prior = json.loads(Path(path).read_text())
        require(prior["sha256"] == env["sha"], "Startup prerequisite binary differs")
        for entry in prior["inputs"]:
            require(
                hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
                == entry["sha256"],
                "Startup prerequisite source differs",
            )
    result = {
        "source": "apk/1.8.1/x86/libg.so",
        "sha256": env["sha"],
        "emulator": "unicorn==2.1.4",
        "stepMs": 50,
        "inputs": [
            *lifecycle["inputs"],
            *[
                {"path": p, "sha256": hashlib.sha256(Path(p).read_bytes()).hexdigest()}
                for p in prerequisites
            ],
        ],
        "profiles": {
            "attacker": "Assassin",
            "target": "Knight",
            "dashCooldownMs": 1000,
            "hitSpeedMs": 1000,
            "loadTimeMs": 600,
            "ownRadius": 600,
            "targetRadius": 500,
            "initialMinimum": 4100,
            "initialMaximum": 6500,
            "retentionMaximum": 7500,
        },
        "limits": [
            "Complete native attack update executes through its real epilogue against supplied valid target/components and source fields. Target validity is a checked true provider; primary/extra scans return no new candidate. Acquisition, removal notifications, world/actor scheduling, natural movement and full battle startup remain excluded.",
            "Raw owner state 2, existing target, zero ordinary attack elapsed/finish/load flags, movement preparation flags and optional world modifiers are supplied. Actual ordinary target geometry, dash admission, buff-adjusted countdown, native target-setter cancellation, launch point/tile, state-4 entry, launch hold and next attack clock clear execute.",
            "Source buffs are copied into supplied vectors; timed replacements, target displacement/null references and partial clocks are fixture controls. Natural application/expiry, hard-stun actor scheduling/component activation and Panic settings are excluded. Freeze modifier controls establish the supplied clock path, not every natural interruption behavior.",
            "Native movement-frame driver is invoked only while the positive attack clock holds it. Travel after clock clear, terrain, post-launch removal, landing/damage and later ordinary attacks are excluded. Existing goal/lifecycle captures supply separate evidence for those bounded paths.",
            "Point allocation/free, view/facing/reset notifications, empty candidate scans and post-cancellation path refresh are checked providers. Every update validates all 64-KiB heap changes, ordered external events and native driver counts. Gameplay remains rules 49.",
        ],
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    output = json.dumps(result, indent=2) + "\n"
    path = Path("reference/client/dash-startup-native-trace.json")
    if env["args"].check:
        require(path.read_text() == output, "Dash startup capture differs")
    else:
        path.write_text(output)
    rows = cases + controls
    print(
        json.dumps(
            {
                "cases": len(cases),
                "controls": len(controls),
                "updates": sum(len(r["frames"]) for r in rows),
                "launches": sum(
                    any(f["state"] == 4 for f in r["frames"]) for r in rows
                ),
            }
        )
    )
