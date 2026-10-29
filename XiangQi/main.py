"""中国象棋 — 程序入口。"""
from __future__ import annotations

import sys

from board import Board
from gui import GameState, XiangqiGUI


def main() -> int:
    state = GameState(board=Board())
    gui = XiangqiGUI(state)
    gui.run_menu_then_game()
    return 0


if __name__ == "__main__":
    sys.exit(main())