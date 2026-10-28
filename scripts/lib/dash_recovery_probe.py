"""Native Bandit landing reload and supplied recovery continuations.

Native admission, clocks, launch, landing and subsequent attack updates run.
Ordinary requests execute the real reload prefix; allocation, ordinary target
damage, acquisition, navigation and world scheduling remain bounded providers.
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
            (0x25C4FA, 0x25C536),
            (0x263E8A, 0x263EAC),
        ]
    )
    names = {
        0x25C4FA: "attackReload",
        0x25E61C: "ordinaryRequest",
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
        elif pc == 0x25C4FA:
            require(read(sp + 4) == attack, "Recovery reload owner differs")
            events.append(["nativeAttackReload"])
        elif pc == 0x25E61C:
            require(
                [read(sp + i) for i in [4, 8, 12]] == [attack, target, -1],
                "Recovery ordinary request arguments differ",
            )
            events.append(["ordinaryRequest", -1])
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
            require(
                read(sp) in [0x25CCC0, 0x2161C3, 0x25F7A7],
                "Recovery clock caller differs",
            )
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

    def episode(direction, scenario, recovery_buffs=(), supplied_reload=None):
        dx, dy = direction
        cpu.mem_write(heap, b"\0" * 0x10000)
        xy = [8250, 8250]
        target_xy = [8250 + 5000 * dx, 8250 + 5000 * dy]
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
            (view_vt + 0x20, 0x25FA16),
            (body + 0x20, xy[0]),
            (body + 0x24, xy[1]),
            (body + 0x38, 15),
            (body + 0x3C, attack),
            (attack + 4, body),
            (attack + 8, target),
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
            (target + 0x20, target_xy[0]),
            (target + 0x24, target_xy[1]),
            (target + 0x38, 4),
            (target + 0x44, target_health),
            (target_health + 4, target),
            (target_health + 8, 1000),
            (target_data + 0x22C, 500),
        ]:
            write(ptr, value)
        cpu.mem_write(settings + 0x295, b"\1")
        set_buffs([])
        state, clock, elapsed, reload, hp, tile, travel_clock = 2, 0, 0, 0, 1000, 0, 0
        flag1d = 0
        landings, launched_before, landed_before, active_buffs = 0, False, False, []
        frames = []
        for step in range(1, 101):
            supplied = []
            if launched_before and scenario == "miss":
                target_xy = [target_xy[0] - 3000 * dy, target_xy[1] + 3000 * dx]
                supplied.append(["target", *target_xy])
            if landed_before:
                if scenario == "miss":
                    target_xy = [xy[0] + 1500 * dx, xy[1] + 1500 * dy]
                    supplied.append(["target", *target_xy])
                elif scenario == "chain" and landings == 1:
                    target_xy = [xy[0] + 5000 * dx, xy[1] + 5000 * dy]
                    supplied.append(["target", *target_xy])
                active_buffs = list(recovery_buffs)
                set_buffs(active_buffs)
                if recovery_buffs:
                    supplied.append(["buffs", *active_buffs])
                if supplied_reload is not None:
                    reload = supplied_reload
                    write(attack + 0x10, reload)
                    supplied.append(["reloadMs", reload])
            for ptr, value in zip([target + 0x20, target + 0x24], target_xy):
                write(ptr, value)
            before = snapshot()
            expected = bytearray(before)
            events_expected, request_expected = [], []
            old_state = state
            launched_before, landed_before = False, False
            reload = max(0, reload - 50)
            for ptr, value in zip([attack + 0x34, attack + 0x38], target_xy):
                put(expected, ptr, value)
            distance2 = sum((a - b) ** 2 for a, b in zip(xy, target_xy))
            charging = old_state != 4 and (clock > 0 or 4100**2 <= distance2 <= 6500**2)
            regular = old_state != 4 and not charging
            if old_state == 4:
                clock, elapsed = 0, 0
                flag1d = 0
            elif charging:
                if clock <= 0:
                    clock = 1000
                    events_expected.append(["providedView", "start"])
                clock = max(0, clock - buff_delta(active_buffs, "HitSpeedMultiplier"))
                if clock == 0:
                    launched_before, state, clock = True, 4, 1000
                    front = [target_xy[0] - 1100 * dx, target_xy[1] - 1100 * dy]
                    tile = math.trunc(front[1] / 500) * 36 + math.trunc(front[0] / 500)
                    put(expected, body + 0x60, 4)
                    put(expected, movement + 0x10, 1)
                    put(expected, movement + 0x14, tile)
                    put(expected, movement + 0x1CC, -1)
                    expected[movement + 0x1EB - heap] = 0
                    events_expected += [
                        ["providedAllocate", 8],
                        ["goal", *front],
                        ["providedFree"],
                        ["stateRequest", 4],
                        ["providedView", "state"],
                    ]
            else:
                clock, state = 0, 2
                require(
                    distance2 <= 1850**2,
                    "Recovery regular target outside captured reach",
                )
                if old_state != 2:
                    put(expected, body + 0x60, 2)
                    put(expected, movement + 0x10, 0)
                    expected[movement + 0x1EB - heap] = 1
                    expected[movement + 0x201 - heap] = 0
                    events_expected.append(["providedView", "state"])
                cycle_before = math.trunc(elapsed / 1000)
                if elapsed == 0:
                    elapsed += 600 - reload
                    reload = 600
                    flag1d = int(elapsed % 1000 >= 600)
                elapsed += buff_delta(active_buffs, "HitSpeedMultiplier")
                if math.trunc(elapsed / 1000) > cycle_before:
                    flag1d = 0
                    events_expected += [
                        ["providedView", "attack"],
                        ["ordinaryRequest", -1],
                    ]
                    request_expected = [
                        {
                            "tick": step,
                            "elapsedMs": elapsed,
                            "reloadMs": reload,
                            "finishMs": 0,
                            "target": "a",
                            "flag1d": 0,
                            "hitIndex": -1,
                            "reloadAfterMs": 600,
                        }
                    ]
                    reload = 600
            held = clock > 0
            moving = state == 4 and not held
            landed, hit = False, False
            if moving:
                goal_xy = [tile % 36 * 500 + 250, tile // 36 * 500 + 250]
                heading = [0, 0]
                for chunk in [250, 250, 0]:
                    delta = [a - b for a, b in zip(goal_xy, xy)]
                    distance = max(1, math.isqrt(sum(v * v for v in delta)))
                    heading = [math.trunc(v * 256 / distance) for v in delta]
                    shift = [
                        math.trunc(v * min(distance, chunk) / 256) for v in heading
                    ]
                    xy = [a + b for a, b in zip(xy, shift)]
                    events_expected.append(["providedOpenPlaneWrite", *shift])
                    target_distance2 = sum((a - b) ** 2 for a, b in zip(xy, target_xy))
                    remaining = math.isqrt(
                        sum((a - b) ** 2 for a, b in zip(xy, goal_xy))
                    )
                    landed = target_distance2 <= 1850**2 or remaining // 500 == 0
                    if landed:
                        break
                for ptr, value in [
                    (body + 0x20, xy[0]),
                    (body + 0x24, xy[1]),
                    (body + 0x50, heading[0]),
                    (body + 0x54, heading[1]),
                    (movement + 0x1DC, travel_clock + 50),
                    (movement + 0x1FC, travel_clock),
                ]:
                    put(expected, ptr, value)
                travel_clock += 50
                expected[movement + 0x1EA - heap] = 1
                if landed:
                    landed_before, state, landings = True, 1, landings + 1
                    put(expected, body + 0x60, 1)
                    events_expected += [
                        ["stateRequest", 1],
                        ["providedDashDamage", 320],
                    ]
                    hit = target_distance2 <= 2350**2
                    if hit:
                        hp -= 320
                        reload = 600
                        put(expected, target_health + 8, hp)
                        events_expected += [["targetHp", hp], ["nativeAttackReload"]]
                    events_expected += [
                        ["providedBlockedTile", False],
                        ["providedPathRefresh"],
                        ["providedView", "state"],
                    ]
            for ptr, value in [
                (attack + 0x20, clock),
                (attack + 0xC, elapsed),
                (attack + 0x10, reload),
            ]:
                put(expected, ptr, value)
            expected[attack + 0x1D - heap] = flag1d
            events.clear()
            calls.clear()
            extra_calls.clear()
            startup_calls.clear()
            context["calls"].clear()
            context["pulses"].clear()
            context["set_tick"](step)
            invoke("startup", 0x25C60C, attack)
            if moving or held:
                invoke("movement", 0x260C2C, movement)
            exact(expected, f"recovery {direction}/{scenario}/{active_buffs}/{step}")
            require(
                events == events_expected,
                f"Recovery event order differs at {step}: {events} != {events_expected}",
            )
            require(
                context["pulses"] == request_expected,
                f"Recovery ordinary prefix differs at {step}",
            )
            require(
                startup_calls["fullAttack"] == 1
                and startup_calls["attackReload"] == int(hit)
                and startup_calls["ordinaryRequest"] == len(request_expected)
                and extra_calls["goalSetter"] == int(launched_before)
                and extra_calls["countdownFragment"] == int(charging)
                and calls["movementFrame"] == int(moving or held)
                and calls["movementUpdate"] == int(moving),
                "Recovery driver inventory differs",
            )
            frames.append(
                {
                    "step": step,
                    "state": state,
                    "xy": list(xy),
                    "target": list(target_xy),
                    "targetHp": hp,
                    "clockMs": clock,
                    "elapsedMs": elapsed,
                    "reloadMs": reload,
                    "flag1d": flag1d,
                    "goalTile": tile,
                    "movementHeld": held,
                    "landed": landed,
                    "hit": hit,
                    "supplied": supplied,
                    "events": list(events),
                    "ordinaryRequests": list(context["pulses"]),
                    "calls": dict(
                        sorted((Counter(inventory()) + startup_calls).items())
                    ),
                    "exactHeapChangesOnly": True,
                }
            )
        return {
            "fields": {
                "direction": list(direction),
                "scenario": scenario,
                "recoveryBuffs": list(recovery_buffs),
                "suppliedReloadMs": supplied_reload,
            },
            "frames": frames,
        }

    directions = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    cases = [
        episode(d, scenario)
        for d in directions
        for scenario in ["hit", "miss", "chain"]
    ]
    controls = [
        episode(d, "hit", buffs)
        for d in directions
        for buffs in [("Rage",), ("IceWizardSlowDown",), ("Rage", "IceWizardSlowDown")]
    ]
    controls += [
        episode(d, "hit", supplied_reload=value)
        for d in directions
        for value in [0, 200]
    ]
    definitions = [
        (
            "landingReload",
            0x25C4FA,
            0x25C536,
            "Actual landing LoadTime getter and reload store; this is not a DashCooldown timer.",
        ),
        (
            "completeAttack",
            0x25C60C,
            0x25D068,
            "Complete actual attack update, including recovery and immediate new charge.",
        ),
        (
            "activeClock",
            0x25F754,
            0x25F87E,
            "Actual first-active LoadTime/reload incorporation and integer buff advancement.",
        ),
        (
            "ordinaryReloadPrefix",
            0x25E681,
            0x25E69F,
            "Actual ordinary request reload store; allocation/ordinary target damage excluded by checked boundary.",
        ),
        (
            "movementStop",
            0x263E8A,
            0x263EAC,
            "Actual movement flags and path count reset on entering ordinary attack state 2.",
        ),
        (
            "landingGate",
            0x2157EB,
            0x2159BC,
            "Actual dash hit gate, surviving HP reduction, attack reset and conditional landing reload call.",
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
        require(bool(instructions), "Empty recovery instruction block")
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
        "reference/client/dash-startup-native-trace.json",
        "reference/client/dash-goals-native-trace.json",
        "reference/client/roster-first-attacks-native-trace.json",
    ]
    for path in prerequisites:
        prior = json.loads(Path(path).read_text())
        require(prior["sha256"] == env["sha"], "Recovery prerequisite binary differs")
        for entry in prior["inputs"]:
            require(
                hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
                == entry["sha256"],
                "Recovery prerequisite input differs",
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
            "dashDamage": 320,
            "targetHp": 1000,
            "dashCooldownMs": 1000,
            "loadTimeMs": 600,
            "hitSpeedMs": 1000,
            "range": 750,
            "ownRadius": 600,
            "targetRadius": 500,
            "unitsPerStep": 500,
            "chunkUnits": 250,
            "headingScale": 256,
        },
        "limits": [
            "Complete supplied-target startup, native state entry, open-plane dash frames, landing hit/miss and next complete attack updates execute. Actual successful landing LoadTime reload initializer replaces the earlier no-op boundary. Natural acquisition, world scheduling and collision/index writes remain excluded.",
            "Actual ordinary damage function header and reload prefix execute across the existing checked skip of allocation/level/damage/world work; ordinary target HP is deliberately unchanged. Only surviving native dash HP stores run. Ordinary requests are not proof of downstream normal hits or damage amounts.",
            "Supplied target displacement after launch creates a miss; the next supplied in-range position permits recovery. A supplied new distant position after a hit permits immediate recharging without a newly acquired target. This proves the controlled existing-reference path, not natural new target selection.",
            "Post-landing buff vectors and optional raw reload overrides are supplied controls. Native application/expiry, hard-stun scheduling, shields, lethal paths, post-store reactions, real path refresh and views/facing remain excluded or checked providers. Source Bandit ordinary clocks and successful-hit reload are retained independently of DashCooldown.",
            "Every supplied frame checks all 64-KiB heap changes, ordered external events, ordinary request/reload records and driver inventories. Gameplay remains rules 50.",
        ],
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    output = json.dumps(result, indent=2) + "\n"
    path = Path("reference/client/dash-recovery-native-trace.json")
    if env["args"].check:
        require(path.read_text() == output, "Dash recovery capture differs")
    else:
        path.write_text(output)
    rows = cases + controls
    print(
        json.dumps(
            {
                "cases": len(cases),
                "controls": len(controls),
                "updates": sum(len(r["frames"]) for r in rows),
                "landings": sum(f["landed"] for r in rows for f in r["frames"]),
                "dashHits": sum(f["hit"] for r in rows for f in r["frames"]),
                "ordinaryRequests": sum(
                    len(f["ordinaryRequests"]) for r in rows for f in r["frames"]
                ),
            }
        )
    )
