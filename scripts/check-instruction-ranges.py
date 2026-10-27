"""Compare cold/hot instruction admission with the original range definition."""
import json
import random
from lib.instruction_ranges import InstructionRanges


source = [(10, 20), (20, 23), (16, 28), (25, 22), (30, 30), (-4, -1),
          (0xfffffffe, 0x100000000)]
gate = InstructionRanges(source)
random = random.Random(29129)
checks = 0
for stage in range(12):
    points = {*range(-8, 70), 0xfffffffd, 0xfffffffe, 0xffffffff, 0x100000000}
    for start, end in source:
        points.update([start - 1, start, start + 1, end - 1, end, end + 1])
    points.update(random.randrange(-20, 10000) for _ in range(2048))
    for _ in range(2):
        for address in points:
            expected = any(start <= address < end for start, end in source)
            if gate.allows(address) != expected:
                raise RuntimeError(f"Instruction admission differs: stage {stage}, address {address:#x}")
            checks += 1
    additions = [(random.randrange(0, 10000), random.randrange(0, 10000)) for _ in range(5)]
    # A rejected address must be reconsidered after a later extension.
    next_address = 0x100000 + stage * 100
    if gate.allows(next_address):
        raise RuntimeError("Instruction escaped before its range was added")
    additions.append((next_address, next_address + 1))
    gate.extend(item for item in additions)
    source.extend(additions)
    if not gate.allows(next_address):
        raise RuntimeError("New instruction range was not admitted")
print(json.dumps({"stages": 12, "addressChecks": checks, "ranges": len(source)}))
