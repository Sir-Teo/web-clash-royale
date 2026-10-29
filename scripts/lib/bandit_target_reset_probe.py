"""Complete supplied Bandit null/removal transitions and close reselection.

Actual setters, removal notification, clocks and request reload prefixes run.
Natural acquisition, death propagation and ordinary packet work stay outside.
"""

from collections import Counter
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess

from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_READ
from unicorn.x86_const import (
    UC_X86_REG_EAX,
    UC_X86_REG_EDI,
    UC_X86_REG_EIP,
    UC_X86_REG_ESP,
)


def capture(env, context, lifecycle, goal, shared):
    require = shared["require"]
    (
        cpu,
        heap,
        body,
        data,
        attack,
        movement,
        health,
        world,
        buffs,
        settings,
        view,
        view_vt,
    ) = [
        shared[k]
        for k in [
            "cpu",
            "heap",
            "body",
            "data",
            "attack",
            "movement",
            "health",
            "world",
            "buffs",
            "settings",
            "view",
            "view_vt",
        ]
    ]
    read, write, put, snapshot, exact, invoke, inventory, set_buffs, buff_delta = [
        shared[k]
        for k in [
            "read",
            "write",
            "put",
            "snapshot",
            "exact",
            "invoke",
            "inventory",
            "set_buffs",
            "buff_delta",
        ]
    ]
    events, calls, extra_calls, startup_calls = [
        shared[k] for k in ["events", "calls", "extra_calls", "startup_calls"]
    ]
    a, b = shared["target"], context["target_b"]
    a_health, b_health = shared["target_health"], heap + 0x9800
    a_data, b_data = shared["target_data"], heap + 0xA800
    manager, row = shared["manager"], shared["row"]
    require(a == heap + 0x8000 and b == heap + 0x8800, "Recheck separate target layout")
    source = env["rows"]["reference/logic/characters.csv"]["Assassin"]
    require(
        source["DashCooldown"] == "1000"
        and source["HitSpeed"] == "1000"
        and source["LoadTime"] == "600"
        and not source["LoadFirstHit"]
        and not source["SelfAsAoeCenter"]
        and not source["Projectile"],
        "Recheck Bandit target-reset source fields",
    )
    globals_rows = {
        r["Name"]: r
        for r in csv.DictReader(io.StringIO(context["globals_bytes"].decode()))
    }
    finish_limit = int(globals_rows["ATTACK_FINISH_TIME_MS"]["NumberValue"])
    allow = globals_rows["ALLOW_AOE_ATTACKS_WITHOUT_TARGET"]["BooleanValue"] == "TRUE"
    require(finish_limit == 250 and allow, "Recheck source target-loss globals")
    env["allowed"].extend(
        [
            (0x25F6B4, 0x25F73C),
            (0x1DEF2C, 0x1DEF40),
            (0x1DDC08, 0x1DDC26),
            (0x1FB83A, 0x1FB84B),
        ]
    )
    names = {
        0x25F594: "targetRemoval",
        0x25FA0C: "removalBase",
        0x25F6B4: "targetlessPolicy",
        0x25F87E: "inactiveClock",
    }
    selected, global_reads, policy_returns = Counter(), set(), []

    def hook(_cpu, pc, _size, _data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        selected[names[pc]] += 1
        require(read(sp + 4) == attack, "Target-reset driver owner differs")
        if pc in [0x25F594, 0x25FA0C]:
            require(
                read(sp + 8) in [a, b]
                and [read(sp + i) for i in [12, 16, 20]] == [0, 0, 0],
                "Removal notification arguments differ",
            )

    def memory(_cpu, _access, address, size, _value, _data):
        global_reads.add((address - settings, size, cpu.reg_read(UC_X86_REG_EIP)))

    def policy_exit(_cpu, _pc, _size, _data):
        value = cpu.reg_read(UC_X86_REG_EAX)
        require(value == 1, "Bandit targetless policy must choose the finish branch")
        selected["targetlessPolicyExit"] += 1
        policy_returns.append(value)

    def expiry(_cpu, _pc, _size, _data):
        require(cpu.reg_read(UC_X86_REG_EDI) == attack, "Finish expiry owner differs")
        selected["finishExpiry"] += 1

    for pc in names:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)
    cpu.hook_add(UC_HOOK_CODE, policy_exit, begin=0x25F735, end=0x25F735)
    cpu.hook_add(UC_HOOK_CODE, expiry, begin=0x25CAAF, end=0x25CAAF)
    cpu.hook_add(UC_HOOK_MEM_READ, memory, begin=settings, end=settings + 0x7FF)

    def label(pointer):
        require(pointer in [0, a, b], "Unexpected target-reset reference")
        return {0: None, a: "a", b: "b"}[pointer]

    def state():
        return {
            "target": label(read(attack + 8)),
            "elapsedMs": read(attack + 0xC),
            "reloadMs": read(attack + 0x10),
            "finishMs": read(attack + 0x28),
            "flag1d": cpu.mem_read(attack + 0x1D, 1)[0],
            "cached": [read(attack + 0x34), read(attack + 0x38)],
        }

    def episode(direction, method, modifiers=(), warm=3, gap=4):
        dx, dy = direction
        positions = {
            "a": [8250 + 1750 * dx, 8250 + 1750 * dy],
            "b": [8250 - 1750 * dx, 8250 - 1750 * dy],
        }
        pointers = {None: 0, "a": a, "b": b}
        cpu.mem_write(heap, b"\0" * 0x10000)
        fields = [
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
            (body + 0x20, 8250),
            (body + 0x24, 8250),
            (body + 0x38, 15),
            (body + 0x3C, attack),
            (attack + 4, body),
            (attack + 8, a),
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
            (settings + 0x1DC, finish_limit),
        ]
        for name, ptr, hp, model in [
            ("a", a, a_health, a_data),
            ("b", b, b_health, b_data),
        ]:
            fields += [
                (ptr, 0x7B34A0),
                (ptr + 0x10, model),
                (ptr + 0x20, positions[name][0]),
                (ptr + 0x24, positions[name][1]),
                (ptr + 0x38, 4),
                (ptr + 0x44, hp),
                (hp + 4, ptr),
                (hp + 8, 1000),
                (model + 0x22C, 500),
            ]
        for ptr, value in fields:
            write(ptr, value)
        cpu.mem_write(settings + 0x201, bytes([allow]))
        cpu.mem_write(settings + 0x295, b"\1")
        set_buffs(modifiers)
        current, elapsed, reload, finish, flag, cached = "a", 0, 0, 0, 0, [0, 0]
        delta = buff_delta(modifiers, "HitSpeedMultiplier")
        loss_at = warm + 1
        resume_at = loss_at + gap if method in ["null", "removal"] else None
        frames = []
        for step in range(1, 61):
            for counter in [
                calls,
                extra_calls,
                startup_calls,
                selected,
                context["calls"],
            ]:
                counter.clear()
            events.clear()
            policy_returns.clear()
            context["pulses"].clear()
            context["set_tick"](step)
            operations, expected_events = [], []
            setter_calls = removal_calls = setter_validity = op_resets = 0
            commands = []
            if step == loss_at:
                commands.append(
                    ("set", None)
                    if method == "null"
                    else (
                        ("remove", "a")
                        if method == "removal"
                        else (
                            ("set", "b")
                            if method == "switch"
                            else (
                                ("set", "a") if method == "refresh" else ("remove", "b")
                            )
                        )
                    )
                )
            if step == resume_at:
                commands.append(("set", "b"))
            for command, destination in commands:
                before_state, expected = state(), bytearray(snapshot())
                operation_events = []
                if command == "set":
                    setter_calls += 1
                    if current != destination:
                        current = destination
                        put(expected, attack + 8, pointers[current])
                        if current is None:
                            put(expected, attack + 0x20, 0)
                            operation_events.append(["providedReset"])
                            op_resets += 1
                        else:
                            setter_validity += 1
                        if finish == 0:
                            operation_events.append(["providedPathRefresh"])
                    if current:
                        cached = list(positions[current])
                else:
                    removal_calls += 1
                    if current == destination:
                        current = None
                        put(expected, attack + 8, 0)
                        if elapsed > 0:
                            finish = 1
                            put(expected, attack + 0x28, finish)
                for ptr, value in zip([attack + 0x34, attack + 0x38], cached):
                    put(expected, ptr, value)
                index = len(events)
                invoke(
                    "startup",
                    0x25D4B0 if command == "set" else 0x25F594,
                    *(
                        [attack, pointers[destination]]
                        if command == "set"
                        else [attack, pointers[destination], 0, 0, 0]
                    ),
                )
                exact(expected, f"target operation {direction}/{method}/{step}")
                require(
                    events[index:] == operation_events, "Target operation events differ"
                )
                expected_events += operation_events
                after_state = {
                    "target": current,
                    "elapsedMs": elapsed,
                    "reloadMs": reload,
                    "finishMs": finish,
                    "flag1d": flag,
                    "cached": list(cached),
                }
                require(state() == after_state, "Target operation clock differs")
                operations.append(
                    {
                        "method": command,
                        "reference": destination,
                        "before": before_state,
                        "after": after_state,
                        "events": operation_events,
                        "exactHeapChangesOnly": True,
                    }
                )
            expected = bytearray(snapshot())
            finish_before = finish
            policy = current is None and flag != 0
            reload = max(0, reload - 50)
            requests = []
            notify_reset = False
            if current is None:
                if finish > 0:
                    finish += 50
                if finish == 0 or finish >= finish_limit:
                    elapsed, finish, flag = 0, 0, 0
                    notify_reset = finish_before == 0
                    for offset in [0xC, 0x14, 0x28, 0x40]:
                        put(expected, attack + offset, 0)
                    if notify_reset:
                        expected_events.append(["providedReset"])
            else:
                cached = list(positions[current])
                cycle = elapsed // 1000
                if elapsed == 0:
                    elapsed += 600 - reload
                    reload = 600
                    flag = int(elapsed % 1000 >= 600)
                elapsed += delta
                if elapsed // 1000 > cycle:
                    flag = 0
                    expected_events += [
                        ["providedView", "attack"],
                        ["ordinaryRequest", -1],
                    ]
                    requests = [
                        {
                            "tick": step,
                            "elapsedMs": elapsed,
                            "reloadMs": reload,
                            "finishMs": finish,
                            "target": current,
                            "flag1d": 0,
                            "hitIndex": -1,
                            "reloadAfterMs": 600,
                        }
                    ]
                    reload = 600
            for offset, value in [
                (0xC, elapsed),
                (0x10, reload),
                (0x28, finish),
                (0x34, cached[0]),
                (0x38, cached[1]),
            ]:
                put(expected, attack + offset, value)
            expected[attack + 0x1D - heap] = flag
            invoke("startup", 0x25C60C, attack)
            exact(expected, f"target update {direction}/{method}/{step}")
            require(
                events == expected_events and context["pulses"] == requests,
                f"Target-reset events/requests differ at {direction}/{method}/{step}: {events}",
            )
            drivers = Counter(inventory()) + startup_calls + selected
            wanted = {
                "fullAttack": 1,
                "targetSetter": setter_calls,
                "targetRemoval": removal_calls,
                "removalBase": removal_calls,
                "providedValidity": int(current is not None) + setter_validity,
                "admission": 2 * int(current is not None),
                "buffClock": int(current is not None),
                "ordinaryRequest": len(requests),
                "providedPrimaryScan": int(current is None and finish_before == 0),
                "providedExtraScan": 0,
                "targetlessPolicy": int(policy),
                "targetlessPolicyExit": int(policy),
                "finishExpiry": int(
                    current is None
                    and finish_before > 0
                    and finish_before + 50 >= finish_limit
                ),
                "inactiveClock": int(notify_reset),
                "providedReset": op_resets + int(notify_reset),
                "countdownFragment": 0,
                "movementFrame": 0,
                "attackReload": 0,
            }
            require(
                all(drivers[name] == value for name, value in wanted.items()),
                f"Target-reset selected drivers differ at {direction}/{method}/{step}: {dict(drivers)} != {wanted}",
            )
            require(
                read(body + 0x60) == 2 and read(attack + 0x20) == 0,
                "Unexpected target-reset dash or actor state",
            )
            frames.append(
                {
                    "step": step,
                    **state(),
                    "operations": operations,
                    "events": list(events),
                    "ordinaryRequests": list(context["pulses"]),
                    "policyReturns": list(policy_returns),
                    "calls": dict(sorted(drivers.items())),
                    "targetHp": [1000, 1000],
                    "exactHeapChangesOnly": True,
                }
            )
        return {
            "fields": {
                "direction": list(direction),
                "method": method,
                "modifiers": list(modifiers),
                "warmUpdates": warm,
                "gapUpdates": gap,
                "lossUpdate": loss_at,
                "resumeUpdate": resume_at,
                "targetPoints": positions,
            },
            "frames": frames,
        }

    directions = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    cases = [episode(d, method) for d in directions for method in ["null", "removal"]]
    controls = [
        episode(d, method, modifier)
        for d in directions
        for modifier in [
            ("Rage",),
            ("IceWizardSlowDown",),
            ("Rage", "IceWizardSlowDown"),
        ]
        for method in ["null", "removal"]
    ]
    controls += [
        episode(d, method, gap=gap)
        for d in directions
        for gap in [0, 1, 16]
        for method in ["null", "removal"]
    ]
    controls += [
        episode(d, method, warm=warm)
        for d in directions
        for warm in [0, 8]
        for method in ["null", "removal"]
    ]
    controls += [
        episode(d, method)
        for d in directions
        for method in ["switch", "refresh", "other-removal"]
    ]
    definitions = [
        (
            "setter",
            0x25D4B0,
            0x25D6F2,
            "Actual close/null setter, cached point and source DashCooldown reset branch.",
        ),
        (
            "removal",
            0x25F594,
            0x25F6B4,
            "Actual current/other removal notification and finish-clock initialization.",
        ),
        (
            "targetlessPolicy",
            0x25F6B4,
            0x25F73C,
            "Actual source global, self-center and primary-projectile policy.",
        ),
        (
            "inactiveClock",
            0x25F87E,
            0x25F8D3,
            "Actual elapsed/flag/finish clear preserving reload, with supplied zero reset gate.",
        ),
        (
            "finishExpiry",
            0x25CA86,
            0x25CAB4,
            "Actual finish-clock real-time increment and inclusive threshold branch to the inline reset; no owner notification.",
        ),
        (
            "inlineReset",
            0x25C968,
            0x25C988,
            "Actual finish expiry clears elapsed/flag/finish fields without calling the inactive helper.",
        ),
        (
            "completeAttack",
            0x25C60C,
            0x25D068,
            "Complete actual updates through close attacks, finish grace, targetless resets and reselection.",
        ),
        (
            "activeClock",
            0x25F754,
            0x25F87E,
            "Actual retained reload incorporation and integer buff advancement.",
        ),
        (
            "ordinaryReload",
            0x25E681,
            0x25E69F,
            "Real ordinary reload prefix; selected packet allocation/delivery excluded.",
        ),
        (
            "finishGlobal",
            0x1F3568,
            0x1F357B,
            "Actual 250-ms ATTACK_FINISH_TIME_MS getter.",
        ),
        (
            "dashPresence",
            0x1DE724,
            0x1DE73E,
            "Actual positive Data DashCooldown test used by the null setter.",
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
        require(bool(instructions), "Empty target-reset native block")
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
        "reference/client/bandit-ordinary-native-trace.json",
        "reference/client/target-loss-clock-native-trace.json",
        "reference/client/targetless-policy-native-trace.json",
    ]
    for path in prerequisites:
        prior = json.loads(Path(path).read_text())
        require(
            prior["sha256"] == env["sha"], "Target-reset prerequisite binary differs"
        )
        for entry in prior["inputs"]:
            require(
                hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
                == entry["sha256"],
                "Target-reset prerequisite source differs",
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
            "targets": ["Knight", "Knight"],
            "targetHp": [1000, 1000],
            "loadTimeMs": 600,
            "hitSpeedMs": 1000,
            "dashCooldownMs": 1000,
            "finishTimeMs": finish_limit,
            "allowAoeWithoutTarget": allow,
            "loadFirstHit": False,
            "selfAsAoeCenter": False,
            "hasProjectile": False,
            "targetlessPolicyReturn": 1,
            "initialExtraClockMs": 0,
            "targetDistance": 1750,
            "ownRadius": 600,
            "targetRadius": 500,
        },
        "limits": [
            "Supplied state-2 Bandit, two distinct close Knight references and source-selected minimal Data run through real setters, current/other removal notification, complete attack updates, targetless policy, active/inactive clocks and ordinary reload prefixes. Targets stay healthy and stationary. Natural death/removal propagation, acquisition/scanner selection, world registration and actor scheduling remain excluded.",
            "Null assignment, removal notifications, immediate/delayed reselection, direct switching and same-reference refresh are explicit calls between supplied updates. Source finish time 250 ms and ALLOW_AOE_ATTACKS_WITHOUT_TARGET true are installed in the shared settings object. Source Bandit has no projectile or self-centered area, so actual targetless policy returns 1 and chooses the finish branch rather than attacking without a target.",
            "Native surviving health/damage paths do not execute. Ordinary headers/reload prefixes use the existing checked skip of packet construction, levels, delivery and world work. Both target HP values remain 1000; request timing is not proof of a hit. Native shields, stun, navigation, full world/views and natural modifier application/expiry remain excluded.",
            "Each setter/notification and full update checks the whole supplied 64-KiB heap, exact clock/reference/cached-point state, ordered events and selected driver inventories. The second target has a separate body, Data and health allocation; only this mode moves the root target-B label to the free 0x8800 slot. Earlier captures retain their layout and output.",
            "Gameplay remains rules 55. This separate evidence does not change runtime target-loss, cancellation or reselection behavior.",
        ],
        "globalReads": [
            {"offset": hex(offset), "size": size, "pc": hex(pc)}
            for offset, size, pc in sorted(global_reads)
        ],
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    output = json.dumps(result, indent=2) + "\n"
    path = Path("reference/client/bandit-target-reset-native-trace.json")
    if env["args"].check:
        require(path.read_text() == output, "Bandit target-reset capture differs")
    else:
        path.write_text(output)
    frames = [f for r in cases + controls for f in r["frames"]]
    print(
        json.dumps(
            {
                "cases": len(cases),
                "controls": len(controls),
                "updates": len(frames),
                "operations": sum(len(f["operations"]) for f in frames),
                "ordinaryRequests": sum(len(f["ordinaryRequests"]) for f in frames),
            }
        )
    )
