"""Native target eligibility with explicit component/world inputs.

The real attack wrapper, body predicate, source air/ground flags, virtual
component/liveness methods and primary scanner execute. Player lookup is supplied;
actual world getters read controlled structures. Full live transitions are absent.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EIP, UC_X86_REG_EDI


def capture(env, context):
    cpu, heap, body, data, component = [env[k] for k in ["cpu", "heap", "body", "data", "component"]]
    read, write, run, return_hook = [env[k] for k in ["read", "write", "run", "return_hook"]]
    initialize, sources, active, acquire = [context[k] for k in ["initialize", "sources", "active", "acquire"]]
    world_ref, game, health, target_buffs = [heap + offset for offset in [0x7000, 0x7400, 0xd000, 0xd400]]
    allowed = env["allowed"]
    allowed.extend([
        (0x25d7c2, 0x25d852), (0x219e64, 0x21a0af), (0x25fa2a, 0x25fa2b),
        (0x2176d4, 0x217757), (0x217460, 0x2174e6), (0x2172e0, 0x217322),
        (0x1de69a, 0x1de6b4), (0x1de872, 0x1de881), (0x1def68, 0x1def90),
        (0x219d5e, 0x219da2), (0x219dae, 0x219dc6), (0x25ff56, 0x25ff6d),
        (0x220562, 0x220571), (0x218754, 0x218764), (0x218c34, 0x218c44),
        (0x1df0a4, 0x1df0bb), (0x21af26, 0x21af36),
        (0x1c8aba, 0x1c8abb), (0x1c9abe, 0x1c9ace), (0x1d9747, 0x1d9761),
    ])
    for delta, name in [(0x1a5125, "AttacksAir"), (0x1a511a, "AttacksGround"), (0x1a49a4, "FlyingHeight")]:
        if bytes(cpu.mem_read(0x7b8a14 - delta, len(name) + 1)) != name.encode() + b"\0":
            raise RuntimeError("Unexpected native eligibility source column")
    target = 0
    calls = {}

    def hook(_cpu, address, _size, _data):
        # Earlier shared hooks may have already returned a controlled null
        # predicate. Do not interpret its now-restored caller stack as a callee.
        if cpu.reg_read(UC_X86_REG_EIP) != address:
            return
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if address == 0x25d7c2:
            if read(sp + 4) != component or read(sp + 8) not in [target, body] or read(sp + 12) not in [0, 1]:
                raise RuntimeError("Unexpected native eligibility invocation")
            calls["nativeEligibility"] = calls.get("nativeEligibility", 0) + 1
        elif address == 0x25fa2a:
            if read(sp + 4) != component:
                raise RuntimeError("Unexpected eligibility owner resolution")
            return_hook(body)
        elif address == 0x1c8aba:
            owner = read(sp + 8)
            if read(sp + 4) != game or owner not in [0, 1] or read(sp) not in [0x21a07e, 0x21a09a]:
                raise RuntimeError("Unexpected controlled player resolution")
            calls["playerLookup"] = calls.get("playerLookup", 0) + 1
            return_hook(heap + 0x7600 + owner * 0x100)
        elif address == 0x1c9abe:
            if read(sp + 4) != game or read(sp) != 0x219f29:
                raise RuntimeError("Unexpected world-scalar query")
            calls["worldScalar"] = calls.get("worldScalar", 0) + 1
        elif address == 0x1d9747:
            if read(sp + 4) != data:
                raise RuntimeError("Unexpected attack flag default owner")
            cpu.reg_write(UC_X86_REG_EDI, data)
        elif address == 0x1d9760:
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])

    for address in [0x25d7c2, 0x25fa2a, 0x1c8aba, 0x1c9abe, 0x1d9747, 0x1d9760]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=address, end=address)
    truth = lambda row, field: row[field].lower() == "true"

    def prepare(owner_name, target_name, team=0, friendly=False, gate=True, world_value=0, options=None):
        nonlocal target
        options = options or {}
        owner, victim = sources[owner_name], sources[target_name]
        if any(row[field] for row in [owner, victim] for field in ["HidesWhenNotAttacking", "HideBeforeFirstHit"]):
            raise RuntimeError("Recheck unsupported source hidden profile")
        initialize(owner, [{"id": "target", "name": target_name, "x": 5000, "y": 0}], team, True, None)
        target = next(iter(active()))
        model = read(target + 0x10)
        write(body + 0x14, world_ref)
        write(target + 0x14, world_ref)
        write(world_ref + 0x28, game)
        write(game + 0x1c, world_value)
        write(target + 0x1c, team if friendly else 1 - team)
        write(target + 0x60, options.get("state", 2))
        write(model + 0x13c, int(victim["FlyingHeight"] or 0))
        write(data + 0x13c, int(owner["FlyingHeight"] or 0))
        raw_air, raw_ground = options.get("attackFlags", [truth(owner, "AttacksAir"), truth(owner, "AttacksGround")])
        cpu.mem_write(data + 0x299, bytes([raw_air, raw_ground]))
        run(0x1d9747, data)
        write(data + 0x28, int(options.get("pointer28", 0)))
        cpu.mem_write(component + 0x1c, bytes([gate]))
        mask = 4 if options.get("healthPresent", True) else 0
        if options.get("buffCounter18", 0):
            mask |= 8
        write(target + 0x38, mask)
        write(target + 0x44, health)
        write(health + 8, options.get("health", 1000))
        write(target + 0x48, target_buffs)
        write(target_buffs + 0x18, options.get("buffCounter18", 0))
        calls.clear()
        return owner, victim, {"rawAir": bool(raw_air), "rawGround": bool(raw_ground),
                               "air": bool(cpu.mem_read(data + 0x299, 1)[0]), "ground": bool(cpu.mem_read(data + 0x29a, 1)[0])}

    def measure(owner_name, target_name, team=0, friendly=False, gate=True, world_value=0, options=None, allow_friendly=False):
        owner, victim, flags = prepare(owner_name, target_name, team, friendly, gate, world_value, options)
        options = options or {}
        state = options.get("state", 2)
        air = bool(run(0x217716, target))
        present = options.get("healthPresent", True)
        hp = options.get("health", 1000)
        targetable = bool(run(0x219d5e, target))
        alive = bool(run(0x220562 if target_name == "KingTower" else 0x2176d4, target))
        expected_air = int(victim["FlyingHeight"] or 0) > 0 or state == 9
        expected_alive = target_name == "KingTower" or (state not in [7, 9] and options.get("buffCounter18", 0) <= 0)
        if air != expected_air or alive != expected_alive or targetable != (not present or hp > 0):
            raise RuntimeError("Native target method differs from controlled arithmetic")
        building = int(victim["Speed"] or 0) == 0 or target_name == "KingTower"
        expected = (present and (gate or hp > 0) and alive and
                    (not truth(owner, "TargetOnlyBuildings") or building) and
                    (flags["air"] if air else flags["ground"]) and
                    (allow_friendly or not friendly))
        direct = bool(run(0x25d7c2, component, target, int(allow_friendly)))
        if direct != expected:
            raise RuntimeError(json.dumps({"owner": owner_name, "target": target_name, "friendly": friendly, "gate": gate,
                                           "options": options, "flags": flags, "expected": expected, "actual": direct}))
        # Primary supplies false for relation bypass, then adds its own +0x4c
        # and raw buff-counter checks after the common eligibility predicate.
        scanned = acquire()
        primary_expected = expected and not allow_friendly and targetable
        if allow_friendly:
            primary_expected = expected and not friendly and targetable
        primary_expected = primary_expected and options.get("buffCounter18", 0) <= 0
        if scanned["setterRequests"] != (["target"] if primary_expected else []):
            raise RuntimeError(json.dumps({"message": "Native primary eligibility continuation differs", "owner": owner_name,
                                           "target": target_name, "friendly": friendly, "gate": gate, "options": options,
                                           "direct": direct, "targetable": targetable, "expected": primary_expected, "actual": scanned}))
        return {"owner": owner_name, "target": target_name, "ownerIndex": team, "friendly": friendly,
                "componentFlag1c": gate, "controlledWorldScalar1c": world_value, "relationBypass": allow_friendly,
                "inputs": options, "attackFlags": flags, "targetMethods": {"air40": air, "targetable4c": targetable, "alive50": alive},
                "eligible": direct, **scanned, "calls": dict(sorted(calls.items()))}

    cases = []
    controls = []
    for target_name in ["Knight", "Balloon", "KingTower"]:
        for gate in [False, True]:
            for options in [{"health": 0}, {"health": -1}, {"healthPresent": False},
                            {"state": 0}, {"state": 4}, {"state": 7}, {"state": 9},
                            {"buffCounter18": 1}, {"pointer28": 1}]:
                controls.append(measure("Musketeer", target_name, gate=gate, options=options))
            for raw_flags in [[False, False], [False, True], [True, False], [True, True]]:
                controls.append(measure("Musketeer", target_name, gate=gate, options={"attackFlags": raw_flags}))
            controls.append(measure("Musketeer", target_name, friendly=True, gate=gate, allow_friendly=True))
    self_controls = []
    for gate in [False, True]:
        prepare("Knight", "Knight", gate=gate)
        self_controls.append({"componentFlag1c": gate, "eligibleSelf": bool(run(0x25d7c2, component, body, 1))})
        if self_controls[-1]["eligibleSelf"]:
            raise RuntimeError("Native eligibility accepted self")

    for owner_name in sources:
        for target_name in sources:
            for team in [0, 1]:
                for friendly in [False, True]:
                    for gate in [False, True]:
                        for world_value in [0, 4]:
                            cases.append(measure(owner_name, target_name, team, friendly, gate, world_value))

    static = [
        ("airColumnField", 0x1d967b, 0x1d96a6, "AttacksAir loads into Data+0x299."),
        ("groundColumnField", 0x1d96ae, 0x1d96d9, "AttacksGround loads into Data+0x29a."),
        ("groundDefault", 0x1d9747, 0x1d9760, "Actual defaults enable ground only if both flags are false."),
        ("flyingHeightColumn", 0x1dc02f, 0x1dc05a, "FlyingHeight caches at GOT+0x17f8."),
        ("flyingHeightField", 0x1d9237, 0x1d924f, "FlyingHeight integer loads into Data+0x13c."),
        ("flyingHeightPredicate", 0x1de69a, 0x1de6b4, "Returns source FlyingHeight>0."),
        ("targetAirVirtual", 0x217716, 0x217757, "Target+0x40 returns true for positive FlyingHeight or numeric state9."),
        ("wrapper", 0x25d7c2, 0x25d852, "Actual attack wrapper supplies TargetOnlyBuildings; flag1c=false additionally gates through target+0x4c."),
        ("bodyEligibility", 0x219e64, 0x21a0af, "Actual body eligibility checks self, class, source air/ground, component/liveness and controlled player identity."),
        ("targetComponent", 0x219dae, 0x219dc6, "Mask0x4 exposes target+0x44 component."),
        ("targetableVirtual", 0x219d5e, 0x219da2, "Missing component is targetable here; otherwise query its positive scalar at+8."),
        ("componentPositiveScalar", 0x25ff56, 0x25ff6d, "Returns component+8>0. Values are controlled; no damage/death propagation executes."),
        ("ordinaryAliveVirtual", 0x2176d4, 0x217716, "State9 and the native hidden predicate block this method; otherwise consult the optional buff counter."),
        ("hiddenPredicate", 0x217460, 0x2174e6, "State7 or source hidden-mode progress can block ordinary targets. Selected source hidden flags remain false."),
        ("buffCounterPredicate", 0x2172e0, 0x217322, "Absent buff component or raw counter+0x18<=0 passes; the counter's full lifecycle is not inferred."),
        ("kingAliveOverride", 0x220562, 0x220571, "King vtable+0x50 returns true, unlike the ordinary numeric-state/buff method."),
        ("worldReference", 0x21af26, 0x21af36, "Actual world-reference getter reads+0x28 before controlled world/player callbacks."),
        ("worldScalar", 0x1c9abe, 0x1c9ace, "Actual getter reads world+0x1c; its meaning is not established by this capture."),
        ("primaryAdditionalPredicates", 0x25dfd3, 0x25e020, "After common eligibility, primary scanning additionally requires target+0x4c and absent/nonpositive raw buff counter+0x18."),
    ]
    blocks = []
    for name, start, end, meaning in static:
        assembly = subprocess.check_output(["objdump", "-d", "-Mintel", f"--start-address={start:#x}", f"--stop-address={end:#x}", str(env["args"].library)], text=True)
        instructions = [re.sub(r"\s+<[^>]+>", "", line.strip()) for line in assembly.splitlines() if re.match(r"\s+[0-9a-f]+:", line)]
        blocks.append({"name": name, "start": hex(start), "end": hex(end), "interpretation": meaning, "instructions": instructions})
    paths = ["reference/logic/characters.csv", "reference/logic/buildings.csv", "reference/logic/globals.csv",
             "reference/client/sight-target-types-native-trace.json", "reference/client/primary-acquisition-native-trace.json",
             "reference/client/first-attacks-native-trace.json"]
    output = json.dumps({"source": "apk/1.8.1/x86/libg.so", "sha256": env["sha"], "emulator": "unicorn==2.1.4",
                         "inputs": [{"path": path, "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest()} for path in paths],
                         "limits": [
                             "Minimal source-selected Data/vtable profiles, not complete loading/inheritance or body/health/buff constructors. Target component scalar+8 is supplied as1000 normally; zero/negative/missing cases are synthetic.",
                             "Actual wrapper, body eligibility, target virtual methods, source flag defaults, health-scalar predicate and primary scanner execute. Range, target damage/death propagation and full owner state machines do not.",
                             "Controlled player lookup maps raw owners0/1 to distinct identities; world field+0x1c supplies values0/4 through its actual getter. Its meaning, complete player/world permissions, King death behavior and other owner kinds are outside scope.",
                             "Owner state is2, target state2 normally; other numeric states and raw buff counter+0x18 controls do not establish state names or live transitions. Source hidden-mode flags remain false for the thirteen selected profiles.",
                             "Data+0x28 and target+0x58/+0x5c are zero normally. A nonzero Data+0x28 control retains target+0x58=0; the deeper metadata/component threshold path is not emulated.",
                             "Null target eligibility and distant fallback remain supplied null boundaries. Primary setter requests are intercepted before lock/clock side effects.",
                             "Inconsistent health/state controls distinguish direct eligibility from the scanner's additional target predicate and buff-counter guard. Acceptance does not mean a naturally dead target remains in native candidate collections.",
                         ], "blocks": blocks, "cases": cases, "controls": controls, "selfControls": self_controls}, indent=2) + "\n"
    path = Path("reference/client/target-eligibility-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native target-eligibility capture differs")
    else:
        path.write_text(output)
    print(json.dumps({"cases": len(cases), "controls": len(controls), "selfControls": len(self_controls), "blocks": len(blocks)}))
