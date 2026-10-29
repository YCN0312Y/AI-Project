"""AI：迭代加深 Alpha-Beta + 快速将军检测 + 吃子静态搜索 + 难度分档。

设计要点
--------
* **迭代加深**：按深度 1、2、3… 逐层搜索。每层都完整评完所有根走法才采用；
  搜索中途超时则丢弃这一层的半成品，退回上一层完整结果。
  这样时间用完时 AI 手里始终握着一个“搜完了的”最佳走法，
  而不会像旧实现那样把被截断的静态评估当成搜索分、从而挑到随机弱着。
* **快速将军检测**：只扫描九宫内将/帅位置的四条射线、马腿、兵邻格，
  不遍历 90 格、也不为每个敌子生成走法表，比 board.is_in_check 快一到两个数量级。
* **根节点完整枚举**：内部节点用「伪合法走法 + 落子后检查己方是否被将」过滤，
  避免比 board.legal_moves() 的重复生成。
* **静态搜索（quiescence）**：叶节点继续展开吃子，消除“地平线效应”
  （例如深度用完时看不到对方下一步的吃子）。
* **难度分档**：不同档位在搜索深度、思考时间、静态搜索深度、
  以及“分数接近的走法随机挑选窗口”上都有区别，见 DIFFICULTY_SETTINGS。
"""
from __future__ import annotations

import random
import time
from typing import Dict, List, Optional, Tuple

from board import Board, Coord
from constants import (
    BLACK,
    CANNON,
    GENERAL,
    HORSE,
    PAWN,
    PIECE_VALUES,
    RED,
    ROOK,
)
from pieces import Piece  # noqa: F401  - 兼容旧的导入习惯

