"""Controlled target removal/null assignment through actual attack clocks.

Constructors, setter/removal, targetless policy, main loop and dispatch reload
prefix execute. Owner/world state, target eligibility/range, source Data and
projectile references are supplied; damage/projectile allocation does not run.
"""

import csv
import hashlib
import io
import json
import math
from pathlib import Path
import re
import subprocess
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_READ
from unicorn.x86_const import UC_X86_REG_EIP


def capture(env, context):
    cpu, heap, body, data, component = [
        env[k] for k in ["cpu", "heap", "body", "data", "component"]
    ]
    read, write, run, initialize, set_buffs = [
        env[k] for k in ["read", "write", "run", "initialize", "set_buffs"]
    ]
    state, pulses, calls = [context[k] for k in ["state", "pulses", "calls"]]
    config = context["config"]
    paths = [
        "reference/client/targetless-policy-native-trace.json",
        "reference/client/roster-first-attacks-native-trace.json",
        "reference/logic/characters.csv",
        "reference/logic/buildings.csv",
        "reference/logic/projectiles.csv",
        "reference/logic/globals.csv",
        "reference/logic/character_buffs.csv",
    ]
    inputs = [
        {"path": path, "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest()}
        for path in paths
    ]
    for path in paths[:2]:
        reference = json.loads(Path(path).read_text())
        if reference["sha256"] != env["sha"]:
            raise RuntimeError("Target-loss reference uses another binary")
        for entry in reference["inputs"]:
            if (
                hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
                != entry["sha256"]
            ):
                raise RuntimeError("Target-loss reference input differs")
    projectiles = {
        row["Name"]: row
        for row in csv.DictReader(io.StringIO(Path(paths[4]).read_text()))
    }
    source_allow = (
        context["globals_rows"]["ALLOW_AOE_ATTACKS_WITHOUT_TARGET"]["BooleanValue"]
        == "TRUE"
    )
    finish_limit = context["finish_ms"]
    if not source_allow or finish_limit != 250:
        raise RuntimeError("Recheck source target-loss globals")
    env["allowed"].extend(
        [
            (0x25D6A5, 0x25D6F2),
            (0x25F6B4, 0x25F73C),
            (0x1DEF2C, 0x1DEF40),
            (0x1DDC08, 0x1DDC26),
            (0x1FB83A, 0x1FB84B),
        ]
    )
    observed, global_reads = [], set()

    def observe(_cpu, address, _size, _data):
        observed.append(hex(address))

    def memory(_cpu, _access, address, size, _value, _data):
        global_reads.add((address - config, size, cpu.reg_read(UC_X86_REG_EIP)))

    for address in [0x25CA62, 0x25CA7A, 0x25CA86, 0x25CAB4]:
        cpu.hook_add(UC_HOOK_CODE, observe, begin=address, end=address)
    cpu.hook_add(UC_HOOK_MEM_READ, memory, begin=config, end=config + 0x7FF)
    names = {
        "characters": [
            "Knight",
            "Archer",
            "Valkyrie",
            "Bomber",
            "Princess",
            "Bowler",
            "AxeMan",
            "ZapMachine",
        ],
        "buildings": ["Mortar", "BombTower"],
    }
    modes = [
        ([], 50),
        (["Rage"], 67),
        (["IceWizardSlowDown"], 32),
        (["Rage", "IceWizardSlowDown"], 43),
    ]
    cases, controls, profiles = [], [], []
    updates = 0

    def sample(table, source, buffs, delta, warm, method, allow, kind):
        nonlocal updates
        interval, load = int(source["HitSpeed"]), int(source["LoadTime"] or 0)
        first = source["LoadFirstHit"].lower() == "true"
        self_center, present = source["SelfAsAoeCenter"].lower() == "true", bool(
            source["Projectile"]
        )
        homing = (
            present and projectiles[source["Projectile"]]["Homing"].lower() == "true"
        )
        preserve = allow and (self_center or (present and not homing))
        initialize({**source, "LoadTime": source["LoadTime"] or "0"})
        set_buffs(buffs)
        cpu.mem_write(data + 0x17D, b"\0")
        cpu.mem_write(data + 0x288, bytes([first]))
        cpu.mem_write(data + 0x16D, bytes([source["AllTargetsHit"].lower() == "true"]))
        cpu.mem_write(data + 0x291, bytes([self_center]))
        cpu.mem_write(config + 0x201, bytes([allow]))
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
        if present:
            write(data + 0x28, heap + 0xE000)
            cpu.mem_write(heap + 0xE078, bytes([homing]))
        write(body + 0x60, 2)
        write(body + 0x18, heap + 0xB000)
        write(heap + 0xB000, heap + 0xC000)
        write(heap + 0xC000 + 0x20, 0x25FA0C)
        write(config + 0x1DC, finish_limit)
        write(body + 0x20, 2000)
        write(body + 0x24, 2000)
        write(context["target_a"] + 0x20, 3000)
        write(context["target_a"] + 0x24, 4000)
        context["constants"][0x25D6F2] = 1
        context["constants"][0x25D7C2] = 1
        pulses.clear()
        calls.clear()
        observed.clear()
        context["set_tick"](0)
        run(0x25C3E6, component, body)
        run(0x25D4B0, component, context["target_a"])
        elapsed, reload, flag, finish, target = 0, load if first else 0, 0, 0, "a"
        expected_pulses, checkpoints = [], []

        def expected_state():
            return {
                "elapsedMs": elapsed,
                "reloadMs": reload,
                "finishMs": finish,
                "target": target,
                "flag1d": flag,
            }

        def point(tick, phase):
            actual = state()
            if actual != expected_state():
                raise RuntimeError(
                    json.dumps(
                        {
                            "profile": source["Name"],
                            "buffs": buffs,
                            "warm": warm,
                            "method": method,
                            "allow": allow,
                            "tick": tick,
                            "phase": phase,
                            "expected": expected_state(),
                            "actual": actual,
                        }
                    )
                )
            raw = {
                hex(offset): read(component + offset)
                for offset in [0x2C, 0x30, 0x34, 0x38, 0x40]
            }
            if raw != {"0x2c": 0, "0x30": 0, "0x34": 3000, "0x38": 4000, "0x40": 0}:
                raise RuntimeError(
                    "Target-loss cached point or supplied raw fields differ"
                )
            checkpoints.append(
                {
                    "tick": tick,
                    "phase": phase,
                    **actual,
                    "raw": raw,
                    "branches": list(observed),
                }
            )

        point(0, "constructed")
        first_tick = math.ceil((interval - (50 if first else load)) / delta)
        after = max(8, first_tick - warm + 6)
        for tick in range(1, warm + after + 1):
            context["set_tick"](tick)
            observed.clear()
            if tick == warm + 1:
                point(tick, "before-loss")
                if method == "null-setter":
                    run(0x25D4B0, component, 0)
                    if first:
                        elapsed, reload, flag, finish = 0, load, 0, 0
                    target = None
                else:
                    removed = (
                        context["target_b"]
                        if method == "other-removal"
                        else context["target_a"]
                    )
                    run(0x25F594, component, removed, 0, 0, 0)
                    if method != "other-removal":
                        if first and elapsed > 0:
                            reload = max(0, load - elapsed)
                            elapsed, flag, finish = 0, 0, 0
                        elif not first and elapsed > 0:
                            finish = 1
                        target = None
                point(tick, "after-loss")
            reload = max(0, reload - 50)
            policy_called = target is None and bool(flag)
            active = target is not None or (policy_called and preserve)
            expected_branches = ["0x25ca62"]
            if target is None:
                if policy_called:
                    expected_branches.append("0x25ca7a")
                expected_branches.append("0x25cab4" if active else "0x25ca86")
            else:
                expected_branches.append("0x25cab4")
            if active:
                previous = elapsed // interval
                if elapsed == 0:
                    elapsed += load - reload
                    reload = load
                    flag = int(elapsed % interval >= load)
                elapsed += delta
                if elapsed // interval > previous:
                    flag = 0
                    expected_pulses.append(
                        {
                            "tick": tick,
                            "elapsedMs": elapsed,
                            "reloadMs": reload,
                            "finishMs": finish,
                            "target": target,
                            "flag1d": 0,
                            "hitIndex": -1,
                            "reloadAfterMs": load,
                        }
                    )
                    reload = load
            else:
                if finish > 0:
                    finish += 50
                if finish == 0 or finish >= finish_limit:
                    elapsed, flag, finish = 0, 0, 0
            run(0x25C60C, component, instruction_budget=10000)
            updates += 1
            if observed != expected_branches:
                raise RuntimeError(
                    json.dumps(
                        {
                            "unexpectedBranches": observed,
                            "expected": expected_branches,
                            "source": source["Name"],
                            "tick": tick,
                        }
                    )
                )
            point(tick, "update")
        if pulses != expected_pulses:
            raise RuntimeError("Native target-loss dispatch clocks differ")
        lost_pulses = [p for p in pulses if p["target"] is None]
        if len(lost_pulses) > 1 or bool(lost_pulses) != (
            warm > 0 and preserve and not first and method != "other-removal"
        ):
            raise RuntimeError("Native target-loss dispatch count differs")
        return {
            "kind": kind,
            "sourceTable": table,
            "sourceName": source["Name"],
            "buffs": buffs,
            "deltaMs": delta,
            "intervalMs": interval,
            "loadTimeMs": load,
            "loadFirstHit": first,
            "selfAsAoeCenter": self_center,
            "hasProjectile": present,
            "projectileHoming": homing,
            "allowWithoutTarget": allow,
            "warmSteps": warm,
            "method": method,
            "afterSteps": after,
            "checkpoints": checkpoints,
            "pulses": list(pulses),
            "calls": dict(calls),
        }

    for table, entries in names.items():
        for name in entries:
            source = env["rows"][f"reference/logic/{table}.csv"][name]
            first = source["LoadFirstHit"].lower() == "true"
            self_center, present = source["SelfAsAoeCenter"].lower() == "true", bool(
                source["Projectile"]
            )
            preserve = self_center or (
                present
                and projectiles[source["Projectile"]]["Homing"].lower() != "true"
            )
            profiles.append(
                {
                    "sourceTable": table,
                    "sourceName": name,
                    "allowContinuation": preserve,
                    "loadFirstHit": first,
                }
            )
            for buffs, delta in modes:
                first_tick = math.ceil(
                    (
                        int(source["HitSpeed"])
                        - (50 if first else int(source["LoadTime"] or 0))
                    )
                    / delta
                )
                if first_tick <= 1:
                    raise RuntimeError("Recheck pending-attack warm profiles")
                for method in ["null-setter", "notification"]:
                    for warm in sorted({1, first_tick - 1}):
                        cases.append(
                            sample(
                                table,
                                source,
                                buffs,
                                delta,
                                warm,
                                method,
                                source_allow,
                                "sourceProfile",
                            )
                        )
                        if preserve:
                            controls.append(
                                sample(
                                    table,
                                    source,
                                    buffs,
                                    delta,
                                    warm,
                                    method,
                                    not source_allow,
                                    "oppositeGlobalControl",
                                )
                            )
                    controls.append(
                        sample(
                            table,
                            source,
                            buffs,
                            delta,
                            0,
                            method,
                            source_allow,
                            "unstartedControl",
                        )
                    )
            controls.append(
                sample(
                    table,
                    source,
                    [],
                    50,
                    1,
                    "other-removal",
                    source_allow,
                    "unmatchedRemovalControl",
                )
            )
    if {offset for offset, _size, _pc in global_reads} != {0x1DC, 0x201}:
        raise RuntimeError(
            json.dumps(
                {
                    "unboundGlobals": [
                        (hex(a), b, hex(c)) for a, b, c in sorted(global_reads)
                    ]
                }
            )
        )
    static = [
        (
            "removal",
            0x25F594,
            0x25F6B3,
            "Actual matching/nonmatching removal, first-load reload rule and finish marker.",
        ),
        (
            "targetlessGate",
            0x25CA62,
            0x25CAB4,
            "Actual null-target, flag/raw-field and policy branch selection.",
        ),
        ("finishReset", 0x25C968, 0x25C988, "Actual finish cleanup reached at expiry."),
        (
            "finishDecision",
            0x25CBDE,
            0x25CCB0,
            "Following finish/owner notification path; full owner update remains supplied.",
        ),
        (
            "targetlessPolicy",
            0x25F6B4,
            0x25F73C,
            "Actual source targetless policy, bound in the preceding capture.",
        ),
        (
            "clock",
            0x25F754,
            0x25F8D3,
            "Actual buff-weighted active elapsed update and source preload boost.",
        ),
        (
            "reloadDecrement",
            0x25C60C,
            0x25C64A,
            "Actual real-time reload decrement before other decisions.",
        ),
        (
            "damageEntry",
            0x25E61C,
            0x25E637,
            "Actual damage-handler prologue; level/damage/world setup is supplied at the following boundary.",
        ),
        (
            "damageReload",
            0x25E681,
            0x25E69F,
            "Actual source LoadTime reload store within the same damage handler, before its supplied return boundary.",
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
    output = (
        json.dumps(
            {
                "source": "apk/1.8.1/x86/libg.so",
                "sha256": env["sha"],
                "emulator": "unicorn==2.1.4",
                "inputs": inputs,
                "stepMs": 50,
                "finishTimeMs": finish_limit,
                "limits": [
                    "Actual constructors, setter/removal notification, main component loop, targetless policy, active/finish clocks and damage reload prefixes execute on supplied source-selected Data and frame structures.",
                    "Raw owner state is supplied as 2, movement component is absent, target A point is 3000/4000 and source range/eligibility are supplied true. Full owner/world transitions, natural death propagation, projectile reference construction, damage allocation and artwork do not execute.",
                    "The notification is explicitly invoked with matching target A or synthetic other target B and zero auxiliary event fields. Null assignment uses the actual setter. The previously controlled damage prefix records dispatch and supplies its continuation boundary; a dispatch is not proof of a constructed projectile or a hit.",
                    "Source positive intervals/load values, first-load flag, self-center flag, primary Homing, all-target flag and standard loop scalar fields are populated. Complete Data inheritance and downstream specialized owner/attack handlers remain outside this contract.",
                    "Every update, setter/removal result, cached target point, selected branches and dispatch clocks are compared with an independent arithmetic model. Only the source allow-targetless and finish-time Globals are read. Synthetic controls invert the global, remove before any active update or notify an unmatched target.",
                    "The capture establishes controlled target-loss component transitions, not complete natural attack continuation or last-point projectile construction. Application rules remain unchanged.",
                ],
                "globalReads": [
                    {"offset": hex(a), "size": b, "pc": hex(c)}
                    for a, b, c in sorted(global_reads)
                ],
                "profiles": profiles,
                "blocks": blocks,
                "cases": cases,
                "controls": controls,
            },
            indent=2,
        )
        + "\n"
    )
    path = Path("reference/client/target-loss-clock-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native target-loss clock capture differs")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "profiles": len(profiles),
                "cases": len(cases),
                "controls": len(controls),
                "updates": updates,
                "dispatches": sum(len(row["pulses"]) for row in cases + controls),
                "blocks": len(blocks),
            }
        )
    )
