"""Verify the AI no longer hands pieces to the opponent."""
import os
os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")

from board import Board
from constants import CANNON, PAWN, RED, ROOK
from pieces import Piece
from ai import choose_move, evaluate


def build_position() -> Board:
    b = Board()
    for c in range(9):
        for r in range(10):
            p = b.squares[c][r]
            if p is not None and p.color == RED and not (c == 4 and r == 0):
                b.squares[c][r] = None
    b.squares[0][0] = Piece(RED, ROOK)
    b.squares[0][3] = Piece("black", PAWN)
    b.squares[0][5] = Piece("black", CANNON)
    b.turn = RED
    return b


def main() -> int:
    b = build_position()
    print("red rook=%s  black cannon=%s  black pawn=%s" % (
        b.squares[0][0], b.squares[0][5], b.squares[0][3]))

    b_bad = b.clone(); b_bad.make_move((0, 0), (0, 2))
    score_bad = evaluate(b_bad, RED)
    b_safe = b.clone(); b_safe.make_move((0, 0), (0, 4))
    score_safe = evaluate(b_safe, RED)
    print("bad move (0,2) score: %.1f" % score_bad)
    print("safe move (0,4) score: %.1f" % score_safe)
    print("delta: %.1f (positive = AI prefers safe)" % (score_safe - score_bad))
    assert score_safe > score_bad

    score_start = evaluate(b, RED)
    print("start pos score: %.1f (negative = hanging rook detected)" % score_start)
    assert score_start < 0

    mv = choose_move(b, depth=3, time_limit_sec=1.5)
    print("AI recommends: %s" % (mv,))
    assert mv is not None
    fr, to = mv

    # Verify the move is NOT a feed:
    # - must not leave the rook on (0,2) (still attacked by cannon via platform)
    # - OR if it captures the platform pawn at (0,3), that's brilliant defense
    if to == (0, 2):
        print("FAIL: AI still moved rook to (0,2)")
        return 1
    print("OK: AI did not feed the rook")

    # If the AI moved to (0,3), verify the cannon can no longer capture it
    after = b.clone()
    after.make_move(fr, to)
    legal_black = after.legal_moves("black")
    if (0, 5) in {to_pos: None for (_, to_pos) in []}:  # placeholder, unused
        pass
    if any(_from == (0, 5) and to_pos == to for (_from, to_pos) in legal_black):
        # cannon can still attack this square
        print("FAIL: cannon at (0,5) can still capture AI's destination %s" % (to,))
        return 1
    print("OK: cannon cannot immediately capture AI's destination")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
