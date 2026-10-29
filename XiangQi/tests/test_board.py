"""中国象棋核心规则单元测试。"""
from __future__ import annotations

import os
import sys
import unittest

# 允许直接运行：python tests/test_board.py
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from board import Board, INITIAL_LAYOUT
from constants import (
    ADVISOR, BLACK, CANNON, ELEPHANT, GENERAL, HORSE, PAWN, RED, ROOK,
)
from pieces import Piece


class TestInitialLayout(unittest.TestCase):
    def test_piece_count(self):
        b = Board()
        count = sum(1 for c in range(9) for r in range(10) if b.squares[c][r] is not None)
        self.assertEqual(count, 32)

    def test_initial_turn(self):
        self.assertEqual(Board().turn, RED)


class TestGeneralMove(unittest.TestCase):
    def test_general_one_step_orthogonal_in_palace(self):
        b = Board()
        # 帅 (4,0) → (4,1) 应合法
        self.assertIn(((4, 0), (4, 1)), b.legal_moves(RED))

    def test_general_cannot_leave_palace(self):
        b = Board()
        # 帅 (4,0) → (4,3) 出宫应不合法
        self.assertNotIn(((4, 0), (4, 3)), b.legal_moves(RED))

    def test_general_diagonal_illegal(self):
        b = Board()
        self.assertNotIn(((4, 0), (3, 1)), b.legal_moves(RED))

    def test_general_cannot_capture_own(self):
        b = Board()
        # 仕 (3,0) 与帅 (4,0) 相邻（斜），帅不能走 (4,0)→(3,1) 试图吃自己仕
        self.assertNotIn(((4, 0), (3, 1)), b.legal_moves(RED))


class TestAdvisorMove(unittest.TestCase):
    def test_advisor_diagonal_in_palace(self):
        b = Board()
        # 仕 (3,0) → (4,1) 应合法
        self.assertIn(((3, 0), (4, 1)), b.legal_moves(RED))

    def test_advisor_cannot_go_straight(self):
        b = Board()
        self.assertNotIn(((3, 0), (3, 1)), b.legal_moves(RED))

    def test_advisor_cannot_leave_palace(self):
        b = Board()
        self.assertNotIn(((3, 0), (4, 3)), b.legal_moves(RED))


class TestElephantMove(unittest.TestCase):
    def test_elephant_two_diagonal(self):
        b = Board()
        # 相 (2,0) → (4,2) 应合法（象眼 (3,1) 为空）
        self.assertIn(((2, 0), (4, 2)), b.legal_moves(RED))

    def test_elephant_blocked_eye(self):
        b = Board()
        # 占据 (3,1) 后相 (2,0)→(4,2) 应不合法
        b.squares[3][1] = Piece(RED, PAWN)
        self.assertNotIn(((2, 0), (4, 2)), b.legal_moves(RED))

    def test_elephant_cannot_cross_river(self):
        b = Board()
        # 红方相在 row 4 时不能走到 row 6
        b.squares = [[None] * 10 for _ in range(9)]
        b.squares[4][0] = Piece(RED, GENERAL)  # 必须有将/帅，否则 is_in_check 返回 True
        b.squares[2][4] = Piece(RED, ELEPHANT)
        # (2,4) → (4,6) 越过河界，不合法
        self.assertNotIn(((2, 4), (4, 6)), b.legal_moves(RED))
        # 但 (2,4) → (4,2) 是合法的（在己方）
        self.assertIn(((2, 4), (4, 2)), b.legal_moves(RED))
        # 黑方象在 row 5 时不能走到 row 3
        b2 = Board()
        b2.squares = [[None] * 10 for _ in range(9)]
        b2.squares[4][9] = Piece(BLACK, GENERAL)
        b2.squares[2][5] = Piece(BLACK, ELEPHANT)
        self.assertNotIn(((2, 5), (4, 3)), b2.legal_moves(BLACK))
        self.assertIn(((2, 5), (4, 7)), b2.legal_moves(BLACK))


