"""Bounded sight scanner with native target vtables and class/radius methods.

Source-selected object/Data fields are supplied, not fully constructed objects.
The captured constructors/factory/column loaders identify those fields. Native
class and radius methods execute; eligibility, priority and broadphase remain
controlled. Successful scans halt before subsequent ranking/attack validation.
"""
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EIP


def capture(env):
    cpu, heap, body, data, component = [env[k] for k in ["cpu", "heap", "body", "data", "component"]]
    read, write, run, return_hook = [env[k] for k in ["read", "write", "run", "return_hook"]]
    config, target, target_data = heap + 0xa000, heap + 0x8000, heap + 0xb000
    handle, grid, collection, pointers = [heap + 0xe000 + i * 0x100 for i in range(4)]
    globals_path = "reference/logic/globals.csv"
    globals_bytes = Path(globals_path).read_bytes()
    globals_rows = {r["Name"]: r for r in csv.DictReader(io.StringIO(globals_bytes.decode()))}
    extra_building = int(globals_rows["EXTRA_SIGHT_RANGE_TO_BUILDING"]["NumberValue"])
    extra_crown = int(globals_rows["EXTRA_SIGHT_RANGE_TO_CROWN_TOWERS"]["NumberValue"])
    flag = globals_rows["ADD_CHARACTER_RANGE_TO_RADIUS"]["BooleanValue"]
    if flag not in ["TRUE", "FALSE"]:
        raise RuntimeError("Unexpected archived own-radius flag")
    vtables = {"character": 0x7b34a0, "king": 0x7b36d8}
    expected_methods = {0x38: 0x217804, 0x60: 0x21a404, 0x64: 0x2172ae, 0x68: 0x2184bc}
    for kind, vtable in vtables.items():
        for slot, address in expected_methods.items():
            expected = 0x2243e4 if kind == "king" and slot == 0x60 else address
            if read(vtable + slot) != expected:
                raise RuntimeError("Pinned target vtable differs")
    hooks = [0x25fa2a, 0x25faf2, 0x1e6cee, 0x21f5f6, 0x25d7c2, 0x219e0a]
    env["allowed"].extend([
        (0x25d95e, 0x25ddad), (0x1ddbe0, 0x1ddbf3), (0x1de2d8, 0x1de2eb),
        (0x1de3f0, 0x1de403), (0x219b26, 0x219b36), (0x21a0bc, 0x21a0f0),
        (0x35d620, 0x35d66f), (0x35d330, 0x35d423), (0x35bd10, 0x35bd52),
        (0x217804, 0x217842), (0x21a404, 0x21a410), (0x2243e4, 0x2243f3),
        (0x2172ae, 0x2172e0), (0x2184bc, 0x2184ee),
        (0x1de24a, 0x1de25e), (0x1dd6d0, 0x1dd6ea),
        *((address, address + 1) for address in hooks),
    ])
    expected_query, query_radius, passed = 0, None, False

    def hook(_cpu, address, _size, _data):
        nonlocal query_radius, passed
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if address in [0x25fa2a, 0x25faf2]:
            if read(sp + 4) != component:
                raise RuntimeError("Unexpected sight component owner")
            return_hook(body if address == 0x25fa2a else handle)
        elif address == 0x1e6cee:
            return_hook(config)
        elif address == 0x21f5f6:
            if [read(sp + i) for i in [0, 4, 8, 12, 16, 20]] != [0x25da19, grid, body + 0x20, expected_query, 0, 0]:
                raise RuntimeError("Unexpected candidate broadphase query")
            query_radius = read(sp + 12)
            return_hook(collection)
        elif address == 0x25d7c2:
            if [read(sp + i) for i in [4, 8, 12]] != [component, target, 0]:
                raise RuntimeError("Unexpected eligibility query")
            return_hook(1)
        elif address == 0x219e0a:
            if [read(sp + 4), read(sp + 8)] != [body, target]:
                raise RuntimeError("Unexpected priority query")
            return_hook(0)
        elif address in [*expected_methods.values(), 0x2243e4]:
            if read(sp + 4) != target:
                raise RuntimeError("Unexpected native target method owner")
        elif address == 0x25db97:
            if read(sp + 0x58) != target:
                raise RuntimeError("Unexpected passing candidate")
            passed = True
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])

    cpu.hook_add(UC_HOOK_CODE, hook)
    names = {
        "characters": ["Knight", "Archer", "Musketeer", "Giant", "HogRider", "Balloon", "Prince", "InfernoDragon"],
        "buildings": ["Cannon", "Mortar", "InfernoTower", "KingTower", "PrincessTower"],
    }
    sources = [(table, name, env["rows"][f"reference/logic/{table}.csv"][name]) for table, entries in names.items() for name in entries]
    targets, profiles = [], []

    def initialize(owner, victim):
        cpu.mem_write(heap, b"\0" * 0x10000)
        write(body + 0x10, data)
        write(component + 4, body)
        write(handle + 0x30, grid)
        write(collection, pointers)
        write(collection + 8, 1)
        write(pointers, target)
        write(target, vtables["king" if victim["Name"] == "KingTower" else "character"])
        write(target + 0x10, target_data)
        write(target + 0x60, 2)
        for offset, field in [(0x1a8, "SightRange"), (0x1a4, "MinimumRange"), (0x22c, "CollisionRadius")]:
            write(data + offset, int(owner[field] or 0))
        write(target_data + 0x190, int(victim["Speed"] or 0))
        write(target_data + 0x22c, int(victim["CollisionRadius"] or 0))
        cpu.mem_write(target_data + 0x28a, bytes([int(victim["IsSummonerTower"].lower() == "true")]))
        write(config + 0x38, extra_building)
        write(config + 0x3c, extra_crown)

    for table, name, source in sources:
        initialize(source, source)
        vtable = read(target)
        flags = {hex(slot): run(read(vtable + slot), target) for slot in [0x60, 0x64, 0x68]}
        expected = {"0x60": int(name == "KingTower"), "0x64": int(source["IsSummonerTower"].lower() == "true"), "0x68": int(not int(source["Speed"] or 0))}
        if flags != expected:
            raise RuntimeError("Native target flags differ from source fields")
        radii = []
        for state in [0, 2, 4, 6]:
            write(target + 0x60, state)
            radius = run(read(vtable + 0x38), target)
            if radius != (0 if state in [4, 6] else int(source["CollisionRadius"])):
                raise RuntimeError("Unexpected native state/radius control")
            radii.append({"state": state, "radius": radius})
        targets.append({"table": table, "name": name, "vtable": hex(vtable),
                        "Speed": int(source["Speed"] or 0), "IsSummonerTower": expected["0x64"] != 0,
                        "CollisionRadius": int(source["CollisionRadius"]), "flags": flags, "radiusControls": radii})

    for table, name, owner in sources:
        samples, getters = [], []
        for victim in targets:
            source = env["rows"][f'reference/logic/{victim["table"]}.csv'][victim["name"]]
            initialize(owner, source)
            for add_radius in [False, True]:
                cpu.mem_write(config + 0x295, bytes([int(add_radius)]))
                sight = run(0x25dd54, component)
                expected_sight = int(owner["SightRange"]) + (int(owner["CollisionRadius"]) if add_radius else 0)
                if sight != expected_sight:
                    raise RuntimeError("Native owner sight getter differs")
                if victim is targets[0]:
                    getters.append({"addOwnRadius": add_radius, "sightRange": sight})
                expected_query = sight + max(extra_building, extra_crown)
                extra = extra_crown if victim["flags"]["0x60"] or victim["flags"]["0x64"] else extra_building if victim["flags"]["0x68"] else 0
                reach = sight + victim["CollisionRadius"] + extra
                for axis, direction in [("right", 1), ("left", -1)]:
                    for offset in [-1, 0, 1]:
                        x = (reach + offset) * direction
                        write(target + 0x20, x)
                        passed, query_radius = False, None
                        run(0x25d95e, component, 0)
                        if passed != (offset <= 0) or query_radius != expected_query:
                            raise RuntimeError("Native source-target sight boundary differs")
                        samples.append({"target": victim["name"], "addOwnRadius": add_radius,
                                        "axis": axis, "offset": offset, "x": x,
                                        "broadphaseRadius": query_radius, "passesSightGate": passed})
        profiles.append({"table": table, "name": name, "SightRange": int(owner["SightRange"]),
                         "MinimumRange": int(owner["MinimumRange"] or 0), "CollisionRadius": int(owner["CollisionRadius"]),
                         "getters": getters, "samples": samples})

    static = [
        ("kingRow", 0x1e7d81, 0x1e7dba, "KingTower string 0x616057 resolves the table row into GOT+0x8b3ec."),
        ("kingRowGetter", 0x1e9964, 0x1e9980, "Reads the retained KingTower row."),
        ("rowIdentity", 0x1e4f42, 0x1e4f66, "Non-null row identity compares Data+0x10 IDs."),
        ("characterFactory", 0x21a528, 0x21a5d0, "Within the character-data branch, KingTower identity chooses the derived constructor; other characters choose the base constructor."),
        ("baseVtable", 0x21459c, 0x2145cd, "The base character constructor installs vtable 0x7b34a0."),
        ("kingVtable", 0x21fa62, 0x21fa94, "The derived King constructor invokes the base then installs 0x7b36d8."),
        ("baseKingFlag", 0x21a404, 0x21a410, "Base virtual+0x60 returns false."),
        ("kingFlag", 0x2243e4, 0x2243f3, "King virtual+0x60 returns true."),
        ("summonerFlag", 0x2172ae, 0x2172e0, "Virtual+0x64 reads source IsSummonerTower through the native getter."),
        ("summonerColumn", 0x1dd2ac, 0x1dd2d7, "IsSummonerTower string 0x614333 caches GOT+0x18d4."),
        ("summonerField", 0x1da6ef, 0x1da707, "The source boolean loads Data+0x28a."),
        ("summonerGetter", 0x1de24a, 0x1de25e, "Reads byte Data+0x28a."),
        ("stationaryFlag", 0x2184bc, 0x2184ee, "Virtual+0x68 checks native Data speed equals zero."),
        ("speedColumn", 0x1db34c, 0x1db37a, "Speed string 0x613ecc caches GOT+0x176c."),
        ("speedField", 0x1dae95, 0x1daeea, "Stores source Speed into Data+0x190; optional path-speed modifiers are controlled at zero."),
        ("stationaryGetter", 0x1dd6d0, 0x1dd6ea, "Checks Data+0x190 == 0."),
        ("targetData", 0x21960e, 0x21961e, "Reads target+0x10 Data pointer."),
        ("targetRadius", 0x217804, 0x217842, "Virtual radius is zero in owner states 4/6, otherwise source CollisionRadius."),
        ("radiusGetter", 0x1de3f0, 0x1de403, "Reads Data+0x22c CollisionRadius."),
        ("ownRadiusGlobal", 0x1f19fe, 0x1f1a31, "Archived ADD_CHARACTER_RANGE_TO_RADIUS loads Globals+0x295."),
        ("extraGlobals", 0x1f168f, 0x1f16f7, "Source building/crown sight extensions load Globals+0x38/+0x3c."),
        ("resolvedSight", 0x25dd54, 0x25ddad, "Owner sight adds own radius under the archived flag."),
        ("candidateGates", 0x25dad2, 0x25db97, "Native minimum, target radius and class extensions precede inclusive squared sight comparison; stop before ranking."),
    ]
    blocks = []
    for name, start, end, interpretation in static:
        assembly = subprocess.check_output(["objdump", "-d", "-Mintel", f"--start-address={start:#x}", f"--stop-address={end:#x}", str(env["args"].library)], text=True)
        instructions = [re.sub(r"\s+<[^>]+>", "", line.strip()) for line in assembly.splitlines() if re.match(r"\s+[0-9a-f]+:", line)]
        blocks.append({"name": name, "start": hex(start), "end": hex(end), "interpretation": interpretation, "instructions": instructions})
    output = json.dumps({
        "source": "apk/1.8.1/x86/libg.so", "sha256": env["sha"], "emulator": "unicorn==2.1.4",
        "addCharacterRangeToRadius": flag == "TRUE", "extraSightToBuilding": extra_building, "extraSightToCrownTowers": extra_crown,
        "vtables": [{"kind": kind, "address": hex(address),
                     "slots": {hex(slot): hex(read(address + slot)) for slot in expected_methods}}
                    for kind, address in vtables.items()],
        "inputs": [*env["inputs"][:2], {"path": globals_path, "sha256": hashlib.sha256(globals_bytes).hexdigest()}],
        "limits": [
            "Native target vtables and class/radius methods execute. Source-selected base/King vtables, body state2 and minimal Data fields are supplied; complete object construction and table loading are not emulated. The retained static factory/constructor/column blocks bind their interpretation.",
            "Source Speed, IsSummonerTower and CollisionRadius supply only the required fields. Other Data modifiers remain zero. State0/2/4/6 radius controls do not establish complete state-machine semantics or eligibility in those states.",
            "Owner/Globals/grid resolution, one-candidate broadphase, eligibility and priority remain controlled. Successful scans halt at0x25db97 before later ranking/attack validation; passing is not acquiring a target.",
            "Both own-radius settings, thirteen owners/targets, two axis directions and adjacent integer boundaries are captured. No browser/native movement or quantization equivalence is claimed.",
        ],
        "blocks": blocks, "targets": targets, "profiles": profiles,
    }, indent=2) + "\n"
    path = Path("reference/client/sight-target-types-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native target-type sight capture differs")
    else:
        path.write_text(output)
    print(json.dumps({"targets": len(targets), "profiles": len(profiles),
                      "samples": sum(len(p["samples"]) for p in profiles), "blocks": len(blocks)}))
