# -*- coding: utf-8 -*-
"""终局回看（点空白处看棋型 / 逐手复盘）的界面行为测试。

运行：python tests/test_replay_ui.py
使用 SDL dummy 视频驱动，不弹窗口、不发声。
"""
from __future__ import annotations

import os
import sys
import unittest

os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pygame

from board import Board
from gui import GameState, XiangqiGUI

# 几步合法开局，用于复盘
SAMPLE_MOVES = [((1, 2), (1, 6)), ((1, 9), (2, 7)), ((4, 3), (4, 4)),
                ((4, 6), (4, 5)), ((7, 0), (6, 2)), ((7, 7), (7, 6))]


def _piece_count(board: Board) -> int:
    return sum(1 for c in range(9) for r in range(10) if board.squares[c][r])


class TestReplayUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        pygame.init()

    def setUp(self) -> None:
        state = GameState(board=Board())
        self.gui = XiangqiGUI(state)
        for fr, to in SAMPLE_MOVES:
            state.board.make_move(fr, to)
        state.last_move = state.board.history[-1]
        state.result = "black_win"
        self.gui._reset_result_view()

    def tearDown(self) -> None:
        pygame.quit()

    def test_result_card_shown_by_default(self) -> None:
        self.assertFalse(self.gui.result_panel_hidden)

    def test_click_blank_hides_card_and_shows_final_position(self) -> None:
        self.gui._handle_result_click((296, 500))
        self.assertTrue(self.gui.result_panel_hidden)
        self.assertIsNone(self.gui.replay_ply)          # 默认看终局
        self.gui._draw(0)                                # 绘制不报错
        self.assertEqual(self.gui._active_board.turn, "red")

    def test_click_inside_card_does_not_hide(self) -> None:
        box, _review = self.gui._result_panel_rects()
        self.gui._handle_result_click((box.centerx, box.y + 30))
        self.assertFalse(self.gui.result_panel_hidden)

    def test_review_button_opens_replay(self) -> None:
        _box, review = self.gui._result_panel_rects()
        self.gui._handle_result_click(review.center)
        self.assertTrue(self.gui.result_panel_hidden)

    def test_step_back_and_forth(self) -> None:
        self.gui._open_replay()
        total = len(self.gui.state.board.history)
        rects = self.gui._replay_side_rects()
        self.gui._handle_result_click(rects["prev"].center)
        self.assertEqual(self.gui._replay_current_ply(), total - 1)
        self.gui._draw(0)
        self.assertEqual(_piece_count(self.gui._active_board),
                         _piece_count(Board()))
        self.gui._handle_result_click(rects["next"].center)
        self.assertIsNone(self.gui.replay_ply)           # 回到终局
        # 一直退到开局
        for _ in range(total):
            self.gui._handle_result_click(rects["prev"].center)
        self.assertEqual(self.gui._replay_current_ply(), 0)
        self.gui._draw(0)
        self.assertEqual(_piece_count(self.gui._active_board),
                         _piece_count(Board()))

    def test_keyboard_arrows(self) -> None:
        self.gui._open_replay()
        total = len(self.gui.state.board.history)
        self.assertTrue(self.gui._handle_key(pygame.K_LEFT))
        self.assertEqual(self.gui._replay_current_ply(), total - 1)
        self.assertTrue(self.gui._handle_key(pygame.K_RIGHT))
        self.assertEqual(self.gui._replay_current_ply(), total)
        self.assertTrue(self.gui._handle_key(pygame.K_r))
        self.assertFalse(self.gui.result_panel_hidden)   # R 键切回结果卡

    def test_board_click_returns_to_result(self) -> None:
        self.gui._open_replay()
        self.gui._handle_result_click((296, 500))
        self.assertFalse(self.gui.result_panel_hidden)

    def test_new_game_resets_replay(self) -> None:
        self.gui._open_replay()
        self.gui.new_game()
        self.assertFalse(self.gui.result_panel_hidden)
        self.assertIsNone(self.gui.replay_ply)
        self.assertEqual(self.gui.state.result, "continue")


if __name__ == "__main__":
    unittest.main()
