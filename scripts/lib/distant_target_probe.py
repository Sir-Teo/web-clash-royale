"""Native default-target fallback on supplied account/body/collection memory.

Account reference resolution, integer distance/lane scoring and the actual
primary caller execute. World registration, lane assignment, full eligibility,
object construction and setter effects remain explicit supplied boundaries.
"""
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EDI, UC_X86_REG_ESP


def capture(env, context):
    cpu, heap, body, world, component = [env[k] for k in ['cpu', 'heap', 'body', 'world', 'component']]
    read, write, run, return_hook = [env[k] for k in ['read', 'write', 'run', 'return_hook']]
    initialize, sources, active, queries = [context[k] for k in ['initialize', 'sources', 'active', 'queries']]
    config, broadphase, collection, pointers = [heap + off for off in [0xa000, 0xe200, 0xf000, 0xf100]]
    env['allowed'].extend([
        (0x25deb6, 0x25e61c), (0x25d4b0, 0x25d4b1),
        (0x217780, 0x217790), (0x219b36, 0x219b4e),
        (0x219d5e, 0x219da2), (0x219dae, 0x219dc6), (0x25ff56, 0x25ff6e),
        (0x219be6, 0x219c90), (0x21af26, 0x21af36),
        (0x1cd216, 0x1cd264), (0x35bba0, 0x35bbbc), (0x35bbc0, 0x35bbdc),
        (0x1c97c0, 0x1c9804), (0x1c8a32, 0x1c8a46),
        (0x1cd028, 0x1cd086), (0x1c8aa2, 0x1c8aba),
        (0x1cacd2, 0x1cacee), (0x1cae00, 0x1cae4a),
        (0x21997c, 0x21999c), (0x1c9576, 0x1c958a),
        (0x35c990, 0x35ca60), (0x35bd60, 0x35bda2),
    ])
    settings = {row['Name']: row for row in csv.DictReader(io.StringIO(Path('reference/logic/globals.csv').read_text()))}
    source_flags = [('LOGIC_DEFAULT_TARGET_USE_LANE_ID', 0x617bee, 0x2c6),
                    ('LOGIC_PRINCESS_TOWERS_ALWAYS_AS DEFAULT_TARGET', 0x617d4a, 0x2c8)]
    for name, address, _offset in source_flags:
        if bytes(cpu.mem_read(address, len(name) + 1)) != name.encode() + b'\0':
            raise RuntimeError('Native default-target source name differs')
        if settings[name]['BooleanValue'] != 'TRUE':
            raise RuntimeError('Recheck archived default-target flags')
    observed, requests, selection = [], [], {}
    mapped = {}
    def identity(pointer):
        return next((name for name, address in mapped.items() if address == pointer), None)

    def hook(_cpu, address, _size, _data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        if address == 0x25e401:
            selection['initialDefault'] = identity(read(sp + 0x10))
        elif address == 0x25e49e:
            selection['initialScore'] = cpu.reg_read(UC_X86_REG_EAX)
        elif address == 0x25e50c:
            observed.append({'target': identity(read(sp + 0x24)),
                             'approximateDistance': cpu.reg_read(UC_X86_REG_EAX)})
        elif address == 0x25e5ab:
            if not observed or observed[-1]['target'] != identity(read(sp + 0x24)):
                raise RuntimeError('Unexpected distant score checkpoint')
            observed[-1]['adjustedScore'] = read_signed(cpu.reg_read(UC_X86_REG_EDI))
        elif address == 0x25d4b0:
            if read(sp) != 0x25e308 or read(sp + 4) != component or read(sp + 8) not in mapped.values():
                raise RuntimeError('Unexpected distant primary setter context')
            requests.append(identity(read(sp + 8)))
            return_hook()
    for address in [0x25e401, 0x25e49e, 0x25e50c, 0x25e5ab, 0x25d4b0]:
        cpu.hook_add(UC_HOOK_CODE, hook, begin=address, end=address)

    def read_signed(value):
        return value if value < 0x80000000 else value - 0x100000000

    def predict(owner_point, candidates, order, lane, use_lane, always, account_count, boundary_field):
        seed, aux = candidates[0], candidates[3]
        winner = seed
        if account_count >= 4 and aux.get('scalar', 1000) > 0:
            if seed.get('scalar', 1000) <= 0 or aux['lane'] == lane:
                winner = aux
        seed_score = (owner_point[0] - winner['x']) ** 2 + (owner_point[1] - winner['y']) ** 2
        initial = {'initialDefault': winner['id']}
        expected_count = 3 if account_count > 3 else 2
        if len(order) != expected_count and not always:
            return winner['id'], [], initial
        initial['initialScore'] = seed_score
        partial = always and len(order) < expected_count
        rows = []
        for name in order:
            candidate = next(row for row in candidates if row['id'] == name)
            dx, dy = abs(candidate['x'] - owner_point[0]), abs(candidate['y'] - owner_point[1])
            distance = max(dx, dy) + min(dx, dy) * 53 // 128
            bias = 0
            if use_lane and candidate['lane'] == lane:
                grid_y = int(owner_point[1] / 500)
                bias = 125 if 3 <= grid_y < boundary_field - 3 else 1000
            score = read_signed(distance * distance - 2 * distance * bias - bias * bias)
            rows.append({'target': name, 'approximateDistance': distance, 'adjustedScore': score})
            if score < seed_score and (not partial or candidate['lane'] == lane):
                winner, seed_score = candidate, score
        return winner['id'], rows, initial

    def sample(owner_name, team=0, add_radius=True, lane=0, use_lane=True, always=True,
               count=2, reverse=False, layout='near-other-lane', owner_y=8000,
               account_count=2, boundary_field=64, seed_scalar=1000, aux_scalar=1000,
               aux_lane=0, ineligible=None):
        nonlocal observed, requests, mapped, selection
        owner_y = owner_y if team == 0 else 32000 - owner_y
        flip = lambda y: y if team == 0 else 32000 - y
        candidates = [
            {'id': 'seed', 'name': 'KingTower', 'x': 9000, 'y': flip(31000), 'lane': 2, 'scalar': seed_scalar},
            {'id': 'a', 'name': 'PrincessTower', 'x': 4000, 'y': flip(26000), 'lane': 0},
            {'id': 'b', 'name': 'PrincessTower', 'x': 14000, 'y': flip(25000), 'lane': 1},
            {'id': 'aux', 'name': 'KingTower', 'x': 9000, 'y': flip(30000), 'lane': aux_lane, 'scalar': aux_scalar},
        ]
        if layout == 'near-same-lane':
            candidates[1]['y'], candidates[2]['y'] = flip(25000), flip(26000)
        elif layout == 'equal-order':
            candidates[2]['y'] = flip(26000)
        elif layout == 'diagonal':
            candidates[1].update(x=9000, y=flip(26000))
        elif layout == 'seed-closer':
            candidates[0].update(x=9000, y=flip(10000))
        elif layout != 'near-other-lane':
            raise RuntimeError('Unknown fallback control layout')
        for candidate in candidates:
            candidate['eligible'] = candidate['id'] != ineligible
        initialize(sources[owner_name], candidates, team, add_radius, None)
        mapped = {row['id']: pointer for pointer, row in active().items()}
        write(body + 0x20, 9000)
        write(body + 0x24, owner_y)
        write(body + 0x8c, lane)
        # Account slots, opaque IDs, world reference and default-body slots are
        # supplied. The native reference/index resolution executes unhooked.
        write(world + 0x1c, account_count)
        reference = heap + 0x7000
        write(body + 0x14, reference)
        write(reference + 0x28, world)
        for index in range(account_count):
            account = heap + 0x7100 + index * 8
            write(account, 100 + index)
            write(account + 4, 200 + index)
            write(world + 0x0c + index * 4, account)
        write(world + 0x50 + 4 * team, body)
        write(world + 0x50 + 4 * (1 - team), mapped['seed'])
        write(world + 0x58, mapped['aux'])
        write(world + 0x5c, mapped['aux'])
        for candidate in candidates:
            pointer = mapped[candidate['id']]
            write(pointer + 0x1c, 1 - team)
            write(pointer + 0x8c, candidate['lane'])
            if candidate['id'] in ['seed', 'aux']:
                scalar = heap + 0xd000 + (0x40 if candidate['id'] == 'aux' else 0)
                write(pointer + 0x38, 4)
                write(pointer + 0x44, scalar)
                write(scalar + 8, candidate['scalar'])
        order = ['a', 'b'][:count]
        if count == 3:
            order.append('aux')  # Synthetic third supplied collection element.
        if reverse:
            order.reverse()
        write(collection, pointers)
        write(collection + 8, len(order))
        for index, name in enumerate(order):
            write(pointers + index * 4, mapped[name])
        write(world + 0x60, collection)
        write(world + 0x64, collection)
        write(world + 0x8c, boundary_field)
        cpu.mem_write(config + 0x2c6, bytes([int(use_lane)]))
        cpu.mem_write(config + 0x2c8, bytes([int(always)]))
        expected, expected_rows, expected_initial = predict((9000, owner_y), candidates, order, lane, use_lane, always, account_count, boundary_field)
        observed, requests, selection = [], [], {}
        result = identity(run(0x25e310, component, instruction_budget=16000))
        if result != expected or observed != expected_rows or selection != expected_initial:
            raise RuntimeError(json.dumps({'owner': owner_name, 'layout': layout, 'count': count,
                'team': team, 'accountCount': account_count, 'actual': [result, observed, selection], 'expected': [expected, expected_rows, expected_initial]}))
        # The actual primary caller sees an empty nearby collection, executes
        # this fallback, applies supplied eligibility and requests the setter.
        direct_rows = observed
        write(broadphase + 8, 0)
        observed, requests, selection = [], [], {}
        run(0x25deb6, component, instruction_budget=16000)
        expected_requests = [] if expected == ineligible else [expected]
        if observed != direct_rows or selection != expected_initial or requests != expected_requests or len(queries()) != 1:
            raise RuntimeError('Native fallback differs through primary caller')
        return {'owner': owner_name, 'teamIndex': team, 'addOwnRadius': add_radius,
                'ownerPoint': {'x': 9000, 'y': owner_y}, 'ownerLane': lane,
                'useLaneId': use_lane, 'alwaysPrincess': always, 'accountSlots': account_count,
                'worldScalar8C': boundary_field, 'layout': layout, 'candidates': candidates,
                'collection': order, **selection, 'result': result, 'scores': direct_rows,
                'setterRequests': requests, 'queryCalls': len(queries())}

    cases, controls = [], []
    for owner in sources:
        for team in [0, 1]:
            for add_radius in [False, True]:
                for use_lane in [False, True]:
                    for always in [False, True]:
                        for reverse in [False, True]:
                            for layout in ['near-other-lane', 'equal-order', 'diagonal']:
                                cases.append(sample(owner, team=team, add_radius=add_radius,
                                    use_lane=use_lane, always=always, reverse=reverse, layout=layout))
    for team in [0, 1]:
        for use_lane in [False, True]:
            for always in [False, True]:
                for count in [0, 1, 2, 3]:
                    for account_count in [2, 4]:
                        for lane in [0, 1, 2]:
                            for reverse in [False, True]:
                                controls.append(sample('Knight', team=team, use_lane=use_lane,
                                    always=always, count=count, account_count=account_count,
                                    lane=lane, reverse=reverse))
        for owner_y in [1499, 1500, 1501, 30499, 30500, 30501]:
            controls.append(sample('Knight', team=team, owner_y=owner_y))
        for account_count in [2, 4]:
            for seed_scalar in [-1, 0, 1000]:
                for aux_scalar in [-1, 0, 1000]:
                    for aux_lane in [0, 1, 2]:
                        controls.append(sample('Knight', team=team, account_count=account_count,
                            seed_scalar=seed_scalar, aux_scalar=aux_scalar, aux_lane=aux_lane,
                            layout='seed-closer'))
        for ineligible in ['seed', 'a', 'b', 'aux']:
            controls.append(sample('Knight', team=team, ineligible=ineligible, count=0 if ineligible == 'seed' else 2))

    # Separately validate the source-unit grid getter and approximate metric.
    numeric = []
    for coordinate in [-1001, -500, -499, -1, 0, 1, 499, 500, 501, 1499, 1500, 30500]:
        write(body + 0x24, coordinate)
        result = run(0x21997c, body)
        if read_signed(result) != int(coordinate / 500):
            raise RuntimeError('Native grid-coordinate getter differs')
        numeric.append({'coordinate': coordinate, 'gridY': read_signed(result)})
    for x, y in [(0, 0), (1, 1), (1000, 0), (1000, 1000), (5000, 18000), (-5000, 18000), (32767, -12345)]:
        result = run(0x35c990, x, y)
        if result != max(abs(x), abs(y)) + min(abs(x), abs(y)) * 53 // 128:
            raise RuntimeError('Native approximate distance differs')
        numeric.append({'dx': x, 'dy': y, 'approximateDistance': result})

    static = [
        ('laneGlobalLoader', 0x1f1cf2, 0x1f1d25, 'LOGIC_DEFAULT_TARGET_USE_LANE_ID loads Globals+0x2c6; archived true.'),
        ('princessGlobalLoader', 0x1f1f05, 0x1f1f38, 'LOGIC_PRINCESS_TOWERS_ALWAYS_AS DEFAULT_TARGET loads Globals+0x2c8; archived true.'),
        ('defaultReference', 0x219be6, 0x219c90, 'Actual account reference resolution chooses the opposite indexed default-body slot from the supplied two-account layout.'),
        ('accountIdGetter', 0x1cd216, 0x1cd264, 'Validates index against world+0x1c and reads a supplied opaque 64-bit account-ID pointer.'),
        ('accountIndexLookup', 0x1c97c0, 0x1c9804, 'Searches supplied account slots by both 32-bit ID halves.'),
        ('defaultBodySlot', 0x1c8a32, 0x1c8a46, 'Reads world+0x50+4*index.'),
        ('summonerCollectionGetter', 0x1cd028, 0x1cd086, 'Validates raw index, masks parity and reads one of two supplied collections at world+0x60.'),
        ('summonerRemovalBinding', 0x1cd086, 0x1cd110, 'Static removal path validates kind5 and IsSummonerTower before removing the body from this collection. Registration is not emulated.'),
        ('worldAccountThreshold', 0x1c8aa2, 0x1c8aba, 'Branches on supplied account slot count>3; no mode name is inferred.'),
        ('expectedSummonerCount', 0x1cacd2, 0x1cacee, 'Returns4 or6 based on supplied account count; fallback divides by2.'),
        ('alternateDefaultSlot', 0x1cae00, 0x1cae4a, 'For at least4 accounts, selects another supplied default-body slot through the raw index map.'),
        ('fallbackSelection', 0x25e310, 0x25e61c, 'Actual seed choice, collection-size gate, approximate metric, lane scoring and partial-list restriction execute.'),
        ('approximateDistance', 0x35c990, 0x35ca60, 'Returnsmax(absdx,absdy)+(53*min(absdx,absdy)>>7); distinct from the initial seed squared distance.'),
        ('gridYGetter', 0x21997c, 0x21999c, 'Truncates body+0x24 divided by500 towardzero.'),
        ('boundaryFieldGetter', 0x1c9576, 0x1c958a, 'Reads the supplied world+0x8c boundary scalar; world-dimension initialization remains outside scope.'),
        ('primaryFallbackCaller', 0x25e28e, 0x25e310, 'With owner movement component absent, primary invokes fallback, supplied eligibility and intercepted setter dispatch.'),
    ]
    blocks = []
    for name, start, end, meaning in static:
        assembly = subprocess.check_output(['objdump', '-d', '-Mintel', f'--start-address={start:#x}', f'--stop-address={end:#x}', str(env['args'].library)], text=True)
        instructions = [re.sub(r'\s+<[^>]+>', '', line.strip()) for line in assembly.splitlines() if re.match(r'\s+[0-9a-f]+:', line)]
        blocks.append({'name': name, 'start': hex(start), 'end': hex(end), 'interpretation': meaning, 'instructions': instructions})
    paths = ['reference/logic/characters.csv', 'reference/logic/buildings.csv', 'reference/logic/globals.csv',
             'reference/client/sight-target-types-native-trace.json']
    output = json.dumps({'source': 'apk/1.8.1/x86/libg.so', 'sha256': env['sha'], 'emulator': 'unicorn==2.1.4',
        'entryPoint': '0x25e310', 'instructionBudget': 16000,
        'inputs': [{'path': path, 'sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest()} for path in paths],
        'sourceFlags': {name: settings[name]['BooleanValue'] == 'TRUE' for name, _address, _offset in source_flags},
        'limits': [
            'Actual default-body/account reference resolution, target predicate, collection-size gates, native integer metrics/lane scoring and primary fallback caller execute on supplied minimal objects.',
            'Opaque account IDs, world/default-body slots, collection membership/order, coordinates, raw lane fields and boundary scalar are supplied. Complete constructors, world registration, spatial indexing, lane assignment and world-dimension initialization do not execute.',
            'The summoner collection is bound by the retained static removal path and source IsSummonerTower getter. The synthetic third aux element is not evidence of natural membership. Account-count branches are numeric controls without inferred game-mode names.',
            'Primary nearby query is controlled empty, owner movement component absent, common eligibility supplied and setter effects intercepted. Nonpositive component scalars are contrived predicate controls, not naturally dead-state simulations.',
            'Thirteen source owners, both raw teams/own-radius settings, both archived flag controls and collection orders execute. Full state-machine, movement and source inheritance parity remain unclaimed.',
        ], 'blocks': blocks, 'cases': cases, 'controls': controls, 'numericControls': numeric}, indent=2) + '\n'
    path = Path('reference/client/distant-target-native-trace.json')
    if env['args'].check:
        if path.read_text() != output:
            raise RuntimeError('Native distant-target capture differs')
    else:
        path.write_text(output)
    print(json.dumps({'cases': len(cases), 'controls': len(controls), 'numericControls': len(numeric), 'blocks': len(blocks)}))
