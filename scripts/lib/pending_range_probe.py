"""Native started-projectile range allowance with actual range geometry.

Runs only the bounded main-loop range-decision fragment. Source Data and owner,
zero-radius target, clock value and caller frame are supplied; complete combat
updates, natural movement/target selection and damage do not execute.
"""

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
    UC_X86_REG_ESI,
    UC_X86_REG_ESP,
    UC_X86_REG_EIP,
)


def capture(env, context):
    cpu, heap, body, data, component = [
        env[k] for k in ["cpu", "heap", "body", "data", "component"]
    ]
    read, write, run, initialize = [
        env[k] for k in ["read", "write", "run", "initialize"]
    ]
    config, target = context["config"], context["target_a"]
    globals_rows = context["globals_rows"]
    preserve = (
        globals_rows["LOGIC_PRESERVE_TARGET_IF_HIT_STARTED"]["BooleanValue"] == "TRUE"
    )
    add_radius = globals_rows["ADD_CHARACTER_RANGE_TO_RADIUS"]["BooleanValue"] == "TRUE"
    continuous_reduction = int(
        globals_rows["LOGIC_CHARACTER_CONTINUOUS_DAMAGE_ATTACK_CLOSER"]["NumberValue"]
    )
    if not preserve or not add_radius:
        raise RuntimeError("Recheck source range policy flags")
    projectile_path = "reference/logic/projectiles.csv"
    projectile_bytes = Path(projectile_path).read_bytes()
    projectiles = {
        r["Name"]: r for r in csv.DictReader(io.StringIO(projectile_bytes.decode()))
    }
    paths = [
        "reference/client/attack-range-native-trace.json",
        projectile_path,
        "reference/logic/globals.csv",
    ]
    inputs = [
        {"path": path, "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest()}
        for path in paths
    ]
    range_trace = json.loads(Path(paths[0]).read_bytes())
    if range_trace["sha256"] != env["sha"]:
        raise RuntimeError("Pending range input uses another binary")
    for item in range_trace["inputs"]:
        if (
            hashlib.sha256(Path(item["path"]).read_bytes()).hexdigest()
            != item["sha256"]
        ):
            raise RuntimeError("Pending range source differs")
    del context["constants"][0x25D6F2]
    env["allowed"].extend(
        [
            (0x25D6F2, 0x25D75C),
            (0x25DDAE, 0x25DEB6),
            (0x1DDBF4, 0x1DDC07),
            (0x1DE2D8, 0x1DE2EB),
            (0x1DE3F0, 0x1DE403),
            (0x21A2D0, 0x21A382),
            (0x35D620, 0x35D66F),
            (0x35D330, 0x35D423),
            (0x1DDC08, 0x1DDC26),
        ]
    )
    current = None
    requests = []
    result = None
    global_reads = set()

    def hook(_cpu, address, _size, _data):
        nonlocal result
        if current is None:
            return
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if address == 0x25C754:
            cpu.reg_write(UC_X86_REG_ESI, component)
            cpu.reg_write(UC_X86_REG_EDI, body)
            cpu.reg_write(UC_X86_REG_EAX, data)
            write(sp + 0x24, data)
        elif address == 0x25D6F2:
            if [read(sp + 4), read(sp + 8)] != [component, target]:
                raise RuntimeError("Unexpected native range request binding")
            requests.append(read(sp + 12))
        elif address == 0x25C7EC:
            result = bool(cpu.mem_read(sp + 0x28, 1)[0])
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])

    def memory(_cpu, _access, address, size, _value, _data):
        if current is not None:
            global_reads.add((address - config, size, cpu.reg_read(UC_X86_REG_EIP)))

    for address in [0x25C754, 0x25D6F2, 0x25C7EC]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=address, end=address)
    cpu.hook_add(UC_HOOK_MEM_READ, memory, begin=config, end=config + 0x7FF)
    profiles = []
    cases = []
    controls = []

    def sample(
        table,
        name,
        row,
        origin,
        elapsed,
        distance,
        keep,
        kind="sourceProfile",
        projectile_override=None,
        interval_override=None,
    ):
        nonlocal current, requests, result
        initialize({**row, "LoadTime": row["LoadTime"] or "0"})
        has_projectile = (
            bool(row["Projectile"])
            if projectile_override is None
            else projectile_override
        )
        interval = (
            int(row["HitSpeed"]) if interval_override is None else interval_override
        )
        for offset, field in [
            (0x1A0, "Range"),
            (0x1A4, "MinimumRange"),
            (0x22C, "CollisionRadius"),
        ]:
            write(data + offset, int(row[field] or 0))
        write(data + 0x198, interval)
        cpu.mem_write(data + 0x17D, b"\0")
        write(data + 0x28, heap + 0xE000 if has_projectile else 0)
        write(body + 0x20, origin)
        write(body + 0x24, -origin)
        write(body + 0x18, heap + 0xB000)
        write(heap + 0xB000, heap + 0xC000)
        write(heap + 0xC000 + 0x20, 0x25FA0C)
        write(target, heap + 0xD000)
        write(heap + 0xD038, 0x21A376)
        write(target + 0x20, origin + distance)
        write(target + 0x24, -origin)
        write(component + 8, target)
        write(component + 0xC, elapsed)
        cpu.mem_write(config + 0x295, bytes([add_radius]))
        write(config + 0x314, continuous_reduction)
        cpu.mem_write(config + 0x32C, bytes([keep]))
        reach = int(row["Range"]) + int(row["CollisionRadius"])
        current = {"source": name}
        requests = []
        result = None
        run(0x25C754, instruction_budget=10000)
        base = distance <= reach
        extra = distance <= reach + 500
        remainder = elapsed % interval if interval else None
        expected = base or (
            keep and has_projectile and extra and interval > 0 and remainder > 50
        )
        expected_requests = [0] + (
            [500] if not base and keep and has_projectile else []
        )
        if result != expected or requests != expected_requests:
            raise RuntimeError(
                json.dumps(
                    {
                        "source": name,
                        "distance": distance,
                        "reach": reach,
                        "elapsed": elapsed,
                        "interval": interval,
                        "keep": keep,
                        "projectile": has_projectile,
                        "expected": expected,
                        "actual": result,
                        "requests": requests,
                        "expectedRequests": expected_requests,
                    }
                )
            )
        record = {
            "kind": kind,
            "sourceTable": table,
            "sourceName": name,
            "origin": {"x": origin, "y": -origin},
            "targetOffsetX": distance,
            "elapsedMs": elapsed,
            "intervalMs": interval,
            "preserveStarted": keep,
            "syntheticPreserveFlag": keep != preserve,
            "hasProjectile": has_projectile,
            "providedTargetRadius": 0,
            "baseReach": reach,
            "baseInRange": base,
            "withinExtraRange": extra,
            "rangeRequests": requests.copy(),
            "computedInRange": result,
        }
        if projectile_override is not None:
            record["syntheticProjectilePresence"] = True
        if interval_override is not None:
            record["syntheticInterval"] = True
        (cases if kind == "sourceProfile" else controls).append(record)
        current = None

    for table, name in [
        ("characters", "Knight"),
        ("characters", "Archer"),
        ("characters", "ZapMachine"),
        ("buildings", "Cannon"),
    ]:
        row = env["rows"][f"reference/logic/{table}.csv"][name]
        if row["Projectile"] and row["Projectile"] not in projectiles:
            raise RuntimeError("Source projectile binding is absent")
        if int(row["MinimumRange"] or 0):
            raise RuntimeError("Pending range source matrix expects zero minimum")
        interval = int(row["HitSpeed"])
        reach = int(row["Range"]) + int(row["CollisionRadius"])
        profiles.append(
            {
                "sourceTable": table,
                "sourceName": name,
                "range": int(row["Range"]),
                "collisionRadius": int(row["CollisionRadius"]),
                "intervalMs": interval,
                "projectile": row["Projectile"] or None,
            }
        )
        for origin in [0, 1333, -9125]:
            for elapsed in [
                0,
                49,
                50,
                51,
                interval - 1,
                interval,
                interval + 49,
                interval + 50,
                interval + 51,
                2 * interval + 51,
            ]:
                for distance in [
                    reach - 1,
                    reach,
                    reach + 1,
                    reach + 499,
                    reach + 500,
                    reach + 501,
                ]:
                    for keep in [False, True]:
                        sample(table, name, row, origin, elapsed, distance, keep)
        for distance in [
            reach - 1,
            reach,
            reach + 1,
            reach + 499,
            reach + 500,
            reach + 501,
        ]:
            for keep in [False, True]:
                sample(
                    table,
                    name,
                    row,
                    0,
                    51,
                    distance,
                    keep,
                    "zeroIntervalControl",
                    interval_override=0,
                )
        for origin in [0, 1333, -9125]:
            for keep in [False, True]:
                sample(
                    table,
                    name,
                    row,
                    origin,
                    51,
                    reach + 1,
                    keep,
                    "projectilePresenceControl",
                    projectile_override=not bool(row["Projectile"]),
                )
    if {offset for offset, _size, _pc in global_reads} != {0x295, 0x314, 0x32C}:
        raise RuntimeError(
            json.dumps(
                {
                    "unboundGlobalReads": [
                        (hex(offset), size, hex(pc))
                        for offset, size, pc in sorted(global_reads)
                    ]
                }
            )
        )
    static = [
        (
            "rangeDecision",
            0x25C754,
            0x25C7EC,
            "Actual base range, source preserve flag, projectile-pointer guard, extra500 query, interval-zero guard and strict elapsed-remainder>50 decision.",
        ),
        (
            "rangeGeometry",
            0x25D6F2,
            0x25D75C,
            "Actual range wrapper adds its supplied extra only to maximum range and invokes native target geometry.",
        ),
        (
            "rangeProfile",
            0x25DDAE,
            0x25DEB6,
            "Actual source maximum/minimum getters and own-radius flag.",
        ),
        (
            "targetGeometry",
            0x21A2D0,
            0x21A382,
            "Actual target point/radius geometry with a supplied zero-radius target method.",
        ),
        (
            "projectileGetter",
            0x1DDC08,
            0x1DDC26,
            "Actual primary/alternate projectile pointer getter; caller supplies primary selection.",
        ),
        (
            "preserveFlagSource",
            0x1F1E54,
            0x1F1E87,
            "Static LOGIC_PRESERVE_TARGET_IF_HIT_STARTED loader/store at Globals+0x32c.",
        ),
        (
            "continuousReductionSource",
            0x1F1DA3,
            0x1F1DD6,
            "Static LOGIC_CHARACTER_CONTINUOUS_DAMAGE_ATTACK_CLOSER loader/store at Globals+0x314.",
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
                "sourceFlags": {
                    "preserveStarted": preserve,
                    "addOwnRadius": add_radius,
                    "continuousDamageReduction": continuous_reduction,
                },
                "extraRange": 500,
                "startedThresholdMs": 50,
                "globalReads": [
                    {"offset": hex(a), "size": b, "pc": hex(c)}
                    for a, b, c in sorted(global_reads)
                ],
                "limits": [
                    "Actual bounded main-loop range decision and native maximum/minimum/target geometry execute. Caller frame, source Data fields, owner/target positions, target vtable and elapsed counter are supplied.",
                    "The target radius method returns the native zero-radius base value. Projectile construction/reference lookup is supplied from archived source rows; only pointer presence is consumed by this decision.",
                    "Source preserve-started and own-radius flags and continuous-damage reduction are populated. Dynamic global-read tracing verifies that this fragment reads only those three configured fields. The reduction is inactive with the supplied absent movement component. False preserve flags, opposite projectile presence and zero intervals are synthetic controls.",
                    "Positions include three translated origins. Exact source-unit distances, strict50ms remainder boundaries, interval wrapping and zero-interval short circuit are retained. Complete owner state, natural movement, target loss/selection, active clock progression, damage and artwork remain outside scope.",
                    "This capture establishes the range-decision contract, not full attack continuation or whether the surrounding body update invokes it in every natural state. No application rule changes are made.",
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
    path = Path("reference/client/pending-range-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native pending range capture differs")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "profiles": len(profiles),
                "cases": len(cases),
                "controls": len(controls),
                "rangeQueries": sum(
                    len(r["rangeRequests"]) for r in [*cases, *controls]
                ),
                "blocks": len(blocks),
            }
        )
    )
