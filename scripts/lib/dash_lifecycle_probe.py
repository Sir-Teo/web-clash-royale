"""Bounded Bandit dash entry, open-plane movement and retained Poison.

Native state entry, movement arithmetic, status clocks and surviving HP stores
execute. Goal admission, collision/world-index writes, view notifications,
natural actor scheduling, application and post-store reactions are supplied or
excluded. The resulting evidence is not a complete natural battle.
"""

from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EIP, UC_X86_REG_ESI, UC_X86_REG_ESP


def capture(env, context):
    def require(condition, message):
        if not condition:
            raise RuntimeError(message)

    cpu, heap, body, data, health, world, buffs, array = [
        env[k]
        for k in ["cpu", "heap", "body", "data", "component", "world", "buffs", "array"]
    ]
    read, write, run, ret = [env[k] for k in ["read", "write", "run", "return_hook"]]
    attack, movement, record, buff_data, row, view_vt, settings, view = [
        heap + off
        for off in [0x7000, 0x6000, 0x8000, 0xA000, 0xC000, 0xD000, 0xE000, 0xF000]
    ]
    paths = [
        "reference/logic/characters.csv",
        "reference/logic/character_buffs.csv",
        "reference/client/buff-ticks-native-trace.json",
        "reference/client/health-shield-native-trace.json",
        "reference/client/world-step-native-trace.json",
    ]
    inputs = [
        {"path": p, "sha256": hashlib.sha256(Path(p).read_bytes()).hexdigest()}
        for p in paths
    ]
    for path in paths[2:]:
        prior = json.loads(Path(path).read_text())
        require(prior["sha256"] == env["sha"], "Dash prerequisite binary differs")
        for entry in prior["inputs"]:
            require(
                hashlib.sha256(Path(entry["path"]).read_bytes()).hexdigest()
                == entry["sha256"],
                "Dash prerequisite input differs",
            )
    source = env["rows"]["reference/logic/characters.csv"]["Assassin"]
    poison = env["buff_rows"]["Poison"]
    require(
        all(
            source[k] == v
            for k, v in {
                "Hitpoints": "750",
                "Speed": "90",
                "JumpSpeed": "500",
                "DashCooldown": "1000",
                "DashMinRange": "4000",
                "DashMaxRange": "6000",
            }.items()
        ),
        "Recheck source Assassin fields",
    )
    require(
        not source["ChargeRange"]
        and not source["JumpHeight"]
        and not source["HidesWhenNotAttacking"],
        "Recheck source dash auxiliary fields",
    )
    require(
        poison["DamagePerSecond"] == "57"
        and poison["HitFrequency"] == "1000"
        and not poison["HitSpeedMultiplier"]
        and not poison["SpeedMultiplier"]
        and not poison["Panic"],
        "Recheck retained Poison profile",
    )
    columns = [
        {"name": "Speed", "string": 0x613ECC, "gotOffset": 0x176C, "dataOffset": 0x190},
        {
            "name": "ChargeRange",
            "string": 0x613FB7,
            "gotOffset": 0x17C8,
            "dataOffset": 0x1AC,
        },
        {
            "name": "DashCooldown",
            "string": 0x6140DA,
            "gotOffset": 0x1818,
            "dataOffset": 0x1C4,
        },
        {
            "name": "JumpHeight",
            "string": 0x6140F2,
            "gotOffset": 0x181C,
            "dataOffset": 0x1C8,
        },
        {
            "name": "JumpSpeed",
            "string": 0x614182,
            "gotOffset": 0x1840,
            "dataOffset": 0x1E0,
        },
    ]
    for column in columns:
        expected = column["name"].encode() + b"\0"
        require(
            bytes(cpu.mem_read(column["string"], len(expected))) == expected,
            "Dash named column differs",
        )
    require(
        read(0x7B34A0 + 0x88) == 0x21617C and read(0x7B34A0 + 0x4C) == 0x219D5E,
        "Actor state callback vtable differs",
    )
    require(
        read(0x7B4D1C + 0xC) == 0x260C2C and read(0x79E1CC + 0xC) == 0x25B18E,
        "Movement/buff vtable differs",
    )
    for address, expected in [
        (0x25FA2A, body),
        (0x25FA9C, data),
        (0x214F60, 0),
        (0x1E6CEE, context["config"]),
    ]:
        require(
            context["constants"].pop(address) == expected,
            "Dash shared boundary differs",
        )
    for ptr in [attack, movement, buffs]:
        env["component_resolvers"][ptr] = (body, world)
    ranges = [
        (0x260C2C, 0x260D98),
        (0x25D946, 0x25D95E),
        (0x25CDF4, 0x25CE05),
        (0x25F928, 0x25F93C),
        (0x214F60, 0x2157EB),
        (0x219B96, 0x219BAE),
        (0x219B36, 0x219B96),
        (0x263E1C, 0x263E8A),
        (0x217780, 0x217790),
        (0x1DDFA2, 0x1DDFB6),
        (0x21617C, 0x21625E),
        (0x2176D4, 0x217716),
        (0x217460, 0x2174E6),
        (0x1DEF68, 0x1DEF90),
        (0x1DE872, 0x1DE882),
        (0x2172E0, 0x217322),
        (0x219546, 0x219578),
        (0x1DE94C, 0x1DE960),
        (0x2198F2, 0x219910),
        (0x219D5E, 0x219DC6),
        (0x25FF56, 0x25FF6E),
        (0x25FA16, 0x25FA17),
        (0x25BF86, 0x25C080),
        (0x1D8154, 0x1D8166),
        (0x1D7F20, 0x1D7F30),
        (0x25B18E, 0x25B217),
        (0x25B3E1, 0x25B42B),
        (0x218F48, 0x21916A),
        (0x1D7EB4, 0x1D7F00),
        (0x1D7F9C, 0x1D7FE8),
        (0x20205A, 0x20205B),
        (0x1E99F2, 0x1E99F3),
        (0x1E6CEE, 0x1E6CEF),
        (0x25FA2A, 0x25FA3A),
        (0x25FA9C, 0x25FA9D),
        (0x25FF6E, 0x260413),
        (0x26064E, 0x26065D),
        (0x217322, 0x217343),
        (0x21A404, 0x21A410),
        (0x2172AE, 0x2172E0),
        (0x1DE24A, 0x1DE25E),
        (0x2639BC, 0x263A0A),
        (0x1DEB1E, 0x1DEB32),
        (0x217804, 0x217844),
        (0x2613F6, 0x2615E7),
        (0x2615E7, 0x261615),
        (0x261872, 0x26187F),
        (0x261956, 0x261E03),
        (0x262A96, 0x262AD5),
        (0x262F18, 0x262F20),
        (0x26301E, 0x263055),
        (0x26329B, 0x2632A4),
        (0x2632A4, 0x2639BC),
        (0x262F50, 0x262FAF),
        (0x219AAE, 0x219B96),
        (0x21735C, 0x21736C),
        (0x25D4A0, 0x25D4B0),
        (0x1DDBCC, 0x1DDBE0),
        (0x1DE07E, 0x1DE092),
        (0x1DE802, 0x1DE816),
        (0x35C120, 0x35C4E0),
        (0x35BD60, 0x35BDA2),
        (0x35D220, 0x35D6E0),
        (0x35D940, 0x35D971),
        (0x23BF26, 0x23BF27),
    ]
    env["allowed"].extend(ranges)
    phase, damage, events, calls = None, None, [], Counter()
    overrides = {}
    names = {
        0x260C2C: "movementFrame",
        0x260D7B: "excludedMovementNotification",
        0x214F60: "stateSetter",
        0x21617C: "componentActivation",
        0x263E1C: "movementEntry",
        0x25F928: "clearAttackFinish",
        0x219546: "componentMask",
        0x219B36: "movementComponent",
        0x2199B0: "buffComponent",
        0x219DAE: "healthComponent",
        0x2613F6: "movementUpdate",
        0x26344E: "movementGeometry",
        0x2632A4: "goalCoordinates",
        0x262F50: "remainingTravel",
        0x25B18E: "buffManager",
        0x218F48: "buffUpdate",
        0x1D7EB4: "baseDamage",
        0x1D7F9C: "baseHeal",
        0x25FF6E: "ordinaryHit",
        0x2601AE: "lowerDamageProxy",
        0x2602D0: "damageReducer",
        0x23BF26: "providedOpenPlaneWrite",
        0x25FA16: "providedViewNotification",
    }

    def hook(_cpu, pc, _size, _data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if pc in names:
            calls[names[pc]] += 1
        if pc in overrides and overrides[pc](sp):
            return
        if pc == 0x25CDF4:
            require(phase == "entry", "Unexpected dash request phase")
            cpu.reg_write(UC_X86_REG_ESI, body)
        elif pc == 0x25CE04:
            cpu.reg_write(UC_X86_REG_EIP, env["stop"])
        elif pc == 0x25FA16:
            require(
                phase == "entry" and read(sp + 4) == view,
                "Unexpected dash view notification",
            )
            events.append(["providedViewNotification"])
            ret()
        elif pc in [0x25FA2A, 0x25FA9C]:
            require(
                read(sp + 4) in [health, attack, movement, buffs],
                "Unexpected dash owner/Data argument",
            )
            ret(body if pc == 0x25FA2A else data)
        elif pc == 0x25B216:
            require(phase == "buff", "Unexpected aura scheduling boundary")
            cpu.reg_write(UC_X86_REG_EIP, 0x25B3E1)
        elif pc == 0x260D7B:
            require(phase == "movement", "Unexpected movement notification phase")
            cpu.reg_write(UC_X86_REG_EIP, 0x260D8F)
        elif pc == 0x20205A:
            caller = read(sp)
            require(caller in [0x1D7EF9, 0x1D7FE1], "Unexpected dash buff table caller")
            expected = [
                row,
                read(0x7B8A14 + (0x1710 if caller == 0x1D7EF9 else 0x1758)),
                0,
                1,
                0,
            ]
            require(
                [read(sp + i) for i in [4, 8, 12, 16, 20]] == expected,
                "Dash buff table arguments differ",
            )
            value = damage if caller == 0x1D7EF9 else 0
            events.append(["rate", "damage" if caller == 0x1D7EF9 else "heal", value])
            ret(value)
        elif pc == 0x1E99F2:
            require(phase == "buff", "Unexpected opaque damage word")
            ret(137)
        elif pc == 0x1E6CEE:
            ret(settings)
        elif pc == 0x260412:
            require(phase == "buff", "Ordinary damage reached HP store during dash")
            events.append(["hp", read(health + 8)])
            cpu.reg_write(UC_X86_REG_EIP, 0x260655)
        elif pc == 0x23BF26:
            require(phase == "movement", "Unexpected open-plane movement phase")
            collision_world, point, dx, dy, owner, collision = [
                read(sp + i) for i in [4, 8, 12, 16, 20, 24]
            ]
            require(
                collision_world == 0
                and point == body + 0x20
                and owner == body
                and collision == 0,
                "Open-plane movement arguments differ",
            )
            require(abs(dx) + abs(dy) in [0, 250], "Unexpected movement chunk")
            write(point, read(point) + dx)
            write(point + 4, read(point + 4) + dy)
            events.append(["providedOpenPlaneWrite", dx, dy])
            ret()

    for pc in {
        *names,
        0x25CDF4,
        0x25CE04,
        0x25FA2A,
        0x25FA9C,
        0x25B216,
        0x20205A,
        0x1E99F2,
        0x1E6CEE,
        0x260412,
    }:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=pc, end=pc)

    def snapshot():
        return bytes(cpu.mem_read(heap, 0x10000))

    def put(expected, ptr, value):
        struct.pack_into("<i", expected, ptr - heap, value)

    def exact(expected, label):
        actual = snapshot()
        changes = [
            (hex(heap + i), a, b)
            for i, (a, b) in enumerate(zip(expected, actual))
            if a != b
        ]
        require(not changes, f"Unexpected dash heap mutation ({label}): {changes[:12]}")

    if env["args"].dash_goals:
        from lib.dash_goal_probe import capture as capture_goals

        def set_phase(value):
            nonlocal phase
            phase = value

        return capture_goals(env, context, locals())

    cases, controls = [], []

    def episode(direction, initial_counter, tick_damage, control=None):
        nonlocal phase, damage
        damage = tick_damage
        dx, dy = direction
        cpu.mem_write(heap, b"\0" * 0x10000)
        for ptr, value in [
            (body, 0x7B34A0),
            (body + 0x10, data),
            (body + 0x18, view),
            (body + 0x20, 8250),
            (body + 0x24, 8250),
            (body + 0x38, 15),
            (body + 0x3C, attack),
            (body + 0x40, movement),
            (body + 0x44, health),
            (body + 0x48, buffs),
            (body + 0x60, 2),
            (attack + 4, body),
            (attack + 0x28, 53),
            (movement + 4, body),
            (movement + 0x10, 1),
            (movement + 0x1BC, 8250 + 5000 * dx),
            (movement + 0x1C0, 8250 + 5000 * dy),
            (health + 4, body),
            (health + 8, 750),
            (view, view_vt),
            (view_vt + 0x5C, 0x25FA16),
            (data + 0x190, 90),
            (data + 0x1C4, 1000),
            (data + 0x1E0, 500),
            (buffs + 8, array),
            (buffs + 0x10, 1),
            (array, record),
            (record, 2000),
            (record + 8, initial_counter),
            (record + 0xC, buff_data),
            (record + 0x10, buffs),
            (buff_data + 8, row),
            (buff_data + 0x50, 1000),
        ]:
            write(ptr, value)
        cpu.mem_write(movement + 0x1EB, b"\1\1")
        phase = "entry"
        events.clear()
        calls.clear()
        expected = bytearray(snapshot())
        put(expected, body + 0x60, 4)
        put(expected, attack + 0x28, 0)
        put(expected, movement + 0x1CC, -1)
        expected[movement + 0x1EB - heap] = 0
        run(0x25CDF4, instruction_budget=8000)
        exact(expected, "entry")
        require(events == [["providedViewNotification"]], "Dash entry events differ")
        require(
            calls["stateSetter"]
            == calls["componentActivation"]
            == calls["movementEntry"]
            == calls["clearAttackFinish"]
            == 1,
            "Dash entry calls differ",
        )
        entry = {
            "state": read(body + 0x60),
            "flags": read(body + 0x38),
            "hp": read(health + 8),
            "attackFinish": read(attack + 0x28),
            "chargeClock": read(movement + 0x1CC),
            "events": list(events),
            "calls": dict(sorted(calls.items())),
            "exactHeapChangesOnly": True,
        }
        if control in ["health-disabled", "movement-disabled"]:
            write(
                body + 0x38,
                15 & ~{"health-disabled": 4, "movement-disabled": 2}[control],
            )
        elif control in ["health-absent", "movement-absent"]:
            write(body + {"health-absent": 0x44, "movement-absent": 0x40}[control], 0)
        elif control == "empty-buffs":
            write(buffs + 0x10, 0)
        flags = read(body + 0x38)
        has_move = bool(flags & 2) and control != "movement-absent"
        has_buff = bool(flags & 8)
        has_health = bool(flags & 4) and control != "health-absent"
        has_record = has_buff and control != "empty-buffs"
        frames = []
        for step in range(1, 9):
            expected = bytearray(snapshot())
            events.clear()
            calls.clear()
            phase = "ordinary"
            pointer = run(0x219DAE, body)
            require(
                pointer == (health if has_health else 0),
                "Dash health mask lookup differs",
            )
            if pointer:
                require(
                    run(0x25FF6E, pointer, 75, 0, 0, 0, 0, instruction_budget=5000)
                    == 0,
                    "Dash ordinary hit was not blocked",
                )
            exact(expected, "ordinary before")
            phase = "movement"
            pointer = run(0x219B36, body)
            require(
                pointer == (movement if has_move else 0),
                "Dash movement mask lookup differs",
            )
            if pointer:
                for ptr, value in [
                    (body + 0x20, 8250 + step * 500 * dx),
                    (body + 0x24, 8250 + step * 500 * dy),
                    (body + 0x50, 256 * dx),
                    (body + 0x54, 256 * dy),
                    (movement + 0x1DC, step * 50),
                    (movement + 0x1FC, (step - 1) * 50),
                ]:
                    put(expected, ptr, value)
                expected[movement + 0x1EA - heap] = 1
                run(0x260C2C, movement, instruction_budget=20000)
            exact(expected, "movement")
            phase = "buff"
            pointer = run(0x2199B0, body)
            require(
                pointer == (buffs if has_buff else 0), "Dash buff mask lookup differs"
            )
            pulse = has_record and initial_counter + step == 20
            if has_record:
                put(expected, record, 2000 - step * 50)
                put(expected, record + 8, (initial_counter + step) % 20)
                if pulse and has_health:
                    put(expected, health + 8, 750 - damage)
            if pointer:
                run(0x25B18E, buffs, instruction_budget=10000)
            exact(expected, "buff")
            phase = "ordinary"
            if has_health:
                require(
                    run(0x25FF6E, health, 75, 0, 0, 0, 0, instruction_budget=5000) == 0,
                    "Dash ordinary hit after Poison was not blocked",
                )
            exact(expected, "ordinary after")
            expected_events = (
                (
                    [["providedOpenPlaneWrite", 250 * dx, 250 * dy]] * 2
                    + [["providedOpenPlaneWrite", 0, 0]]
                )
                if has_move
                else []
            )
            if pulse:
                expected_events += [["rate", "damage", damage], ["rate", "heal", 0]]
                if has_health:
                    expected_events += [["hp", 750 - damage]]
            require(events == expected_events, "Dash frame event order differs")
            require(
                calls["damageReducer"] == int(pulse and has_health),
                "Dash reducer count differs",
            )
            require(
                calls["movementGeometry"] == 3 * int(has_move),
                "Dash geometry count differs",
            )
            require(
                calls["movementFrame"]
                == calls["excludedMovementNotification"]
                == int(has_move),
                "Dash frame driver count differs",
            )
            require(
                calls["buffUpdate"] == int(has_record),
                "Dash status update count differs",
            )
            frames.append(
                {
                    "step": step,
                    "state": read(body + 0x60),
                    "flags": read(body + 0x38),
                    "xy": [read(body + 0x20), read(body + 0x24)],
                    "hp": read(health + 8),
                    "remainingMs": read(record),
                    "counter": read(record + 8),
                    "pulse": pulse,
                    "ordinaryHitBlocked": has_health,
                    "events": list(events),
                    "calls": dict(sorted(calls.items())),
                    "exactHeapChangesOnly": True,
                }
            )
        result = {
            "fields": {
                "direction": list(direction),
                "counter": initial_counter,
                "damage": damage,
                "hp": 750,
                "flags": flags,
                "control": control,
            },
            "entry": entry,
            "frames": frames,
        }
        (controls if control else cases).append(result)

    for direction in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
        for counter in [12, 19]:
            for value in [57, 121]:
                episode(direction, counter, value)
    for control in [
        "health-disabled",
        "health-absent",
        "movement-disabled",
        "movement-absent",
        "empty-buffs",
    ]:
        for value in [57, 121]:
            episode((1, 0), 19, value, control)
    definitions = [
        (
            "movementFrame",
            0x260C2C,
            0x260D98,
            "Actual movement component update dispatches the dash sub-update once. Post-movement notification at 260d7b is skipped through the real epilogue.",
        ),
        (
            "dashRequest",
            0x25CDF4,
            0x25CE05,
            "Actual attack fragment requests state 4; the following attack continuation is excluded.",
        ),
        (
            "stateSetter",
            0x214F60,
            0x2157EB,
            "Actual old/new actor state dispatch, attack finish clear, movement entry and component activation; view notification is a checked no-op.",
        ),
        (
            "componentActivation",
            0x21617C,
            0x21625E,
            "Actual alive/buff clock gating can enable the attack bit; health and buffs remain enabled.",
        ),
        (
            "movementEntry",
            0x263E1C,
            0x263E8A,
            "Actual movement entry reads source absent ChargeRange and resets charge/stop state.",
        ),
        (
            "movementUpdate",
            0x2613F6,
            0x261E03,
            "Actual movement sub-update follows source Speed, state 4, JumpSpeed and JumpHeight. Supplied exact-coordinate goal and no attack target; landing and owner outer update excluded.",
        ),
        (
            "movementGeometry",
            0x2632A4,
            0x26398A,
            "Actual goal and integer geometry execute. The collision/world-index writer at 23bf26 is replaced by checked open-plane point addition.",
        ),
        (
            "retainedBuff",
            0x218F48,
            0x21916A,
            "Actual retained Poison clock and lower damage request; supplied rate/opaque word, source frequency and no expiry in these short episodes.",
        ),
        (
            "ordinaryAndLowerDamage",
            0x25FF6E,
            0x260413,
            "Actual ordinary state gate versus lower proxy/reducer and surviving HP store. Post-store reactions skipped through real return.",
        ),
        (
            "speedStore",
            0x1DAE95,
            0x1DAEEA,
            "Source Speed loader into Data+190; optional modifiers absent. Loader retained, not executed.",
        ),
        (
            "chargeColumn",
            0x1DBADA,
            0x1DBB08,
            "Named ChargeRange binding to GOT+17c8; loader excluded.",
        ),
        (
            "chargeStore",
            0x1D99D8,
            0x1D99F0,
            "ChargeRange column into Data+1ac; loader excluded.",
        ),
        (
            "jumpHeightColumn",
            0x1DC370,
            0x1DC39B,
            "Named JumpHeight binding to GOT+181c; loader excluded.",
        ),
        (
            "jumpFields",
            0x1D9A83,
            0x1D9AB3,
            "DashCooldown/JumpHeight source field stores; loader excluded.",
        ),
        (
            "jumpSpeedColumn",
            0x1DC608,
            0x1DC6D9,
            "Named JumpSpeed and range bindings; loaders excluded.",
        ),
        (
            "jumpSpeedStore",
            0x1D9B35,
            0x1D9B4D,
            "JumpSpeed column to Data+1e0; loader excluded.",
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
        require(bool(instructions), "Empty dash instruction block")
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
        "inputs": inputs,
        "sourceColumns": columns,
        "stepMs": 50,
        "profiles": {
            "target": "Assassin",
            "buff": "Poison",
            "sourceHp": 750,
            "sourceDamage": 57,
            "normalizedDamageControl": 121,
            "sourceSpeed": 90,
            "sourceJumpSpeed": 500,
            "frequencyMs": 1000,
        },
        "limits": [
            "Supplied existing ordinary actor/attack/movement/health/buff objects enter the actual attack dash request and full actor state setter from raw state 2 to 4. State entry, attack finish clearing, movement initialization, alive/clock component activation execute; view notification is a checked no-op. Object construction, natural dash eligibility/target acquisition and full actor outer scheduling are excluded.",
            "Actual movement frame 260c2c dispatches sub-update 2613f6, which executes with archived Assassin Speed=90, absent ChargeRange/JumpHeight and JumpSpeed=500. Opaque Data+130 is supplied zero. A supplied exact-coordinate goal five tiles away and null attack target avoid tile decoding, target hit tests and landing. Four cardinal directions advance 500 native units per supplied 50-ms update in two 250-unit chunks plus a zero chunk. Diagonals, obstacles, moving targets and landing remain excluded.",
            "Collision/world-index writer 23bf26 is a checked open-plane provider adding native-computed displacement to the actor point. Native world admission, collision resolution, indexing and view updates do not execute. Post-movement notification 260d7b is skipped through the real movement frame epilogue. The evidence establishes bounded movement arithmetic, not complete navigation equivalence.",
            "Each supplied step calls actual masked component getters, the movement frame and retained buff manager in that order. Later area-buff scheduling is skipped through the real manager epilogue. Full four-phase actor dispatch and the health component's own frame update are excluded. Controls explicitly disable/remove individual components only after native state entry.",
            "Retained source Poison counter/frequency and actual lower proxy/reducer/HP store execute. Damage 57 uses the archived source rate; 121 is a supplied normalization control. Table scaling, buff application, expiry, shields, lethal paths and post-store reactions are excluded. Actual ordinary 75-damage requests remain blocked by state 4 before and after these updates.",
            "Every entry and step validates exact whole-heap changes, provider arguments, ordered movement/rate/HP events and important native call counts. Earlier captures pin separate periodic clock, shield/death clamp and 50-ms world-step contracts. Application gameplay remains rules 47 in this evidence checkpoint.",
        ],
        "blocks": blocks,
        "cases": cases,
        "controls": controls,
    }
    output = json.dumps(result, indent=2) + "\n"
    path = Path("reference/client/dash-lifecycle-native-trace.json")
    if env["args"].check:
        require(path.read_text() == output, "Dash lifecycle capture differs")
    else:
        path.write_text(output)
    frames = [f for r in cases + controls for f in r["frames"]]
    print(
        json.dumps(
            {
                "cases": len(cases),
                "controls": len(controls),
                "steps": len(frames),
                "pulses": sum(f["pulse"] for f in frames),
                "dashPoisonHits": sum(
                    any(e[0] == "hp" for e in f["events"]) for f in frames
                ),
                "ordinaryBlocks": sum(f["ordinaryHitBlocked"] * 2 for f in frames),
                "blocks": len(blocks),
            }
        )
    )
