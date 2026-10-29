"""棋子类定义。"""
from __future__ import annotations

from dataclasses import dataclass

from constants import (
    ADVISOR,
    BLACK,
    CANNON,
    ELEPHANT,
    GENERAL,
    HORSE,
    PAWN,
    PIECE_NAMES_CN,
    RED,
    ROOK,
)


@dataclass(frozen=True)
class Piece:
    """一枚棋子。

    Attributes:
        color: ``constants.RED`` 或 ``constants.BLACK``
        kind:  棋子类型字母 (G/A/E/H/R/C/P)
    """

    color: str
    kind: str

    def __post_init__(self) -> None:
        if self.color not in (RED, BLACK):
            raise ValueError(f"Invalid color: {self.color}")
        if self.kind not in (GENERAL, ADVISOR, ELEPHANT, HORSE, ROOK, CANNON, PAWN):
            raise ValueError(f"Invalid kind: {self.kind}")

    @property
    def name_cn(self) -> str:
        """该棋子的中文显示名（如『帅』、『将』、『马』）。"""
        return PIECE_NAMES_CN[(self.color, self.kind)]

    def __str__(self) -> str:  # pragma: no cover - 仅调试
        return f"{self.name_cn}({self.color[0].upper()})"