"""Native null-source damage wrapper and bounded health/shield reduction.

Owner/world/settings providers and shield-loss side effects are supplied. Actual
gates, shield absorption, HP subtraction and terminal zero clamp execute. Later
reaction/death work is skipped explicitly before returning through native frames.
"""

from collections import Counter
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import struct
import subprocess

from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_READ
from unicorn.x86_const import UC_X86_REG_EIP, UC_X86_REG_ESP


def require(condition, detail):
    if not condition:
        raise RuntimeError(str(detail))


def capture(env, context):
    cpu, heap, body, data, component, world = [
        env[k] for k in ["cpu", "heap", "body", "data", "component", "world"]
    ]
    read, write, run, ret = [env[k] for k in ["read", "write", "run", "return_hook"]]
    paths = [
        "reference/client/projectile-hit-damage-native-trace.json",
        "reference/client/target-eligibility-native-trace.json",
        "reference/logic/characters.csv",
        "reference/logic/buildings.csv",
    ]
    inputs = [
        {"path": p, "sha256": hashlib.sha256(Path(p).read_bytes()).hexdigest()}
        for p in paths
    ]
    for path in paths[:2]:
        prior = json.loads(Path(path).read_text())
        require(prior["sha256"] == env["sha"], "Health/shield binary differs")
        for entry in prior["inputs"]:
            require(
                hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
                == entry["sha256"],
                f"Health/shield input differs: {entry['path']}",
            )
    columns = [
        {"name": "Hitpoints", "string": 0x613ED2, "gotOffset": 0x1770},
        {"name": "ShieldHitpoints", "string": 0x613EDC, "gotOffset": 0x1774},
    ]
    for col in columns:
        name = col["name"].encode() + b"\0"
        require(
            bytes(cpu.mem_read(col["string"], len(name))) == name,
            "Health/shield source column differs",
        )
    settings, vector = heap + 0xA000, heap + 0xE000
    # This continuation executes the real component owner getter. Its settings
    # boundary adds a caller-site guard beyond the shared clock harness.
    require(context["constants"].pop(0x25FA2A) == body, "Owner provider differs")
    require(context["constants"].pop(0x1E6CEE) == settings, "Settings provider differs")
    env["allowed"].extend(
        [
            (0x25FF6E, 0x2601AE),
            (0x2601AE, 0x2602CF),
            (0x2602D0, 0x260413),
            (0x260518, 0x260519),
            (0x26064E, 0x26065D),
            (0x25FA2A, 0x25FA3A),
            (0x217460, 0x2174E6),
            (0x217322, 0x217343),
            (0x1DEF68, 0x1DEF90),
            (0x1DEFC8, 0x1DEFDB),
            (0x1DE872, 0x1DE881),
            (0x1E6CEE, 0x1E6CEF),
            (0x35BD10, 0x35BD52),
            (0x218778, 0x218779),
        ]
    )
    current, events, reads, providers = None, [], [], Counter()
    resolver_sites = {
        0x25FFAD: "hiddenOwner",
        0x25FFCB: "stateOwner",
        0x2603EE: "shieldOwner",
        0x260305: "world",
    }

    def hook(_cpu, pc, _size, _data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if pc in resolver_sites:
            require(read(sp) == component, "Health resolver receiver differs")
            providers[resolver_sites[pc]] += 1
        elif pc == 0x1E6CEE:
            require(read(sp) == 0x2601D1, "Unexpected settings provider call")
            providers["settings"] += 1
            ret(settings)
        elif pc == 0x2602D0:
            require(
                [read(sp + i) for i in [4, 8, 12, 16, 20, 24]]
                == [
                    component,
                    current["amount"],
                    current["payload"],
                    0,
                    vector if current["vector"] is not None else 0,
                    current["force"] if current["direct"] else 0,
                ],
                "Native reducer arguments differ",
            )
            events.append(
                [
                    "reduce",
                    current["amount"],
                    current["payload"],
                    current["vector"],
                    (current["force"] if current["direct"] else 0) & 255,
                ]
            )
        elif pc == 0x218778:
            require(
                [read(sp + 4), read(sp + 8)]
                == [body, vector if current["vector"] is not None else 0],
                "Shield-loss notification arguments differ",
            )
            require(
                read(component + 0x14) == 0,
                "Shield-loss notification before shield zero",
            )
            events.append(["shieldLost", current["vector"]])
            ret()
        elif pc in [0x260412, 0x260518]:
            hp, shield = read(component + 8), read(component + 0x14)
            require((hp <= 0) == (pc == 0x260518), "Raw HP branch differs")
            events.append(["stored", hp, shield])
            # Retain the actual fatal zero store while skipping later callbacks.
            cpu.reg_write(UC_X86_REG_EIP, 0x26064E if hp <= 0 else 0x260655)
        elif pc == 0x260655:
            events.append(["return", read(component + 8), read(component + 0x14)])

    def memory(_cpu, _access, address, size, _value, _data):
        owner, base = next(
            (name, start)
            for name, start in [
                ("data", data),
                ("world", world),
                ("settings", settings),
            ]
            if start <= address < start + 0x800
        )
        reads.append((owner, address - base, size))

    for pc in [
        *resolver_sites,
        0x1E6CEE,
        0x2602D0,
        0x218778,
        0x260412,
        0x260518,
        0x260655,
    ]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)
    for start in [data, world, settings]:
        cpu.hook_add(UC_HOOK_MEM_READ, memory, begin=start, end=start + 0x7FF)
    rows = {}
    for path in paths[2:]:
        rows.update(
            {
                r["Name"]: r
                for r in csv.DictReader(io.StringIO(Path(path).read_text()))
                if r["Name"] not in ["", "string"]
            }
        )
    profiles = []
    for name in [
        "Knight",
        "DarkPrince",
        "SkeletonWarrior",
        "Cannon",
        "PrincessTower",
        "KingTower",
    ]:
        row = rows[name]
        require(
            not row["HidesWhenNotAttacking"] and not row["HideBeforeFirstHit"],
            "Recheck source hidden defaults",
        )
        profiles.append(
            {
                "sourceName": name,
                "hitpoints": int(row["Hitpoints"]),
                "shieldHitpoints": int(row["ShieldHitpoints"] or 0),
            }
        )
    pattern = bytes((i * 19 + 61) % 256 for i in range(0x10000))

    def sample(
        profile, amounts, source_request=None, override=None, category="control"
    ):
        nonlocal current
        current = {
            "hp": profile["hitpoints"],
            "shield": profile["shieldHitpoints"],
            "state": 2,
            "hideIdle": 0,
            "hideFirst": 0,
            "hideProgress": 600,
            "hideThreshold": 600,
            "worldByte": 0,
            "force": 0,
            "direct": False,
            "ownerPresent": True,
            "payload": -23,
            "vector": None,
            **(override or {}),
        }
        fields = current.copy()
        cpu.mem_write(heap, pattern)
        for ptr, value in [
            (body, 0x7B36D8 if profile["sourceName"] == "KingTower" else 0x7B34A0),
            (body + 0x10, data),
            (body + 0x38, 4),
            (body + 0x3C, 0),
            (body + 0x48, 0),
            (body + 0x60, current["state"]),
            (body + 0x6C, current["hideProgress"]),
            (data + 0x180, current["hideThreshold"]),
            (component + 4, body if current["ownerPresent"] else 0),
            (component + 8, current["hp"]),
            (component + 0x14, current["shield"]),
        ]:
            write(ptr, value)
        for ptr, value in [
            (data + 0x169, current["hideIdle"]),
            (data + 0x16A, current["hideFirst"]),
            (world + 0xFC, current["worldByte"]),
            (settings + 0x331, 0),
        ]:
            cpu.mem_write(ptr, bytes([value]))
        if current["vector"] is not None:
            for i, value in enumerate(current["vector"]):
                write(vector + 4 * i, value)
        frames = []
        for amount in amounts:
            require(
                0 <= amount <= 2147483647,
                "Damage amount outside supplied nonnegative domain",
            )
            current["amount"] = amount
            hp, shield = read(component + 8), read(component + 0x14)
            force = bool(current["force"] & 255)
            hidden = current["state"] == 7 or (
                (current["hideIdle"] or current["hideFirst"])
                and current["hideProgress"] == current["hideThreshold"]
            )
            forwarded = current["direct"] or (
                amount > 0 and current["state"] not in [4, 9] and (force or not hidden)
            )
            lower_force = force if current["direct"] else False
            applies = (
                forwarded
                and current["ownerPresent"]
                and (lower_force or not current["worldByte"])
                and hp > 0
            )
            next_shield, raw_hp, next_hp = shield, hp, hp
            expected_events = []
            expected_reads, expected_providers = Counter(), Counter()
            if not current["direct"]:
                expected_providers["hiddenOwner"] = 1
                if current["state"] != 7:
                    expected_reads[("data", 0x169, 1)] += 1
                    if not current["hideIdle"]:
                        expected_reads[("data", 0x16A, 1)] += 1
                    if current["hideIdle"] or current["hideFirst"]:
                        expected_reads[("data", 0x180, 4)] += 1
                if force or not hidden:
                    expected_providers["stateOwner"] = 1
                if forwarded:
                    expected_providers["settings"] = 1
                    expected_reads[("settings", 0x331, 1)] = 1
            if forwarded:
                expected_events.append(
                    [
                        "reduce",
                        amount,
                        current["payload"],
                        current["vector"],
                        (current["force"] if current["direct"] else 0) & 255,
                    ]
                )
                if current["ownerPresent"] and not lower_force:
                    expected_providers["world"] = 1
                    expected_reads[("world", 0xFC, 1)] = 1
                if applies:
                    if shield > 0:
                        next_shield = max(0, shield - amount)
                        if next_shield == 0:
                            expected_events.append(["shieldLost", current["vector"]])
                            expected_providers["shieldOwner"] = 1
                    else:
                        raw_hp = hp - amount
                        next_hp = max(0, raw_hp)
                    expected_events.append(["stored", raw_hp, next_shield])
                expected_events.append(["return", next_hp, next_shield])
            before = bytes(cpu.mem_read(heap, 0x10000))
            expected = bytearray(before)
            struct.pack_into("<i", expected, component - heap + 8, next_hp)
            struct.pack_into("<i", expected, component - heap + 0x14, next_shield)
            events.clear()
            reads.clear()
            providers.clear()
            returned = run(
                0x2602D0 if current["direct"] else 0x25FF6E,
                component,
                amount,
                current["payload"] if current["direct"] else 0,
                0 if current["direct"] else current["payload"],
                vector if current["vector"] is not None else 0,
                current["force"],
                instruction_budget=10000,
            )
            require(
                current["direct"] or returned == int(forwarded),
                "Wrapper return differs",
            )
            require(
                bytes(cpu.mem_read(heap, 0x10000)) == expected,
                "Health/shield heap mutation differs",
            )
            require(
                events == expected_events
                and Counter(reads) == expected_reads
                and providers == expected_providers,
                f"Health/shield events/reads/providers differ: {events}, {reads}, {providers}; expected {expected_events}, {expected_reads}, {expected_providers}",
            )
            frames.append(
                {
                    "amount": amount,
                    "hpBefore": hp,
                    "shieldBefore": shield,
                    "hpAfter": next_hp,
                    "shieldAfter": next_shield,
                    "wrapperResult": None if current["direct"] else returned,
                    "events": list(events),
                    "providers": dict(providers),
                    "dataReads": {
                        f"{n}/{hex(o)}/{s}": count
                        for (n, o, s), count in sorted(expected_reads.items())
                    },
                    "unrelatedHeapUnchanged": True,
                }
            )
        return {
            "kind": "source" if source_request is not None else category,
            "targetSource": profile["sourceName"],
            "sourceRequest": source_request,
            "fields": fields,
            "frames": frames,
        }

    prior = json.loads(Path(paths[0]).read_text())
    source_requests = {}
    for row in prior["cases"]:
        if row["targetSource"] in ["Knight", "PrincessTower", "KingTower"]:
            hit = next(e for e in row["events"] if e[0] == "hit")
            source_requests.setdefault(
                (row["sourceName"], row["targetSource"]),
                {
                    "sourceName": row["sourceName"],
                    "targetSource": row["targetSource"],
                    "amount": hit[1],
                },
            )
    cases = []
    for profile in profiles:
        target = (
            profile["sourceName"]
            if profile["sourceName"] in ["PrincessTower", "KingTower"]
            else "Knight"
        )
        for source in [
            r for r in source_requests.values() if r["targetSource"] == target
        ]:
            cases.append(sample(profile, [source["amount"], source["amount"]], source))
    require(len(cases) == 228, "Recheck health/shield source inventory")
    controls = []
    for profile in profiles:
        hp, shield = profile["hitpoints"], profile["shieldHitpoints"]
        for amount in sorted(
            {0, 1, hp - 1, hp, hp + 1, max(0, shield - 1), shield, shield + 1, 100000}
        ):
            controls.append(sample(profile, [amount, amount], category="boundary"))
    dark = next(p for p in profiles if p["sourceName"] == "DarkPrince")
    controls += [
        sample(dark, [199, 1, 1], category="sequence"),
        sample(dark, [1, 1000], override={"shield": 1}, category="sequence"),
        sample(
            dark, [2147483647, 1], override={"hp": 1, "shield": 1}, category="sequence"
        ),
    ]
    controls += [
        sample(dark, [201], override={"state": state, "force": force})
        for state in [0, 2, 4, 7, 9]
        for force in [0, 1, 255, 256]
    ]
    controls += [
        sample(dark, [201], override={field: flag, "force": force})
        for field in ["hideIdle", "hideFirst"]
        for flag in [1, 2, 255]
        for force in [0, 1]
    ]
    controls += [
        sample(dark, [201], override={"hideIdle": 1, "hideProgress": progress})
        for progress in [599, 600, 601]
    ]
    controls += [
        sample(
            dark, [201], override={"worldByte": flag, "force": force, "direct": direct}
        )
        for flag in [0, 1, 255]
        for force in [0, 1, 256]
        for direct in [False, True]
    ]
    controls += [
        sample(
            dark, [201], override={"direct": True, "ownerPresent": present, "hp": hp}
        )
        for present in [False, True]
        for hp in [-1, 0, 1]
    ]
    controls += [
        sample(dark, [0], override={"direct": True, "shield": shield})
        for shield in [0, 1, 200]
    ]
    controls += [
        sample(dark, [201], override={"direct": True, "state": state})
        for state in [4, 7, 9]
    ]
    controls += [
        sample(dark, [201], override={"payload": payload, "vector": point})
        for payload in [-2147483648, -23, 0, 2147483647]
        for point in [None, [0, 0], [300, -400]]
    ]
    definitions = [
        (
            "damageWrapper",
            0x25FF6E,
            0x2601AE,
            "Actual nonnegative amount assertion, hidden/state/positive gates, empty-buff route and forwarded request; source attribution is supplied null.",
        ),
        (
            "proxyGate",
            0x2601AE,
            0x2602CF,
            "Actual provided settings+0x331 false route into the reducer.",
        ),
        (
            "ownerWorldAndAliveGates",
            0x2602D0,
            0x260348,
            "Actual owner presence, world byte and positive HP guards; account pointer is supplied null.",
        ),
        (
            "shieldAndHealth",
            0x2603C9,
            0x260412,
            "Actual shield subtraction/max, discarded excess, shield-loss request and raw HP store.",
        ),
        (
            "fatalClamp",
            0x26064E,
            0x26065D,
            "Actual final zero clamp and native epilogue; intervening death/reaction work is skipped.",
        ),
        (
            "currentHealthGetter",
            0x25FF46,
            0x25FF56,
            "Actual component+0x08 current HP getter, retained for field interpretation.",
        ),
        (
            "shieldCapacityBinding",
            0x25FCBB,
            0x25FCD2,
            "Retained native level getter call and component+0x18 shield capacity store; level table projection is not executed.",
        ),
        (
            "currentShieldRestore",
            0x25FF1B,
            0x25FF36,
            "Retained component+0x14 current shield store when capacity is positive; stream construction is not executed.",
        ),
        (
            "hiddenPredicate",
            0x217460,
            0x2174E6,
            "Actual state 7 and hidden-source progress predicate.",
        ),
        (
            "statePredicate",
            0x217322,
            0x217343,
            "Actual states 4/9 rejection predicate.",
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
            line.strip()
            for line in asm.splitlines()
            if re.match(r"\s*[0-9a-f]+:", line)
        ]
        require(bool(instructions), "Empty health/shield instruction block")
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
        "sourceColumns": columns,
        "limits": [
            "Six source-seeded HP/shield records receive amounts from the prior actual projectile hit-request capture. Current HP/shield, headers, source Data and empty-buff state are supplied; actual component construction and native level projection are excluded.",
            "The native wrapper and reducer execute with a null damage-source object and account pointer. Owner/world resolution and false settings+0x331 are supplied providers with checked receiver/return sites; account attribution, retargeting, source buffs and alternate proxy routing are excluded.",
            "Actual hidden/state/positive amount gates, owner/world/alive reducer guards, shield max/subtraction, whole-packet shield absorption, raw HP subtraction and terminal zero clamp execute. A nonzero outer override bypasses the hidden test but is not forwarded to the lower world-byte guard; direct-lower controls vary its own override separately.",
            "Shield-loss notification records its exact owner/vector arguments with no side effects. After the raw HP store, later surviving-body callbacks and fatal notifications/effects/removal are skipped explicitly; fatal paths still execute the real final zero store and native epilogues. This does not prove complete death handling.",
            "Each invocation verifies ordered events, provider counts/arguments, exact Data/world/settings read inventories and the complete supplied 64-KiB heap. An outer wrapper result of one can accompany no HP change (world blocked or already dead); it is not an HP-change assertion. Application rules remain 44.",
        ],
        "profiles": profiles,
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    path = Path("reference/client/health-shield-native-trace.json")
    output = json.dumps(result, indent=2) + "\n"
    if env["args"].check:
        require(path.read_text() == output, "Health/shield capture differs")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "profiles": len(profiles),
                "cases": len(cases),
                "controls": len(controls),
                "calls": sum(len(r["frames"]) for r in cases + controls),
                "blocks": len(blocks),
            }
        )
    )