# --- 棋子位置加成（行优先，越靠中心或前进位置越优）---
# 9 列 × 10 行；red 视角 row 0 是底线
PAWN_POSITION_BONUS_RED = [
    # 红方未过河奖励小，过河后奖励大；冲到黑方底线（row 9）最具威胁
    [  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [ 10, 18, 22, 35, 40, 35, 22, 18, 10],
    [ 10, 27, 30, 40, 42, 40, 30, 27, 10],
    [ 20, 30, 45, 55, 55, 55, 45, 30, 20],
    [ 20, 30, 50, 65, 70, 65, 50, 30, 20],
    [ 25, 40, 60, 85, 95, 85, 60, 40, 25],
]
# 黑方视角：row 9 在前，向下 row 减小（黑方的“前进”是 row-1）
PAWN_POSITION_BONUS_BLACK = PAWN_POSITION_BONUS_RED[::-1]

# 马位置加成（鼓励马往中心走）
HORSE_POSITION_BONUS = [
    [ -5,  0,  0,  0,  0,  0,  0,  0, -5],
    [ -5,  0,  3,  8, 12,  8,  3,  0, -5],
    [ -5,  5, 10, 15, 18, 15, 10,  5, -5],
    [ -5,  5, 10, 18, 22, 18, 10,  5, -5],
    [ -5,  5, 10, 18, 22, 18, 10,  5, -5],
    [ -5,  5, 10, 18, 22, 18, 10,  5, -5],
    [ -5,  5, 10, 15, 18, 15, 10,  5, -5],
    [ -5,  0,  3,  8, 12,  8,  3,  0, -5],
    [ -5,  0,  0,  0,  0,  0,  0,  0, -5],
    [ -5,  0,  0,  0,  0,  0,  0,  0, -5],
]

INF = float("inf")
MATE_SCORE = 100000.0        # 将死/困毙的基准分（离根越近分越高）
TIMEOUT_CHECK_MASK = 127     # 每 128 个节点检查一次时间


# =========================================================================
# 快速将军检测
# =========================================================================
def _find_general_fast(board: Board, color: str) -> Optional[Coord]:
    """将/帅只可能在九宫的 9 个格子里，直接扫描九宫。"""
    sq = board.squares
    rows = (0, 1, 2) if color == RED else (7, 8, 9)
    for c in (3, 4, 5):
        col = sq[c]
        for r in rows:
            p = col[r]
            if p is not None and p.color == color and p.kind == GENERAL:
                return (c, r)
    return None


# 直线方向：右、左、上、下
_LINES = ((1, 0), (-1, 0), (0, 1), (0, -1))
# 马吃将/帅的 8 种「马的位置相对将/帅」的关系：(马位置偏移, 马腿相对马的位置)
_HORSE_ATTACK_OFFSETS = (
    ((2, 1), (1, 0)), ((2, -1), (1, 0)),
    ((-2, 1), (-1, 0)), ((-2, -1), (-1, 0)),
    ((1, 2), (0, 1)), ((-1, 2), (0, 1)),
    ((1, -2), (0, -1)), ((-1, -2), (0, -1)),
)


def _in_check_fast(board: Board, color: str) -> bool:
    """color 方的将/帅当前是否被将军（等价 board.is_in_check，但快得多）。

    只检查能攻击到九宫内将/帅的棋子：车、炮、对方将/帅（照面）、马、兵/卒。
    士与象永远够不到对方九宫，无需检查。
    """
    gen = _find_general_fast(board, color)
    if gen is None:
        return True
    c, r = gen
    sq = board.squares
    enemy = BLACK if color == RED else RED

    # --- 车 / 炮 / 将帅照面：沿四条直线向外走 ---
    for dc, dr in _LINES:
        nc = c + dc
        nr = r + dr
        first_seen = False
        while 0 <= nc <= 8 and 0 <= nr <= 9:
            p = sq[nc][nr]
            if p is not None:
                if not first_seen:
                    if p.color == enemy:
                        if p.kind == ROOK:
                            return True
                        # 照面只可能发生在同一列的将帅之间
                        if p.kind == GENERAL and dc == 0:
                            return True
                    first_seen = True
                else:
                    # 第二个挡子：若是敌炮，则它隔着第一个挡子正好打到将/帅
                    if p.color == enemy and p.kind == CANNON:
                        return True
                    break
            nc += dc
            nr += dr

    # --- 马 ---
    for (dc, dr), (lc, lr) in _HORSE_ATTACK_OFFSETS:
        hc = c + dc
        hr = r + dr
        if 0 <= hc <= 8 and 0 <= hr <= 9:
            p = sq[hc][hr]
            if p is not None and p.color == enemy and p.kind == HORSE:
                # 马腿：从马的位置朝将/帅方向的第一步
                leg_c = hc - lc
                leg_r = hr - lr
                if sq[leg_c][leg_r] is None:
                    return True

    # --- 兵 / 卒 ---
    forward = 1 if enemy == RED else -1     # 敌兵前进方向
    pr = r - forward
    if 0 <= pr <= 9:
        p = sq[c][pr]
        if p is not None and p.color == enemy and p.kind == PAWN:
            return True
    for dc in (-1, 1):
        pc = c + dc
        if 0 <= pc <= 8:
            p = sq[pc][r]
            if p is not None and p.color == enemy and p.kind == PAWN:
                # 只有过河的兵/卒才能横吃
                if (p.color == RED and r >= 5) or (p.color == BLACK and r <= 4):
                    return True

    return False


# =========================================================================
# 评估函数
# =========================================================================
def _build_attack_map(board: Board, by_color: str) -> set:
    """返回 by_color 方所有棋子攻击到的格子集合（含吃子目标，不含自家子）。"""
    attacked = set()
    for c in range(9):
        for r in range(10):
            p = board.squares[c][r]
            if p is None or p.color != by_color:
                continue
            for to in board._gen_moves_for(c, r):
                attacked.add(to)
    return attacked


def _eval_fast(board: Board, perspective: str) -> float:
    """快速静态评估：子力 + 兵/马位置分 + 被将军惩罚。"""
    score = 0.0
    sq = board.squares
    pawn_red = PAWN_POSITION_BONUS_RED
    pawn_black = PAWN_POSITION_BONUS_BLACK
    horse_bonus = HORSE_POSITION_BONUS
    values = PIECE_VALUES
    for c in range(9):
        col = sq[c]
        for r in range(10):
            p = col[r]
            if p is None:
                continue
            kind = p.kind
            v = values[kind]
            if kind == PAWN:
                v += (pawn_red[r][c] if p.color == RED else pawn_black[r][c])
            elif kind == HORSE:
                v += horse_bonus[r][c]
            if p.color == perspective:
                score += v
            else:
                score -= v
    if _in_check_fast(board, perspective):
        score -= 80.0
    return score


def _is_defended(board: Board, c: int, r: int, color: str) -> bool:
    """判断 (c, r) 上的 color 方棋子是否受己方其它棋子保护。

    ``_gen_moves_for`` 返回的是“落点”（不含自家子占据的格子），因此不能直接
    用来判断保护关系；这里临时把该子移开，再看己方是否有走法能落到原格。
    """
    piece = board.squares[c][r]
    if piece is None or piece.color != color:
        return False
    board.squares[c][r] = None
    try:
        for cc in range(9):
            col = board.squares[cc]
            for rr in range(10):
                q = col[rr]
                if q is None or q.color != color:
                    continue
                if (c, r) in board._gen_moves_for(cc, rr):
                    return True
        return False
    finally:
        board.squares[c][r] = piece


def evaluate(board: Board, perspective: str) -> float:
    """从 perspective 视角的局面对势（正数对 perspective 有利）。

    考虑：子力价值、位置奖励（兵、马）、棋子安全性（悬空子扣分）、是否被将军。
    这是给外部调用/调试用的“重”评估；搜索内部用 _eval_fast 以保证速度。

    注意：对“己方被攻击”的判定用对方的攻击图，对“对方被攻击”的判定用己方的
    攻击图——两者不可混用，否则高估自己/低估对方，函数也不再零和。
    """
    score = _eval_fast(board, perspective)

    enemy = BLACK if perspective == RED else RED
    # 棋子安全：被对方攻击且无己方保护 → 视为“悬空”（hang），对方可白吃。
    enemy_attacks = _build_attack_map(board, enemy)
    self_attacks = _build_attack_map(board, perspective)
    for c in range(9):
        for r in range(10):
            p = board.squares[c][r]
            if p is None or p.kind == GENERAL:
                continue
            if p.color == perspective:
                if (c, r) in enemy_attacks and not _is_defended(board, c, r, perspective):
                    score -= PIECE_VALUES[p.kind] * 0.6
            else:
                if (c, r) in self_attacks and not _is_defended(board, c, r, enemy):
                    score += PIECE_VALUES[p.kind] * 0.6

    return score


def _eval_side_to_move(board: Board) -> float:
    """以当前行棋方为视角的快速评估（negamax 叶节点用）。"""
    return _eval_fast(board, board.turn)


# =========================================================================
# 走法排序
# =========================================================================
def _move_score(board: Board, fr: Coord, to: Coord, perspective: str = "") -> int:
    """走法排序启发：先吃高价值子，MVV-LVA 风格（保留旧接口签名）。"""
    piece = board.squares[fr[0]][fr[1]]
    target = board.squares[to[0]][to[1]]
    if target is None:
        return 0
    return PIECE_VALUES[target.kind] - (PIECE_VALUES[piece.kind] // 10)


def _mvv_lva(board: Board, fr: Coord, to: Coord) -> int:
    """排序键：吃子优先，被吃子价值高优先，用小子吃大子优先。"""
    target = board.squares[to[0]][to[1]]
    if target is None:
        return 0
    piece = board.squares[fr[0]][fr[1]]
    return PIECE_VALUES[target.kind] * 16 - PIECE_VALUES[piece.kind]


def _new_search_ctx() -> dict:
    """一次搜索的共享状态：killer 走法（每层两个）+ 历史启发表."""
    return {
        "killers": [(None, None) for _ in range(64)],
        "history": {},
    }


def _order_moves(board: Board, moves, ply: int, ctx: dict) -> List[Tuple[Coord, Coord]]:
    """走法排序：吃子(MVV-LVA) > killer > 历史启发 > 其余。"""
    killers = ctx["killers"]
    k0, k1 = killers[ply] if ply < len(killers) else (None, None)
    history = ctx["history"]
    scored = []
    for m in moves:
        if board.squares[m[1][0]][m[1][1]] is not None:
            key = 1_000_000 + _mvv_lva(board, m[0], m[1])
        elif m == k0:
            key = 900_000
        elif m == k1:
            key = 800_000
        else:
            key = history.get(m, 0)
        scored.append((key, m))
    scored.sort(key=lambda t: -t[0])
    return [m for _, m in scored]


def _legal_moves_fast(board: Board, color: Optional[str] = None) -> List[Tuple[Coord, Coord]]:
    """快速生成合法走法（与 board.legal_moves 结果一致）。"""
    color = color or board.turn
    result: List[Tuple[Coord, Coord]] = []
    for fr, to in board.pseudo_legal_moves(color):
        board.make_move(fr, to)
        legal = not _in_check_fast(board, color)
        board.undo_move()
        if legal:
            result.append((fr, to))
    return result


# =========================================================================
# 搜索
# =========================================================================
class _SearchTimeout(Exception):
    """搜索时间用尽（内部用于从递归里快速退出）。"""


def _search(
    board: Board,
    depth: int,
    alpha: float,
    beta: float,
    deadline: float,
    node_count: List[int],
    ply: int,
    qdepth: int,
    ctx: dict,
) -> float:
    """negamax + alpha-beta，返回值以「当前行棋方」为视角。"""
    node_count[0] += 1
    if not (node_count[0] & TIMEOUT_CHECK_MASK) and time.time() > deadline:
        raise _SearchTimeout

    if depth <= 0:
        return _quiescence(board, alpha, beta, deadline, node_count, ply, qdepth)

    color = board.turn
    moves = board.pseudo_legal_moves(color)
    if not moves:
        return -MATE_SCORE + ply

    best = -INF
    legal_count = 0
    for fr, to in _order_moves(board, moves, ply, ctx):
        is_capture = board.squares[to[0]][to[1]] is not None
        board.make_move(fr, to)
        if _in_check_fast(board, color):
            board.undo_move()
            continue
        legal_count += 1
        score = -_search(board, depth - 1, -beta, -alpha, deadline,
                         node_count, ply + 1, qdepth, ctx)
        board.undo_move()
        if score > best:
            best = score
            if score > alpha:
                alpha = score
                if alpha >= beta:
                    # 剪枝：记录 killer 与历史启发，供后续排序使用
                    if not is_capture:
                        killers = ctx["killers"]
                        k0, k1 = killers[ply]
                        if k0 != (fr, to):
                            killers[ply] = ((fr, to), k0)
                        history = ctx["history"]
                        history[(fr, to)] = history.get((fr, to), 0) + depth * depth
                    break
    if legal_count == 0:
        return -MATE_SCORE + ply
    return best


def _quiescence(
    board: Board,
    alpha: float,
    beta: float,
    deadline: float,
    node_count: List[int],
    ply: int,
    qdepth: int,
) -> float:
    """静态搜索：只展开吃子（被将军时展开所有解将走法），消除地平线效应。"""
    node_count[0] += 1
    if not (node_count[0] & TIMEOUT_CHECK_MASK) and time.time() > deadline:
        raise _SearchTimeout

    color = board.turn
    in_check = _in_check_fast(board, color)
    stand = _eval_side_to_move(board)

    if qdepth <= 0:
        return stand

    moves = board.pseudo_legal_moves(color)
    if in_check:
        candidates = moves          # 被将军：所有解将走法都必须看
    else:
        if stand >= beta:
            return stand
        if stand > alpha:
            alpha = stand
        candidates = [m for m in moves
                      if board.squares[m[1][0]][m[1][1]] is not None]
        if not candidates:
            return alpha

    candidates.sort(key=lambda m: -_mvv_lva(board, m[0], m[1]))

    legal_count = 0
    for fr, to in candidates:
        board.make_move(fr, to)
        if _in_check_fast(board, color):
            board.undo_move()
            continue
        legal_count += 1
        score = -_quiescence(board, -beta, -alpha, deadline,
                             node_count, ply + 1, qdepth - 1)
        board.undo_move()
        if score >= beta:
            # fail-soft：返回真实分数而不是 beta，避免把上界裁剪值当成精确分
            # （根节点用较窄窗口搜索时，返回 beta 会导致分数被误当成“杀棋分”）
            return score
        if score > alpha:
            alpha = score
    if legal_count == 0:
        return -MATE_SCORE + ply
    return alpha


def search(board: Board, depth: int, alpha: float, beta: float,
           maximizing: bool, perspective: str,
           deadline: float, node_count: List[int]) -> Tuple[float, Optional[Tuple[Coord, Coord]]]:
    """兼容旧接口的固定深度搜索（返回 perspective 视角的分值与走法）。"""
    try:
        value = _search(board, depth, alpha, beta, deadline, node_count, 0, 0,
                        _new_search_ctx())
    except _SearchTimeout:
        return evaluate(board, perspective), None
    if board.turn != perspective:
        value = -value
    return value, None


# =========================================================================
# 随机化参数与难度档位
# =========================================================================
# 开局阶段在分数接近的走法中随机选择，让 AI 的开局多样化；
# 中残局窗口收窄，保证棋力不明显下降。
OPENING_PLIES = 6          # 前 6 个半回合（双方各 3 步）视为开局
OPENING_EPSILON = 30.0     # 开局：与最佳分差 ≤ 30 的走法都可能被选中
MIDGAME_EPSILON = 8.0      # 中残局：与最佳分差 ≤ 8 的走法都可能被选中

# --- 难度档位 ---
# depth           迭代加深的最大深度（受时间限制，通常提前用满时间就停）
# time_limit_sec  单步思考时间上限
# qdepth          静态搜索（吃子延伸）深度：0 = 不延伸（简单档会因此漏看对方回吃）
# opening_epsilon 开局随机窗口：越大开局越多变、越不拘一格
# midgame_epsilon 中残局随机窗口：越大越容易走出小失误
DIFFICULTY_SETTINGS = {
    # 简单：只看一步 + 不做吃子延伸。看不到对方回击、也看不到两步战术，
    # 加上很宽的随机窗口，会不时走出漫不经心的棋，适合入门。
    "easy": {
        "label": "简单",
        "depth": 1,
        "time_limit_sec": 0.5,
        "qdepth": 0,
        "opening_epsilon": 80.0,
        "midgame_epsilon": 50.0,
    },
    # 正常：迭代加深到 4 层（时间足够时）+ 2 层吃子延伸，攻守均衡，开局走法多样。
    "normal": {
        "label": "正常",
        "depth": 5,
        "time_limit_sec": 1.2,
        "qdepth": 2,
        "opening_epsilon": 25.0,
        "midgame_epsilon": 8.0,
    },
    # 困难：迭代加深到 6 层（时间足够时）+ 3 层吃子延伸，
    # 随机窗口最小，走法最精准、失误最少。
    "hard": {
        "label": "困难",
        "depth": 6,
        "time_limit_sec": 2.5,
        "qdepth": 3,
        "opening_epsilon": 12.0,
        "midgame_epsilon": 3.0,
    },
}


# =========================================================================
# 对外主入口
# =========================================================================
def choose_move(
    board: Board,
    depth: int = 3,
    time_limit_sec: float = 1.5,
    difficulty: Optional[str] = None,
    stats: Optional[Dict[str, object]] = None,
) -> Optional[Tuple[Coord, Coord]]:
    """为当前回合选择走法。无合法走法时返回 None。

    difficulty 为 'easy' / 'normal' / 'hard' 时使用对应难度档位
    （见 DIFFICULTY_SETTINGS），此时忽略 depth / time_limit_sec；
    不传 difficulty 时按显式参数搜索（兼容旧调用方）。

    搜索在克隆的棋盘上进行，不修改传入的 board，可安全地在后台线程调用。
    stats 若给出字典，会写入本次搜索的统计信息：
        depth_reached / nodes / candidates / best_score / timed_out

    同一局面下，AI 会在分数接近最佳的一组走法中随机选择，
    因此不同对局即使玩家走法相同，AI 的应对也不会完全一样。
    """
    if difficulty is not None:
        settings = DIFFICULTY_SETTINGS.get(difficulty, DIFFICULTY_SETTINGS["normal"])
        max_depth = int(settings["depth"])
        time_limit_sec = float(settings["time_limit_sec"])
        qdepth = int(settings["qdepth"])
        opening_eps = float(settings["opening_epsilon"])
        midgame_eps = float(settings["midgame_epsilon"])
    else:
        max_depth = depth
        qdepth = 2
        opening_eps = OPENING_EPSILON
        midgame_eps = MIDGAME_EPSILON

    perspective = board.turn
    work_board = board.clone()
    deadline = time.time() + time_limit_sec
    node_count = [0]
    timed_out = False

    root_moves = _legal_moves_fast(work_board, perspective)
    if not root_moves:
        if stats is not None:
            stats.update(depth_reached=0, nodes=0, candidates=0,
                         best_score=0.0, timed_out=False)
        return None

    # 洗牌 + 吃子启发：等值走法的相对顺序每次都不同，开局不雷同
    random.shuffle(root_moves)
    root_moves.sort(key=lambda m: -_mvv_lva(work_board, m[0], m[1]))

    epsilon = opening_eps if len(board.history) < OPENING_PLIES else midgame_eps

    completed: List[Tuple[float, Tuple[Coord, Coord]]] = []
    depth_reached = 0
    ctx = _new_search_ctx()

    # ---- 迭代加深：只有完整搜完的一层才会被采用 ----
    for d in range(1, max_depth + 1):
        layer: List[Tuple[float, Tuple[Coord, Coord]]] = []
        best_alpha = -INF
        try:
            for fr, to in root_moves:
                work_board.make_move(fr, to)
                # 只对「可能进入候选窗口」的走法做完整搜索：
                # 若分数低于当前最佳 - epsilon - 1，后面的搜索可以放宽上界以加速。
                beta = INF if best_alpha == -INF else -(best_alpha - epsilon - 1.0)
                try:
                    score = -_search(work_board, d - 1, -INF, beta, deadline,
                                     node_count, 1, qdepth, ctx)
                finally:
                    work_board.undo_move()
                layer.append((score, (fr, to)))
                if score > best_alpha:
                    best_alpha = score
        except _SearchTimeout:
            timed_out = True
            break

        completed = sorted(layer, key=lambda t: -t[0])
        depth_reached = d
        # 用本层结果重排根走法，下一层剪枝更狠
        root_moves = [mv for _, mv in completed]
        if time.time() > deadline:
            timed_out = True
            break

    if not completed:
        # 极端情况：时间上限小到连第 1 层都没走完。
        # 退化为「吃子优先」的贪心一步，保证总能返回一个合法走法。
        best = max(root_moves, key=lambda m: _mvv_lva(work_board, m[0], m[1]))
        if stats is not None:
            stats.update(depth_reached=0, nodes=node_count[0], candidates=1,
                         best_score=0.0, timed_out=True)
        return best

    best_score = completed[0][0]
    candidates = [mv for sc, mv in completed if best_score - sc <= epsilon]
    chosen = random.choice(candidates)

    if stats is not None:
        stats.update(depth_reached=depth_reached, nodes=node_count[0],
                     candidates=len(candidates), best_score=best_score,
                     timed_out=timed_out)
    return chosen
