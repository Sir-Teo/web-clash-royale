"""Native active owner/manager steps with actual attack and projectile updates.

Owner services, actor body/empty buff updates, allocation and projectile birth
are provided. Manager snapshots, phase dispatch, clock, history and movement run.
"""

import csv
import hashlib
import io
import itertools
import json
import math
from pathlib import Path
import re
import struct
import subprocess
from collections import Counter
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESI, UC_X86_REG_ESP, UC_X86_REG_EIP


def capture(env, context):
    cpu, heap, body, data, component, manager = [
        env[k] for k in ["cpu", "heap", "body", "data", "component", "world"]
    ]
    read, write, run, initialize, ret = [
        env[k] for k in ["read", "write", "run", "initialize", "return_hook"]
    ]
    paths = [
        "reference/client/first-attacks-native-trace.json",
        "reference/client/projectile-flight-native-trace.json",
        "reference/client/projectile-launch-native-trace.json",
        "reference/logic/characters.csv",
        "reference/logic/buildings.csv",
        "reference/logic/projectiles.csv",
    ]
    inputs = [
        {"path": p, "sha256": hashlib.sha256(Path(p).read_bytes()).hexdigest()}
        for p in paths
    ]
    priors = [json.loads(Path(p).read_text()) for p in paths[:3]]
    for prior in priors:
        if prior["sha256"] != env["sha"]:
            raise RuntimeError("World-step binary differs")
        for entry in prior["inputs"]:
            if (
                hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
                != entry["sha256"]
            ):
                raise RuntimeError("World-step provenance differs")
    projectile_rows = {
        r["Name"]: r
        for r in csv.DictReader(io.StringIO(Path(paths[-1]).read_text()))
        if r["Name"] not in ["", "string"]
    }
    owner, ctrl, actor_vtable, pdata, objects, scratch = (
        heap + 0x9000,
        heap + 0xD000,
        heap + 0xA000,
        heap + 0xB000,
        heap + 0x7000,
        heap + 0x7400,
    )
    services, settings, rules = heap + 0xE800, heap + 0xE000, heap + 0xE100
    actor_vtable_fields = {0x5C: 0x21A382, 0x10: 0x21961E, 0x14: 0x21A376}
    if (
        read(0x79E1F4 + 0xC) != 0x25C5E4
        or read(0x7B364C + 0x10) != 0x21D796
        or read(0x7B364C + 0x5C) != 0x21A382
    ):
        raise RuntimeError("World-step vtable binding differs")
    debug_flag = bool(bytes(cpu.mem_read(read(0x7B8A14 - 0x398), 1))[0])
    env["allowed"].extend(
        [
            (0x23873A, 0x23874E),
            (0x238798, 0x238834),
            (0x2382E6, 0x2382F8),
            (0x1C7706, 0x1C7868),
            (0x21A938, 0x21AC18),
            (0x21A376, 0x21A3D4),
            (0x219578, 0x21959A),
            (0x21961E, 0x219628),
            (0x21A41C, 0x21A446),
            (0x25C5E4, 0x25C60B),
            (0x25F8FE, 0x25F918),
            (0xBCBE6, 0xBCC72),
            (0x21D796, 0x21DBAD),
            (0x21E9F6, 0x21EA7A),
            (0x21F028, 0x21F03A),
            (0x219AAE, 0x219B32),
            (0x1FB78E, 0x1FB79E),
            (0x1FB488, 0x1FB4D6),
            (0x35D250, 0x35D430),
            (0x35D550, 0x35D66F),
            (0x35C120, 0x35C4DB),
            (0x23C248, 0x23C25A),
            (0x238C80, 0x238C90),
            (0x1C7868, 0x1C78AC),
        ]
    )
    boundaries = [0x55EE0, 0x55EA0, 0x1C9916, 0x1C78AC, 0x23D904, 0x1D0648, 0x23E384]
    env["allowed"].extend((pc, pc + 1) for pc in boundaries)
    current, frame, events, counts, actual_shots, actual_order = (
        None,
        0,
        [],
        Counter(),
        [],
        [],
    )
    current_snapshot = []

    def signed(value):
        return (value + 0x80000000) % 0x100000000 - 0x80000000

    def packet(pointer, index):
        p = current["projectile"]
        return {
            0: 0x7B364C,
            8: index + 2,
            0x10: pdata,
            0x14: manager,
            0x20: current["start"][0],
            0x24: current["start"][1],
            0x30: current["start"][2],
            0x28: current["start"][0],
            0x2C: current["start"][1],
            0x34: current["start"][2],
            0x54: body,
            0x5C: current["goal"][0],
            0x60: current["goal"][1],
            0x64: current["start"][2],
            0x68: current["start"][0],
            0x6C: current["start"][1],
            0x70: current["start"][2],
        }

    def birth(phase):
        pointer = heap + 0xC000 + len(actual_shots) * 0x100
        if len(actual_shots) >= 12:
            raise RuntimeError("World-step projectile budget exceeded")
        for offset, value in packet(pointer, len(actual_shots)).items():
            write(pointer + offset, value)
        actual_shots.append(pointer)
        actual_order.append(pointer)
        write(objects + (len(actual_order) - 1) * 4, pointer)
        write(manager + 8, len(actual_order))
        events.append(["birth", pointer, phase])

    def hook(_cpu, pc, _size, _data):
        nonlocal current_snapshot
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if pc == 0x23873A:
            cpu.reg_write(UC_X86_REG_ESI, owner)
        elif pc == 0x23874D:
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        elif pc in [0x1C9916, 0x1C78AC, 0x23D904, 0x1D0648, 0x23E384]:
            expected = (
                ctrl
                if pc in [0x1C9916, 0x1C78AC]
                else services if pc == 0x1D0648 else owner + 0x120
            )
            if read(sp + 4) != expected:
                raise RuntimeError("Unexpected owner service argument")
            counts[hex(pc)] += 1
            ret(0)
        elif pc == 0x55EE0:
            if read(sp + 4) != len(actual_order) * 4:
                raise RuntimeError("Unexpected world snapshot allocation")
            events.append(["allocate", read(sp + 4)])
            ret(scratch)
        elif pc == 0x55EA0:
            if read(sp + 4) != scratch:
                raise RuntimeError("Unexpected world snapshot free")
            events.append(["free"])
            ret()
        elif pc == 0x21A938:
            if read(sp + 4) != manager:
                raise RuntimeError("Unexpected manager step owner")
            events.append(["manager"])
        elif pc == 0x21A382:
            pointer = read(sp + 4)
            if pointer not in actual_order:
                raise RuntimeError("Unexpected pre-step object")
            events.append(["pre", pointer])
            if pointer == body and current["birthPhase"] == "pre" and frame == 1:
                birth("pre")
        elif pc == 0x21A9FC:
            if read(sp + 0x20) != scratch:
                raise RuntimeError("Unexpected snapshot pointer")
            current_snapshot = [read(scratch + i * 4) for i in range(read(sp + 0x28))]
            events.append(["snapshot", list(current_snapshot)])
        elif pc == 0x25C5E4:
            if read(sp + 4) != component:
                raise RuntimeError("Unexpected actual attack component")
            events.append(["attackComponent"])
            if current["birthPhase"] == "component" and frame == 1:
                birth("component")
        elif pc == 0x25E637:
            events.append(["damage"])
            if current["birthPhase"] == "attack":
                birth("attack")
        elif pc == 0x21961E:
            pointer = read(sp + 4)
            caller = read(sp)
            if pointer == body and caller == 0x21AA65:
                events.append(["actorUpdate"])
                if current["birthPhase"] == "body" and frame == 1:
                    birth("body")
            elif pointer == env["buffs"]:
                counts["buffNoop"] += 1
            elif pointer not in actual_shots:
                raise RuntimeError("Unexpected supplied/base no-op")
        elif pc == 0x21D796:
            pointer = read(sp + 4)
            if pointer not in current_snapshot or pointer not in actual_shots:
                raise RuntimeError("Unexpected projectile update")
            events.append(["projectileUpdate", pointer])
        elif pc == 0x21D83C:
            # Preserve the real nested update frame and return to the manager.
            counts["arrivalBoundary"] += 1
            cpu.reg_write(UC_X86_REG_EIP, 0x21E9F6)
        elif pc == 0x23C248:
            if read(sp + 4) != owner + 0x34:
                raise RuntimeError("Unexpected owner clock object")
            events.append(["clockIncrement"])
        elif pc == 0x219578:
            if read(sp + 4) not in current_snapshot or read(sp + 8) not in range(4):
                raise RuntimeError("Unexpected native component lookup")
            counts["componentLookup"] += 1
        elif pc == 0x25F8FE:
            if read(sp + 4) != component:
                raise RuntimeError("Unexpected native pre-clock copy")
            counts["preClockCopy"] += 1

    for pc in [
        0x23873A,
        0x23874D,
        *boundaries,
        0x21A938,
        0x21A382,
        0x21A9FC,
        0x25C5E4,
        0x25E637,
        0x21961E,
        0x21D796,
        0x21D83C,
        0x23C248,
        0x219578,
        0x25F8FE,
    ]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)
    cases, controls = [], []
    total_frames = 0
    total_births = 0
    total_updates = 0
    profiles = [
        {"sourceTable": t, "sourceName": n}
        for t, n in [
            ("characters", "Archer"),
            ("characters", "Musketeer"),
            ("buildings", "Cannon"),
        ]
    ]
    modifiers = [[], ["Rage"], ["IceWizardSlowDown"], ["Rage", "IceWizardSlowDown"]]

    def store(expected, offset, value):
        expected[offset : offset + 4] = struct.pack("<i", signed(value))

    def sample(profile, buffs, variant=0, overrides=None, kind="source", steps=48):
        nonlocal current, frame, events, counts, actual_shots, actual_order, current_snapshot, total_frames, total_births, total_updates
        source = env["rows"]["reference/logic/" + profile["sourceTable"] + ".csv"][
            profile["sourceName"]
        ]
        options = {
            "firstLoad": source["LoadFirstHit"].lower() == "true",
            "origin": 1333 if variant else 0,
            "initialFrame": 19 if variant else 0,
            "frameOffset": 0,
            "rawSecondary": -719,
            "birthPhase": "attack",
            "preexisting": False,
            "actorLast": False,
            "raw24": 0,
            "endDelay": 0,
            **(overrides or {}),
        }
        initialize({**source, "LoadTime": source["LoadTime"] or "0"})
        env["set_buffs"](buffs)
        cpu.mem_write(data + 0x17D, b"\0")
        cpu.mem_write(data + 0x288, bytes([options["firstLoad"]]))
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
            write(data + offset, int(source[field] or "0"))
        if any(
            source[f]
            for f in [
                "StopTimeAfterAttack",
                "VisualHitSpeed",
                "MultipleTargets",
                "Burst",
                "BurstDelay",
                "ActivationTime",
                "AttackDashTime",
            ]
        ):
            raise RuntimeError("Recheck supported manager actor profile")
        origin = options["origin"]
        point = {"x": 9000 + origin, "y": 16000 - origin, "z": 200}
        write(body + 0x60, 2)
        write(body + 0x18, heap + 0x6C00)
        write(heap + 0x6C00, heap + 0x6D00)
        write(heap + 0x6D00 + 0x20, 0x25FA0C)
        write(context["config"] + 0x1DC, context["finish_ms"])
        run(0x25C3E6, component, body)
        constructed = {
            **context["state"](),
            "flag1c": bytes(cpu.mem_read(component + 0x1C, 1))[0],
        }
        run(0x25D4B0, component, context["target_a"])
        assigned = context["state"]()
        witness = next(
            r
            for r in priors[0]["cases"]
            if r["sourceName"] == profile["sourceName"]
            and r["sourceTable"] == profile["sourceTable"]
            and r["buffs"] == buffs
            and r["loadFirstHit"] == options["firstLoad"]
        )
        if constructed != witness["constructed"] or assigned != witness["assigned"]:
            raise RuntimeError(
                "Manager actor setup differs from native first-attack witness"
            )
        write(body, actor_vtable)
        for offset, value in actor_vtable_fields.items():
            write(actor_vtable + offset, value)
        for offset, value in [
            (0x38, 9),
            (0x3C, component),
            (0x40, 0),
            (0x4C, 0),
            (0x20, point["x"]),
            (0x24, point["y"]),
            (0x30, point["z"]),
            (0x28, -713),
            (0x2C, -719),
            (0x34, -727),
        ]:
            write(body + offset, value)
        write(component + 0x24, options["raw24"])
        for offset, value in [
            (0, objects),
            (4, 16),
            (8, 1),
            (0x28, owner),
            (0x30, 0),
            (0x34, 0),
        ]:
            write(manager + offset, value)
        write(env["buffs"], heap + 0xA200)
        write(heap + 0xA200 + 0xC, 0x21961E)
        write(objects, body)
        write(ctrl, owner)
        write(ctrl + 0x94, options["frameOffset"])
        write(ctrl + 0x90, options["endDelay"])
        write(owner + 0x78, ctrl)
        write(owner + 0x24, manager)
        write(owner + 0x20, services)
        write(owner + 0x34, options["initialFrame"])
        write(owner + 0x44, options["rawSecondary"])
        cpu.mem_write(ctrl + 0x10C, b"\1")
        write(ctrl + 0x98, settings)
        write(settings + 4, rules)
        write(rules + 0x34, 0)
        p = projectile_rows[source["Projectile"]]
        if int(p["ProjectileRadius"] or 0) or int(p["PingpongVisualTime"] or 0):
            raise RuntimeError("Recheck supported ordinary world projectile")
        write(pdata + 0x54, int(p["Speed"] or 0))
        write(pdata + 0x4C, 0)
        write(pdata + 0x98, 0)
        cpu.mem_write(pdata + 0x78, bytes([p["Homing"].lower() == "true"]))
        current = {
            "projectile": p,
            "birthPhase": options["birthPhase"],
            "start": [
                point["x"] + int(source["ProjectileStartRadius"] or 0),
                point["y"] + int(source["ProjectileYOffset"] or 0),
                point["z"] + int(source["ProjectileStartZ"] or 0),
            ],
            "goal": [point["x"] + 6000, point["y"]],
        }
        actual_shots, actual_order = [], [body]
        if options["preexisting"]:
            events = []
            birth("providedInitial")
            if options["actorLast"]:
                actual_order.reverse()
                write(objects, actual_order[0])
                write(objects + 4, actual_order[1])
        model_order = list(actual_order)
        model_shots = {
            s: {
                "x": current["start"][0],
                "y": current["start"][1],
                "z": current["start"][2],
                "born": 0,
            }
            for s in actual_shots
        }
        elapsed = 0
        reload = int(source["LoadTime"] or 0) if options["firstLoad"] else 0
        load = int(source["LoadTime"] or 0)
        interval = int(source["HitSpeed"])
        delta = {
            (): 50,
            ("Rage",): 67,
            ("IceWizardSlowDown",): 32,
            ("Rage", "IceWizardSlowDown"): 43,
        }[tuple(buffs)]
        flag = assigned["flag1d"]
        context["pulses"].clear()
        frames = []
        for frame in range(1, steps + 1):
            context["set_tick"](frame)
            events = []
            counts = Counter()
            current_snapshot = []
            expected = bytearray(cpu.mem_read(heap, 0x10000))
            start_order = list(model_order)
            expected_events = [["manager"]]
            born = []

            def model_birth(phase):
                pointer = heap + 0xC000 + len(model_shots) * 0x100
                for offset, value in packet(pointer, len(model_shots)).items():
                    store(expected, pointer - heap + offset, value)
                model_shots[pointer] = {
                    "x": current["start"][0],
                    "y": current["start"][1],
                    "z": current["start"][2],
                    "born": frame,
                }
                model_order.append(pointer)
                store(expected, objects - heap + (len(model_order) - 1) * 4, pointer)
                store(expected, manager - heap + 8, len(model_order))
                expected_events.append(["birth", pointer, phase])
                born.append(pointer)

            for pointer in start_order:
                expected_events.append(["pre", pointer])
                if pointer == body:
                    if options["birthPhase"] == "pre" and frame == 1:
                        model_birth("pre")
                    xyz = point.values()
                    for off, val in zip([0x28, 0x2C, 0x34], xyz):
                        store(expected, off, val)
                    store(expected, component - heap + 0x14, elapsed)
                    store(expected, component - heap + 0x18, options["raw24"])
                else:
                    for off, k in [(0x28, "x"), (0x2C, "y"), (0x34, "z")]:
                        store(expected, pointer - heap + off, model_shots[pointer][k])
            snapshot_order = list(model_order)
            expected_events.append(["allocate", 4 * len(snapshot_order)])
            for i, pointer in enumerate(snapshot_order):
                store(expected, scratch - heap + i * 4, pointer)
            expected_events.append(["snapshot", list(snapshot_order)])
            expected_events.append(["attackComponent"])
            if options["birthPhase"] == "component" and frame == 1:
                model_birth("component")
            reload = max(0, reload - 50)
            previous_cycle = elapsed // interval
            if elapsed == 0:
                flag = int(reload == 0)
                elapsed += load - reload
                reload = load
            elapsed += delta
            pulse = elapsed // interval > previous_cycle
            if pulse:
                expected_events.append(["damage"])
                if options["birthPhase"] == "attack":
                    model_birth("attack")
                reload = load
            if pulse:
                flag = 0
            store(expected, component - heap + 0xC, elapsed)
            store(expected, component - heap + 0x10, reload)
            expected[component - heap + 0x1D] = flag
            arrival_count = 0
            for pointer in snapshot_order:
                if pointer == body:
                    expected_events.append(["actorUpdate"])
                    if options["birthPhase"] == "body" and frame == 1:
                        model_birth("body")
                else:
                    expected_events.append(["projectileUpdate", pointer])
                    shot = model_shots[pointer]
                    dx = current["goal"][0] - shot["x"]
                    dy = current["goal"][1] - shot["y"]
                    d = math.isqrt(dx * dx + dy * dy)
                    speed = int(p["Speed"] or 0)
                    if d > speed:
                        shot["x"] += int(dx * speed / d)
                        shot["y"] += int(dy * speed / d)
                        store(expected, pointer - heap + 0x20, shot["x"])
                        store(expected, pointer - heap + 0x24, shot["y"])
                    else:
                        arrival_count += 1
            expected_events.extend([["free"], ["clockIncrement"]])
            for off, initial in [
                (0x34, options["initialFrame"]),
                (0x44, options["rawSecondary"]),
            ]:
                store(expected, owner - heap + off, initial + frame)
            if options["endDelay"] > 0:
                store(expected, ctrl - heap + 0x90, options["endDelay"] + frame * 50)
            run(0x23873A, instruction_budget=120000)
            frame_count = signed(options["initialFrame"] + frame)
            difference = signed(frame_count - options["frameOffset"])
            expected_unit = (-1 if difference < 0 else 1) * (abs(difference) // 20)
            logical_unit = signed(run(0x1C7868, ctrl))
            actual_state = context["state"]()
            expected_counts = {
                "0x1c9916": 2,
                "0x1c78ac": 1 + int(options["endDelay"] > 0),
                "0x23d904": 1,
                "0x1d0648": 1,
                "0x23e384": 1,
                "buffNoop": 1,
                "componentLookup": 4 * len(snapshot_order),
                "preClockCopy": 1,
            }
            if arrival_count:
                expected_counts["arrivalBoundary"] = arrival_count
            if (
                bytes(cpu.mem_read(heap, 0x10000)) != bytes(expected)
                or events != expected_events
                or dict(counts) != expected_counts
                or logical_unit != expected_unit
                or actual_state
                != {
                    "elapsedMs": elapsed,
                    "reloadMs": reload,
                    "finishMs": 0,
                    "target": "a",
                    "flag1d": flag,
                }
            ):
                changes = [
                    (hex(i), struct.unpack_from("<i", expected, i)[0], read(heap + i))
                    for i in range(0, 0x10000, 4)
                    if bytes(cpu.mem_read(heap + i, 4)) != bytes(expected[i : i + 4])
                ]
                raise RuntimeError(
                    f"Native owner/manager step differs: {profile} {buffs} {options} frame {frame} {changes[:12]} {actual_state} {flag} {events} {expected_events} {dict(counts)} {expected_counts}"
                )
            witness_state = next(
                (c for c in witness["checkpoints"] if c["tick"] == frame), None
            )
            if (
                witness_state
                and {k: v for k, v in witness_state.items() if k != "tick"}
                != actual_state
            ):
                raise RuntimeError(
                    "Manager attack clocks differ from prior native checkpoints"
                )
            total_frames += 1
            total_births += len(born)
            total_updates += len(snapshot_order) - 1
            frames.append(
                {
                    "frame": frame,
                    "ownerFrame": frame_count,
                    "logicalTimeUnit": logical_unit,
                    "rawSecondary": read(owner + 0x44),
                    "rawEndDelay": read(ctrl + 0x90),
                    "attack": actual_state,
                    "previousAttackElapsedMs": read(component + 0x14),
                    "snapshot": snapshot_order,
                    "managerObjects": list(model_order),
                    "events": list(events),
                    "providerAndGetterCalls": dict(counts),
                    "projectiles": [
                        {
                            "pointer": s,
                            "bornFrame": v["born"],
                            "position": [
                                read(s + 0x20),
                                read(s + 0x24),
                                read(s + 0x30),
                            ],
                            "previous": [
                                read(s + 0x28),
                                read(s + 0x2C),
                                read(s + 0x34),
                            ],
                        }
                        for s, v in model_shots.items()
                    ],
                    "unrelatedHeapUnchanged": True,
                }
            )
        return {
            **profile,
            "kind": kind,
            "buffs": buffs,
            "options": options,
            "actorPoint": point,
            "projectile": source["Projectile"],
            "projectileSpeedPerUpdate": int(p["Speed"] or 0),
            "providedMuzzle": current["start"],
            "providedGoal": current["goal"],
            "constructed": constructed,
            "assigned": assigned,
            "frames": frames,
        }

    for profile, buffs, variant in itertools.product(profiles, modifiers, [0, 1]):
        cases.append(sample(profile, buffs, variant))
    for profile, buffs in itertools.product(profiles, modifiers):
        controls.append(
            sample(profile, buffs, 0, {"firstLoad": True}, "firstLoadOverride")
        )
    for phase, preexisting, actor_last in itertools.product(
        ["pre", "component", "body"], [False, True], [False, True]
    ):
        controls.append(
            sample(
                profiles[1],
                [],
                0,
                {
                    "birthPhase": phase,
                    "preexisting": preexisting,
                    "actorLast": actor_last,
                    "raw24": 77,
                },
                "birthPhaseOverride",
            )
        )
    for delay in [-1, 1, 999]:
        controls.append(
            sample(profiles[1], [], 0, {"endDelay": delay}, "endDelayOverride")
        )
    for initial, offset in [(-21, 0), (0, 21), (0x7FFFFFFE, 0)]:
        controls.append(
            sample(
                profiles[1],
                [],
                0,
                {"initialFrame": initial, "frameOffset": offset},
                "clockOverride",
            )
        )
    definitions = [
        (
            "activeOwnerDriver",
            0x23873A,
            0x23874D,
            "Actual active owner driver invokes battle update before incrementing its clock; prior gate/outer frame supplied.",
        ),
        (
            "ownerBattleUpdate",
            0x238798,
            0x238834,
            "Actual owner update with provided status/task/service boundaries and active battle context.",
        ),
        (
            "battleManagerGate",
            0x1C7706,
            0x1C7868,
            "Actual supplied-normal-settings/end-delay gates and manager invocation; earlier duration gate supplied complete.",
        ),
        (
            "clockIncrement",
            0x23C248,
            0x23C25A,
            "Actual logical-frame and raw secondary counter increment.",
        ),
        ("clockGetter", 0x238C80, 0x238C90, "Actual owner frame getter."),
        (
            "elapsedUnitGetter",
            0x1C7868,
            0x1C78AC,
            "Actual signed truncation of (owner frame minus context offset) divided by twenty.",
        ),
        (
            "managerStep",
            0x21A938,
            0x21AAF0,
            "Actual prepass, fixed snapshot, four component phases and body update loop; allocation/free supplied.",
        ),
        (
            "managerCleanup",
            0x21AAF0,
            0x21ABB2,
            "Actual cleanup scans provided alive actor/projectile getters; no deletion branch executes.",
        ),
        (
            "snapshotCopy",
            0x21ABB2,
            0x21AC18,
            "Actual native vector copy, with sufficient capacity.",
        ),
        (
            "componentLookup",
            0x219578,
            0x21959A,
            "Actual component mask and indexed pointer lookup.",
        ),
        (
            "positionHistory",
            0x21A382,
            0x21A3D4,
            "Actual component pre-copy and current XYZ to previous XYZ stores.",
        ),
        (
            "attackPreCopy",
            0x25F8FE,
            0x25F918,
            "Actual attack elapsed/raw word copies into previous fields.",
        ),
        (
            "attackUpdateWrapper",
            0x25C5E4,
            0x25C60B,
            "Actual attack vtable update wrapper calls the measured fifty-unit clock update.",
        ),
        (
            "projectileUpdate",
            0x21D796,
            0x21DBAD,
            "Actual ordinary null-target projectile movement. Arrival diverts to the actual update epilogue before effects.",
        ),
        (
            "projectileArrivedGetter",
            0x21F028,
            0x21F03A,
            "Actual projectile arrived flag getter remains false under the pre-effect arrival boundary.",
        ),
    ]
    blocks = []
    for name, start, end, meaning in definitions:
        asm = subprocess.check_output(
            [
                "objdump",
                "-d",
                "-Mintel",
                f"--start-address={start}",
                f"--stop-address={end}",
                str(env["args"].library),
            ],
            text=True,
        )
        instructions = [
            l.strip() for l in asm.splitlines() if re.match(r"\s*[0-9a-f]+:", l)
        ]
        if not instructions:
            raise RuntimeError("World-step instruction block is empty")
        blocks.append(
            {
                "name": name,
                "start": hex(start),
                "end": hex(end),
                "interpretation": meaning,
                "instructions": instructions,
            }
        )
    result = {
        "source": "apk/1.8.1/x86/libg.so",
        "sha256": env["sha"],
        "emulator": "unicorn==2.1.4",
        "inputs": inputs,
        "mappedDiagnosticFlag": debug_flag,
        "logicalFrame": {
            "ownerIncrement": 1,
            "elapsedDivisor": 20,
            "normalAttackClockDelta": 50,
        },
        "limits": [
            "Actual active owner segment, battle/context gate, manager prepass/snapshot/four component phases/body updates, owner clock increment and elapsed-unit getter execute. Earlier owner gate/outer frame, complete-duration flag, normal settings, status/task/service/empty-buff/actor-body behavior and object array are supplied; external wall-clock scheduling, loading/paused modes, networking and full owner states remain excluded.",
            "An actual source attack constructor/target setter/vtable wrapper and clock execute with supplied eligible target/owner boundaries. Native fifty-unit normal and buff-modified attack clocks match independent calculations and prior first-attack witnesses. Damage dispatch executes its real reload prefix while skipping damage/world work, as in the pinned clock capture.",
            "Projectile allocation/muzzle/header/registration are a declared provider at actual attack dispatch, or a declared pre/component/body-phase control. The supplied ordinary source projectile has null target and no radius/return mode. Its actual pre-history/update/arrival getter execute; arrival returns through the native moving epilogue before effects, allowing the manager to finish. Native factory, actual registration/IDs, homing/hits/removal and actor movement are not executed.",
            "Manager object snapshot is fixed before component/body phases. A provided projectile born in an attack/component/body phase first moves on the next manager step; prepass-birth controls enter the same-step snapshot. Existing objects preserve previous XYZ before moving. Indexed component lookup, snapshot copy and object visitation order execute natively; allocation/free use supplied buffers and alive cleanup paths avoid deletion.",
            "Each logical owner step increments frame and secondary counter once; the elapsed getter divides signed (frame minus offset) by twenty. Normal attack clocks advance fifty units per active manager step. Every event, clock/previous field, birth/position/history, provider/getter count and complete heap mutation matches independent models. This establishes the bounded active logical update contract, not external wall time or complete natural world execution. Application rules remain at 42.",
        ],
        "profiles": profiles,
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    output = json.dumps(result, indent=2) + "\n"
    path = Path("reference/client/world-step-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native world-step trace differs")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "profiles": len(profiles),
                "cases": len(cases),
                "controls": len(controls),
                "steps": total_frames,
                "births": total_births,
                "projectileUpdates": total_updates,
                "blocks": len(blocks),
            }
        )
    )
