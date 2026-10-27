"""Monotonically extended native instruction ranges with cached membership.

Only accepted addresses are cached. The immutable range tuple can grow through
extend(), so a cached acceptance remains valid and an earlier rejection can
become accepted after configuration adds a range.
"""


class InstructionRanges:
    def __init__(self, ranges=()):
        self._ranges = tuple(ranges)
        self._accepted = set()

    def extend(self, ranges):
        self._ranges += tuple(ranges)

    def allows(self, address):
        if address in self._accepted:
            return True
        if any(start <= address < end for start, end in self._ranges):
            self._accepted.add(address)
            return True
        return False