class TestHorseMove(unittest.TestCase):
    def test_horse_basic_L(self):
        b = Board()
        # 马 (1,0) → (2,2) 日字象眼 (1,1) 为空
        self.assertIn(((1, 0), (2, 2)), b.legal_moves(RED))

    def test_horse_leg_blocked(self):
        b = Board()
        # 在 (1,1) 放子阻挡
        b.squares[1][1] = Piece(RED, PAWN)
        # 但红方兵行 (0,3)(2,3) 已有兵，初始 (1,1) 之前为空
        # 走法 (1,0)→(0,2) 蹩腿点 (1,1) 现在有子 → 不合法
        self.assertNotIn(((1, 0), (0, 2)), b.legal_moves(RED))


class TestRookMove(unittest.TestCase):
    def test_rook_straight_unblocked(self):
        b = Board()
        # 车 (0,0) → (0,1) 无阻挡
        self.assertIn(((0, 0), (0, 1)), b.legal_moves(RED))
        # 车 (0,0) → (0,2) 也无阻挡（红炮在 col 1，不在 col 0）
        self.assertIn(((0, 0), (0, 2)), b.legal_moves(RED))
        # 但 (0,0)→(1,0) 不行，(1,0) 是己方马（不能越子也不能吃己方）
        self.assertNotIn(((0, 0), (1, 0)), b.legal_moves(RED))

    def test_rook_blocked_by_piece(self):
        b = Board()
        # 车 (0,0) 列方向：(0,1), (0,2) 空，(0,3) 是己方兵 → 阻挡
        # (0,0) → (0,3) 不合法（被己方兵挡住）
        self.assertNotIn(((0, 0), (0, 3)), b.legal_moves(RED))
        # (0,0) → (0,1) 合法
        self.assertIn(((0, 0), (0, 1)), b.legal_moves(RED))


class TestCannonMove(unittest.TestCase):
    def test_cannon_moves_like_rook(self):
        b = Board()
        # 炮 (1,2) → (1,0) 走子无阻挡（(1,1) 空，(1,0) 是车 → 不能吃，未跨炮架）
        # 先看是否能到 (1,3) — 沿列方向无阻挡
        # 但 (1,2) 是红炮，红炮 (1,2) → (1,0) 不能吃车，因为没有炮架
        self.assertNotIn(((1, 2), (1, 0)), b.legal_moves(RED))
        # 走到 (1,1) 空
        self.assertIn(((1, 2), (1, 1)), b.legal_moves(RED))

    def test_cannon_captures_by_jumping(self):
        b = Board()
        # 红方炮 (1,2) → 黑方马 (1,9)：中间 (1,7) 是黑炮可作炮架
        self.assertIn(((1, 2), (1, 9)), b.legal_moves(RED))
        # 但 (1,2) → (1,7) 不能直接吃（无炮架）
        self.assertNotIn(((1, 2), (1, 7)), b.legal_moves(RED))
        # 走子 (1,2) → (1,3),(1,4),(1,5),(1,6) 都合法（都是空位）
        for to in [(1, 3), (1, 4), (1, 5), (1, 6)]:
            self.assertIn(((1, 2), to), b.legal_moves(RED))


class TestPawnMove(unittest.TestCase):
    def test_pawn_forward_before_river(self):
        b = Board()
        # 红兵 (0,3) → (0,4) 前进
        self.assertIn(((0, 3), (0, 4)), b.legal_moves(RED))
        # 红兵不能横走未过河
        self.assertNotIn(((0, 3), (1, 3)), b.legal_moves(RED))
        # 红兵不能后退
        self.assertNotIn(((0, 3), (0, 2)), b.legal_moves(RED))

    def test_pawn_can_move_sideways_after_river(self):
        b = Board()
        b.squares = [[None] * 10 for _ in range(9)]
        b.squares[4][0] = Piece(RED, GENERAL)  # 必须有将/帅
        b.squares[4][5] = Piece(RED, PAWN)  # 已过河
        # (4,5) → (3,5) 横走
        self.assertIn(((4, 5), (3, 5)), b.legal_moves(RED))
        # 前进
        self.assertIn(((4, 5), (4, 6)), b.legal_moves(RED))
        # 不能后退
        self.assertNotIn(((4, 5), (4, 4)), b.legal_moves(RED))


