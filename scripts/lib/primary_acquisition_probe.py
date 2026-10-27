"""Native primary acquisition with explicit setter/fallback boundaries.

The actual nearby scanner, class/radius/priority methods, clipping and numeric
target-field adjustment execute. Setter requests are intercepted before lock
side effects; distant fallback, full eligibility and movement are controlled.
"""
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP


def capture(env, context):
    cpu, body, component = [env[k] for k in ["cpu", "body", "component"]]
    read, write, run, return_hook = [env[k] for k in ["read", "write", "run", "return_hook"]]
    initialize, sources, targets, active, queries = [context[k] for k in ["initialize", "sources", "targets", "active", "queries"]]
    extras = context["extras"]
    for vtable in [0x7b34a0, 0x7b36d8]:
        if read(vtable + 0x4c) != 0x219d5e or read(vtable + 0x80) != 0x218c44:
            raise RuntimeError("Unexpected primary target virtual methods")
    env["allowed"].extend([
        (0x25deb6, 0x25e310), (0x217780, 0x217790),
        (0x219d5e, 0x219da2), (0x219dae, 0x219dc6), (0x218c44, 0x218c58),
        (0x25d4b0, 0x25d4b1), (0x25e310, 0x25e311), (0x219b36, 0x219b4e),
    ])
    nominated, requests, fallback_calls, fallback_id = None, [], 0, None

    def identity(pointer):
        return active()[pointer]["id"] if pointer in active() else None

    def hook(_cpu, address, _size, _data):
        nonlocal nominated, fallback_calls
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if address == 0x25e27d:
            nominated = identity(read(sp + 0x24))
        elif address == 0x25e310:
            if read(sp + 4) != component or read(sp) != 0x25e2e2:
                raise RuntimeError("Unexpected primary distant-fallback boundary")
            fallback_calls += 1
            pointer = next((pointer for pointer, value in active().items() if value["id"] == fallback_id), 0)
            return_hook(pointer)
        elif address == 0x25d4b0:
            if read(sp + 4) != component or read(sp) != 0x25e308:
                raise RuntimeError("Unexpected primary setter dispatch")
            pointer = read(sp + 8)
            if pointer not in active():
                raise RuntimeError("Primary scan requested an unknown target")
            requests.append(identity(pointer))
            return_hook()

    cpu.hook_add(UC_HOOK_CODE, hook)

    def predict(owner, candidates, add_radius, team, state, fallback):
        if state in [3, 4, 6]:
            return None, [], 0
        own = int(owner["CollisionRadius"]) if add_radius else 0
        sight = int(owner["SightRange"]) + own
        clip = 0 if int(owner["Speed"] or 0) == 0 else int(owner["SightClip"] or 1000)
        side = int(owner["SightClipSide"] or 0)
        choices = []
        for candidate in candidates:
            if not candidate.get("eligible", True):
                continue
            victim = targets[candidate["name"]]
            flags, radius = victim["flags"], victim["CollisionRadius"]
            score = max(0, candidate["x"] ** 2 + candidate["y"] ** 2 - candidate.get("fieldAC", 0))
            minimum = int(owner["MinimumRange"] or 0)
            inner = abs(minimum + own - radius) if minimum > 0 and add_radius else minimum
            extra = extras["crown"] if flags["0x60"] or flags["0x64"] else extras["building"] if flags["0x68"] else 0
            reach = sight + radius + extra
            if score < inner ** 2 or score > reach ** 2:
                continue
            if clip > 0:
                limit = max(0, reach - clip)
                if (team == 0 and candidate["y"] < -limit) or (team == 1 and candidate["y"] > limit):
                    continue
            if side > 0 and abs(candidate["x"]) > max(0, reach - side):
                continue
            priority = int(owner["TargetOnlyBuildings"].lower() == "true" and flags["0x68"] != 0)
            choices.append((-priority, score, candidate))
        if choices:
            winner = min(choices, key=lambda choice: choice[:2])[2]["id"]
            return winner, [winner], 0
        candidate = next((candidate for candidate in candidates if candidate["id"] == fallback and candidate.get("eligible", True)), None)
        return None, [candidate["id"]] if candidate else [], 1

    if env["args"].spawn_priority or env["args"].target_eligibility:
        if env["args"].target_eligibility:
            from lib.target_eligibility_probe import capture as capture_continuation
        else:
            from lib.spawn_priority_probe import capture as capture_continuation

        def acquire():
            nonlocal nominated, requests, fallback_calls, fallback_id
            nominated, requests, fallback_calls, fallback_id = None, [], 0, None
            run(0x25deb6, component, instruction_budget=16000)
            return {"nominated": nominated, "setterRequests": list(requests),
                    "fallbackCalls": fallback_calls, "queryCalls": len(queries())}

        capture_continuation(env, {**context, "acquire": acquire})
        return

    cases = []
    for name, owner in sources.items():
        for add_radius in [False, True]:
            own = int(owner["CollisionRadius"]) if add_radius else 0
            near = 5000 if int(owner["MinimumRange"] or 0) else max(1, math.floor((int(owner["Range"]) + own + 500) * 0.6))
            bias = (near + 100) ** 2 - near ** 2 + 1
            for team in [0, 1]:
                front = 1 if team == 0 else -1
                def candidate(id, kind, x, y, eligible=True, field=0):
                    return {"id": id, "name": kind, "x": x, "y": y * front, "eligible": eligible, "fieldAC": field}
                scenarios = [
                    ("center-over-edge", [candidate("a", "Knight", -near, 0), candidate("b", "Giant", near + 100, 0)], None, None, 2),
                    ("stable-score-tie", [candidate("a", "Knight", -near, 0), candidate("b", "Giant", near, 0)], None, None, 2),
                    ("building-priority", [candidate("a", "Knight", -near, 0), candidate("b", "Cannon", near + 200, 0)], None, None, 2),
                    ("outside-attack-bound", [candidate("a", "PrincessTower", 0, int(owner["Range"]) + own + 1001)], None, None, 2),
                    ("current-is-not-excluded", [candidate("a", "Knight", -near, 0), candidate("b", "Giant", near + 100, 0)], "a", None, 2),
                    ("ineligible-nearest", [candidate("a", "Knight", -near, 0, False), candidate("b", "Giant", near + 100, 0)], None, None, 2),
                    ("positive-field-adjustment", [candidate("a", "Knight", -near, 0), candidate("b", "Giant", near + 100, 0, field=bias)], None, None, 2),
                    ("negative-field-adjustment", [candidate("a", "Knight", -near, 0, field=-bias), candidate("b", "Giant", near + 100, 0)], None, None, 2),
                    ("empty-fallback-null", [], None, None, 2),
                    ("controlled-distant-fallback", [candidate("b", "KingTower", 0, 20000)], None, "b", 2),
                ]
                clip = 0 if int(owner["Speed"] or 0) == 0 else int(owner["SightClip"] or 1000)
                rear = max(0, int(owner["SightRange"]) + own + 500 - clip)
                for offset in [-1, 0, 1]:
                    scenarios.append((f"rear-clip-{offset}", [candidate("a", "Knight", 0, -(rear + offset))], None, None, 2))
                for state in [0, 1, 3, 4, 5, 6, 9]:
                    scenarios.append((f"owner-state-{state}", [candidate("a", "Knight", -near, 0)], None, None, state))
                for label, candidates, current, fallback_id, state in scenarios:
                    for reverse in ([False, True] if len(candidates) > 1 else [False]):
                        ordered = candidates[::-1] if reverse else candidates
                        resolved_clip = initialize(owner, ordered, team, add_radius, current)
                        write(body + 0x60, state)
                        for pointer, value in active().items():
                            write(pointer + 0xac, value.get("fieldAC", 0))
                        nominated, requests, fallback_calls = None, [], 0
                        run(0x25deb6, component, instruction_budget=16000)
                        expected = predict(owner, ordered, add_radius, team, state, fallback_id)
                        if (nominated, requests, fallback_calls) != expected:
                            raise RuntimeError(json.dumps({"owner": name, "case": label, "state": state,
                                                           "expected": expected, "actual": [nominated, requests, fallback_calls]}))
                        attack_checks = []
                        for requested in requests:
                            pointer = next(pointer for pointer, value in active().items() if value["id"] == requested)
                            in_range = bool(run(0x25d6f2, component, pointer, 0))
                            if label == "outside-attack-bound" and in_range:
                                raise RuntimeError("Outside-bound control unexpectedly passes native attack predicate")
                            attack_checks.append({"target": requested, "inRange": in_range})
                        cases.append({"owner": name, "case": label, "addOwnRadius": add_radius, "teamIndex": team,
                                      "ownerState": state, "resolvedSightClip": resolved_clip, "candidates": ordered,
                                      "initialCurrent": current, "controlledFallback": fallback_id, "queryCalls": len(queries()),
                                      "nominated": nominated, "setterRequests": requests, "fallbackCalls": fallback_calls,
                                      "postScanAttackChecks": attack_checks})
    static = [
        ("mainLoopCaller", 0x25c881, 0x25c89d, "The native main-loop scan gate calls primary acquisition0x25deb6, distinct from extra-target scanner0x25d95e."),
        ("ownerStateGate", 0x25deb6, 0x25def6, "Owner states3/4/6 return before querying; other captured numeric states proceed."),
        ("ownerStateGetter", 0x217780, 0x217790, "Reads owner+0x60."),
        ("targetOptionalComponent", 0x219dae, 0x219dc6, "Virtual+0x44 returns null with mask0x4 absent; these minimal targets supply that absence."),
        ("targetPredicate", 0x219d5e, 0x219da2, "Virtual+0x4c accepts the controlled absent component. Non-null component handling is outside scope."),
        ("targetFieldGetter", 0x218c44, 0x218c58, "Virtual+0x80 reads target field+0xac; its live meaning/update rules remain unresolved."),
        ("constructorFieldZero", 0x214688, 0x214692, "The base constructor initializes field+0xac to zero."),
        ("primaryDistanceAndMinimum", 0x25e020, 0x25e0a2, "Subtract target virtual+0x80 from squared center distance and clamp0, then apply the candidate minimum."),
        ("primarySightAndClipping", 0x25e0a2, 0x25e21a, "Native priority, target class/radius sight extensions and source rear/side clipping execute."),
        ("primaryRanking", 0x25e21a, 0x25e27d, "Prefer larger priority, then strictly smaller adjusted squared score; exact ties retain collection order."),
        ("nomineeSetterDispatch", 0x25e27d, 0x25e28e, "A nearby nominee dispatches to the lock setter without a final attack-range check."),
        ("fallbackAndSetter", 0x25e28e, 0x25e310, "With movement-component resolution controlled absent, consult a supplied distant fallback then eligibility before dispatching the setter. Setter effects are intercepted."),
    ]
    blocks = []
    for label, start, end, meaning in static:
        assembly = subprocess.check_output(["objdump", "-d", "-Mintel", f"--start-address={start:#x}", f"--stop-address={end:#x}", str(env["args"].library)], text=True)
        instructions = [re.sub(r"\s+<[^>]+>", "", line.strip()) for line in assembly.splitlines() if re.match(r"\s+[0-9a-f]+:", line)]
        blocks.append({"name": label, "start": hex(start), "end": hex(end), "interpretation": meaning, "instructions": instructions})
    paths = ["reference/logic/characters.csv", "reference/logic/buildings.csv", "reference/logic/globals.csv",
             "reference/client/sight-target-types-native-trace.json", "reference/client/candidate-ranking-native-trace.json"]
    output = json.dumps({
        "source": "apk/1.8.1/x86/libg.so", "sha256": env["sha"], "emulator": "unicorn==2.1.4", "instructionBudget": 16000,
        "entryPoint": "0x25deb6", "role": "primary nearby acquisition through intercepted setter dispatch",
        "inputs": [{"path": path, "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest()} for path in paths],
        "limits": [
            "Executes the actual primary scanner, class/radius/priority methods, source clipping defaults and target-field score adjustment. Candidate collection/eligibility, minimal source-selected objects and numeric owner states are supplied.",
            "Target field+0xac is zero by the retained constructor fragment, with explicit positive/negative synthetic controls. Its live meaning, initialization after construction and update rules are unresolved; it is not asserted to be radius squared or a card stat.",
            "The target optional component mask is controlled absent, as is the owner's movement component. Distant fallback is an explicit provider. No full native spatial index, inherited profile, eligibility, movement destination selection or state-machine behavior is recovered.",
            "The lock setter at0x25d4b0 is intercepted to record requests; actual lock mutation, reset/reload clocks and side effects are outside this capture. No setter request does not mean an existing lock was cleared. Native team indices are numeric controls, not browser colors.",
            "Post-scan attack checks independently call the real attack predicate on each requested target after the scanner returns. These measurements are not checks performed by the primary scanner itself.",
        ], "blocks": blocks, "cases": cases,
    }, indent=2) + "\n"
    path = Path("reference/client/primary-acquisition-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native primary acquisition capture differs")
    else:
        path.write_text(output)
    print(json.dumps({"owners": len(sources), "cases": len(cases), "setterRequests": sum(len(c["setterRequests"]) for c in cases), "blocks": len(blocks)}))
