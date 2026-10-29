"""Execute the native dash-admission helper on supplied source/body states.

This pure query is distinct from target acquisition and the complete attack
loop. It proves geometry, existing-clock precedence and supplied buff gates.
"""

from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ESP


def capture(env, context):
    def require(condition, message):
        if not condition:
            raise RuntimeError(message)

    cpu, heap, body, data, attack, buffs, array = [
        env[k] for k in ["cpu", "heap", "body", "data", "component", "buffs", "array"]
    ]
    read, write, run = [env[k] for k in ["read", "write", "run"]]
    target, target_data = heap + 0x8000, heap + 0x9000
    source = env["rows"]["reference/logic/characters.csv"]["Assassin"]
    victim = env["rows"]["reference/logic/characters.csv"]["Knight"]
    require(
        {
            k: source[k]
            for k in [
                "Speed",
                "DashCooldown",
                "DashMinRange",
                "DashMaxRange",
                "CollisionRadius",
            ]
        }
        == {
            "Speed": "90",
            "DashCooldown": "1000",
            "DashMinRange": "4000",
            "DashMaxRange": "6000",
            "CollisionRadius": "600",
        }
        and victim["CollisionRadius"] == "500",
        "Recheck dash admission source fields",
    )
    columns = [
        {
            "name": "DashMinRange",
            "string": 0x614168,
            "gotOffset": 0x1848,
            "dataOffset": 0x1DC,
        },
        {
            "name": "DashMaxRange",
            "string": 0x614175,
            "gotOffset": 0x184C,
            "dataOffset": 0x1F8,
        },
        {"name": "SpeedMultiplier", "string": 0x6135BF, "dataOffset": 0x48},
        {"name": "AttractPercentage", "string": 0x6134EF, "dataOffset": 0x6C},
    ]
    for column in columns:
        expected = column["name"].encode() + b"\0"
        require(
            bytes(cpu.mem_read(column["string"], len(expected))) == expected,
            "Dash admission column differs",
        )
    require(
        all(
            not row["Panic"]
            for name, row in env["buff_rows"].items()
            if name not in ["", "String"]
        ),
        "Recheck source buff Panic fields",
    )
    require(
        read(0x7B34A0 + 0x38) == 0x217804, "Dash admission target radius vtable differs"
    )
    env["allowed"].extend(
        [
            (0x25BF86, 0x25C080),
            (0x1D8154, 0x1D8166),
            (0x1D7F20, 0x1D7F30),
            (0x1DDBCC, 0x1DDBE0),
            (0x1DEA5C, 0x1DEA70),
            (0x1DE7EE, 0x1DE802),
            (0x1DE3F0, 0x1DE404),
            (0x21A2D0, 0x21A376),
            (0x217804, 0x217844),
            (0x35D620, 0x35D670),
            (0x35D330, 0x35D423),
        ]
    )
    names = {
        0x25D852: "admission",
        0x25FA64: "providedOwner",
        0x2147C8: "data",
        0x2199B0: "buffComponent",
        0x25C19A: "attractionGate",
        0x1D8218: "attractionGetter",
        0x1DE724: "dashEnabled",
        0x1DDBCC: "speed",
        0x25BF86: "buffSpeed",
        0x1D8154: "panic",
        0x1D7F20: "speedMultiplier",
        0x1DEA5C: "maximum",
        0x1DE7EE: "minimum",
        0x1DE3F0: "radiusData",
        0x25FA2A: "providedPositionOwner",
        0x219B26: "position",
        0x21A2D0: "geometry",
        0x217804: "targetRadius",
        0x217780: "state",
        0x356EB0: "providedAssertion",
    }
    calls, events, models = Counter(), [], []

    def hook(_cpu, pc, _size, _data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        name = names[pc]
        # Earlier shared provider hooks have already popped their return word.
        if name in ["providedOwner", "providedPositionOwner", "providedAssertion"]:
            sp -= 4
        calls[name] += 1
        events.append(name)
        if name == "admission":
            require(
                [read(sp + 4), read(sp + 8)] == [attack, target],
                "Dash admission arguments differ",
            )
        elif name in ["providedOwner", "providedPositionOwner"]:
            require(read(sp + 4) == attack, "Dash admission owner argument differs")
        elif name in ["data", "buffComponent"]:
            require(read(sp + 4) == body, "Dash admission body argument differs")
        elif name in ["attractionGate", "buffSpeed"]:
            require(read(sp + 4) == buffs, "Dash admission buff manager differs")
            if name == "buffSpeed":
                require(
                    read(sp + 8) == read(data + 0x190),
                    "Dash admission speed input differs",
                )
        elif name in ["attractionGetter", "panic", "speedMultiplier"]:
            require(read(sp + 4) in models, "Dash admission buff Data differs")
        elif name in ["dashEnabled", "speed", "minimum", "maximum"]:
            require(read(sp + 4) == data, "Dash admission source Data differs")
        elif name == "radiusData":
            require(
                read(sp + 4) in [data, target_data],
                "Dash admission radius Data differs",
            )
        elif name in ["position", "targetRadius", "state"]:
            require(
                read(sp + 4) == (body if name == "position" else target),
                "Dash admission position/radius receiver differs",
            )
        elif name == "geometry":
            require(
                [read(sp + i) for i in [4, 8, 12, 16]]
                == [
                    target,
                    body + 0x20,
                    read(data + 0x1F8),
                    read(data + 0x1DC) + read(data + 0x22C),
                ],
                "Dash admission geometry arguments differ",
            )
        elif name == "providedAssertion":
            require(read(sp + 4) == 1, "Dash admission geometry assertion differs")

    for pc in names:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)

    def episode(
        direction=(1, 0),
        distance=5000,
        active_clock=0,
        buff_names=(),
        target_state=0,
        cooldown=1000,
        speed=90,
        raw_buff=None,
    ):
        cpu.mem_write(heap, b"\0" * 0x10000)
        xy = [8250 + round(distance * value) for value in direction]
        for ptr, value in [
            (body + 0x10, data),
            (body + 0x38, 8),
            (body + 0x48, buffs),
            (body + 0x20, 8250),
            (body + 0x24, 8250),
            (attack + 4, body),
            (attack + 0x20, active_clock),
            (data + 0x190, speed),
            (data + 0x1C4, cooldown),
            (data + 0x1DC, 4000),
            (data + 0x1F8, 6000),
            (data + 0x22C, 600),
            (target, 0x7B34A0),
            (target + 0x10, target_data),
            (target + 0x20, xy[0]),
            (target + 0x24, xy[1]),
            (target + 0x60, target_state),
            (target_data + 0x22C, 500),
            (buffs + 8, array),
        ]:
            write(ptr, value)
        buff_fields = [
            {
                "name": name,
                "speedMultiplier": int(env["buff_rows"][name]["SpeedMultiplier"] or 0),
                "attraction": int(env["buff_rows"][name]["AttractPercentage"] or 0),
            }
            for name in buff_names
        ]
        if raw_buff is not None:
            buff_fields.append({"name": "supplied", **raw_buff})
        write(buffs + 0x10, len(buff_fields))
        models.clear()
        for index, fields in enumerate(buff_fields):
            record = heap + 0x6000 + index * 0x100
            model = record + 0x40
            models.append(model)
            write(array + index * 4, record)
            write(record + 0xC, model)
            write(model + 0x48, fields["speedMultiplier"])
            write(model + 0x6C, fields["attraction"])
        before = bytes(cpu.mem_read(heap, 0x10000))
        calls.clear()
        events.clear()
        context["calls"].clear()
        run(0x25D852, attack, target, instruction_budget=8000)
        require(
            bytes(cpu.mem_read(heap, 0x10000)) == before,
            "Dash admission mutated supplied heap",
        )
        blocked = any(b["attraction"] > 0 for b in buff_fields)
        positive = max(
            [
                100,
                *[
                    b["speedMultiplier"]
                    for b in buff_fields
                    if b["speedMultiplier"] > 0
                ],
            ]
        )
        negative = max(
            [
                0,
                *[
                    -b["speedMultiplier"]
                    for b in buff_fields
                    if b["speedMultiplier"] < 0
                ],
            ]
        )
        effective_speed = math.trunc(
            math.trunc(speed * positive / 100) * max(0, min(100, 100 - negative)) / 100
        )
        radius = 0 if target_state in [4, 6] else 500
        delta2 = sum((value - 8250) ** 2 for value in xy)
        lower, upper = 4000 + 600 - radius, 6000 + radius
        expected = not blocked and (
            active_clock > 0
            or (cooldown > 0 and effective_speed > 0 and lower**2 <= delta2 <= upper**2)
        )
        actual = cpu.reg_read(UC_X86_REG_EAX)
        require(
            actual == int(expected),
            "Dash admission result differs from independent model",
        )
        require(
            calls["providedOwner"] == 2
            and calls["admission"] == calls["data"] == calls["attractionGate"] == 1,
            "Dash admission driver inventory differs",
        )
        uses_speed = not blocked and active_clock <= 0 and cooldown > 0
        uses_geometry = uses_speed and effective_speed > 0
        require(
            calls["geometry"] == int(uses_geometry)
            and calls["buffSpeed"] == int(uses_speed),
            "Dash admission gate order differs",
        )
        expected_events = [
            "admission",
            "providedOwner",
            "data",
            "providedOwner",
            "buffComponent",
            "attractionGate",
        ]
        for fields in buff_fields:
            expected_events.append("attractionGetter")
            if fields["attraction"] > 0:
                break
        if not blocked and active_clock <= 0:
            expected_events.append("dashEnabled")
            if cooldown > 0:
                expected_events += ["buffComponent", "speed", "buffSpeed"]
                for _ in buff_fields:
                    expected_events += ["panic", "speedMultiplier"]
                if effective_speed > 0:
                    expected_events += [
                        "maximum",
                        "minimum",
                        "radiusData",
                        "providedPositionOwner",
                        "position",
                        "geometry",
                    ]
                    for _ in range(2):
                        expected_events += (
                            ["targetRadius"]
                            + (["radiusData"] if radius else [])
                            + ["providedAssertion"]
                        )
        require(
            events == expected_events and calls == Counter(expected_events),
            "Dash admission exact ordered inventory differs",
        )
        return {
            "fields": {
                "direction": list(direction),
                "requestedDistance": distance,
                "origin": [8250, 8250],
                "target": xy,
                "activeClockMs": active_clock,
                "targetState": target_state,
                "cooldownMs": cooldown,
                "speed": speed,
                "buffs": buff_fields,
            },
            "returned": actual,
            "calls": dict(sorted(calls.items())),
            "events": list(events),
            "exactHeapUnchanged": True,
        }

    directions = [
        (1, 0),
        (-1, 0),
        (0, 1),
        (0, -1),
        *[
            (x * a, y * b)
            for a, b in [(0.6, 0.8), (0.8, 0.6)]
            for x in [1, -1]
            for y in [1, -1]
        ],
    ]
    cases = [
        episode(direction=d, distance=r)
        for d in directions
        for r in [0, 4099, 4100, 4101, 4500, 5000, 6499, 6500, 6501, 8000]
    ]
    controls = []
    for state in [4, 6]:
        for r in [4099, 4100, 4599, 4600, 4601, 5999, 6000, 6001, 6500]:
            controls.append(episode(distance=r, target_state=state))
    for buff_names in [
        (name,) for name in env["buff_rows"] if name not in ["", "String"]
    ] + [
        ("Rage", "IceWizardSlowDown"),
        ("IceWizardSlowDown", "Rage"),
        ("Rage", "Freeze"),
        ("Rage", "Tornado"),
        ("Poison", "Tornado", "Rage"),
    ]:
        for active in [0, 1, 950]:
            for r in [0, 5000, 8000]:
                controls.append(
                    episode(distance=r, active_clock=active, buff_names=buff_names)
                )
    for active in [-1, 0, 1, 1000]:
        for cooldown in [-1, 0, 1000]:
            for speed in [-1, 0, 1, 90]:
                controls.append(
                    episode(active_clock=active, cooldown=cooldown, speed=speed)
                )
    for attraction in [-1, 0, 1]:
        for multiplier in [-101, -100, -99, 0, 100, 200]:
            for active in [0, 1]:
                controls.append(
                    episode(
                        active_clock=active,
                        raw_buff={
                            "attraction": attraction,
                            "speedMultiplier": multiplier,
                        },
                    )
                )

    definitions = [
        (
            "admission",
            0x25D852,
            0x25D946,
            "Actual attraction, active-clock, configured dash, effective-speed and target-window gates.",
        ),
        (
            "attraction",
            0x25C19A,
            0x25C1EB,
            "Actual supplied buff-vector scan; positive attraction blocks dash admission.",
        ),
        (
            "speed",
            0x25BF86,
            0x25C080,
            "Actual strongest positive/negative speed scaling; Panic fields supplied false.",
        ),
        (
            "geometry",
            0x21A2D0,
            0x21A376,
            "Actual target virtual radius, squared-distance and inclusive lower/upper window.",
        ),
        (
            "targetRadius",
            0x217804,
            0x217844,
            "Actual state-4/6 virtual radius suppression and ordinary radius getter.",
        ),
        (
            "buffGetters",
            0x1D8154,
            0x1D8166,
            "Actual Panic byte getter; all archived profiles are false in this capture.",
        ),
        (
            "attractionGetter",
            0x1D8218,
            0x1D822F,
            "Actual positive AttractPercentage query at Data+0x6c.",
        ),
        (
            "squaredDistance",
            0x35D330,
            0x35D423,
            "Actual bounded squared coordinate distance, reached by native geometry.",
        ),
        (
            "rangeBindings",
            0x1DC608,
            0x1DC6AE,
            "Named DashMinRange/MaxRange column bindings; loader excluded.",
        ),
        (
            "rangeStores",
            0x1D9B1D,
            0x1D9BDD,
            "Source dash minimum/maximum Data stores; loader excluded.",
        ),
        (
            "attractionStore",
            0x1D72F8,
            0x1D7328,
            "Named AttractPercentage to Data+0x6c store; loader excluded.",
        ),
    ]
    blocks = []
    for name, start, end, meaning in definitions:
        assembly = subprocess.check_output(
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
        instructions = [
            line.strip()
            for line in assembly.splitlines()
            if re.match(r"\s*[0-9a-f]+:", line)
        ]
        require(bool(instructions), "Empty dash admission instruction block")
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
        "inputs": [
            {"path": p, "sha256": hashlib.sha256(Path(p).read_bytes()).hexdigest()}
            for p in [
                "reference/logic/characters.csv",
                "reference/logic/character_buffs.csv",
            ]
        ],
        "sourceColumns": columns,
        "profiles": {
            "attacker": "Assassin",
            "target": "Knight",
            "speed": 90,
            "dashCooldownMs": 1000,
            "dashMinimum": 4000,
            "dashMaximum": 6000,
            "ownRadius": 600,
            "targetRadius": 500,
        },
        "limits": [
            "Actual pure dash-admission helper executes against supplied source/body/target/buff states. Natural acquisition, target validity, outer attack scheduling, countdown, movement and damage remain excluded; this is not a full natural startup capture.",
            "Owner and position-owner resolution and successful geometry assertions are checked providers. Actual Data/buff getters, native speed scaling, target virtual radius and squared geometry execute. Panic fields are supplied false; configured panic speed changes are excluded.",
            "Positive active clocks, disabled/nonpositive configured cooldown/speed, raw target states 4/6 and raw buff controls are supplied directly. Source buff fields are copied from archived rows; natural application/expiry and a moving second dash are excluded.",
            "Every invocation validates exact 64-KiB heap immutability, arguments, ordered getter inventory, branch drivers and an independent result model. Gameplay remains rules 49.",
        ],
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    output = json.dumps(result, indent=2) + "\n"
    path = Path("reference/client/dash-admission-native-trace.json")
    if env["args"].check:
        require(path.read_text() == output, "Dash admission capture differs")
    else:
        path.write_text(output)
    print(
        json.dumps(
            {
                "cases": len(cases),
                "controls": len(controls),
                "accepted": sum(r["returned"] for r in cases + controls),
                "unchangedHeaps": len(cases + controls),
            }
        )
    )
