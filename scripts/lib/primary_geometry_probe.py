"""Native primary sight/clipping boundaries with source-backed eligibility.

Healthy eligibility results come from the separate actual-predicate capture;
the current run supplies that boundary and executes the real geometry/scanner.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess


def capture(env, context):
    read, write = env["read"], env["write"]
    initialize, sources, targets, active, acquire, predict, extras = [context[k] for k in ["initialize", "sources", "targets", "active", "acquire", "predict", "extras"]]
    eligibility_path = "reference/client/target-eligibility-native-trace.json"
    eligibility = json.loads(Path(eligibility_path).read_bytes())
    if eligibility["sha256"] != env["sha"]:
        raise RuntimeError("Eligibility capture uses another native binary")
    for entry in eligibility["inputs"]:
        if hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest() != entry["sha256"]:
            raise RuntimeError("Eligibility source input changed")
    healthy = {(case["owner"], case["target"], case["ownerIndex"]): case["eligible"] for case in eligibility["cases"]
               if not case["friendly"] and case["componentFlag1c"] and case["controlledWorldScalar1c"] == 0}
    if len(healthy) != len(sources) ** 2 * 2:
        raise RuntimeError("Recheck healthy eligibility matrix coverage")
    cases, controls = [], []

    def sample(owner_name, victim_name, add_radius, team, label, x, y, field=0):
        owner, victim = sources[owner_name], targets[victim_name]
        candidate = {"id": "target", "name": victim_name, "x": x, "y": y,
                     "eligible": healthy[(owner_name, victim_name, team)], "fieldAC": field}
        clip = initialize(owner, [candidate], team, add_radius, None)
        pointer = next(iter(active()))
        write(pointer + 0xac, field)
        if read(pointer + 0xac) != field:
            raise RuntimeError("Unexpected supplied score adjustment")
        result = acquire()
        expected_nominee, expected_requests, expected_fallback = predict(owner, [candidate], add_radius, team, 2, None)
        if (result["nominated"], result["setterRequests"], result["fallbackCalls"], result["queryCalls"]) != (expected_nominee, expected_requests, expected_fallback, 1):
            raise RuntimeError(json.dumps({"owner": owner_name, "target": victim_name, "case": label,
                                           "x": x, "y": y, "field": field, "expected": expected_requests, "actual": result}))
        return {"owner": owner_name, "target": victim_name, "case": label, "addOwnRadius": add_radius,
                "teamIndex": team, "eligible": candidate["eligible"], "targetRadius": victim["CollisionRadius"],
                "targetFlags": victim["flags"], "resolvedSightClip": clip,
                "sourceSightClipSide": int(owner["SightClipSide"] or 0),
                "point": {"x": x, "y": y}, "fieldAC": field, **result}

    for owner_name, owner in sources.items():
        for victim_name, victim in targets.items():
            for add_radius in [False, True]:
                own = int(owner["CollisionRadius"]) if add_radius else 0
                flags = victim["flags"]
                extra = extras["crown"] if flags["0x60"] or flags["0x64"] else extras["building"] if flags["0x68"] else 0
                reach = int(owner["SightRange"]) + own + victim["CollisionRadius"] + extra
                clip = 0 if int(owner["Speed"] or 0) == 0 else int(owner["SightClip"] or 1000)
                side = int(owner["SightClipSide"] or 0)
                rear_limit = max(0, reach - clip) if clip > 0 else reach
                side_limit = max(0, reach - side) if side > 0 else reach
                for team in [0, 1]:
                    front = 1 if team == 0 else -1
                    boundaries = [("forward", reach, 0, front), ("rear", rear_limit, 0, -front),
                                  ("right", side_limit, 1, 0), ("left", side_limit, -1, 0)]
                    for label, bound, dx, dy in boundaries:
                        for offset in [-1, 0, 1]:
                            distance = bound + offset
                            cases.append(sample(owner_name, victim_name, add_radius, team,
                                                f"{label}-{offset}", distance * dx, distance * dy))
                    # Sight uses adjusted squared score, while nonzero rear/side
                    # clips still constrain unadjusted coordinates.
                    outside = reach + 1
                    required = outside ** 2 - reach ** 2
                    for delta in [-1, 0, 1]:
                        controls.append(sample(owner_name, victim_name, add_radius, team,
                                               f"adjusted-circle-{delta}", 0, front * outside, required + delta))
                    for label, bound, dx, dy in [boundaries[1], boundaries[2]]:
                        distance = bound + 1
                        controls.append(sample(owner_name, victim_name, add_radius, team,
                                               f"zero-score-outside-{label}", distance * dx, distance * dy, distance ** 2))
                    minimum = int(owner["MinimumRange"] or 0)
                    if minimum > 0:
                        inner = abs(minimum + own - victim["CollisionRadius"]) if add_radius else minimum
                        for offset in [-1, 0, 1]:
                            for field in [0, 1600]:
                                controls.append(sample(owner_name, victim_name, add_radius, team,
                                                       f"minimum-{offset}-bias-{field}", 0, front * (inner + offset), field))

    static = [
        ("primaryCandidateEligibility", 0x25dfd3, 0x25e020, "Eligibility is supplied from the pinned healthy matrix; additional native target predicate/buff guards execute on minimal bodies."),
        ("adjustedScoreMinimum", 0x25e020, 0x25e0a2, "Subtract target+0xac from squared center distance with zero clamp, then compare the candidate minimum."),
        ("classSightExtension", 0x25e0a2, 0x25e111, "Native target class/radius methods select Crown extra before stationary-building extra."),
        ("primaryClipping", 0x25e111, 0x25e21a, "Actual source rear/side limits compare unadjusted coordinates after the adjusted circular sight gate."),
        ("sourceClipDefaults", 0x1dd78c, 0x1dd7b3, "Actual default uses1000 for absent moving rear clip and zero for stationary source speed."),
        ("primarySetterDispatch", 0x25e27d, 0x25e28e, "An eligible geometry nominee requests the setter without an immediate attack-range veto."),
    ]
    blocks = []
    for name, start, end, meaning in static:
        assembly = subprocess.check_output(["objdump", "-d", "-Mintel", f"--start-address={start:#x}", f"--stop-address={end:#x}", str(env["args"].library)], text=True)
        instructions = [re.sub(r"\s+<[^>]+>", "", line.strip()) for line in assembly.splitlines() if re.match(r"\s+[0-9a-f]+:", line)]
        blocks.append({"name": name, "start": hex(start), "end": hex(end), "interpretation": meaning, "instructions": instructions})
    paths = ["reference/logic/characters.csv", "reference/logic/buildings.csv", "reference/logic/globals.csv",
             "reference/client/sight-target-types-native-trace.json", "reference/client/primary-acquisition-native-trace.json", eligibility_path]
    output = json.dumps({"source": "apk/1.8.1/x86/libg.so", "sha256": env["sha"], "emulator": "unicorn==2.1.4",
                         "inputs": [{"path": path, "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest()} for path in paths],
                         "limits": [
                             "Actual source clipping defaults, target class/radius methods, adjusted score/minimum, primary sight/clipping/ranking and setter dispatch execute on source-selected minimal bodies.",
                             "Eligibility is supplied from the pinned actual-predicate healthy-profile matrix for each owner/target/raw-owner combination, with positive supplied components and no source hidden flags. Component construction, live health/death/control and full eligibility state machines do not execute here.",
                             "Owner and target numeric states are2; collection contains one candidate. Null fallback and setter effects remain controlled boundaries. This does not recover distant selection, movement or scan-gate timing.",
                             "Both own-radius flags and numeric team directions are controlled. Raw input coordinates and score adjustments are integer source units. Adjusted-circle controls use synthetic score fields; minimum controls separately retain the observed Barrel-sized1600 adjustment.",
                             "Radius/class values are the thirteen archived profiles from the type capture. Source row inheritance, oversized synthetic bodies and other object kinds remain outside this matrix.",
                         ], "blocks": blocks, "cases": cases, "controls": controls}, indent=2) + "\n"
    path = Path("reference/client/primary-geometry-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native primary geometry capture differs")
    else:
        path.write_text(output)
    print(json.dumps({"cases": len(cases), "controls": len(controls),
                      "accepted": sum(bool(case["setterRequests"]) for case in cases), "blocks": len(blocks)}))
