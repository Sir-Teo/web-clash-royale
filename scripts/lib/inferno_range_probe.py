"""Native range-loss/scan-gate continuation of the controlled Inferno probe.

Range predicates execute native integer geometry. Candidate selection remains a
controlled provider, called only when the native main loop permits a scan.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EIP


def capture(env, context):
    cpu, heap, body, data, component = [env[key] for key in ["cpu", "heap", "body", "data", "component"]]
    read, write, run, initialize, set_buffs, return_hook = [env[key] for key in ["read", "write", "run", "initialize", "set_buffs", "return_hook"]]
    config, target_a, target_b = [context[key] for key in ["config", "target_a", "target_b"]]
    state, pulses, calls = [context[key] for key in ["state", "pulses", "calls"]]
    add_radius = context["globals_rows"]["ADD_CHARACTER_RANGE_TO_RADIUS"]["BooleanValue"]
    if add_radius not in ["TRUE", "FALSE"]:
        raise RuntimeError("Unexpected archived range-radius flag")
    for address in [0x25d6f2, 0x25deb6]:
        del context["constants"][address]
    env["allowed"].extend([
        (0x25d6f2, 0x25d75c), (0x25ddae, 0x25deb6),
        (0x1ddbf4, 0x1ddc07), (0x1de2d8, 0x1de2eb), (0x1de3f0, 0x1de403),
        (0x21a2d0, 0x21a382), (0x35d620, 0x35d66f), (0x35d330, 0x35d423),
    ])
    tick, available_tick = 0, 0
    scans, acquisitions = [], []

    def candidate_hook(_cpu, address, _size, _data):
        if address != 0x25deb6:
            return
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if read(sp + 4) != component or read(sp) != 0x25c89d:
            raise RuntimeError("Candidate provider called outside the native main-loop scan gate")
        scans.append(tick)
        calls[hex(address)] = calls.get(hex(address), 0) + 1
        if tick >= available_tick and read(component + 8) == 0:
            if read(component + 0x28) != 0:
                raise RuntimeError("Native scan occurred before attack finish expired")
            acquisitions.append({"tick": tick, "before": state(), "candidate": "b"})
            # Tail-call the real setter, retaining the main loop's return frame.
            write(sp + 8, target_b)
            cpu.reg_write(UC_X86_REG_EIP, 0x25d4b0)
        else:
            return_hook()

    cpu.hook_add(UC_HOOK_CODE, candidate_hook)
    cases, boundaries = [], []
    for card, source in [("inferno-tower", env["rows"]["reference/logic/buildings.csv"]["InfernoTower"]),
                         ("inferno-dragon", env["rows"]["reference/logic/characters.csv"]["InfernoDragon"])]:
        if any(source[field] for field in ["LoadFirstHit", "StopTimeAfterAttack", "BurstDelay", "AttackDashTime", "RetargetAfterAttack", "MinimumRange"]):
            raise RuntimeError("Recheck source first-load/control/burst/retarget/range profile")
        for names in [[], ["Rage"], ["IceWizardSlowDown"], ["Rage", "IceWizardSlowDown"]]:
            for scenario in ["move-out-of-range", "notify-removal"]:
                for loss_tick in [89, 100]:
                    initialize(source)
                    set_buffs(names)
                    for name in names:
                        if env["buff_rows"][name]["AttractPercentage"]:
                            raise RuntimeError("Recheck buff attraction state")
                    write(body + 0x60, 2)
                    write(body + 0x18, heap + 0xb000)
                    write(heap + 0xb000, heap + 0xc000)
                    write(heap + 0xc000 + 0x20, 0x25fa0c)
                    for target, x in [(target_a, 2000), (target_b, -2000)]:
                        write(target, heap + 0xd000)
                        write(target + 0x20, x)
                    write(heap + 0xd000 + 0x38, 0x21a376)
                    write(component + 0xc, 0)
                    write(config + 0x1dc, context["finish_ms"])
                    cpu.mem_write(config + 0x295, bytes([int(add_radius == "TRUE")]))
                    for offset, field in [(0x1a0, "Range"), (0x1a4, "MinimumRange"),
                                          (0x22c, "CollisionRadius"),
                                          (0x1c4, "StopTimeAfterAttack"), (0x2e0, "VisualHitSpeed"),
                                          (0x2e4, "MultipleTargets"), (0x2e8, "Burst"),
                                          (0x2ec, "BurstDelay"), (0x2f0, "ActivationTime"), (0x2f4, "AttackDashTime")]:
                        write(data + offset, int(source[field] or 0))
                    # Prove the exact boundary of the executed range predicate.
                    if not names and scenario == "move-out-of-range" and loss_tick == 89:
                        reach = int(source["Range"]) + (int(source["CollisionRadius"]) if add_radius == "TRUE" else 0)
                        for x in [reach - 1, reach, reach + 1, 10000]:
                            write(target_a + 0x20, x)
                            boundaries.append({"card": card, "targetX": x, "inRange": bool(run(0x25d6f2, component, target_a, 0))})
                        write(target_a + 0x20, 2000)
                    pulses.clear()
                    calls.clear()
                    scans.clear()
                    acquisitions.clear()
                    tick, available_tick = 0, loss_tick + 1
                    context["set_tick"](tick)
                    run(0x25d4b0, component, target_a)
                    checkpoints, changes = [], []
                    for tick in range(1, 161):
                        context["set_tick"](tick)
                        if tick == loss_tick:
                            before = state()
                            if scenario == "move-out-of-range":
                                write(target_a + 0x20, 10000)
                            else:
                                run(0x25f594, component, target_a, 0, 0, 0)
                            changes.append({"tick": tick, "before": before, "afterTrigger": state()})
                        run(0x25c60c, component)
                        if tick in [1, 8, 24, 40, 80, 88, 120, 140, 160] or loss_tick <= tick <= loss_tick + 12:
                            checkpoints.append({"tick": tick, **state()})
                    if len(acquisitions) != 1 or acquisitions[0]["tick"] != loss_tick + 5:
                        raise RuntimeError("Recheck native finish-gated acquisition timing")
                    cases.append({"card": card, "buffs": names, "scenario": scenario,
                                  "lossTick": loss_tick, "candidateAvailableTick": available_tick,
                                  "range": int(source["Range"]), "collisionRadius": int(source["CollisionRadius"]),
                                  "loadTimeMs": int(source["LoadTime"]),
                                  "pulses": list(pulses), "changes": changes, "checkpoints": checkpoints,
                                  "scanTicks": list(scans), "acquisitions": list(acquisitions),
                                  "interceptCalls": dict(sorted(calls.items()))})
    static = [
        ("rangeRadiusGlobalLoader", 0x1f19fe, 0x1f1a31, "ADD_CHARACTER_RANGE_TO_RADIUS loads into Globals+0x295; the archived value is TRUE."),
        ("collisionRadiusColumn", 0x1dcccc, 0x1dccfa, "CollisionRadius column caches at GOT+0x1894; its native string is at 0x61421b."),
        ("collisionRadiusField", 0x1d9207, 0x1d921f, "The cached CollisionRadius column loads into CharacterData+0x22c."),
        ("collisionRadiusGetter", 0x1de3f0, 0x1de403, "The source collision radius reads CharacterData+0x22c."),
        ("retargetFlagLoader", 0x1daeea, 0x1daf15, "RetargetAfterAttack loads into CharacterData+0x16b; both source Infernos leave it false."),
        ("maximumRangeGetter", 0x1ddbf4, 0x1ddc07, "The maximum attack range reads CharacterData+0x1a0."),
        ("minimumRangeGetter", 0x1de2d8, 0x1de2eb, "The minimum attack range reads CharacterData+0x1a4."),
        ("rangeProfile", 0x25ddae, 0x25deb6, "Source range getters add own collision radius under the archived global flag; movement range reduction is inactive in this stationary profile."),
        ("rangePredicate", 0x25d6f2, 0x25d75c, "Resolves source position and range, then calls native target geometry."),
        ("targetGeometry", 0x21a2d0, 0x21a376, "Tests squared distance against range plus target radius; maximum range equality is eligible."),
        ("zeroRadius", 0x21a376, 0x21a382, "The controlled dummy target uses this native zero-radius virtual getter."),
        ("distanceWrapper", 0x35d620, 0x35d66f, "Resolves the two integer points for the native squared-distance helper."),
        ("squaredDistance", 0x35d330, 0x35d423, "Integer squared distance with saturation guards; all supplied coordinates remain within bounds."),
        ("rangeLossAndScanGate", 0x25c816, 0x25c89d, "An out-of-range active variable-damage target is cleared and finish starts at one; pending finish prevents candidate scanning."),
        ("finishGate", 0x25ca86, 0x25cab4, "Finish advances by 50 real ms until the archived 250-ms threshold, then clears attack state."),
        ("reloadDecrement", 0x25c627, 0x25c640, "Reload decreases by 50 real ms independently of buffs."),
        ("targetSetter", 0x25d4b0, 0x25d6a5, "The candidate provider tail-calls this real setter only from the native scan gate."),
        ("targetRemovalNotification", 0x25f594, 0x25f6b3, "The explicitly supplied removal notification can retain elapsed until finish expiry."),
        ("damageReloadPrefix", 0x25e681, 0x25e69f, "Native damage dispatch reloads the source LoadTime before skipped allocation."),
    ]
    blocks = []
    for name, start, end, meaning in static:
        assembly = subprocess.check_output(["objdump", "-d", "-Mintel", f"--start-address={start:#x}", f"--stop-address={end:#x}", str(env["args"].library)], text=True)
        instructions = [re.sub(r"\s+<[^>]+>", "", line.strip()) for line in assembly.splitlines() if re.match(r"\s+[0-9a-f]+:", line)]
        blocks.append({"name": name, "start": hex(start), "end": hex(end), "interpretation": meaning, "instructions": instructions})
    output = json.dumps({"source": "apk/1.8.1/x86/libg.so", "sha256": env["sha"],
                         "emulator": "unicorn==2.1.4", "stepMs": 50, "steps": 160,
                         "finishTimeMs": context["finish_ms"],
                         "addCharacterRangeToRadius": add_radius == "TRUE",
                         "inputs": [*env["inputs"], {"path": context["globals_path"], "sha256": hashlib.sha256(context["globals_bytes"]).hexdigest()}],
                         "limits": ["Controlled stationary owner state 2, no movement component; full card state machines, deployment, control and Freeze/Zap effects are not emulated.",
                                    "Native integer range geometry runs using source Range/MinimumRange/CollisionRadius, the archived ADD_CHARACTER_RANGE_TO_RADIUS flag and zero-radius dummy targets. Other Globals fields remain zero; full inherited source/global profiles are not recovered.",
                                    "Target eligibility is supplied true. Native scan timing runs, but selection is a controlled provider: target b becomes available one update after loss and is assigned through the real setter on the first permitted no-target scan. Target ranking and real acquisition are not recovered.",
                                    "Owner/data/world resolution and state/aim/movement notifications are intercepted. The visual callback uses a native empty method.",
                                    "Damage dispatch executes its prologue and LoadTime reload prefix; level lookup, damage allocation and the rest of dispatch are skipped, with callee registers/frame restored.",
                                    "Removal notification is explicitly invoked. Complete death propagation is outside the capture. Native 20-Hz quantization is not browser 30-Hz equivalence."],
                         "blocks": blocks, "boundaries": boundaries, "cases": cases}, indent=2) + "\n"
    path = Path("reference/client/inferno-range-loss-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native Inferno range-loss capture differs")
    else:
        path.write_text(output)
    print(json.dumps({"cases": len(cases), "updates": len(cases) * 160,
                      "pulses": sum(len(case["pulses"]) for case in cases), "boundaries": len(boundaries), "blocks": len(blocks)}))