class TestFlyingGeneral(unittest.TestCase):
    def test_kings_cannot_face(self):
        b = Board()
        b.squares = [[None] * 10 for _ in range(9)]
        b.squares[4][0] = Piece(RED, GENERAL)
        b.squares[4][9] = Piece(BLACK, GENERAL)
        b.turn = RED
        # 红帅不能走 (4,0) → (4,1) 因为中间没有子，依然照面
        legal = b.legal_moves(RED)
        self.assertNotIn(((4, 0), (4, 1)), legal)
        # 放一个子在中间则红帅可以前进
        b.squares[4][5] = Piece(RED, PAWN)
        legal = b.legal_moves(RED)
        self.assertIn(((4, 0), (4, 1)), legal)


class TestCheckAndStalemate(unittest.TestCase):
    def test_check_detection(self):
        b = Board()
        b.squares = [[None] * 10 for _ in range(9)]
        b.squares[4][1] = Piece(RED, GENERAL)
        b.squares[4][8] = Piece(BLACK, GENERAL)
        b.squares[0][5] = Piece(RED, ROOK)
        # 初始状态下红方未被将军
        self.assertFalse(b.is_in_check(RED))
        # 把黑车放在 (4,2)，与红帅同列且中间无子 → 将军
        b.squares[4][2] = Piece(BLACK, ROOK)
        self.assertTrue(b.is_in_check(RED))
        # 黑车走到 (4,1) 吃帅 → 将帅不存在 → game_result 黑胜
        b.make_move((4, 2), (4, 1))
        self.assertEqual(b.game_result(), "black_win")


class TestCaptureAndHistory(unittest.TestCase):
    def test_capture_records_in_history(self):
        b = Board()
        # 红方炮 (1,2) → 黑方炮 (1,7) 吃子
        b.make_move((1, 2), (1, 7))
        self.assertEqual(len(b.history), 1)
        self.assertIsNotNone(b.history[0].captured)
        self.assertEqual(b.history[0].captured.color, BLACK)
        # 目标位置是红炮
        self.assertEqual(b.squares[1][7].color, RED)

    def test_undo(self):
        b = Board()
        b.make_move((1, 2), (1, 7))
        move = b.undo_move()
        self.assertIsNotNone(move)
        # 撤销后黑炮应回到 (1,7)
        p = b.squares[1][7]
        self.assertIsNotNone(p)
        self.assertEqual(p.color, BLACK)
        self.assertEqual(p.kind, CANNON)
        # 红炮回到 (1,2)
        p = b.squares[1][2]
        self.assertIsNotNone(p)
        self.assertEqual(p.color, RED)
        self.assertEqual(p.kind, CANNON)


class TestSerialization(unittest.TestCase):
    def test_round_trip(self):
        b = Board()
        b.make_move((1, 2), (1, 7))  # 红炮吃黑炮
        d = b.to_dict()
        b2 = Board.from_dict(d)
        self.assertEqual(b2.turn, b.turn)
        self.assertEqual(len(b2.history), len(b.history))
        self.assertEqual(b2.history[0].to, (1, 7))
        # 棋盘应一致
        for c in range(9):
            for r in range(10):
                p1 = b.squares[c][r]
                p2 = b2.squares[c][r]
                if p1 is None:
                    self.assertIsNone(p2)
                else:
                    self.assertEqual((p1.color, p1.kind), (p2.color, p2.kind))


if __name__ == "__main__":
    unittest.main()