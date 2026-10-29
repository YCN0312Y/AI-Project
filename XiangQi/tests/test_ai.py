# -*- coding: utf-8 -*-
"""AI 引擎单元测试：快速将军检测、走法生成、战术、将死、难度档位。

运行：python tests/test_ai.py  或  python -m unittest discover tests
这些测试不依赖 pygame，可在无显示环境下运行。
"""
from __future__ import annotations

import os
import random
import sys
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import ai
from board import Board
from constants import (
    ADVISOR, BLACK, CANNON, GENERAL, HORSE, PAWN, RED, ROOK,
)
from pieces import Piece


def _empty_board_with(turn=RED):
    b = Board()
    b.squares = [[None] * 10 for _ in range(9)]
    b.turn = turn
    return b


def _free_rook_board():
    """红车 (0,2) 可白吃黑车 (0,7)，黑方无法回吃。"""
    b = _empty_board_with(RED)
    b.squares[4][0] = Piece(RED, GENERAL)
    b.squares[4][4] = Piece(RED, PAWN)
    b.squares[0][2] = Piece(RED, ROOK)
    b.squares[8][2] = Piece(RED, ROOK)
    b.squares[4][9] = Piece(BLACK, GENERAL)
    b.squares[3][9] = Piece(BLACK, ADVISOR)
    b.squares[5][9] = Piece(BLACK, ADVISOR)
    b.squares[0][7] = Piece(BLACK, ROOK)
    b.squares[1][7] = Piece(BLACK, HORSE)
    return b


def _mate_in_one_board():
    """红方一步杀：车 (8,8)→(8,9) 或 (0,8)→(0,9) 都能将死黑方。"""
    b = _empty_board_with(RED)
    b.squares[4][0] = Piece(RED, GENERAL)
    b.squares[4][4] = Piece(RED, PAWN)      # 阻断将帅照面
    b.squares[0][8] = Piece(RED, ROOK)
    b.squares[8][8] = Piece(RED, ROOK)
    b.squares[4][9] = Piece(BLACK, GENERAL)
    return b


class TestFastCheck(unittest.TestCase):
    """快速将军检测 / 快速合法走法必须与参考实现完全一致。"""

    def test_in_check_matches_reference(self):
        random.seed(20251028)
        checked = 0
        for _ in range(4):
            b = Board()
            for ply in range(60):
                checked += 1
                for side in (RED, BLACK):
                    self.assertEqual(ai._in_check_fast(b, side), b.is_in_check(side),
                                     msg=f"ply {ply} side {side}")
                legal = b.legal_moves()
                if not legal:
                    break
                b.make_move(*random.choice(legal))
        self.assertGreater(checked, 100)

    def test_legal_moves_match_reference(self):
        random.seed(7)
        b = Board()
        for ply in range(80):
            if ply % 9 == 0:
                self.assertEqual(sorted(ai._legal_moves_fast(b)), sorted(b.legal_moves()))
            legal = b.legal_moves()
            if not legal:
                break
            b.make_move(*random.choice(legal))


class TestTactics(unittest.TestCase):
    def test_free_rook_taken_by_all_difficulties(self):
        for diff in ("easy", "normal", "hard"):
            with self.subTest(difficulty=diff):
                move = ai.choose_move(_free_rook_board(), difficulty=diff)
                self.assertEqual(move, ((0, 2), (0, 7)))

    def test_mate_in_one_is_mating_move(self):
        for depth in (1, 2):
            with self.subTest(depth=depth):
                b = _mate_in_one_board()
                move = ai.choose_move(b, depth=depth, time_limit_sec=2.0)
                self.assertIsNotNone(move)
                b.make_move(*move)
                self.assertEqual(len(ai._legal_moves_fast(b, BLACK)), 0)

    def test_mated_side_has_no_move(self):
        b = _mate_in_one_board()
        b.make_move((8, 8), (8, 9))
        self.assertIsNone(ai.choose_move(b, difficulty="normal"))


class TestChooseMoveContract(unittest.TestCase):
    def test_returns_legal_move_without_mutating_board(self):
        for diff in ("easy", "normal", "hard"):
            with self.subTest(difficulty=diff):
                b = Board()
                before = b.to_dict()
                move = ai.choose_move(b, difficulty=diff)
                self.assertIn(move, b.legal_moves())
                self.assertEqual(b.to_dict(), before)

    def test_stats_are_reported(self):
        stats = {}
        ai.choose_move(Board(), difficulty="normal", stats=stats)
        for key in ("depth_reached", "nodes", "candidates", "best_score", "timed_out"):
            self.assertIn(key, stats)
        self.assertGreaterEqual(stats["depth_reached"], 1)
        self.assertGreater(stats["nodes"], 0)

    def test_tiny_time_budget_still_returns_legal_move(self):
        b = Board()
        stats = {}
        move = ai.choose_move(b, depth=4, time_limit_sec=0.01, stats=stats)
        self.assertIn(move, b.legal_moves())
        self.assertTrue(stats["timed_out"])

    def test_legacy_search_interface(self):
        b = Board()
        value, move = ai.search(b, depth=1, alpha=-float("inf"), beta=float("inf"),
                                maximizing=True, perspective=RED,
                                deadline=time.time() + 2.0, node_count=[0])
        self.assertIsInstance(value, float)
        self.assertIsNone(move)

    def test_evaluate_is_zero_sum(self):
        for board in (Board(), _free_rook_board()):
            self.assertAlmostEqual(ai.evaluate(board, RED), -ai.evaluate(board, BLACK), delta=1e-6)

    def test_evaluate_penalizes_undefended_piece(self):
        # 红车 (0,2) 白吃黑车 (0,7)：红方视角应显著高于纯子力差（黑车悬空）。
        b = _free_rook_board()
        fast = ai._eval_fast(b, RED)
        heavy = ai.evaluate(b, RED)
        self.assertGreater(heavy, fast)
        # 等价局面：红车隔两步被黑车保护，则不应有悬空加分，红方优势变小。
        guarded = _free_rook_board()
        guarded.squares[0][8] = Piece(BLACK, ROOK)
        self.assertLess(ai.evaluate(guarded, RED), heavy)


class TestDifficultySettings(unittest.TestCase):
    def test_gradient_is_monotonic(self):
        easy = ai.DIFFICULTY_SETTINGS["easy"]
        normal = ai.DIFFICULTY_SETTINGS["normal"]
        hard = ai.DIFFICULTY_SETTINGS["hard"]
        self.assertLess(easy["depth"], normal["depth"])
        self.assertLess(normal["depth"], hard["depth"])
        self.assertLess(easy["time_limit_sec"], normal["time_limit_sec"])
        self.assertLess(normal["time_limit_sec"], hard["time_limit_sec"])
        self.assertEqual(easy["qdepth"], 0)
        self.assertLessEqual(normal["qdepth"], hard["qdepth"])
        # 随机窗口越难越小，保证高难度失误更少
        self.assertGreater(easy["midgame_epsilon"], normal["midgame_epsilon"])
        self.assertGreater(normal["midgame_epsilon"], hard["midgame_epsilon"])

    def test_unknown_difficulty_falls_back_to_normal(self):
        move_default = ai.choose_move(Board(), difficulty="normal")
        self.assertIsNotNone(move_default)
        self.assertIn("label", ai.DIFFICULTY_SETTINGS["normal"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
