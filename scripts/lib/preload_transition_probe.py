"""Controlled passive reload and active-clock transitions for source load flags.

Uses actual constructors, setter, main loop and damage reload prefix on fixed
minimal owners. Natural state transitions, movement and damage are supplied.
"""

import hashlib
import json
from pathlib import Path
import re
import subprocess


def capture(env, context):
    cpu, heap, body, data, component = [
        env[k] for k in ["cpu", "heap", "body", "data", "component"]
    ]
    read, write, run, initialize, set_buffs = [
        env[k] for k in ["read", "write", "run", "initialize", "set_buffs"]
    ]
    state, pulses, calls = [context[k] for k in ["state", "pulses", "calls"]]
    roster_path = "reference/client/roster-first-attacks-native-trace.json"
    roster_bytes = Path(roster_path).read_bytes()
    roster = json.loads(roster_bytes)
    if roster["sha256"] != env["sha"]:
        raise RuntimeError("Preload input uses another binary")
    for entry in roster["inputs"]:
        if (
            hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
            != entry["sha256"]
        ):
            raise RuntimeError("Preload source input differs")
    results = []
    for name in ["Knight", "ZapMachine"]:
        source = env["rows"]["reference/logic/characters.csv"][name]
        first_load = source["LoadFirstHit"].lower() == "true"
        load = int(source["LoadTime"] or 0)
        interval = int(source["HitSpeed"])
        baseline = [
            r
            for r in roster["cases"]
            if r["sourceName"] == name and not r["syntheticFirstLoad"]
        ]
        if len(baseline) != 4 or any(
            r["sourceLoadFirstHit"] != first_load
            or r["loadTimeMs"] != load
            or r["hitSpeedMs"] != interval
            for r in baseline
        ):
            raise RuntimeError("Preload profile differs from source roster")
        for buffs in [
            [],
            ["Rage"],
            ["IceWizardSlowDown"],
            ["Rage", "IceWizardSlowDown"],
        ]:
            delta = {
                (): 50,
                ("Rage",): 67,
                ("IceWizardSlowDown",): 32,
                ("Rage", "IceWizardSlowDown"): 43,
            }[tuple(buffs)]
            for scenario in [
                "range-false-owner2",
                "range-false-owner1",
                "range-true-owner1",
                "no-target-owner1",
                "range-true-owner7",
            ]:
                owner_state = (
                    7
                    if scenario.endswith("owner7")
                    else 2 if scenario.endswith("owner2") else 1
                )
                warm_range = scenario in ["range-true-owner1", "range-true-owner7"]
                for warm in [20, 60, 100]:
                    initialize({**source, "LoadTime": source["LoadTime"] or "0"})
                    set_buffs(buffs)
                    cpu.mem_write(data + 0x17D, b"\0")
                    cpu.mem_write(data + 0x288, bytes([first_load]))
                    cpu.mem_write(data + 0x16D, b"\0")
                    for offset, field in [
                        (0x1C4, "StopTimeAfterAttack"),
                        (0x2E0, "VisualHitSpeed"),
                        (0x2E4, "MultipleTargets"),
                        (0x2E8, "Burst"),
                        (0x2EC, "BurstDelay"),
                        (0x2F0, "ActivationTime"),
                        (0x2F4, "AttackDashTime"),
                    ]:
                        write(data + offset, int(source[field] or 0))
                    write(body + 0x60, owner_state)
                    write(body + 0x18, heap + 0xB000)
                    write(heap + 0xB000, heap + 0xC000)
                    write(heap + 0xC000 + 0x20, 0x25FA0C)
                    write(context["config"] + 0x1DC, context["finish_ms"])
                    context["constants"][0x25D6F2] = int(warm_range)
                    context["constants"][0x25D7C2] = 1
                    pulses.clear()
                    calls.clear()
                    context["set_tick"](0)
                    run(0x25C3E6, component, body)
                    target = None if scenario == "no-target-owner1" else "a"
                    run(
                        0x25D4B0,
                        component,
                        0 if target is None else context["target_a"],
                    )
                    elapsed, reload, first_flag = 0, load if first_load else 0, 0
                    expected_state = {
                        "elapsedMs": 0,
                        "reloadMs": reload,
                        "finishMs": 0,
                        "target": target,
                        "flag1d": 0,
                    }
                    constructed = state()
                    if constructed != expected_state:
                        raise RuntimeError("Preload constructor/setter state differs")
                    checkpoints = []
                    expected_pulses = []
                    for tick in range(1, warm + 121):
                        context["set_tick"](tick)
                        if tick == warm + 1:
                            write(body + 0x60, 2)
                            context["constants"][0x25D6F2] = 1
                            run(0x25D4B0, component, context["target_a"])
                            target = "a"
                            if state() != {**expected_state, "target": target}:
                                raise RuntimeError(
                                    "In-range acquisition changed retained clocks"
                                )
                            checkpoints.append(
                                {"tick": tick, "phase": "assigned-ready", **state()}
                            )
                        run(0x25C60C, component, instruction_budget=10000)
                        reload = max(0, reload - 50)
                        active = tick > warm or (warm_range and owner_state != 7)
                        if active:
                            previous = elapsed // interval
                            if elapsed == 0:
                                elapsed += load - reload
                                reload = load
                                first_flag = int(elapsed % interval >= load)
                            elapsed += delta
                            if elapsed // interval > previous:
                                first_flag = 0
                                expected_pulses.append(
                                    {
                                        "tick": tick,
                                        "elapsedMs": elapsed,
                                        "reloadMs": reload,
                                        "finishMs": 0,
                                        "target": "a",
                                        "flag1d": 0,
                                        "hitIndex": -1,
                                        "reloadAfterMs": load,
                                    }
                                )
                                reload = load
                        expected_state = {
                            "elapsedMs": elapsed,
                            "reloadMs": reload,
                            "finishMs": 0,
                            "target": target,
                            "flag1d": first_flag,
                        }
                        if state() != expected_state:
                            raise RuntimeError(
                                json.dumps(
                                    {
                                        "source": name,
                                        "buffs": buffs,
                                        "scenario": scenario,
                                        "warm": warm,
                                        "tick": tick,
                                        "expected": expected_state,
                                        "actual": state(),
                                    }
                                )
                            )
                        if tick in [
                            1,
                            2,
                            3,
                            warm,
                            warm + 1,
                            warm + 2,
                            warm + 3,
                            warm + 20,
                            warm + 100,
                            warm + 120,
                        ]:
                            checkpoints.append(
                                {"tick": tick, "phase": "update", **state()}
                            )
                    if pulses != expected_pulses:
                        raise RuntimeError("Preload transition dispatches differ")
                    results.append(
                        {
                            "source": "characters",
                            "sourceName": name,
                            "loadFirstHit": first_load,
                            "loadTimeMs": load,
                            "hitSpeedMs": interval,
                            "buffs": buffs,
                            "scenario": scenario,
                            "providedWarmOwnerState": owner_state,
                            "providedWarmRange": warm_range,
                            "warmSteps": warm,
                            "activeSteps": 120,
                            "constructed": constructed,
                            "checkpoints": checkpoints,
                            "pulses": list(pulses),
                            "interceptCalls": dict(sorted(calls.items())),
                        }
                    )
    static = [
        (
            "realReloadAndOwnerGate",
            0x25C627,
            0x25C659,
            "Actual reload decrements50 real milliseconds before the raw owner-state7 early return.",
        ),
        (
            "activeClock",
            0x25F754,
            0x25F87E,
            "Actual first active clock includes source LoadTime minus remaining real-time reload, followed by modifier elapsed delta.",
        ),
        (
            "rangeBranch",
            0x25C754,
            0x25C7EC,
            "Actual provided range/target gates choose later main-loop paths.",
        ),
        (
            "elapsedDispatch",
            0x25CAC4,
            0x25CC50,
            "Actual elapsed/interval dispatch and active clock call.",
        ),
        (
            "targetSetter",
            0x25D4B0,
            0x25D6A5,
            "Actual pointer assignment preserves clocks on in-range acquisition; supplied eligibility and movement effects are boundaries.",
        ),
        (
            "damageReload",
            0x25E681,
            0x25E69F,
            "Actual source reload store executes before intercepted damage effects.",
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
        "stepMs": 50,
        "inputs": [
            {"path": roster_path, "sha256": hashlib.sha256(roster_bytes).hexdigest()}
        ],
        "limits": [
            "Actual constructors, target setter, main loop, active clock and damage reload prefix execute on source Knight/ZapMachine rows. Minimal Data, owner state, target/range/eligibility, notifications and owner/world references are supplied.",
            "Raw owner states1/2 are controls rather than inferred moving/attacking labels. In-range raw1 advances its active clock; raw7 exits after the real-time reload decrement. Natural owner state transitions and deployment/stun meaning are not recovered.",
            "Warm phases use provided out-of-range, absent-target or raw7 gates, then assign an in-range target with raw state2. Both source first-load flags and all four modifier modes execute. Every update and dispatch is checked against a separate integer calculation.",
            "Damage side effects, projectiles, HP, real movement, target loss after partial active attacks, complete owner state machines and browser initial deployment scheduling remain outside scope. No gameplay change is made by this capture.",
        ],
        "blocks": blocks,
        "cases": results,
    }
    path = Path("reference/client/preload-transition-native-trace.json")
    encoded = json.dumps(result, indent=2) + "\n"
    if env["args"].check:
        if path.read_text() != encoded:
            raise RuntimeError("Native passive preload transition capture differs")
    else:
        path.write_text(encoded)
    print(
        json.dumps(
            {
                "cases": len(results),
                "updates": sum(r["warmSteps"] + r["activeSteps"] for r in results),
                "pulses": sum(len(r["pulses"]) for r in results),
                "blocks": len(blocks),
            }
        )
    )
