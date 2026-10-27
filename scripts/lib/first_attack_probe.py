"""Controlled native construction and first-attack clock continuation.

Full owner state machines, range, eligibility, scanning and damage allocation
remain supplied boundaries. Actual attack/base/point constructors execute.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess


def capture(env, context):
    cpu, heap, body, data, component = [env[k] for k in ["cpu", "heap", "body", "data", "component"]]
    read, write, run, initialize, set_buffs = [env[k] for k in ["read", "write", "run", "initialize", "set_buffs"]]
    state, pulses, calls = [context[k] for k in ["state", "pulses", "calls"]]
    roster = env["args"].roster_first_attacks
    env["allowed"].extend([
        (0x25c3e6, 0x25c4f9), (0x25f9ba, 0x25fa0c),
        (0x35d220, 0x35d245), (0x35d250, 0x35d281),
        (0x25d95e, 0x25d95f),
    ])
    columns = [
        {"name": "LoadTime", "string": 0x613efe, "gotOffset": 0x1780, "dataOffset": 0x1fc},
        {"name": "VariableDamageTime1", "string": 0x613eb8, "gotOffset": 0x1768},
        {"name": "VariableDamageTime2", "string": 0x613ea4, "gotOffset": 0x1764},
    ]
    if roster:
        columns += [
            {"name": "LoadFirstHit", "string": 0x61438a, "gotOffset": 0x18e4, "dataOffset": 0x288},
            {"name": "AttackDashTime", "string": 0x613d22, "dataOffset": 0x2f4},
        ]
    for column in columns:
        expected = column["name"].encode() + b"\0"
        if bytes(cpu.mem_read(column["string"], len(expected))) != expected:
            raise RuntimeError("Unexpected native clock column string")
    # Extra-target choice is absent; the actual AllTargetsHit fallback remains.
    context["constants"][0x25d95e] = 0
    if env["args"].preload_transitions:
        from lib.preload_transition_probe import capture

        return capture(env, context)
    if env["args"].pending_range:
        from lib.pending_range_probe import capture

        return capture(env, context)
    names = {
        "characters": ["Knight", "Archer", "Musketeer", "Giant", "HogRider", "Balloon", "Prince", "InfernoDragon", "ElectroWizard"],
        "buildings": ["Cannon", "Mortar", "InfernoTower", "KingTower", "PrincessTower"],
    }
    if roster:
        names = {
            table: [name for name, row in env["rows"][f"reference/logic/{table}.csv"].items()
                    if name not in ["", "string"] and int(row["HitSpeed"] or 0) > 0]
            for table in ["characters", "buildings"]
        }
    cases = []
    steps = 240
    for table, source_names in names.items():
        for name in source_names:
            source = env["rows"][f"reference/logic/{table}.csv"][name]
            unsupported = ["StopTimeAfterAttack", "Burst", "BurstDelay", "ActivationTime", "RetargetAfterAttack"]
            if not roster:
                unsupported += ["LoadFirstHit", "AttackDashTime"]
            if any(source[field] for field in unsupported):
                raise RuntimeError(f"Recheck unsupported first-attack profile: {name}")
            source_first_load = source["LoadFirstHit"].lower() == "true"
            variable = all(int(source[field] or 0) > 0 for field in ["VariableDamageTime1", "VariableDamageTime2"])
            for buffs in [[], ["Rage"], ["IceWizardSlowDown"], ["Rage", "IceWizardSlowDown"]]:
                for first_load in [False, True]:
                    initialize({**source, "LoadTime": source["LoadTime"] or "0"})
                    set_buffs(buffs)
                    for buff in buffs:
                        if env["buff_rows"][buff]["AttractPercentage"]:
                            raise RuntimeError("Recheck buff attraction state")
                    cpu.mem_write(data + 0x17d, bytes([variable]))
                    cpu.mem_write(data + 0x288, bytes([first_load]))
                    cpu.mem_write(data + 0x16d, bytes([source["AllTargetsHit"].lower() == "true"]))
                    for offset, field in [(0x1c4, "StopTimeAfterAttack"), (0x2e0, "VisualHitSpeed"),
                                          (0x2e4, "MultipleTargets"), (0x2e8, "Burst"),
                                          (0x2ec, "BurstDelay"), (0x2f0, "ActivationTime"), (0x2f4, "AttackDashTime")]:
                        write(data + offset, int(source[field] or 0))
                    write(body + 0x60, 2)
                    write(body + 0x18, heap + 0xb000)
                    write(heap + 0xb000, heap + 0xc000)
                    write(heap + 0xc000 + 0x20, 0x25fa0c)
                    write(context["config"] + 0x1dc, context["finish_ms"])
                    pulses.clear()
                    calls.clear()
                    context["set_tick"](0)
                    run(0x25c3e6, component, body)
                    constructed = {**state(), "flag1c": cpu.mem_read(component + 0x1c, 1)[0]}
                    if read(component + 4) != body or constructed["reloadMs"] != (int(source["LoadTime"] or 0) if first_load else 0):
                        raise RuntimeError("Unexpected native constructor clocks")
                    run(0x25d4b0, component, context["target_a"])
                    assigned = state()
                    checkpoints = []
                    # Separate integer calculation from the recovered clock
                    # branches, checked against every update and dispatch.
                    elapsed = 0
                    reload = int(source["LoadTime"] or 0) if first_load else 0
                    load = int(source["LoadTime"] or 0)
                    interval = int(source["HitSpeed"])
                    delta = {(): 50, ("Rage",): 67, ("IceWizardSlowDown",): 32,
                             ("Rage", "IceWizardSlowDown"): 43}[tuple(buffs)]
                    expected_pulses = []
                    for tick in range(1, steps + 1):
                        context["set_tick"](tick)
                        run(0x25c60c, component, instruction_budget=8000)
                        reload = max(0, reload - 50)
                        previous_cycle = elapsed // interval
                        advance = True
                        if elapsed == 0:
                            if load > interval:
                                if reload > interval:
                                    advance = False
                                else:
                                    reload = 0
                            else:
                                elapsed += load - reload
                                reload = load
                        if advance:
                            elapsed += delta
                        if elapsed // interval > previous_cycle:
                            indices = [0, 1] if name == "ElectroWizard" else [-1]
                            for index in indices:
                                expected_pulses.append({"tick": tick, "elapsedMs": elapsed,
                                                        "reloadMs": reload, "hitIndex": index,
                                                        "reloadAfterMs": load})
                                reload = load
                        actual = state()
                        if (actual["elapsedMs"], actual["reloadMs"], actual["target"]) != (elapsed, reload, "a"):
                            raise RuntimeError(f"Clock calculation differs: {name}, {buffs}, {first_load}, tick {tick}")
                        if tick <= 5 or tick in [8, 16, 20, 24, 30, 40, 60, 80, 100, 120, 160, 200, 240]:
                            checkpoints.append({"tick": tick, **state()})
                    measured = [{key: pulse[key] for key in ["tick", "elapsedMs", "reloadMs", "hitIndex", "reloadAfterMs"]} for pulse in pulses]
                    if (not roster and not pulses) or measured != expected_pulses:
                        raise RuntimeError(f"Dispatch calculation differs: {name}, {buffs}, {first_load}")
                    cases.append({"sourceTable": table, "sourceName": name, "buffs": buffs,
                                  **({"sourceLoadFirstHit": source_first_load, "attackDashTimeMs": int(source["AttackDashTime"] or 0)} if roster else {}),
                                  "loadFirstHit": first_load, "syntheticFirstLoad": first_load != source_first_load,
                                  "hitSpeedMs": int(source["HitSpeed"]), "loadTimeMs": int(source["LoadTime"] or 0),
                                  "variableDamage": variable, "constructed": constructed, "assigned": assigned,
                                  "pulses": list(pulses), "checkpoints": checkpoints,
                                  "interceptCalls": dict(sorted(calls.items()))})

    static = [
        ("loadColumn", 0x1db4f2, 0x1db520, "LoadTime caches at GOT+0x1780."),
        ("loadField", 0x1d9bdd, 0x1d9bf5, "The integer LoadTime column loads into Data+0x1fc."),
        ("variableColumns", 0x1db2a7, 0x1db328, "VariableDamageTime2/1 cache at GOT+0x1764/0x1768."),
        ("variableFlag", 0x1dad37, 0x1dad74, "Both positive variable-damage times enable Data+0x17d."),
        ("constructor", 0x25c3e6, 0x25c4f9, "Actual attack constructor initializes elapsed and flags; LoadFirstHit selects initial reload."),
        ("baseConstructor", 0x25f9ba, 0x25fa0c, "Actual base constructor asserts non-null owner and stores it."),
        ("pointConstructor", 0x35d250, 0x35d281, "Actual point constructor calls zero initialization."),
        ("pointZero", 0x35d220, 0x35d245, "Actual point initialization zeros both coordinates."),
        ("reloadDecrement", 0x25c627, 0x25c640, "Each main-loop update subtracts 50 real ms from reload with a zero clamp."),
        ("activeClock", 0x25f754, 0x25f87e, "The first active update incorporates LoadTime minus remaining reload; later elapsed advances by the native buff delta. LoadTime above HitSpeed takes a separate gate."),
        ("pulseBoundary", 0x25cac4, 0x25cc50, "Actual elapsed/HitSpeed crossing and active-clock update choose dispatches."),
        ("damageReload", 0x25e681, 0x25e69f, "Actual damage prefix reloads the source LoadTime."),
    ]
    if roster:
        static += [
            ("firstLoadColumn", 0x1dd4d9, 0x1dd501, "Static LoadFirstHit string/column binding caches at GOT+0x18e4."),
            ("firstLoadField", 0x1d9c0d, 0x1d9c25, "Static boolean column read stores LoadFirstHit at Data+0x288."),
            ("attackDashField", 0x1db193, 0x1db1bb, "Static AttackDashTime source-name integer read stores Data+0x2f4."),
        ]
    blocks = []
    for name, start, end, interpretation in static:
        assembly = subprocess.check_output(["objdump", "-d", "-Mintel", f"--start-address={start:#x}", f"--stop-address={end:#x}", str(env["args"].library)], text=True)
        instructions = [re.sub(r"\s+<[^>]+>", "", line.strip()) for line in assembly.splitlines() if re.match(r"\s+[0-9a-f]+:", line)]
        blocks.append({"name": name, "start": hex(start), "end": hex(end), "interpretation": interpretation, "instructions": instructions})
    output = json.dumps({
        "source": "apk/1.8.1/x86/libg.so", "sha256": env["sha"], "emulator": "unicorn==2.1.4",
        "stepMs": 50, "steps": steps,
        "inputs": [*env["inputs"], {"path": context["globals_path"], "sha256": hashlib.sha256(context["globals_bytes"]).hexdigest()}],
        "limits": [
            "Source-selected minimal Data profiles, not full table loading or inheritance. Blank numeric fields supply zero. Data variable-damage flag follows both positive source times.",
            ("Actual attack, base and point constructors execute. Every positive archived HitSpeed row is selected, including unused/spawner data rows without a claim that they naturally construct an attack component. ZapMachine's true LoadFirstHit is retained; each opposite first-load setting is a synthetic control. Source Bat AttackDashTime=150 is supplied under the same fixed owner state."
             if roster else "Actual attack, base and point constructors execute. Archived LoadFirstHit is false in all selected rows; true cases are synthetic controls."),
            "Owner state is fixed at numeric 2, with no movement component, supplied in-range eligible primary and no scanned primary/extra target. Full owner/deployment/movement/control/Freeze/Zap state machines do not execute.",
            "Owner/data/world resolution and state/aim/movement notifications are supplied. Only ATTACK_FINISH_TIME_MS is populated in Globals; other fields remain zero.",
            "Actual main loop, setter and damage reload prefix execute. Damage dispatch records hit indices and reload, then restores its frame before damage allocation. HP, projectiles, level scaling and target death are outside this capture.",
            "Uninterrupted 20-Hz integer clocks are controlled evidence; they do not establish browser timing changes or live initial-owner state behavior.",
        ], "sourceColumns": columns, "blocks": blocks, "cases": cases,
    }, indent=2) + "\n"
    path = Path("reference/client/roster-first-attacks-native-trace.json" if roster else "reference/client/first-attacks-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native first-attacks capture differs")
    else:
        path.write_text(output)
    print(json.dumps({"cases": len(cases), "updates": len(cases) * steps,
                      "pulses": sum(len(case["pulses"]) for case in cases), "blocks": len(blocks)}))
