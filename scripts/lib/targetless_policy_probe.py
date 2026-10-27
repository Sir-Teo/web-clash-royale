"""Native targetless policy and bounded finish/active caller selection.

Owner lookup and source-selected Data records are supplied. Actual Data/field
getters, policy and caller branch execute. This does not execute finish timers,
active attack clocks, natural target loss, target setters or damage dispatch.
"""

import csv
import hashlib
import io
import itertools
import json
from pathlib import Path
import re
import subprocess
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_READ
from unicorn.x86_const import UC_X86_REG_ESI, UC_X86_REG_ESP, UC_X86_REG_EIP


def capture(env, context):
    cpu, heap, body, data, component = [
        env[k] for k in ["cpu", "heap", "body", "data", "component"]
    ]
    read, write, run, initialize = [
        env[k] for k in ["read", "write", "run", "initialize"]
    ]
    config, projectile, alternate = context["config"], heap + 0xE000, heap + 0xE100
    source_allow = (
        context["globals_rows"]["ALLOW_AOE_ATTACKS_WITHOUT_TARGET"]["BooleanValue"]
        == "TRUE"
    )
    if not source_allow:
        raise RuntimeError("Recheck archived targetless policy flag")
    paths = [
        "reference/logic/characters.csv",
        "reference/logic/buildings.csv",
        "reference/logic/projectiles.csv",
        "reference/logic/globals.csv",
    ]
    inputs = [
        {"path": path, "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest()}
        for path in paths
    ]
    projectiles = {
        row["Name"]: row
        for row in csv.DictReader(io.StringIO(Path(paths[2]).read_text()))
    }
    for address, name in [
        (0x61690B, "ALLOW_AOE_ATTACKS_WITHOUT_TARGET"),
        (0x613908, "SelfAsAoeCenter"),
        (0x619505, "Homing"),
    ]:
        if bytes(cpu.mem_read(address, len(name) + 1)) != name.encode() + b"\0":
            raise RuntimeError("Recheck native targetless source column")
    env["allowed"].extend(
        [
            (0x25F6B4, 0x25F73C),
            (0x1DEF2C, 0x1DEF40),
            (0x1DDC08, 0x1DDC26),
            (0x1FB83A, 0x1FB84B),
        ]
    )
    global_reads, data_reads, projectile_reads = set(), set(), set()
    counts, branch = {}, None

    def hook(_cpu, address, _size, _user):
        nonlocal branch
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if address == 0x25CA7A:
            cpu.reg_write(UC_X86_REG_ESI, component)
        elif address in [0x25CA86, 0x25CAB4]:
            branch = "finish" if address == 0x25CA86 else "active"
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        else:
            key, owner = {
                0x25F6B4: ("policy", component),
                0x2147C8: ("ownerData", body),
                0x1DEF2C: ("selfCenter", data),
                0x1DDC08: ("primaryProjectile", data),
                0x1FB83A: ("homing", projectile),
            }[address]
            if read(sp + 4) != owner or (
                key == "primaryProjectile" and read(sp + 8) != 0
            ):
                raise RuntimeError("Unexpected targetless getter binding")
            counts[key] = counts.get(key, 0) + 1

    def memory(_cpu, _access, address, size, _value, _user):
        pc = cpu.reg_read(UC_X86_REG_EIP)
        if config <= address < config + 0x800:
            global_reads.add((address - config, size, pc))
        elif data <= address < data + 0x400:
            data_reads.add((address - data, size, pc))
        elif projectile <= address < projectile + 0x100:
            projectile_reads.add((address - projectile, size, pc))

    for address in [
        0x25CA7A,
        0x25CA86,
        0x25CAB4,
        0x25F6B4,
        0x2147C8,
        0x1DEF2C,
        0x1DDC08,
        0x1FB83A,
    ]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=address, end=address)
    for start, end in [
        (config, config + 0x7FF),
        (data, data + 0x3FF),
        (projectile, projectile + 0xFF),
    ]:
        cpu.hook_add(UC_HOOK_MEM_READ, memory, begin=start, end=end)
    cases, controls, profiles = [], [], []

    def sample(
        table,
        source,
        allow,
        self_center,
        present,
        homing,
        alternate_present=False,
        kind="sourceProfile",
    ):
        nonlocal counts, branch
        initialize({**source, "LoadTime": source["LoadTime"] or "0"})
        cpu.mem_write(config + 0x201, bytes([allow]))
        cpu.mem_write(data + 0x291, bytes([self_center]))
        write(data + 0x28, projectile if present else 0)
        write(data + 0x34, alternate if alternate_present else 0)
        cpu.mem_write(projectile + 0x78, bytes([homing]))
        cpu.mem_write(alternate + 0x78, bytes([not homing]))
        write(component + 8, 0)
        expected = not allow or (not self_center and (not present or homing))
        expected_counts = {"policy": 1}
        if allow:
            expected_counts.update(ownerData=1, selfCenter=1)
            if not self_center:
                expected_counts["primaryProjectile"] = 2 if present else 1
                if present:
                    expected_counts["homing"] = 1
        before = bytes(cpu.mem_read(heap, 0x10000))
        counts = {}
        result = run(0x25F6B4, component)
        direct_counts = dict(counts)
        counts, branch = {}, None
        run(0x25CA7A, instruction_budget=2000)
        if result != int(expected) or branch != ("finish" if expected else "active"):
            raise RuntimeError("Native targetless policy or caller branch differs")
        if direct_counts != expected_counts or counts != expected_counts:
            raise RuntimeError("Native targetless short circuit differs")
        if bytes(cpu.mem_read(heap, 0x10000)) != before:
            raise RuntimeError(
                "Targetless policy unexpectedly mutates supplied objects"
            )
        return {
            "kind": kind,
            "sourceTable": table,
            "sourceName": source["Name"],
            "allowWithoutTarget": allow,
            "selfAsAoeCenter": self_center,
            "hasProjectile": present,
            "projectileHoming": homing,
            "alternatePresent": alternate_present,
            "alternateHoming": not homing if alternate_present else None,
            "useFinishBranch": bool(result),
            "callerBranch": branch,
            "directGetterCalls": direct_counts,
            "callerGetterCalls": dict(counts),
            "heapUnchanged": True,
        }

    for table in ["characters", "buildings"]:
        for name, row in env["rows"][f"reference/logic/{table}.csv"].items():
            if name in ["", "string"] or int(row["HitSpeed"] or 0) <= 0:
                continue
            present, self_center = (
                bool(row["Projectile"]),
                row["SelfAsAoeCenter"].lower() == "true",
            )
            if present and row["Projectile"] not in projectiles:
                raise RuntimeError("Source primary projectile is missing")
            homing = (
                present and projectiles[row["Projectile"]]["Homing"].lower() == "true"
            )
            profiles.append(
                {
                    "sourceTable": table,
                    "sourceName": name,
                    "selfAsAoeCenter": self_center,
                    "projectile": row["Projectile"] or None,
                    "homing": homing if present else None,
                }
            )
            cases.append(sample(table, row, source_allow, self_center, present, homing))
            controls.append(
                sample(
                    table,
                    row,
                    not source_allow,
                    self_center,
                    present,
                    homing,
                    kind="oppositeGlobalControl",
                )
            )
    if len(profiles) != 63:
        raise RuntimeError("Recheck positive HitSpeed roster")
    knight = env["rows"][paths[0]]["Knight"]
    for allow, self_center, present, homing, alternate_present in itertools.product(
        [False, True], repeat=5
    ):
        controls.append(
            sample(
                "characters",
                knight,
                allow,
                self_center,
                present,
                homing,
                alternate_present,
                "syntheticTruthTable",
            )
        )
    if (
        {offset for offset, _size, _pc in global_reads} != {0x201}
        or {offset for offset, _size, _pc in data_reads} != {0x28, 0x291}
        or {offset for offset, _size, _pc in projectile_reads} != {0x78}
    ):
        raise RuntimeError("Native targetless decision reads an unbound field")
    static = [
        (
            "targetlessPolicy",
            0x25F6B4,
            0x25F73C,
            "Actual global/self-center/primary-projectile/homing decision; return one selects the finish branch at the bounded caller.",
        ),
        (
            "callerSelection",
            0x25CA68,
            0x25CAB4,
            "Earlier target/raw-field gates are retained statically. Executed entry at 0x25ca7a calls the real policy and stops at finish at 0x25ca86 or active at 0x25cab4 before their effects.",
        ),
        (
            "ownerData",
            0x2147C8,
            0x2147EF,
            "Actual owner Data getter through native base getter; owner resolution itself is supplied.",
        ),
        ("bodyData", 0x21960E, 0x21961E, "Actual body Data pointer field."),
        (
            "selfCenterGetter",
            0x1DEF2C,
            0x1DEF40,
            "Actual SelfAsAoeCenter field at Data+0x291.",
        ),
        (
            "projectileGetter",
            0x1DDC08,
            0x1DDC26,
            "Actual primary/alternate getter, invoked with primary selector zero.",
        ),
        ("homingGetter", 0x1FB83A, 0x1FB84B, "Actual Projectile+0x78 Homing getter."),
        (
            "allowGlobalSource",
            0x1EF7BA,
            0x1EF7F5,
            "Static ALLOW_AOE_ATTACKS_WITHOUT_TARGET loader/store at Globals+0x201.",
        ),
        (
            "selfCenterSource",
            0x1D96E1,
            0x1D970C,
            "Static SelfAsAoeCenter loader/store.",
        ),
        (
            "homingColumnSource",
            0x1FACDD,
            0x1FAD08,
            "Static Homing column reference retained at GOT+0x1b9c.",
        ),
        (
            "homingFieldSource",
            0x1FA24B,
            0x1FA260,
            "Static referenced Homing column boolean loads and stores Projectile+0x78.",
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
    reads = lambda values: [
        {"offset": hex(a), "size": b, "pc": hex(c)} for a, b, c in sorted(values)
    ]
    output = (
        json.dumps(
            {
                "source": "apk/1.8.1/x86/libg.so",
                "sha256": env["sha"],
                "emulator": "unicorn==2.1.4",
                "inputs": inputs,
                "sourceAllowWithoutTarget": source_allow,
                "limits": [
                    "Actual targetless policy, owner Data/field getters and bounded caller selection execute. Owner lookup, minimal Data records, source primary projectile references and caller frame are supplied; full construction/class resolution is excluded.",
                    "Caller entry is 0x25ca7a with a null component target. Earlier owner/state/target/raw-field gates remain outside execution. Finish at 0x25ca86 and active at 0x25cab4 are stop boundaries; neither finish timers/reset nor active clock/damage effects execute.",
                    "Return one means the caller's finish branch, not proof of immediate cancellation. Return zero selects its active branch, not proof of a completed attack without a target.",
                    "Archived positive HitSpeed rows supply self-center and primary Homing fields. Alternate pointers are zero in source cases; synthetic non-null opposite-Homing alternates prove that this primary selector ignores them.",
                    "Getter call counts check every short circuit. Dynamic global/Data/projectile reads verify only populated fields are consumed, and the complete supplied heap remains unchanged by both calls. Natural target disappearance, target setters, damage, movement, artwork and application rules remain separate.",
                ],
                "globalReads": reads(global_reads),
                "dataReads": reads(data_reads),
                "projectileReads": reads(projectile_reads),
                "profiles": profiles,
                "blocks": blocks,
                "cases": cases,
                "controls": controls,
            },
            indent=2,
        )
        + "\n"
    )
    path = Path("reference/client/targetless-policy-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native targetless policy capture differs")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "profiles": len(profiles),
                "cases": len(cases),
                "controls": len(controls),
                "nativePolicyCalls": 2 * (len(cases) + len(controls)),
                "blocks": len(blocks),
            }
        )
    )
