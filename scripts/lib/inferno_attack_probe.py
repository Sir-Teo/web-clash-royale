"""Controlled attack-component continuation for probe-inferno-clock.py.

This shares its pinned ELF loader and native clock setup. Geometry/eligibility,
candidate scanning, owner state/visual callbacks and damage allocation remain
outside the contract. The real main attack loop, target setter, target-removal
notification and damage-dispatch reload prefix run from the library.
"""
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_ESI, UC_X86_REG_EDI, UC_X86_REG_EBP, UC_X86_REG_ESP, UC_X86_REG_EIP


def capture(env):
    cpu, heap, body, data, component = [env[key] for key in ["cpu", "heap", "body", "data", "component"]]
    read, write, run, initialize, set_buffs, return_hook = [env[key] for key in ["read", "write", "run", "initialize", "set_buffs", "return_hook"]]
    allowed, rows, args = [env[key] for key in ["allowed", "rows", "args"]]
    config, target_a, target_b = heap + 0xa000, heap + 0x8000, heap + 0x9000
    globals_path = "reference/logic/globals.csv"
    globals_bytes = Path(globals_path).read_bytes()
    globals_rows = {row["Name"]: row for row in csv.DictReader(io.StringIO(globals_bytes.decode()))}
    finish_ms = int(globals_rows["ATTACK_FINISH_TIME_MS"]["NumberValue"])
    allowed.extend([(0x25c60c, 0x25d068), (0x25d4b0, 0x25d6a5), (0x25f594, 0x25f6b3),
                    (0x25fa0c, 0x25fa16), (0x217780, 0x217790), (0x219af6, 0x219b4e),
                    (0x1dec32, 0x1dec46), (0x1f3568, 0x1f357b), (0x35bd10, 0x35bd52),
                    (0x25d852, 0x25d946), (0x25c19a, 0x25c1eb), (0x1de724, 0x1de73e),
                    (0x1d8218, 0x1d822f), (0x215f58, 0x215f98), (0x25e61c, 0x25e638), (0x25e681, 0x25e6a0)])
    # These are explicit boundaries, rather than inferred original outcomes.
    constants = {0x25fa9c: data, 0x25fa2a: body, 0x1e6cee: config,
                 0x25d6f2: 1, 0x25d7c2: 1, 0x25deb6: 0,
                 0x214f60: 0, 0x2182ea: 0, 0x218320: 0, 0x21863e: 0}
    allowed.extend((address, address + 1) for address in constants)
    calls = {}
    pulses = []
    tick = 0
    damage_context = None

    def target_label(pointer):
        if pointer not in [0, target_a, target_b]:
            raise RuntimeError("Unexpected native target pointer")
        return {0: None, target_a: "a", target_b: "b"}[pointer]

    def state():
        return {"elapsedMs": read(component + 0xc), "reloadMs": read(component + 0x10),
                "finishMs": read(component + 0x28), "target": target_label(read(component + 8)),
                "flag1d": cpu.mem_read(component + 0x1d, 1)[0]}

    def hook(_cpu, address, _size, _data):
        nonlocal damage_context
        if address in constants:
            sp = cpu.reg_read(UC_X86_REG_ESP)
            if address in [0x25fa9c, 0x25fa2a, 0x25d6f2, 0x25d7c2, 0x25deb6, 0x25d95e]:
                if read(sp + 4) != component:
                    raise RuntimeError("Unexpected attack-component callback owner")
            elif address != 0x1e6cee and read(sp + 4) != body:
                raise RuntimeError("Unexpected unit notification owner")
            if address in [0x25d6f2, 0x25d7c2]:
                if read(sp + 8) not in [target_a, target_b]:
                    raise RuntimeError("Unexpected supplied eligible target")
            if address == 0x214f60 and read(sp + 8) != 2:
                raise RuntimeError("Unexpected owner-state notification")
            calls[hex(address)] = calls.get(hex(address), 0) + 1
            return_hook(constants[address])
        elif address == 0x25e637:
            # Keep the actual callee frame and execute its real reload prefix,
            # skipping level/damage/world work. Restore that frame at its end.
            base = cpu.reg_read(UC_X86_REG_EBP)
            if read(base + 8) != component:
                raise RuntimeError("Unexpected native damage-dispatch owner")
            target_label(read(base + 12))
            damage_context = {"tick": tick, **state()}
            if args.first_attacks:
                damage_context["hitIndex"] = read(base + 16)
            cpu.reg_write(UC_X86_REG_EIP, 0x25e681)
        elif address == 0x25e69f:
            if damage_context is None:
                raise RuntimeError("Reload prefix without damage dispatch")
            pulses.append({**damage_context, "reloadAfterMs": read(component + 0x10)})
            damage_context = None
            base = cpu.reg_read(UC_X86_REG_EBP)
            for offset, register in [(4, UC_X86_REG_EBX), (8, UC_X86_REG_EDI), (12, UC_X86_REG_ESI)]:
                cpu.reg_write(register, read(base - offset))
            cpu.reg_write(UC_X86_REG_ESP, base + 4)
            cpu.reg_write(UC_X86_REG_EBP, read(base))
            return_hook()

    # Keep the global instruction allowlist in the root harness. These explicit
    # callback boundaries need Python dispatch only at their own addresses.
    # First-attack continuation adds the extra-scan provider after registration.
    for address in [*constants, 0x25d95e, 0x25e637, 0x25e69f]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=address, end=address)
    if args.range_loss or args.first_attacks or args.target_switches:
        if args.target_switches:
            from lib.target_switch_probe import capture as capture_continuation
        elif args.first_attacks:
            from lib.first_attack_probe import capture as capture_continuation
        else:
            from lib.inferno_range_probe import capture as capture_continuation

        def set_tick(value):
            nonlocal tick
            tick = value

        capture_continuation(env, {"config": config, "target_a": target_a, "target_b": target_b,
                            "finish_ms": finish_ms, "state": state, "pulses": pulses,
                            "calls": calls, "constants": constants, "set_tick": set_tick,
                            "globals_path": globals_path, "globals_bytes": globals_bytes,
                            "globals_rows": globals_rows})
        return
    cases = []
    for card, source in [("inferno-tower", rows["reference/logic/buildings.csv"]["InfernoTower"]),
                         ("inferno-dragon", rows["reference/logic/characters.csv"]["InfernoDragon"])]:
        if source["LoadFirstHit"] or source["StopTimeAfterAttack"] or source["BurstDelay"] or source["AttackDashTime"]:
            raise RuntimeError("Recheck source first-load/control/burst profile")
        for names in [[], ["Rage"], ["IceWizardSlowDown"], ["Rage", "IceWizardSlowDown"]]:
            for scenario in ["uninterrupted", "assign-in-range", "remove-then-acquire", "notify-removal-then-acquire"]:
                initialize(source)
                set_buffs(names)
                # AttractPercentage is absent for these three actual buff rows.
                for name in names:
                    if env["buff_rows"][name]["AttractPercentage"]:
                        raise RuntimeError("Recheck buff attraction state")
                write(body + 0x60, 2)
                write(body + 0x18, heap + 0xb000)
                write(heap + 0xb000, heap + 0xc000)
                write(heap + 0xc000 + 0x20, 0x25fa0c)
                write(component + 0xc, 0)
                write(data + 0x1c4, int(source["StopTimeAfterAttack"] or 0))
                cpu.mem_write(data + 0x288, b"\0")
                write(config + 0x1dc, finish_ms)
                for offset, field in [(0x2e0, "VisualHitSpeed"), (0x2e4, "MultipleTargets"),
                                      (0x2e8, "Burst"), (0x2ec, "BurstDelay"),
                                      (0x2f0, "ActivationTime"), (0x2f4, "AttackDashTime")]:
                    write(data + offset, int(source[field] or 0))
                pulses.clear()
                calls.clear()
                run(0x25d4b0, component, target_a)
                checkpoints, changes = [], []
                for tick in range(1, 161):
                    if tick == 89 and scenario != "uninterrupted":
                        before = state()
                        if scenario == "assign-in-range":
                            run(0x25d4b0, component, target_b)
                        elif scenario == "remove-then-acquire":
                            run(0x25d4b0, component, 0)
                        else:
                            run(0x25f594, component, target_a, 0, 0, 0)
                        changes.append({"tick": tick, "before": before, "after": state()})
                    if tick == 95 and scenario in ["remove-then-acquire", "notify-removal-then-acquire"]:
                        before = state()
                        run(0x25d4b0, component, target_b)
                        changes.append({"tick": tick, "before": before, "after": state()})
                    run(0x25c60c, component)
                    if tick in [1, 8, 24, 40, 80, 88, 89, 90, 93, 94, 95, 100, 110, 120, 140, 160]:
                        checkpoints.append({"tick": tick, **state()})
                cases.append({"card": card, "buffs": names, "scenario": scenario,
                              "loadTimeMs": int(source["LoadTime"]), "pulses": list(pulses),
                              "changes": changes, "checkpoints": checkpoints, "interceptCalls": dict(sorted(calls.items()))})

    static = [
        ("firstLoadColumn", 0x1dd4d9, 0x1dd525, "LoadFirstHit column caches at GOT+0x18e4; source Infernos leave it false."),
        ("firstLoadField", 0x1d9c0d, 0x1d9c25, "The LoadFirstHit flag loads into CharacterData+0x288."),
        ("finishColumn", 0x1f0e14, 0x1f0e47, "ATTACK_FINISH_TIME_MS loads into Globals+0x1dc; archived value is 250 ms."),
        ("constructorClock", 0x25c429, 0x25c4d0, "Elapsed/reload initialize to zero; only LoadFirstHit initializes reload to LoadTime."),
        ("targetSetter", 0x25d4b0, 0x25d6a5, "With supplied in-range eligibility, direct assignment can retain elapsed. Explicit null removal resets variable-damage elapsed while retaining reload."),
        ("targetRemovalNotification", 0x25f594, 0x25f6b3, "Removing the current target clears its pointer and can start an attack-finish countdown. Complete death propagation is outside the capture."),
        ("reloadDecrement", 0x25c627, 0x25c640, "The larger attack loop subtracts 50 real ms from reload, clamping at zero."),
        ("finishGate", 0x25ca86, 0x25cab4, "A positive finish counter advances by 50 ms; on expiry the reset branch clears elapsed and pending state."),
        ("pulseBoundary", 0x25cac4, 0x25cc50, "The larger loop compares elapsed/HitSpeed before and after the active-clock update to select a damage dispatch."),
        ("damageDispatch", 0x25cec5, 0x25cf54, "The pulse flag reaches the real damage-dispatch entry under the controlled non-burst/non-dash profile."),
        ("damageReloadPrefix", 0x25e681, 0x25e69f, "Each dispatched pulse reloads AttackComponent+0x10 from source LoadTime before damage allocation."),
    ]
    blocks = []
    for name, start, end, meaning in static:
        assembly = subprocess.check_output(["objdump", "-d", "-Mintel", f"--start-address={start:#x}", f"--stop-address={end:#x}", str(args.library)], text=True)
        instructions = [re.sub(r"\s+<[^>]+>", "", line.strip()) for line in assembly.splitlines() if re.match(r"\s+[0-9a-f]+:", line)]
        blocks.append({"name": name, "start": hex(start), "end": hex(end), "interpretation": meaning, "instructions": instructions})
    output = json.dumps({"source": "apk/1.8.1/x86/libg.so", "sha256": env["sha"],
                         "emulator": "unicorn==2.1.4", "stepMs": 50, "steps": 160,
                         "inputs": [*env["inputs"], {"path": globals_path, "sha256": hashlib.sha256(globals_bytes).hexdigest()}],
                         "limits": ["Controlled stationary attack components, with owner state fixed at 2 and movement components absent. Actual card state machines, movement, deployment, control and Freeze/Zap effects are not emulated.",
                                    "Range and target-eligibility predicates return true for supplied targets. Candidate scanning supplies no target. Reacquisition is explicitly supplied on tick 95, outside the main loop. This does not recover native target selection or prove direct in-range reassignment occurs in normal play.",
                                    "Owner/data/world resolution and unit state/aim/movement notifications are intercepted. The visual callback uses a native empty method. Other Globals fields remain zero and are not a recovered global profile.",
                                    "Damage dispatch runs its native prologue and LoadTime reload prefix; level lookup, damage allocation and the remainder of the dispatch are skipped. Callee registers/frame are restored at that boundary.",
                                    "The target-removal notification is invoked explicitly; complete death propagation, eligibility geometry and source row inheritance are outside the contract.",
                                    "Native 20-Hz integer updates are evidence, not a claim of equivalence with the browser's 30-Hz simulation."],
                         "blocks": blocks, "cases": cases}, indent=2) + "\n"
    path = Path("reference/client/inferno-attack-loop-native-trace.json")
    if args.check:
        if path.read_text() != output:
            raise RuntimeError("Native Inferno attack-loop capture differs")
    else:
        path.write_text(output)
    print(json.dumps({"cases": len(cases), "updates": len(cases) * 160,
                      "pulses": sum(len(case["pulses"]) for case in cases), "blocks": len(blocks)}))
