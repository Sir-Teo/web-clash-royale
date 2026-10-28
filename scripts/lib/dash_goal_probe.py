"""Supplied Bandit countdown, native launch tile and landing hit/miss episodes.

Shares only the checked dash memory/emulator boundaries. Acquisition, natural
actor scheduling, collision/index writes, views and post-damage reactions are
excluded. Native countdown, launch arithmetic, movement and landing gates run.
"""

from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import (
    UC_X86_REG_EDI,
    UC_X86_REG_EIP,
    UC_X86_REG_ESI,
    UC_X86_REG_ESP,
)


def capture(env, context, shared):
    def require(condition, message):
        if not condition:
            raise RuntimeError(message)

    cpu, heap, body, data, health, world, buffs = [
        shared[k] for k in ["cpu", "heap", "body", "data", "health", "world", "buffs"]
    ]
    attack, movement, view, view_vt, settings = [
        shared[k] for k in ["attack", "movement", "view", "view_vt", "settings"]
    ]
    read, write, run, ret, snapshot, put, exact, set_phase = [
        shared[k]
        for k in [
            "read",
            "write",
            "run",
            "ret",
            "snapshot",
            "put",
            "exact",
            "set_phase",
        ]
    ]
    events, calls, overrides = [shared[k] for k in ["events", "calls", "overrides"]]
    target, target_health, target_data, manager, point, row = [
        heap + off for off in [0x8000, 0x9000, 0xA000, 0xB000, 0xC000, 0xC800]
    ]
    require(context["constants"].pop(0x25D6F2) == 1, "Dash goal range boundary differs")
    require(
        context["constants"].pop(0x218320) == 0, "Dash goal facing boundary differs"
    )
    env["component_resolvers"][target_health] = (target, world)
    source = env["rows"]["reference/logic/characters.csv"]["Assassin"]
    victim = env["rows"]["reference/logic/characters.csv"]["Knight"]
    range_path = "reference/client/attack-range-native-trace.json"
    range_trace = json.loads(Path(range_path).read_text())
    require(
        range_trace["sha256"] == env["sha"]
        and range_trace["addCharacterRangeToRadius"] is True,
        "Dash goal native range prerequisite differs",
    )
    for entry in range_trace["inputs"]:
        require(
            hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
            == entry["sha256"],
            "Dash goal native range source differs",
        )
    require(
        source["CollisionRadius"] == "600"
        and victim["CollisionRadius"] == "500"
        and source["Range"] == "750"
        and source["DashDamage"] == "320"
        and not source["DashRadius"]
        and not source["DashPushBack"],
        "Recheck dash goal geometry source fields",
    )
    columns = [
        {"name": "DashDamage", "string": 0x6140E7, "gotOffset": 0x1828},
        {
            "name": "DashPushBack",
            "string": 0x6140FD,
            "gotOffset": 0x1820,
            "dataOffset": 0x1D0,
        },
        {
            "name": "DashRadius",
            "string": 0x61410A,
            "gotOffset": 0x1824,
            "dataOffset": 0x1CC,
        },
        {
            "name": "CollisionRadius",
            "string": 0x61421B,
            "gotOffset": 0x1894,
            "dataOffset": 0x22C,
        },
    ]
    for column in columns:
        expected = column["name"].encode() + b"\0"
        require(
            bytes(cpu.mem_read(column["string"], len(expected))) == expected,
            "Dash goal named column differs",
        )
    env["allowed"].extend(
        [
            (0x25CC50, 0x25CE05),
            (0x25C95F, 0x25C98A),
            (0x263C4A, 0x263CB9),
            (0x1C939A, 0x1C93AE),
            (0x55E80, 0x55E81),
            (0x55E90, 0x55E91),
            (0x1DE3F0, 0x1DE404),
            (0x21984A, 0x219874),
            (0x21AF26, 0x21AF36),
            (0x25D6F2, 0x25D75C),
            (0x25DDAE, 0x25DEB6),
            (0x1DDBF4, 0x1DDC08),
            (0x1DE2D8, 0x1DE2EC),
            (0x21A2D0, 0x21A376),
            (0x35D620, 0x35D670),
            (0x26217E, 0x262198),
            (0x2157EB, 0x2159BC),
            (0x1DE092, 0x1DE0BA),
            (0x1DE01A, 0x1DE06A),
            (0x1DE762, 0x1DE772),
            (0x1DE816, 0x1DE82A),
            (0x23BDFE, 0x23BDFF),
            (0x261050, 0x261051),
            (0x25D75C, 0x25D78A),
            (0x25C4FA, 0x25C4FB),
            (0x1DE422, 0x1DE440),
            (0x1DE06A, 0x1DE07E),
            (0x1DE772, 0x1DE782),
            (0x218320, 0x218321),
        ]
    )
    phase, direction, current_goal = None, None, None
    extra_calls = Counter()
    labels = {
        0x25CC50: "countdownFragment",
        0x263C4A: "goalSetter",
        0x25C95F: "dashClockClear",
        0x25D6F2: "attackRange",
        0x2157EB: "landingTargetGate",
        0x1DE01A: "dashDamageGetter",
        0x21A2D0: "targetGeometry",
    }

    def handler(pc, sp):
        nonlocal current_goal
        if pc in labels:
            extra_calls[labels[pc]] += 1
        if pc == 0x25CC50:
            require(phase == "countdown", "Unexpected countdown fragment phase")
            cpu.reg_write(UC_X86_REG_ESI, body)
            cpu.reg_write(UC_X86_REG_EDI, attack)
            write(sp + 0x24, data)
        elif pc == 0x25C95F:
            require(phase == "clear", "Unexpected dash clock clear phase")
            cpu.reg_write(UC_X86_REG_ESI, attack)
        elif pc in [0x25C988, 0x25CE04]:
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
            return True
        elif pc == 0x25CDF4:
            require(phase == "countdown", "Unexpected dash state request")
            events.append(["stateRequest", 4])
            return True
        elif pc == 0x214F60:
            require(
                read(sp + 4) == body and read(sp + 8) in [1, 4],
                "Unexpected goal actor state request",
            )
            if read(sp + 8) == 1:
                events.append(["stateRequest", 1])
        elif pc in [0x25FA2A, 0x25FA9C]:
            pointer = read(sp + 4)
            require(
                pointer in [health, attack, movement, buffs, target_health],
                "Unexpected dash goal owner/Data provider",
            )
            ret(
                (target if pointer == target_health else body)
                if pc == 0x25FA2A
                else data
            )
            return True
        elif pc == 0x25FA16:
            require(
                read(sp + 4) == view and read(sp) in [0x25CCA0, 0x21546E],
                "Unexpected dash goal view callback",
            )
            events.append(
                ["providedView", "start" if read(sp) == 0x25CCA0 else "state"]
            )
            ret()
            return True
        elif pc == 0x218320:
            require(
                read(sp + 4) == body and read(sp + 8) == target,
                "Unexpected countdown facing request",
            )
            ret()
            return True
        elif pc == 0x55E80:
            require(
                phase == "countdown" and read(sp + 4) == 8,
                "Unexpected launch allocation",
            )
            events.append(["providedAllocate", 8])
            ret(point)
            return True
        elif pc == 0x55E90:
            require(read(sp + 4) == point, "Unexpected launch point disposal")
            events.append(["providedFree"])
            ret()
            return True
        elif pc == 0x263C4A:
            require(
                read(sp + 4) == movement and read(sp + 8) == point,
                "Unexpected dash launch goal arguments",
            )
            current_goal = [read(point), read(point + 4)]
            events.append(["goal", *current_goal])
        elif pc == 0x20205A:
            require(
                read(sp) == 0x1DE062
                and [read(sp + i) for i in [4, 8, 12, 16, 20]]
                == [row, read(0x7B8A14 + 0x1828), 0, 1, 0],
                "Unexpected dash damage table result context",
            )
            events.append(["providedDashDamage", 320])
            ret(320)
            return True
        elif pc == 0x260412:
            require(phase == "movement", "Unexpected dash landing HP store")
            events.append(["targetHp", read(target_health + 8)])
            cpu.reg_write(UC_X86_REG_EIP, 0x260655)
            return True
        elif pc == 0x261050:
            require(read(sp + 4) == movement, "Unexpected post-dash path refresh")
            events.append(["providedPathRefresh"])
            ret()
            return True
        elif pc == 0x23BDFE:
            require(
                phase == "movement"
                and read(sp + 4) == 0
                and [read(sp + i) for i in [8, 12]]
                == [read(body + 0x20), read(body + 0x24)],
                "Unexpected landing blocked-tile query",
            )
            events.append(["providedBlockedTile", False])
            ret(0)
            return True
        elif pc == 0x25C4FA:
            require(
                read(sp + 4) == attack,
                "Unexpected post-hit attack clock initialization",
            )
            events.append(["providedAttackReload"])
            ret()
            return True
        return False

    base_addresses = {
        *shared["names"],
        0x25CDF4,
        0x25CE04,
        0x25FA2A,
        0x25FA9C,
        0x20205A,
        0x260412,
    }
    addresses = {
        *labels,
        0x25CC50,
        0x25C95F,
        0x25C988,
        0x25CE04,
        0x25CDF4,
        0x214F60,
        0x25FA2A,
        0x25FA9C,
        0x25FA16,
        0x218320,
        0x55E80,
        0x55E90,
        0x263C4A,
        0x20205A,
        0x260412,
        0x261050,
        0x23BDFE,
        0x25C4FA,
    }
    for pc in addresses:
        if pc in base_addresses:
            overrides[pc] = lambda sp, pc=pc: handler(pc, sp)
        else:
            cpu.hook_add(
                UC_HOOK_CODE,
                lambda _cpu, pc, _size, _data: handler(
                    pc, cpu.reg_read(UC_X86_REG_ESP)
                ),
                begin=pc,
                end=pc,
            )

    def invoke(label, start, *args):
        nonlocal phase
        phase = label
        set_phase(label)
        run(start, *args, instruction_budget=25000)

    def inventory():
        return dict(sorted((calls + extra_calls).items()))

    cases, controls = [], []

    def episode(axis, motion, initial_clock=0):
        nonlocal direction, current_goal
        direction, current_goal = axis, None
        dx, dy = axis
        cpu.mem_write(heap, b"\0" * 0x10000)
        origin = [8250, 8250]
        initial_target = [8250 + 5000 * dx, 8250 + 5000 * dy]
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
            (body + 0x20, origin[0]),
            (body + 0x24, origin[1]),
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
            (data + 0x1A0, 750),
            (data + 0x1C4, 1000),
            (data + 0x1E0, 500),
            (data + 0x22C, 600),
            (target, 0x7B34A0),
            (target + 0x10, target_data),
            (target + 0x20, initial_target[0]),
            (target + 0x24, initial_target[1]),
            (target + 0x38, 4),
            (target + 0x44, target_health),
            (target_health + 4, target),
            (target_health + 8, 1000),
            (target_data + 0x22C, 500),
        ]:
            write(ptr, value)
        cpu.mem_write(settings + 0x295, b"\1")
        countdown = []
        expected_clock = initial_clock or 1000
        for step in range(1, 21):
            events.clear()
            calls.clear()
            extra_calls.clear()
            expected = bytearray(snapshot())
            expected_clock = max(0, expected_clock - 50)
            launched = expected_clock == 0
            put(expected, attack + 0x20, 1000 if launched else expected_clock)
            if launched:
                put(expected, body + 0x60, 4)
                put(expected, movement + 0x10, 1)
                goal = [initial_target[0] - 1100 * dx, initial_target[1] - 1100 * dy]
                put(
                    expected,
                    movement + 0x14,
                    int(goal[1] / 500) * 36 + int(goal[0] / 500),
                )
                put(expected, movement + 0x1CC, -1)
            invoke("countdown", 0x25CC50)
            exact(expected, "goal countdown/launch")
            expected_events = (
                [["providedView", "start"]] if step == 1 and initial_clock == 0 else []
            )
            if launched:
                expected_events += [
                    ["providedAllocate", 8],
                    ["goal", *goal],
                    ["providedFree"],
                    ["stateRequest", 4],
                    ["providedView", "state"],
                ]
            require(events == expected_events, "Dash countdown event order differs")
            require(
                current_goal
                == (
                    [initial_target[0] - 1100 * dx, initial_target[1] - 1100 * dy]
                    if launched
                    else None
                ),
                "Native launch point differs",
            )
            countdown.append(
                {
                    "step": step,
                    "state": read(body + 0x60),
                    "clockMs": read(attack + 0x20),
                    "xy": [read(body + 0x20), read(body + 0x24)],
                    "goalTile": read(movement + 0x14),
                    "events": list(events),
                    "calls": inventory(),
                    "exactHeapChangesOnly": True,
                }
            )
            if launched:
                break
        require(launched, "Dash countdown did not launch")
        launch_goal = list(current_goal)
        launch_tile = read(movement + 0x14)
        events.clear()
        calls.clear()
        extra_calls.clear()
        before = snapshot()
        invoke("movement", 0x260C2C, movement)
        exact(before, "launch-frame movement hold")
        require(
            calls["movementFrame"] == 1 and not calls["movementUpdate"],
            "Launch movement was not held by the attack clock",
        )
        held = {
            "state": read(body + 0x60),
            "clockMs": read(attack + 0x20),
            "calls": inventory(),
            "exactHeapChangesOnly": True,
        }
        expected = bytearray(before)
        put(expected, attack + 0x20, 0)
        invoke("clear", 0x25C95F)
        exact(expected, "actual dash clock clear")
        displacement = {
            "stationary": (0, 0),
            "sideways": (-3000 * dy, 3000 * dx),
            "away": (3000 * dx, 3000 * dy),
            "closer": (-2000 * dx, -2000 * dy),
        }[motion]
        for offset, initial, delta in zip([0x20, 0x24], initial_target, displacement):
            write(target + offset, initial + delta)
        frames = []
        final_step = 7 if motion == "stationary" else 3 if motion == "closer" else 8
        for step in range(1, final_step + 1):
            events.clear()
            calls.clear()
            extra_calls.clear()
            expected = bytearray(snapshot())
            landing = step == final_step
            travelled = step * 500 - (250 if landing else 0)
            for ptr, value in [
                (body + 0x20, 8250 + travelled * dx),
                (body + 0x24, 8250 + travelled * dy),
                (body + 0x50, 256 * dx),
                (body + 0x54, 256 * dy),
                (movement + 0x1DC, step * 50),
                (movement + 0x1FC, (step - 1) * 50),
            ]:
                put(expected, ptr, value)
            expected[movement + 0x1EA - heap] = 1
            if landing:
                put(expected, body + 0x60, 1)
                if motion in ["stationary", "closer"]:
                    put(expected, target_health + 8, 680)
            invoke("movement", 0x260C2C, movement)
            exact(expected, "native goal movement/landing")
            expected_events = [["providedOpenPlaneWrite", 250 * dx, 250 * dy]]
            if landing:
                expected_events += [["stateRequest", 1], ["providedDashDamage", 320]]
                if motion in ["stationary", "closer"]:
                    expected_events += [["targetHp", 680], ["providedAttackReload"]]
                expected_events += [
                    ["providedBlockedTile", False],
                    ["providedPathRefresh"],
                    ["providedView", "state"],
                ]
            else:
                expected_events += [
                    ["providedOpenPlaneWrite", 250 * dx, 250 * dy],
                    ["providedOpenPlaneWrite", 0, 0],
                ]
            require(
                events == expected_events, "Dash landing/movement event order differs"
            )
            require(
                read(movement + 0x14) == launch_tile, "Dash goal followed moving target"
            )
            require(
                calls["movementFrame"] == calls["movementUpdate"] == 1,
                "Goal movement driver counts differ",
            )
            frames.append(
                {
                    "step": step,
                    "state": read(body + 0x60),
                    "xy": [read(body + 0x20), read(body + 0x24)],
                    "targetHp": read(target_health + 8),
                    "goalTile": read(movement + 0x14),
                    "events": list(events),
                    "calls": inventory(),
                    "exactHeapChangesOnly": True,
                }
            )
        result = {
            "fields": {
                "direction": list(axis),
                "motion": motion,
                "initialClockMs": initial_clock,
                "origin": origin,
                "initialTarget": initial_target,
                "movedTarget": [read(target + 0x20), read(target + 0x24)],
            },
            "countdown": countdown,
            "launchGoal": launch_goal,
            "launchFrameHold": held,
            "frames": frames,
        }
        (controls if initial_clock else cases).append(result)

    for axis in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
        for motion in ["stationary", "sideways", "away", "closer"]:
            episode(axis, motion)
        for initial in [50, 500]:
            episode(axis, "stationary", initial)
    definitions = [
        (
            "countdown",
            0x25CC50,
            0x25CD18,
            "Actual supplied-eligible dash countdown, source 1000-ms clock, buff delta, reset and launch choice. Earlier eligibility, target scanning and outer attack bookkeeping excluded.",
        ),
        (
            "launchGoal",
            0x25CD18,
            0x25CE05,
            "Actual source-radius point normalization/addition, tile setter and state 4 request; point allocation/disposal and view notifications supplied.",
        ),
        (
            "tileSetter",
            0x263C4A,
            0x263CB9,
            "Actual truncation by 500 and world-width goal index. Supplied world width 36.",
        ),
        (
            "goalDecoder",
            0x2632A4,
            0x263446,
            "Actual stored tile center lookup. No exact-coordinate-goal override is enabled.",
        ),
        (
            "movementDriver",
            0x260C2C,
            0x260D98,
            "Actual attack-clock movement hold and one dash update; post-movement notification excluded.",
        ),
        (
            "dashClockClear",
            0x25C95F,
            0x25C988,
            "Actual already-dashing clock/attack-field clear; earlier outer attack checks excluded.",
        ),
        (
            "dashMovement",
            0x261B7A,
            0x261E03,
            "Actual fixed-goal movement chunks, target range stop and remaining-travel time. Open-plane writer supplied.",
        ),
        (
            "dashLanding",
            0x21514B,
            0x215394,
            "Actual source dash amount/radius/pushback choices; source radius/pushback absent, visual fields supplied zero.",
        ),
        (
            "landingTarget",
            0x2157EB,
            0x2159BC,
            "Actual target/component/range+500 gate, lower damage request, attack reset and state continuation. Blocked-tile query is supplied false and later path refresh/reload are checked no-ops.",
        ),
        (
            "damageGetter",
            0x1DE01A,
            0x1DE06A,
            "Actual DashDamage table request with supplied base rate 320, row, level zero and opaque rarity zero.",
        ),
        (
            "dashColumnBindings",
            0x1DC31D,
            0x1DC469,
            "Named DashDamage, DashPushBack and DashRadius column bindings; loader excluded.",
        ),
        (
            "dashFieldStores",
            0x1D9A9B,
            0x1D9AE3,
            "Source dash auxiliary field stores; loader excluded.",
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
        require(bool(instructions), "Empty dash goal instruction block")
        blocks.append(
            {
                "name": name,
                "start": hex(start),
                "end": hex(end),
                "interpretation": meaning,
                "instructions": instructions,
            }
        )
    prerequisite = "reference/client/dash-lifecycle-native-trace.json"
    result = {
        "source": "apk/1.8.1/x86/libg.so",
        "sha256": env["sha"],
        "emulator": "unicorn==2.1.4",
        "stepMs": 50,
        "inputs": [
            *shared["inputs"],
            {
                "path": range_path,
                "sha256": hashlib.sha256(Path(range_path).read_bytes()).hexdigest(),
            },
            *[
                entry
                for entry in range_trace["inputs"]
                if entry["path"] == "reference/logic/globals.csv"
            ],
            {
                "path": prerequisite,
                "sha256": hashlib.sha256(Path(prerequisite).read_bytes()).hexdigest(),
            },
        ],
        "sourceColumns": [*shared["columns"], *columns],
        "profiles": {
            "attacker": "Assassin",
            "target": "Knight",
            "sourceDashDamage": 320,
            "sourceDashCooldownMs": 1000,
            "range": 750,
            "ownRadius": 600,
            "targetRadius": 500,
            "goalTileSize": 500,
            "worldWidth": 36,
            "sourceJumpSpeed": 500,
            "addCharacterRangeToRadius": True,
        },
        "limits": [
            "Supplied eligible existing target/components enter the actual countdown fragment; natural acquisition, eligibility, outer attack update and actor scheduling remain excluded. Source 1000-ms countdown runs in 50-ms buff-adjusted increments without active buffs. Initial partial clocks are controlled. Source-state 2 is retained until launch; this does not reconstruct complete natural startup behavior.",
            "Native launch point normalization/addition, native tile setter/decoder, state 4 entry and actual movement frames execute. Goal admission is limited to the source launch request; supplied width 36 and cardinal positions avoid diagonal quantization/obstacles. Exact-coordinate goal override is disabled. Target displacement after launch is controlled, not native target movement.",
            "Source Range 750, CollisionRadius 600/500, absent DashRadius/DashPushBack and source DashDamage base 320 are supplied. Actual native DashDamage getter executes against a checked row/column/level/rarity table result provider; level/rarity scaling is excluded. Native target stop and landing +500 range gates execute, including actual target HP reduction on hits.",
            "Point allocation/free, facing/view notifications, open-plane collision writes, blocked-tile false, post-hit attack reload and post-dash path refresh are checked boundaries. Visual fields and optional world modifiers are supplied zero. Full navigation, target removal/death, spell interruption, diagonal travel, shields/lethal paths, post-HP damage reactions and next walking/attacking behavior remain excluded.",
            "Each countdown/movement step checks exact 64-KiB heap changes and driver counts. Source attack clock holds movement on the launch frame; the actual state-4 attack-clear fragment permits movement on the following supplied frame. Ordinary immunity/retained status behavior is supplied by the prerequisite lifecycle capture, not re-executed here. Gameplay remains rules 48.",
        ],
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    output = json.dumps(result, indent=2) + "\n"
    path = Path("reference/client/dash-goals-native-trace.json")
    if env["args"].check:
        require(path.read_text() == output, "Dash goal capture differs")
    else:
        path.write_text(output)
    rows = cases + controls
    print(
        json.dumps(
            {
                "cases": len(cases),
                "controls": len(controls),
                "countdownSteps": sum(len(r["countdown"]) for r in rows),
                "movementSteps": sum(len(r["frames"]) for r in rows),
                "hits": sum(r["frames"][-1]["targetHp"] == 680 for r in rows),
                "misses": sum(r["frames"][-1]["targetHp"] == 1000 for r in rows),
                "blocks": len(blocks),
            }
        )
    )
