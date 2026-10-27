"""Native Electro Wizard pulse dispatch loop, with damage allocation intercepted.

The actual extra-target scanner and AllTargetsHit fallback execute. The primary
lock/pulse boundary and minimal owner/candidate fields are supplied; damage,
death propagation and complete combat state machines remain outside scope.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EIP, UC_X86_REG_EDI


def capture(env, context):
    cpu, body, data, component = [env[k] for k in ["cpu", "body", "data", "component"]]
    read, write, run, return_hook = [env[k] for k in ["read", "write", "run", "return_hook"]]
    initialize, predict, candidate_id = [context[k] for k in ["initialize", "predict", "candidate_id"]]
    owner = env["rows"]["reference/logic/characters.csv"]["ElectroWizard"]
    if owner["MultipleTargets"] != "2" or owner["AllTargetsHit"] != "true" or owner["Projectile"]:
        raise RuntimeError("Recheck native Electro Wizard multi-hit/projectile profile")
    for delta, text in [(0x1a4d58, "MultipleTargets"), (0x1a4d48, "AllTargetsHit")]:
        if bytes(cpu.mem_read(0x7b8a14 - delta, len(text) + 1)) != text.encode() + b"\0":
            raise RuntimeError("Native multi-hit source string differs")
    env["allowed"].extend([(0x25cf20, 0x25d05f), (0x25e61c, 0x25e61d), (0x1defa4, 0x1defc7)])
    dispatches, clear_after_primary = [], False

    def hook(_cpu, address, _size, _data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if address == 0x25cf20:
            if read(sp + 4) != component:
                raise RuntimeError("Unexpected supplied hit-loop frame")
            cpu.reg_write(UC_X86_REG_EDI, component)
            write(sp + 0x24, data)
        elif address == 0x25e61c:
            index, pointer = read(sp + 12), read(sp + 8)
            if read(sp + 4) != component or read(sp) != {0: 0x25cf54, 1: 0x25d04a}.get(index):
                raise RuntimeError("Unexpected native hit dispatch")
            victim = candidate_id(pointer)
            if victim is None:
                raise RuntimeError("Native hit dispatched to an unknown target")
            dispatches.append({"target": victim, "index": index})
            if index == 0 and clear_after_primary:
                # Controlled equivalent of an external target-clear boundary;
                # this does not emulate damage, death or native notification.
                write(component + 8, 0)
            return_hook()
        elif address == 0x25d05e:
            # Stop at the completed multi-target loop before returning to the
            # surrounding attack clocks and state transitions.
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])

    cpu.hook_add(UC_HOOK_CODE, hook)
    cases = []
    for add_radius in [False, True]:
        own = int(owner["CollisionRadius"]) if add_radius else 0
        base = int(owner["Range"]) + own
        rear = int(owner["SightRange"]) + own + 500 - 1000
        for team in [0, 1]:
            forward = 1 if team == 0 else -1
            primary = {"id": "primary", "name": "Knight", "x": 0, "y": forward * 1000}
            def victim(id, name, x, y, eligible=True):
                return {"id": id, "name": name, "x": x, "y": y * forward, "eligible": eligible}
            scenarios = [
                ("lone-primary", [], False),
                ("split-ground", [victim("other", "Giant", 2500, 0)], False),
                ("source-balloon-candidate", [victim("other", "Balloon", 2500, 0)], False),
                ("ineligible-candidate", [victim("other", "Knight", 2500, 0, False)], False),
                ("center-over-edge", [victim("a", "Knight", -3600, 0), victim("b", "Giant", 3700, 0)], False),
                ("stable-center-tie", [victim("a", "Knight", -2500, 0), victim("b", "Giant", 2500, 0)], False),
                ("nominee-range-veto", [victim("a", "PrincessTower", 0, base + 1001), victim("b", "KingTower", 0, base + 1101)], False),
                ("farther-king-alone", [victim("b", "KingTower", 0, base + 1101)], False),
                ("cleared-after-primary", [], True),
            ]
            for offset in [-1, 0, 1]:
                scenarios.append((f"rear-clip-{offset}", [victim("other", "Knight", 0, -(rear + offset))], False))
            for label, others, clear_after_primary in scenarios:
                for reverse in ([False, True] if others else [False]):
                    candidates = [{**primary, "eligible": not clear_after_primary}, *others]
                    if reverse:
                        candidates.reverse()
                    for all_targets_hit in [False, True]:
                        resolved_clip = initialize(owner, candidates, team, add_radius, "primary")
                        write(data + 0x2e4, int(owner["MultipleTargets"]))
                        cpu.mem_write(data + 0x16d, bytes([int(all_targets_hit)]))
                        dispatches = []
                        run(0x25cf20, component, instruction_budget=16000)
                        _, extra = predict(owner, candidates, team, add_radius, None if clear_after_primary else "primary")
                        if extra is None and all_targets_hit and not clear_after_primary:
                            extra = "primary"
                        expected = [{"target": "primary", "index": 0}]
                        if extra is not None:
                            expected.append({"target": extra, "index": 1})
                        if dispatches != expected:
                            raise RuntimeError(json.dumps({"case": label, "addOwnRadius": add_radius, "team": team,
                                                           "allTargetsHit": all_targets_hit, "expected": expected, "actual": dispatches}))
                        cases.append({"case": label, "addOwnRadius": add_radius, "teamIndex": team,
                                      "allTargetsHit": all_targets_hit, "sourceControl": "archived" if all_targets_hit else "synthetic-false",
                                      "resolvedSightClip": resolved_clip, "candidates": candidates,
                                      "clearPrimaryAfterFirstDispatch": clear_after_primary, "dispatches": dispatches})
    static = [
        ("multipleTargetsField", 0x1db00b, 0x1db036, "MultipleTargets string0x613cbc loads Data+0x2e4."),
        ("allTargetsHitField", 0x1db03e, 0x1db069, "AllTargetsHit string0x613ccc loads Data byte+0x16d."),
        ("primaryDispatch", 0x25cf20, 0x25cf83, "Dispatch the assigned primary at hit index0, then enter the extra-target loop when MultipleTargets>=2."),
        ("extraTargetFallback", 0x25d00b, 0x25d05e, "Run the real extra-target scanner. A null result with AllTargetsHit=true falls back to the current primary; a cleared primary skips that extra dispatch."),
        ("noProjectileControl", 0x25cf83, 0x25cfb8, "With the flag false and no extra target, the native projectile getter returns the controlled null pointer and the loop advances without another dispatch."),
        ("projectileGetter", 0x1defa4, 0x1defc7, "The native projectile getter reads the controlled Data+0x84/+0x88 pointer; source ElectroWizard has no Projectile row."),
    ]
    blocks = []
    for name, start, end, meaning in static:
        assembly = subprocess.check_output(["objdump", "-d", "-Mintel", f"--start-address={start:#x}", f"--stop-address={end:#x}", str(env["args"].library)], text=True)
        instructions = [re.sub(r"\s+<[^>]+>", "", line.strip()) for line in assembly.splitlines() if re.match(r"\s+[0-9a-f]+:", line)]
        blocks.append({"name": name, "start": hex(start), "end": hex(end), "interpretation": meaning, "instructions": instructions})
    paths = ["reference/logic/characters.csv", "reference/logic/buildings.csv", "reference/logic/globals.csv",
             "reference/client/sight-target-types-native-trace.json", "reference/client/candidate-ranking-native-trace.json"]
    output = json.dumps({
        "source": "apk/1.8.1/x86/libg.so", "sha256": env["sha"], "emulator": "unicorn==2.1.4", "instructionBudget": 16000,
        "inputs": [{"path": path, "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest()} for path in paths],
        "owner": {"name": owner["Name"], **{key: int(owner[key] or 0) for key in ["Range", "MinimumRange", "SightRange", "CollisionRadius", "Speed", "MultipleTargets", "SightClip", "SightClipSide"]}, "AllTargetsHit": True},
        "limits": [
            "Executes native pulse dispatch from0x25cf20 through the completed extra-hit loop at0x25d05e, including the actual extra-target scanner, source clipping defaults, class/radius/priority methods and final range validation.",
            "The primary lock, entry frame, minimal source-selected objects and candidate eligibility/collection are supplied. The source AllTargetsHit=true setting and synthetic false control are explicit; no-projectile Data pointers remain controlled null.",
            "The actual damage dispatcher at0x25e61c is intercepted to record target and hit index. Damage allocation, level scaling, shields, HP changes, real death propagation, beam attachment geometry and full attack clocks/state machines are not emulated.",
            "Primary-clear controls externally clear the lock after the first dispatch and supply false eligibility for that body. They do not establish native death notification behavior. Native team indices are numeric controls, not browser player-color identities.",
        ], "blocks": blocks, "cases": cases,
    }, indent=2) + "\n"
    path = Path("reference/client/electro-bolts-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native Electro Wizard bolt capture differs")
    else:
        path.write_text(output)
    print(json.dumps({"cases": len(cases), "dispatches": sum(len(c["dispatches"]) for c in cases), "blocks": len(blocks)}))
