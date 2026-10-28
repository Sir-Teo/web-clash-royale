"""Selected nonprojectile, zero-area ordinary packet delivery.

The actual ordinary header establishes its frame. Packet selection/scaling and
reload are skipped through a checked jump into the actual selected melee tail.
Actual target health resolution, vector construction, receiver filters, lower
damage calls and surviving HP stores execute. Eligibility and reactions do not.
"""

from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_READ
from unicorn.x86_const import (
    UC_X86_REG_ESP,
    UC_X86_REG_EIP,
    UC_X86_REG_ESI,
    UC_X86_REG_EDI,
)


def capture(env, context, lifecycle, goal):
    def require(value, message):
        if not value:
            raise RuntimeError(message)

    (
        cpu,
        heap,
        body,
        data,
        attack,
        health,
        target,
        target_data,
        target_health,
        view,
        view_vt,
    ) = [
        goal[k]
        for k in [
            "cpu",
            "heap",
            "body",
            "data",
            "attack",
            "health",
            "target",
            "target_data",
            "target_health",
            "view",
            "view_vt",
        ]
    ]
    world, buffs, movement, row, manager, settings = [
        goal[k] for k in ["world", "buffs", "movement", "row", "manager", "settings"]
    ]
    read, write, ret, invoke, snapshot, put, exact = [
        goal[k] for k in ["read", "write", "ret", "invoke", "snapshot", "put", "exact"]
    ]
    events, calls, extra_calls = [goal[k] for k in ["events", "calls", "extra_calls"]]
    overrides = lifecycle["overrides"]
    source = env["rows"]["reference/logic/characters.csv"]["Assassin"]
    require(
        source["Damage"] == "160"
        and not source["Projectile"]
        and not source["ProjectileSpecial"]
        and not source["AreaDamageRadius"]
        and not source["ChargeRange"]
        and not source["CrownTowerDamagePercent"]
        and source["DamageEffect"] == "assassin_hit",
        "Recheck source selected ordinary delivery fields",
    )
    target_view, target_vt, effect_ref = heap + 0xF100, heap + 0xD100, heap + 0xD800
    current = None
    vector = None
    selected_calls = Counter()
    data_reads = set()
    env["allowed"].extend(
        [
            (0x25EEA7, 0x25EF71),
            (0x25EFE5, 0x25F32A),
            (0x25F331, 0x25F332),
            (0x35D1C0, 0x35D216),
            (0x1DDF8E, 0x1DDFC9),
            (0x1DE272, 0x1DE2C3),
            (0x21A41C, 0x21A445),
        ]
    )
    names = {
        0x25E61C: "ordinaryHeader",
        0x25EEA7: "selectedMeleeTail",
        0x25F1EB: "singleTargetBranch",
        0x35D1C0: "directionConstructor",
        0x25FF6E: "ordinaryReceiver",
        0x21A41C: "sourceParent",
    }
    old_view = overrides[0x25FA16]

    def view_provider(sp):
        require(current is not None, "Delivery view outside sample")
        if read(sp) == 0x25F282:
            require(
                [read(sp + i) for i in [4, 8, 12, 16]]
                == [target_view, *current["delta"], 0],
                "Target facing arguments differ",
            )
            events.append(["providedTargetFacing", *current["delta"], 0])
            ret()
            return True
        if read(sp) == 0x260077:
            require(
                read(sp + 4) == view and current["sourcePresent"],
                "Source view binding differs",
            )
            events.append(["providedSourceDamageView"])
            ret()
            return True
        return old_view(sp)

    def opaque_provider(sp):
        require(
            current is not None
            and not current["effectPresent"]
            and read(sp) == 0x25EEC3,
            "Delivery fallback word context differs",
        )
        events.append(["providedOpaqueWord", 137])
        ret(137)
        return True

    def hp_boundary(sp):
        require(current is not None, "Delivery HP boundary outside sample")
        require(
            read(target_health + 8) == 1000 - current["damage"],
            "Surviving ordinary HP differs",
        )
        events.append(["targetHp", read(target_health + 8)])
        cpu.reg_write(UC_X86_REG_EIP, 0x260655)
        return True

    overrides[0x25FA16] = view_provider
    overrides[0x1E99F2] = opaque_provider
    overrides[0x260412] = hp_boundary

    def hook(_cpu, pc, _size, _data):
        nonlocal vector
        require(current is not None, "Ordinary delivery driver outside sample")
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if pc in names:
            selected_calls[names[pc]] += 1
        if pc == 0x25E61C:
            require(
                [read(sp + i) for i in [4, 8, 12]]
                == [attack, target if current["targetPresent"] else 0, -1],
                "Ordinary header arguments differ",
            )
            events.append(["ordinaryHeader", current["targetPresent"]])
        elif pc == 0x25E637:
            # The real function prologue and saved caller frame already ran.
            # Supply the selected packet's caller locals, then enter its tail.
            for offset, value in [
                (0x60, current["damage"]),
                (0x67, 0),
                (0x74, 0),
                (0x98, current["effectWord"]),
                (0xA4, current["cached"][1]),
                (0xA8, data),
                (0xAC, body if current["sourcePresent"] else 0),
            ]:
                if offset == 0x67:
                    cpu.mem_write(sp + offset, b"\0")
                else:
                    write(sp + offset, value)
            cpu.reg_write(UC_X86_REG_ESI, 0)
            cpu.reg_write(UC_X86_REG_EDI, attack)
            events.append(
                ["providedSelectedPacket", current["damage"], current["sourcePresent"]]
            )
            cpu.reg_write(UC_X86_REG_EIP, 0x25EEA7)
        elif pc == 0x35D1C0:
            vector = read(sp + 4)
            require(
                env["stack"] <= vector < env["stack"] + 0x100000 - 8
                and [read(sp + i) for i in [8, 12]] == current["delta"],
                "Native direction constructor differs",
            )
        elif pc == 0x25FF6E:
            require(
                current["targetPresent"] and vector is not None,
                "Receiver without selected target/vector",
            )
            require(
                [read(sp + i) for i in [4, 8, 12, 16, 20, 24]]
                == [
                    target_health,
                    current["damage"],
                    body if current["sourcePresent"] else 0,
                    current["effectWord"],
                    vector,
                    0,
                ],
                "Ordinary receiver arguments differ",
            )
            require(
                [read(vector), read(vector + 4)] == current["delta"],
                "Actual direction buffer differs",
            )
            events.append(
                [
                    "ordinaryReceiver",
                    current["damage"],
                    current["effectWord"],
                    *current["delta"],
                ]
            )
        elif pc == 0x21A41C:
            require(
                read(sp + 4) == body and current["sourcePresent"],
                "Source parent owner differs",
            )
        elif pc in [0x25F329, 0x25F331]:
            require(
                (pc == 0x25F329) == current["targetPresent"],
                "Delivery stop branch differs",
            )
            events.append(["afterOrdinaryDelivery", current["targetPresent"]])
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])

    def memory(_cpu, _access, address, size, _value, _data):
        data_reads.add((address - data, size))

    for pc in [*names, 0x25E637, 0x25F329, 0x25F331]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)
    cpu.hook_add(UC_HOOK_MEM_READ, memory, begin=data, end=data + 0x7FF)

    def sample(
        direction,
        distance,
        kind="source",
        *,
        cached_distance=None,
        target_state=0,
        damage=160,
        target_present=True,
        source_present=True,
        effect_present=True,
    ):
        nonlocal current, vector
        origin = [8250, 8250]
        actual = [origin[i] + int(distance * direction[i]) for i in range(2)]
        cached = [
            origin[i]
            + int(
                (distance if cached_distance is None else cached_distance)
                * direction[i]
            )
            for i in range(2)
        ]
        delta = [cached[i] - origin[i] for i in range(2)]
        word = effect_ref if effect_present else 137
        cpu.mem_write(heap, b"\0" * 0x10000)
        for ptr, value in [
            (body, 0x7B34A0),
            (body + 0x10, data),
            (body + 0x14, manager),
            (manager + 0x28, world),
            (body + 0x18, view),
            (body + 0x20, origin[0]),
            (body + 0x24, origin[1]),
            (body + 0x38, 15),
            (body + 0x3C, attack),
            (attack + 4, body),
            (attack + 8, target if target_present else 0),
            (attack + 0x34, cached[0]),
            (attack + 0x38, cached[1]),
            (body + 0x40, movement),
            (movement + 4, body),
            (body + 0x44, health),
            (health + 4, body),
            (health + 8, 750),
            (body + 0x48, buffs),
            (body + 0x60, 2),
            (data + 8, row),
            (data + 0x50, effect_ref if effect_present else 0),
            (data + 0xBC, 0),
            (data + 0x1AC, 0),
            (data + 0x190, 90),
            (data + 0x198, 1000),
            (data + 0x19C, 0),
            (data + 0x1A0, 750),
            (data + 0x1B4, 0),
            (data + 0x1FC, 600),
            (data + 0x22C, 600),
            (target, 0x7B34A0),
            (target + 0x10, target_data),
            (target + 0x18, target_view),
            (target + 0x20, actual[0]),
            (target + 0x24, actual[1]),
            (target + 0x38, 4),
            (target + 0x44, target_health),
            (target_health + 4, target),
            (target_health + 8, 1000),
            (target + 0x60, target_state),
            (target_data + 0x22C, 500),
            (view, view_vt),
            (view_vt + 0x0C, 0x25FA16),
            (target_view, target_vt),
            (target_vt + 0x48, 0x25FA16),
        ]:
            write(ptr, value)
        current = {
            "damage": damage,
            "cached": cached,
            "delta": delta,
            "targetPresent": target_present,
            "sourcePresent": source_present,
            "effectPresent": effect_present,
            "effectWord": word,
        }
        before = snapshot()
        expected = bytearray(before)
        applied = target_present and target_state not in [4, 9] and damage > 0
        if applied:
            put(expected, target_health + 8, 1000 - damage)
        wanted = [
            ["ordinaryHeader", target_present],
            ["providedSelectedPacket", damage, source_present],
        ]
        if not effect_present:
            wanted.append(["providedOpaqueWord", 137])
        if target_present:
            wanted += [
                ["providedTargetFacing", *delta, 0],
                ["ordinaryReceiver", damage, word, *delta],
            ]
            if applied:
                if source_present:
                    wanted.append(["providedSourceDamageView"])
                wanted.append(["targetHp", 1000 - damage])
        wanted.append(["afterOrdinaryDelivery", target_present])
        events.clear()
        calls.clear()
        extra_calls.clear()
        selected_calls.clear()
        data_reads.clear()
        context["calls"].clear()
        context["pulses"].clear()
        vector = None
        invoke(
            "ordinary-delivery", 0x25E61C, attack, target if target_present else 0, -1
        )
        exact(expected, f"ordinary delivery {kind}/{direction}/{distance}")
        require(events == wanted, f"Ordinary event order differs: {events} != {wanted}")
        wanted_selected = {
            "ordinaryHeader": 1,
            "selectedMeleeTail": 1,
            "singleTargetBranch": 1,
        }
        if target_present:
            wanted_selected.update({"directionConstructor": 1, "ordinaryReceiver": 1})
        if applied and source_present:
            wanted_selected["sourceParent"] = 1
        require(
            dict(selected_calls) == wanted_selected,
            f"Selected driver inventory differs: {dict(selected_calls)}",
        )
        wanted_calls = Counter()
        if target_present:
            wanted_calls.update(
                {"healthComponent": 1, "ordinaryHit": 1, "providedViewNotification": 1}
            )
        if applied:
            wanted_calls.update(
                {"buffComponent": 1, "lowerDamageProxy": 1, "damageReducer": 1}
            )
            if source_present:
                wanted_calls["providedViewNotification"] += 1
        require(
            calls == wanted_calls and not extra_calls,
            f"Delivery native driver inventory differs: {dict(calls)} / {dict(extra_calls)}",
        )
        reads = [
            {"offset": hex(offset), "size": size} for offset, size in sorted(data_reads)
        ]
        current = None
        return {
            "fields": {
                "kind": kind,
                "direction": list(direction),
                "distanceUnits": distance,
                "origin": origin,
                "target": actual,
                "cached": cached,
                "targetState": target_state,
                "amount": damage,
                "targetPresent": target_present,
                "sourcePresent": source_present,
                "effectPresent": effect_present,
                "effectWord": word,
            },
            "result": {
                "targetHp": read(target_health + 8),
                "applied": applied,
                "direction": delta if target_present else None,
                "events": list(events),
                "calls": dict(sorted(calls.items())),
                "selectedCalls": dict(sorted(selected_calls.items())),
                "dataReads": reads,
                "exactHeapChangesOnly": True,
            },
        }

    axes = [
        (1, 0),
        (-1, 0),
        (0, 1),
        (0, -1),
        (0.6, 0.8),
        (-0.6, 0.8),
        (0.8, -0.6),
        (-0.8, -0.6),
    ]
    cases = [sample(d, distance) for d in axes for distance in [1750, 5000]]
    controls = [
        sample(d, distance, "distance")
        for d in axes[:4]
        for distance in [0, 1850, 1851, 3000, 6500, 7500]
    ]
    controls += [
        sample(d, 5000, "state", target_state=state) for d in axes for state in [4, 9]
    ]
    controls += [sample(d, 5000, "cached-point", cached_distance=1750) for d in axes]
    controls += [
        sample(d, 5000, "amount", damage=amount)
        for d in axes[:4]
        for amount in [0, 1, 194, 450]
    ]
    controls += [
        sample(d, 5000, "missing-target", target_present=False) for d in axes[:4]
    ]
    controls += [
        sample(d, 5000, "missing-source", source_present=False) for d in axes[:4]
    ]
    controls += [
        sample(d, 5000, "fallback-effect", effect_present=False) for d in axes[:4]
    ]
    definitions = [
        (
            "ordinaryHeader",
            0x25E61C,
            0x25E637,
            "Actual ordinary function prologue establishes the caller frame; the selected packet jump occurs at its checked next instruction.",
        ),
        (
            "selectedMeleeTail",
            0x25EEA7,
            0x25EF71,
            "Actual effect reference, area radius, auxiliary and zero ChargeRange selection reads; effect fallback is a checked provider.",
        ),
        (
            "singleTargetDelivery",
            0x25EFE5,
            0x25F329,
            "Actual Crown-percentage calculation, cached direction, health resolution, target class branch, vector construction and ordinary damage receiver call. End stops immediately after receiver return.",
        ),
        (
            "directionConstructor",
            0x35D1C0,
            0x35D216,
            "Actual signed integer direction vector construction and base initialization.",
        ),
        (
            "ordinaryReceiver",
            0x25FF6E,
            0x2601AE,
            "Actual target state/health filters and ordinary-to-lower receiver path; source/target views are checked providers.",
        ),
        (
            "survivingHp",
            0x2602D0,
            0x260413,
            "Actual surviving damage HP store. Reactions and lifetime work after this boundary are skipped to the checked real return path.",
        ),
        (
            "sourceParent",
            0x21A41C,
            0x21A445,
            "Actual source parent lookup executes against the supplied zero parent context.",
        ),
        (
            "sourceAmountPercent",
            0x1DE272,
            0x1DE2C3,
            "Actual integer source Crown-percentage helper runs with source absent CrownTowerDamagePercent (zero adjustment). Knight uses the ordinary amount branch.",
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
        require(bool(instructions), "Empty selected delivery instruction block")
        blocks.append(
            {
                "name": name,
                "start": hex(start),
                "end": hex(end),
                "meaning": meaning,
                "instructions": instructions,
                "sha256": hashlib.sha256(
                    bytes(cpu.mem_read(start, end - start))
                ).hexdigest(),
            }
        )
    prerequisites = [
        "reference/client/dash-transition-native-trace.json",
        "reference/client/dash-recovery-native-trace.json",
    ]
    for path in prerequisites:
        prior = json.loads(Path(path).read_text())
        require(prior["sha256"] == env["sha"], "Delivery prerequisite binary differs")
        for entry in prior["inputs"]:
            require(
                hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
                == entry["sha256"],
                "Delivery prerequisite source differs",
            )
    result = {
        "source": "apk/1.8.1/x86/libg.so",
        "sha256": env["sha"],
        "emulator": "unicorn==2.1.4",
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
            "sourceAmount": 160,
            "initialTargetHp": 1000,
            "areaDamageRadius": 0,
            "chargeRange": 0,
            "crownTowerDamagePercent": 0,
            "sourceEffect": "assassin_hit",
        },
        "limits": [
            "This is selected packet delivery. The actual ordinary function header runs, then a checked jump supplies amount/source/cached-point locals and enters the actual zero-projectile tail. Packet/level selection, reload initialization, ordinary clocks, target eligibility/acquisition and full world/actor scheduling are excluded.",
            "Actual non-area, no-charge source data getters, target class/health resolution, cached direction arithmetic, native vector construction, ordinary receiver state filters, lower damage proxy/reducer and surviving HP stores execute. Whole supplied 64-KiB heap changes, ordered events, native receiver/vector arguments, source Data reads and driver counts are checked.",
            "A source Damage 160 packet and Knight HP 1000 seed the source cases. Other packet amounts, absent source/target references, cached points, effect fallback and raw target states 4/9 are explicit controls. Damage levels, shields, lethal paths, natural protection lifecycle and target selection are not inferred from these controls.",
            "Damage effect references are supplied opaque bindings for source assassin_hit; fallback identifiers and both facing/source view notifications are checked providers. Post-store reactions, lifetime/cleanup and post-delivery effect branches are excluded. The original real header frame is present; this is not an execution of the skipped allocation/selection prefix.",
            "The selected tail has no additional distance gate in these supplied episodes. This does not establish which targets a complete battle would select or retain. Gameplay remains rules 53; ordinary-cycle transition evidence is a separate prerequisite.",
        ],
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    output = json.dumps(result, indent=2) + "\n"
    path = Path("reference/client/ordinary-delivery-native-trace.json")
    if env["args"].check:
        require(path.read_text() == output, "Ordinary delivery capture differs")
    else:
        path.write_text(output)
    rows = cases + controls
    print(
        json.dumps(
            {
                "cases": len(cases),
                "controls": len(controls),
                "samples": len(rows),
                "hpStores": sum(r["result"]["applied"] for r in rows),
                "receiverRequests": sum(r["fields"]["targetPresent"] for r in rows),
            }
        )
    )
