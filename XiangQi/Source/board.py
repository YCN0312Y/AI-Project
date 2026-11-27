"""棋盘状态、走法生成、合法性检查、胜负判定。

坐标系统：
    (col, row)，col ∈ [0,8]，row ∈ [0,9]
    红方在下方 (row 0-4)，黑方在上方 (row 5-9)
    河界在 row 4 与 row 5 之间
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from typing import Iterable, List, Optional, Tuple

from constants import (
    ADVISOR,
    BLACK,
    CANNON,
    ELEPHANT,
    GENERAL,
    HORSE,
    PAWN,
    RED,
    ROOK,
)
from pieces import Piece

Coord = Tuple[int, int]


# --- 初始布局 ---
# row 9 (黑方底线), row 6 (黑方兵行), row 0 (红方底线), row 3 (红方兵行)
INITIAL_LAYOUT: dict[Coord, Piece] = {
    # 黑方（上方）
    (0, 9): Piece(BLACK, ROOK), (1, 9): Piece(BLACK, HORSE), (2, 9): Piece(BLACK, ELEPHANT),
    (3, 9): Piece(BLACK, ADVISOR), (4, 9): Piece(BLACK, GENERAL),
    (5, 9): Piece(BLACK, ADVISOR), (6, 9): Piece(BLACK, ELEPHANT),
    (7, 9): Piece(BLACK, HORSE), (8, 9): Piece(BLACK, ROOK),
    (1, 7): Piece(BLACK, CANNON), (7, 7): Piece(BLACK, CANNON),
    (0, 6): Piece(BLACK, PAWN), (2, 6): Piece(BLACK, PAWN), (4, 6): Piece(BLACK, PAWN),
    (6, 6): Piece(BLACK, PAWN), (8, 6): Piece(BLACK, PAWN),
    # 红方（下方）
    (0, 0): Piece(RED, ROOK), (1, 0): Piece(RED, HORSE), (2, 0): Piece(RED, ELEPHANT),
    (3, 0): Piece(RED, ADVISOR), (4, 0): Piece(RED, GENERAL),
    (5, 0): Piece(RED, ADVISOR), (6, 0): Piece(RED, ELEPHANT),
    (7, 0): Piece(RED, HORSE), (8, 0): Piece(RED, ROOK),
    (1, 2): Piece(RED, CANNON), (7, 2): Piece(RED, CANNON),
    (0, 3): Piece(RED, PAWN), (2, 3): Piece(RED, PAWN), (4, 3): Piece(RED, PAWN),
    (6, 3): Piece(RED, PAWN), (8, 3): Piece(RED, PAWN),
}


def in_board(c: int, r: int) -> bool:
    return 0 <= c <= 8 and 0 <= r <= 9


def in_palace(color: str, c: int, r: int) -> bool:
    if not (3 <= c <= 5):
        return False
    if color == RED:
        return 0 <= r <= 2
    return 7 <= r <= 9


def same_side(row: int) -> str:
    """根据行号判断属于哪一方辖区（红方 row 0-4，黑方 row 5-9）。"""
    return RED if row <= 4 else BLACK


# --- 走法记录 ---
@dataclass
class Move:
    fr: Coord
    to: Coord
    piece: Piece
    captured: Optional[Piece] = None

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.piece.name_cn}({self.fr[0]},{self.fr[1]})→({self.to[0]},{self.to[1]})"


class Board:
    """中国象棋棋盘。负责维护状态与规则。"""

    def __init__(self) -> None:
        self.squares: List[List[Optional[Piece]]] = [[None] * 10 for _ in range(9)]
        for (c, r), p in INITIAL_LAYOUT.items():
            self.squares[c][r] = p
        self.turn: str = RED
        self.history: List[Move] = []

    # ---------- 基础查询 ----------
    def get(self, c: int, r: int) -> Optional[Piece]:
        if not in_board(c, r):
            return None
        return self.squares[c][r]

    def find_general(self, color: str) -> Optional[Coord]:
        """查找指定方将/帅的位置。"""
        for c in range(9):
            for r in range(10):
                p = self.squares[c][r]
                if p and p.color == color and p.kind == GENERAL:
                    return (c, r)
        return None

    def is_own(self, c: int, r: int, color: str) -> bool:
        p = self.get(c, r)
        return p is not None and p.color == color

    def is_empty(self, c: int, r: int) -> bool:
        return self.get(c, r) is None

    def kings_face_each_other(self) -> bool:
        """将帅照面：同列中间无任何棋子。"""
        rg = self.find_general(RED)
        bg = self.find_general(BLACK)
        if rg is None or bg is None:
            return False
        if rg[0] != bg[0]:
            return False
        c = rg[0]
        r1, r2 = rg[1], bg[1]
        lo, hi = sorted((r1, r2))
        return all(self.squares[c][r] is None for r in range(lo + 1, hi))

    # ---------- 走法生成（按棋子类型） ----------
    def _gen_moves_for(self, c: int, r: int) -> Iterable[Coord]:
        """返回某位置棋子所有『结构上合法』的落点（不考虑将帅照面后的自家被将）。"""
        p = self.squares[c][r]
        if p is None:
            return []
        kind = p.kind
        color = p.color
        moves: List[Coord] = []

        if kind == GENERAL:
            for dc, dr in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                nc, nr = c + dc, r + dr
                if in_palace(color, nc, nr) and not self.is_own(nc, nr, color):
                    moves.append((nc, nr))

        elif kind == ADVISOR:
            for dc, dr in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
                nc, nr = c + dc, r + dr
                if in_palace(color, nc, nr) and not self.is_own(nc, nr, color):
                    moves.append((nc, nr))

        elif kind == ELEPHANT:
            for dc, dr in ((2, 2), (2, -2), (-2, 2), (-2, -2)):
                nc, nr = c + dc, r + dr
                if not in_board(nc, nr):
                    continue
                if color == RED and nr > 4:
                    continue
                if color == BLACK and nr < 5:
                    continue
                eye_c, eye_r = c + dc // 2, r + dr // 2
                if self.is_empty(eye_c, eye_r) and not self.is_own(nc, nr, color):
                    moves.append((nc, nr))

        elif kind == HORSE:
            # 8 个日字位置 + 蹩马腿
            offsets = [
                ((2, 1), (1, 0)), ((2, -1), (1, 0)),
                ((-2, 1), (-1, 0)), ((-2, -1), (-1, 0)),
                ((1, 2), (0, 1)), ((-1, 2), (0, 1)),
                ((1, -2), (0, -1)), ((-1, -2), (0, -1)),
            ]
            for (dc, dr), (lc, lr) in offsets:
                nc, nr = c + dc, r + dr
                if not in_board(nc, nr):
                    continue
                if self.is_empty(c + lc, r + lr) and not self.is_own(nc, nr, color):
                    moves.append((nc, nr))

        elif kind == ROOK:
            for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nc, nr = c + dc, r + dr
                while in_board(nc, nr):
                    if self.is_empty(nc, nr):
                        moves.append((nc, nr))
                    else:
                        if not self.is_own(nc, nr, color):
                            moves.append((nc, nr))
                        break
                    nc += dc
                    nr += dr

        elif kind == CANNON:
            for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nc, nr = c + dc, r + dr
                # 走子：先走到第一个空位
                while in_board(nc, nr) and self.is_empty(nc, nr):
                    moves.append((nc, nr))
                    nc += dc
                    nr += dr
                # 越过炮架：再走到第一个非空位
                if in_board(nc, nr):
                    nc += dc
                    nr += dr
                    while in_board(nc, nr):
                        if self.is_empty(nc, nr):
                            pass
                        else:
                            if not self.is_own(nc, nr, color):
                                moves.append((nc, nr))
                            break
                        nc += dc
                        nr += dr

        elif kind == PAWN:
            forward = 1 if color == RED else -1
            # 前进
            nc, nr = c, r + forward
            if in_board(nc, nr) and not self.is_own(nc, nr, color):
                moves.append((nc, nr))
            # 过河后横走
            crossed = (color == RED and r >= 5) or (color == BLACK and r <= 4)
            if crossed:
                for dc in (1, -1):
                    nc2, nr2 = c + dc, r
                    if in_board(nc2, nr2) and not self.is_own(nc2, nr2, color):
                        moves.append((nc2, nr2))

        return moves

    def pseudo_legal_moves(self, color: Optional[str] = None) -> List[Tuple[Coord, Coord]]:
        """返回某方所有『结构上合法』的走法，不过滤『送将』走法。"""
        color = color or self.turn
        result: List[Tuple[Coord, Coord]] = []
        for c in range(9):
            for r in range(10):
                p = self.squares[c][r]
                if p and p.color == color:
                    for to in self._gen_moves_for(c, r):
                        result.append(((c, r), to))
        return result

    # ---------- 走子 / 撤销 ----------
    def make_move(self, fr: Coord, to: Coord) -> Move:
        """执行一步走子，存入历史。返回 Move 记录。"""
        piece = self.squares[fr[0]][fr[1]]
        assert piece is not None, "no piece at fr"
        captured = self.squares[to[0]][to[1]]
        self.squares[to[0]][to[1]] = piece
        self.squares[fr[0]][fr[1]] = None
        move = Move(fr=fr, to=to, piece=piece, captured=captured)
        self.history.append(move)
        self.turn = BLACK if self.turn == RED else RED
        return move

    def undo_move(self) -> Optional[Move]:
        """撤销最后一步走子。"""
        if not self.history:
            return None
        move = self.history.pop()
        self.squares[move.fr[0]][move.fr[1]] = move.piece
        self.squares[move.to[0]][move.to[1]] = move.captured
        self.turn = BLACK if self.turn == RED else RED
        return move

    # ---------- 将军 / 合法走法 / 胜负 ----------
    def is_in_check(self, color: str) -> bool:
        """指定方当前是否被将军（被对方任何棋子攻击到将/帅位置）。"""
        gen = self.find_general(color)
        if gen is None:
            return True  # 将帅已被吃 → 等价被将
        for c in range(9):
            for r in range(10):
                p = self.squares[c][r]
                if p and p.color != color:
                    if gen in self._gen_moves_for(c, r):
                        return True
        return False

    def legal_moves(self, color: Optional[str] = None) -> List[Tuple[Coord, Coord]]:
        """过滤掉所有『走完后己方被将军或照面』的走法，返回真正合法走法。"""
        color = color or self.turn
        result: List[Tuple[Coord, Coord]] = []
        for fr, to in self.pseudo_legal_moves(color):
            move = self.make_move(fr, to)
            ok = (not self.is_in_check(color)) and (not self.kings_face_each_other())
            self.undo_move()
            if ok:
                result.append((fr, to))
        return result

    def has_legal_move(self, color: Optional[str] = None) -> bool:
        return bool(self.legal_moves(color))

    def game_result(self, color: Optional[str] = None) -> str:
        """判定当前局面结果。

        Returns:
            'continue' / 'red_win' / 'black_win' / 'stalemate_red' / 'stalemate_black'
        """
        # 将帅被吃：立即胜负
        if self.find_general(RED) is None:
            return "black_win"
        if self.find_general(BLACK) is None:
            return "red_win"

        color = color or self.turn
        in_check = self.is_in_check(color)
        has_move = self.has_legal_move(color)
        if not has_move:
            if in_check:
                # 将死
                return "black_win" if color == RED else "red_win"
            # 困毙 → 当前方判负
            return "black_win" if color == RED else "red_win"
        return "continue"

    # ---------- 克隆 / FEN 风格序列化 ----------
    def clone(self) -> "Board":
        new = Board.__new__(Board)
        new.squares = deepcopy(self.squares)
        new.turn = self.turn
        new.history = list(self.history)
        return new

    def to_dict(self) -> dict:
        """将棋盘序列化为可 JSON 化的字典。"""
        pieces_data: List[dict] = []
        for c in range(9):
            for r in range(10):
                p = self.squares[c][r]
                if p:
                    pieces_data.append({"c": c, "r": r, "color": p.color, "kind": p.kind})
        history_data = [
            {
                "fr": list(m.fr),
                "to": list(m.to),
                "piece": {"color": m.piece.color, "kind": m.piece.kind},
                "captured": ({"color": m.captured.color, "kind": m.captured.kind}
                             if m.captured else None),
            }
            for m in self.history
        ]
        return {
            "pieces": pieces_data,
            "turn": self.turn,
            "history": history_data,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Board":
        b = cls.__new__(cls)
        b.squares = [[None] * 10 for _ in range(9)]
        for item in data["pieces"]:
            b.squares[item["c"]][item["r"]] = Piece(item["color"], item["kind"])
        b.turn = data["turn"]
        b.history = []
        for m in data.get("history", []):
            piece = Piece(m["piece"]["color"], m["piece"]["kind"])
            captured = (Piece(m["captured"]["color"], m["captured"]["kind"])
                        if m["captured"] else None)
            b.history.append(Move(fr=tuple(m["fr"]), to=tuple(m["to"]),
                                  piece=piece, captured=captured))
        return b