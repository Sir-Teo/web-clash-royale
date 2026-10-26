"""Bounded generic attack-range geometry using archived native getters."""
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP


def capture(env):
    cpu, heap, body, data, component = [env[k] for k in ["cpu", "heap", "body", "data", "component"]]
    read, write, run, return_hook = [env[k] for k in ["read", "write", "run", "return_hook"]]
    config, target, vtable = heap + 0xa000, heap + 0x8000, heap + 0xd000
    radius_callback = env["stop"] + 0x100
    globals_path = "reference/logic/globals.csv"
    globals_bytes = Path(globals_path).read_bytes()
    globals_rows = {r["Name"]: r for r in csv.DictReader(io.StringIO(globals_bytes.decode()))}
    flag = globals_rows["ADD_CHARACTER_RANGE_TO_RADIUS"]["BooleanValue"]
    if flag not in ["TRUE", "FALSE"]:
        raise RuntimeError("Unexpected archived own-radius flag")
    env["allowed"].extend([
        (0x25d6f2, 0x25d75c), (0x25ddae, 0x25deb6), (0x219b26, 0x219b36),
        (0x1ddbf4, 0x1ddc07), (0x1de2d8, 0x1de2eb), (0x1de3f0, 0x1de403),
        (0x21a2d0, 0x21a376), (0x35d620, 0x35d66f), (0x35d330, 0x35d423),
        (0x25fa2a, 0x25fa2b), (0x25fa9c, 0x25fa9d),
        (0x1e6cee, 0x1e6cef), (radius_callback, radius_callback + 1),
    ])
    target_radius = 0

    def hook(_cpu, address, _size, _data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if address in [0x25fa2a, 0x25fa9c]:
            if read(sp + 4) != component:
                raise RuntimeError("Unexpected range component owner")
            return_hook(body if address == 0x25fa2a else data)
        elif address == 0x1e6cee:
            return_hook(config)
        elif address == radius_callback:
            if read(sp + 4) != target or read(sp) not in [0x21a2f3, 0x21a336]:
                raise RuntimeError("Unexpected target-radius query")
            return_hook(target_radius)

    cpu.hook_add(UC_HOOK_CODE, hook)
    profiles = []
    minimum_mode = env["args"].minimum_range
    names = {
        "characters": ["Knight", "Archer", "Musketeer", "Giant", "HogRider", "Balloon", "Prince", "InfernoDragon"],
        "buildings": ["Cannon", "Mortar", "InfernoTower", "KingTower", "PrincessTower"],
    }
    for table, source_names in names.items():
        for name in source_names:
            source = env["rows"][f"reference/logic/{table}.csv"][name]
            cpu.mem_write(heap, b"\0" * 0x10000)
            write(body + 0x10, data)
            write(component + 4, body)
            write(target, vtable)
            write(vtable + 0x38, radius_callback)
            values = {key: int(source[key] or 0) for key in ["Range", "MinimumRange", "CollisionRadius"]}
            if values["Range"] <= 0 or values["CollisionRadius"] <= 0:
                raise RuntimeError(f"Recheck attack profile: {name}")
            for offset, field in [(0x1a0, "Range"), (0x1a4, "MinimumRange"), (0x22c, "CollisionRadius")]:
                write(data + offset, values[field])
            samples = []
            for add_radius in [False, True]:
                cpu.mem_write(config + 0x295, bytes([int(add_radius)]))
                own = values["CollisionRadius"] if add_radius else 0
                for target_radius in ([0, 250, 1000, 6000] if minimum_mode else [0, 250, 1000]):
                    reach = values["Range"] + own + target_radius
                    minimum = max(0, values["MinimumRange"] + (own if values["MinimumRange"] > 0 else 0) - target_radius)
                    for axis, dx, dy in [("right", 1, 0), ("left", -1, 0), ("down", 0, 1), ("up", 0, -1)]:
                        for offset in [-1, 0, 1]:
                            boundary = minimum if minimum_mode else reach
                            x, y = (boundary + offset) * dx, (boundary + offset) * dy
                            write(target + 0x20, x)
                            write(target + 0x24, y)
                            actual = bool(run(0x25d6f2, component, target, 0))
                            if actual != (minimum * minimum <= x * x + y * y <= reach * reach):
                                raise RuntimeError("Native range geometry differs from recovered bounds")
                            samples.append({"addOwnRadius": add_radius, "targetRadius": target_radius,
                                            "axis": axis, "offset": offset, "x": x, "y": y, "inRange": actual})
            profiles.append({"table": table, "name": name, **values, "samples": samples})
    static = [
        ("globalLoader", 0x1f19fe, 0x1f1a31, "ADD_CHARACTER_RANGE_TO_RADIUS at native string 0x617a38 loads Globals+0x295; archived TRUE."),
        ("rangeGetter", 0x1ddbf4, 0x1ddc07, "Maximum range reads CharacterData+0x1a0."),
        ("minimumGetter", 0x1de2d8, 0x1de2eb, "Minimum range reads CharacterData+0x1a4."),
        ("radiusColumn", 0x1dcccc, 0x1dccfa, "CollisionRadius at native string 0x61421b caches GOT+0x1894."),
        ("radiusLoader", 0x1d9207, 0x1d921f, "The cached CollisionRadius column loads CharacterData+0x22c."),
        ("radiusGetter", 0x1de3f0, 0x1de403, "Own collision radius reads CharacterData+0x22c."),
        ("rangeModifiers", 0x25ddae, 0x25deb6, "The global adds own collision radius to range. Other Globals modifiers are controlled at zero."),
        ("predicate", 0x25d6f2, 0x25d75c, "Supplied range extension is zero; source position and ranges feed native target geometry."),
        ("geometry", 0x21a2d0, 0x21a376, "Maximum bound includes target radius and accepts equality; radius queries are controlled callbacks."),
        ("distanceWrapper", 0x35d620, 0x35d66f, "Native integer point-to-point squared distance."),
        ("squaredDistance", 0x35d330, 0x35d423, "Saturating integer distance; supplied source coordinates do not saturate."),
    ]
    if minimum_mode:
        static.extend([
            ("minimumColumn", 0x1db694, 0x1db6c2, "MinimumRange column caches GOT+0x1794."),
            ("minimumField", 0x1d990f, 0x1d9927, "The cached MinimumRange column loads CharacterData+0x1a4."),
            ("minimumModifier", 0x25de60, 0x25deb6, "Own radius is added only when source minimum is positive and ADD_CHARACTER_RANGE_TO_RADIUS is true."),
            ("minimumGeometry", 0x21a32b, 0x21a36b, "Subtract target radius from the resolved minimum. A positive inner bound accepts equality; a nonpositive bound imposes no minimum."),
        ])
    blocks = []
    for name, start, end, meaning in static:
        assembly = subprocess.check_output(["objdump", "-d", "-Mintel", f"--start-address={start:#x}", f"--stop-address={end:#x}", str(env["args"].library)], text=True)
        instructions = [re.sub(r"\s+<[^>]+>", "", line.strip()) for line in assembly.splitlines() if re.match(r"\s+[0-9a-f]+:", line)]
        blocks.append({"name": name, "start": hex(start), "end": hex(end), "interpretation": meaning, "instructions": instructions})
    boundary_limit = ("Minimum-boundary samples use direct source fields, including zero minimum controls and a supplied target radius larger than Mortar's inner bound. Negative coordinate offsets around a zero boundary still have positive absolute distance."
                      if minimum_mode else "Maximum-boundary samples use archived direct Range/MinimumRange/CollisionRadius rows for representative melee, ranged, flying, building and Crown Tower profiles. Native integer coordinates do not establish browser floating-point quantization equivalence.")
    output = json.dumps({"source": "apk/1.8.1/x86/libg.so", "sha256": env["sha"], "emulator": "unicorn==2.1.4",
                         "addCharacterRangeToRadius": flag == "TRUE",
                         "inputs": [*env["inputs"][:2], {"path": globals_path, "sha256": hashlib.sha256(globals_bytes).hexdigest()}],
                         "limits": ["Executes generic native range getters and integer geometry, not attack acquisition, card state machines or damage.",
                                    "Owner and Globals resolution are intercepted; dummy target radius is explicitly supplied through its virtual callback. Other Globals modifiers remain zero; full inherited/global profiles are not recovered.",
                                    boundary_limit],
                         "blocks": blocks, "profiles": profiles}, indent=2) + "\n"
    path = Path("reference/client/attack-minimum-native-trace.json" if minimum_mode else "reference/client/attack-range-native-trace.json")
    if env["args"].check:
        if path.read_text() != output:
            raise RuntimeError("Native attack-range capture differs")
    else:
        path.write_text(output)
    print(json.dumps({"profiles": len(profiles), "samples": sum(len(p["samples"]) for p in profiles), "blocks": len(blocks)}))
