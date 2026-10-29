"""Pygame GUI：棋盘绘制、棋子、动画、交互、菜单。

视觉层统一走「超采样 + 预渲染」：棋盘、棋子、面板皮肤都在启动时生成一次，
每帧只做 blit，因此可以放心用高倍率绘制来换取干净的抗锯齿边缘。
"""
from __future__ import annotations

import math
import os
import random
import sys
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple

import pygame

from constants import (
    ANIMATION_DURATION_MS,
    BLACK,
    BOARD_COLS,
    BOARD_MARGIN_X,
    BOARD_MARGIN_Y,
    BOARD_PX_HEIGHT,
    BOARD_PX_WIDTH,
    BOARD_ROWS,
    COLOR_BG_BOTTOM,
    COLOR_BG_GLOW,
    COLOR_BG_TOP,
    COLOR_BLACK,
    COLOR_BLACK_DARK,
    COLOR_CHECK,
    COLOR_FRAME,
    COLOR_FRAME_LIGHT,
    COLOR_GOLD,
    COLOR_GOLD_LIGHT,
    COLOR_GRAIN,
    COLOR_HEADER_BOTTOM,
    COLOR_HEADER_TOP,
    COLOR_HIGHLIGHT,
    COLOR_LEGAL_CAPTURE,
    COLOR_LEGAL_DOT,
    COLOR_LINE,
    COLOR_PANEL,
    COLOR_PANEL_BOTTOM,
    COLOR_PANEL_CARD,
    COLOR_PANEL_LINE,
    COLOR_PIECE_EDGE,
    COLOR_PIECE_FACE,
    COLOR_PIECE_FACE_DARK,
    COLOR_RED,
    COLOR_RED_DARK,
    COLOR_SUGGEST,
    COLOR_SUGGEST_GLOW,
    COLOR_TEXT,
    COLOR_TEXT_SOFT,
    COLOR_WOOD_DARK,
    COLOR_WOOD_LIGHT,
    DEFAULT_TIME_LIMIT_SEC,
    PIECE_NAMES_CN,
    RED,
    SAVE_DIR,
    SAVE_PREFIX,
    SIDEBAR_WIDTH,
    SIDEBAR_X,
    TILE_SIZE,
    WINDOW_HEIGHT,
    WINDOW_WIDTH,
)
from board import Board, Coord, Move
from pieces import Piece
from ai import DIFFICULTY_SETTINGS, choose_move

# --- 棋盘原点在屏幕坐标 (px) ---
BOARD_ORIGIN_X = BOARD_MARGIN_X
BOARD_ORIGIN_Y = BOARD_MARGIN_Y

# 侧栏面板与棋盘木框上下对齐
PANEL_TOP = BOARD_MARGIN_Y - TILE_SIZE // 2
PANEL_HEIGHT = BOARD_PX_HEIGHT + TILE_SIZE

PIECE_RADIUS = TILE_SIZE // 2 - 4
PIECE_CHAR_PX = 34

# 棋盘贴图 / 棋子贴图的超采样倍率
SS_BOARD = 3
SS_PIECE = 4

BOARD_W = BOARD_PX_WIDTH + TILE_SIZE
BOARD_H = BOARD_PX_HEIGHT + TILE_SIZE
BOARD_X = BOARD_ORIGIN_X - TILE_SIZE // 2
BOARD_Y = BOARD_ORIGIN_Y - TILE_SIZE // 2

# 侧栏内部布局（相对 PANEL_TOP）
PANEL_PAD = 20
HEADER_H = 58
PANEL_INNER_X = SIDEBAR_X + PANEL_PAD
PANEL_INNER_W = SIDEBAR_WIDTH - PANEL_PAD * 2
CHIP_CY = 84
MODE_Y = 104
DIFF_Y = 130
DIFF_PILL_W = 82
DIFF_PILL_H = 24
DIFF_PILL_GAP = 6
CLOCK_Y = (166, 220)
CLOCK_H = 48
DIVIDER_Y = 278
CAPTION_Y = 288
CAPTURE_Y = (312, 342)
BTN_Y = 368
BTN_H = 34
BTN_GAP = 38

# ================= 字体辅助 =================
# 候选字体文件路径（直接加载，避免 pygame.font.match_font 在某些 Windows
# 系统上枚举注册表时触发 TypeError 的 bug）
_FONT_CANDIDATES = [
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyh.ttf",
    r"C:\Windows\Fonts\NotoSansSC-VF.ttf",
    r"C:\Windows\Fonts\simfang.ttf",
    r"C:\Windows\Fonts\simkai.ttf",
    r"C:\Windows\Fonts\simyou.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
    "/System/Library/Fonts/PingFang.ttc",      # macOS
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",  # Linux
]

_FONT_PATH: Optional[str] = None


def _font_path() -> Optional[str]:
    global _FONT_PATH
    if _FONT_PATH is None:
        for path in _FONT_CANDIDATES:
            if os.path.exists(path):
                _FONT_PATH = path
                break
        else:
            _FONT_PATH = ""
    return _FONT_PATH or None


def _load_font(size: int) -> Optional[pygame.font.Font]:
    """直接加载候选字体文件，失败时回退到 pygame 默认字体。"""
    path = _font_path()
    if path:
        try:
            return pygame.font.Font(path, size)
        except (OSError, pygame.error):
            pass
    try:
        return pygame.font.Font(None, size)
    except pygame.error:
        try:
            return pygame.font.SysFont(None, size)
        except pygame.error:
            return None


# ================= 绘制工具 =================
def _mix(c1, c2, t: float):
    """两色线性混合。"""
    return tuple(int(round(c1[i] + (c2[i] - c1[i]) * t)) for i in range(3))


def _vgradient(size, top, bottom) -> pygame.Surface:
    """竖向渐变（利用 1x2 小图缩放，边缘天然平滑）。"""
    w, h = max(1, int(size[0])), max(2, int(size[1]))
    base = pygame.Surface((1, 2), pygame.SRCALPHA)
    base.set_at((0, 0), top if len(top) == 4 else (*top, 255))
    base.set_at((0, 1), bottom if len(bottom) == 4 else (*bottom, 255))
    return pygame.transform.smoothscale(base, (w, h))


def _rounded_gradient(size, radius: int, top, bottom,
                      corners: str = "all") -> pygame.Surface:
    """圆角渐变面板。corners: 'all' / 'top' / 'bottom'。"""
    w, h = max(1, int(size[0])), max(1, int(size[1]))
    surf = _vgradient((w, h), top, bottom)
    mask = pygame.Surface((w, h), pygame.SRCALPHA)
    rect = mask.get_rect()
    if corners == "top":
        pygame.draw.rect(mask, (255, 255, 255, 255), rect,
                         border_top_left_radius=radius, border_top_right_radius=radius)
    elif corners == "bottom":
        pygame.draw.rect(mask, (255, 255, 255, 255), rect,
                         border_bottom_left_radius=radius, border_bottom_right_radius=radius)
    else:
        pygame.draw.rect(mask, (255, 255, 255, 255), rect, border_radius=radius)
    surf.blit(mask, (0, 0), special_flags=pygame.BLEND_RGBA_MULT)
    return surf


def _rounded_surface(size, radius: int, top, bottom,
                     border=None, border_w: int = 2) -> pygame.Surface:
    """圆角渐变 + 可选（抗锯齿）描边。"""
    w, h = max(1, int(size[0])), max(1, int(size[1]))
    surf = _rounded_gradient((w, h), radius, top, bottom)
    if border is not None:
        ss = 3
        hi = pygame.Surface((w * ss, h * ss), pygame.SRCALPHA)
        inset = border_w * ss // 2
        pygame.draw.rect(hi, (*border, 255),
                         (inset, inset, w * ss - inset * 2, h * ss - inset * 2),
                         border_w * ss, border_radius=radius * ss)
        surf.blit(pygame.transform.smoothscale(hi, (w, h)), (0, 0))
    return surf


def _make_shadow(size, radius: int = 12, blur: int = 10, alpha: int = 110,
                 color=(22, 12, 6)):
    """柔和的圆角投影，返回 (surface, pad)；贴图时左上角回退 pad。"""
    w, h = max(1, int(size[0])), max(1, int(size[1]))
    pad = blur * 2 + 2
    sw = max(4, (w + pad) // 4)
    sh = max(4, (h + pad) // 4)
    small = pygame.Surface((sw, sh), pygame.SRCALPHA)
    inner = pygame.Rect(0, 0, max(1, w // 4), max(1, h // 4))
    inner.center = (sw // 2, sh // 2)
    pygame.draw.rect(small, (255, 255, 255, 255), inner,
                     border_radius=max(1, radius // 4))
    mid = pygame.transform.smoothscale(small, (max(2, sw // 2), max(2, sh // 2)))
    big = pygame.transform.smoothscale(mid, (w + pad * 2, h + pad * 2))
    big.fill((*color, alpha), special_flags=pygame.BLEND_RGBA_MULT)
    return big, pad


def _radial_mask(size, color, alpha: int = 60, power: float = 2.0,
                 center=(0.5, 0.5), edge: bool = False) -> pygame.Surface:
    """径向柔光 / 暗角蒙版（先在 64x64 上算，再放大）。"""
    n = 64
    small = pygame.Surface((n, n), pygame.SRCALPHA)
    cx, cy = center[0] * (n - 1), center[1] * (n - 1)
    maxd = math.hypot(max(cx, n - 1 - cx), max(cy, n - 1 - cy)) or 1.0
    for y in range(n):
        for x in range(n):
            d = math.hypot(x - cx, y - cy) / maxd
            f = d if edge else (1.0 - d)
            a = int(alpha * max(0.0, f) ** power)
            if a:
                small.set_at((x, y), (*color[:3], a))
    return pygame.transform.smoothscale(small, (max(2, size[0]), max(2, size[1])))


def _soft_dot(size: int, color, alpha: int = 255, solid: float = 0.52,
              power: float = 1.4) -> pygame.Surface:
    """柔和圆点（合法落点提示）。"""
    n = 40
    small = pygame.Surface((n, n), pygame.SRCALPHA)
    c = (n - 1) / 2
    for y in range(n):
        for x in range(n):
            d = math.hypot(x - c, y - c) / c
            if d > 1.0:
                continue
            f = 1.0 if d <= solid else 1.0 - (d - solid) / (1.0 - solid)
            a = int(alpha * f ** power)
            if a:
                small.set_at((x, y), (*color, a))
    return pygame.transform.smoothscale(small, (size, size))


def _ring_surface(radius: int, color, width: int = 3, alpha: int = 235,
                  ss: int = 4, pad: int = 3) -> pygame.Surface:
    """抗锯齿圆环。"""
    size = (radius + pad) * 2
    hi = pygame.Surface((size * ss, size * ss), pygame.SRCALPHA)
    c = size * ss // 2
    pygame.draw.circle(hi, (*color, alpha), (c, c), radius * ss, max(1, width * ss))
    return pygame.transform.smoothscale(hi, (size, size))


# 按钮皮肤缓存：key=(w, h, state)
_BTN_CACHE: Dict[Tuple[int, int, str], Tuple[pygame.Surface, pygame.Surface, int]] = {}


def _button_assets(size, state: str):
    key = (int(size[0]), int(size[1]), state)
    cached = _BTN_CACHE.get(key)
    if cached is not None:
        return cached
    w, h = key[0], key[1]
    if state == "disabled":
        top, bottom, border = (214, 201, 181), (188, 173, 152), (156, 141, 123)
    elif state == "primary":
        top, bottom, border = (176, 66, 48), (132, 36, 30), (74, 20, 16)
    elif state == "primary_hover":
        top, bottom, border = (202, 88, 66), (154, 46, 38), COLOR_GOLD_LIGHT
    elif state == "ghost":
        top, bottom, border = (240, 230, 211), (228, 215, 192), (198, 180, 150)
    elif state == "ghost_hover":
        top, bottom, border = (249, 241, 225), (237, 226, 204), COLOR_GOLD
    elif state == "hover":
        top, bottom, border = (224, 170, 104), (180, 120, 62), COLOR_GOLD_LIGHT
    else:
        top, bottom, border = (192, 136, 78), (154, 98, 50), (92, 56, 32)
    face = _rounded_gradient((w, h), 10, top, bottom)
    overlay = pygame.Surface((w, h), pygame.SRCALPHA)
    pygame.draw.line(overlay, (255, 255, 255, 52), (12, 2), (w - 12, 2), 2)
    pygame.draw.line(overlay, (255, 228, 184, 26), (10, h - 3), (w - 10, h - 3), 1)
    face.blit(overlay, (0, 0))
    strong = state in ("hover", "primary_hover", "ghost_hover", "primary")
    pygame.draw.rect(face, border, face.get_rect(), 2 if strong else 1,
                     border_radius=10)
    shadow, pad = _make_shadow((w, h), 10, blur=7,
                               alpha=80 if state != "disabled" else 40)
    _BTN_CACHE[key] = (face, shadow, pad)
    return face, shadow, pad


def _draw_button(surf: pygame.Surface, rect: pygame.Rect, label: str,
                 font: pygame.font.Font, hover: bool = False,
                 enabled: bool = True, style: str = "normal") -> None:
    if not enabled:
        state = "disabled"
    elif style == "normal":
        state = "hover" if hover else "normal"
    else:
        state = f"{style}_hover" if hover else style
    face, shadow, pad = _button_assets((rect.w, rect.h), state)
    lift = -2 if (hover and enabled) else 0
    surf.blit(shadow, (rect.x - pad, rect.y - pad + lift + 3))
    surf.blit(face, (rect.x, rect.y + lift))
    if style == "ghost" and enabled:
        color = (96, 70, 46) if hover else (116, 88, 62)
    else:
        color = (253, 246, 234) if enabled else (252, 249, 242)
    if enabled and style != "ghost":
        shadow_text = font.render(label, True, (54, 28, 12))
        shadow_text.set_alpha(90)
        surf.blit(shadow_text,
                  shadow_text.get_rect(center=(rect.centerx + 1, rect.centery + lift + 2)))
    text = font.render(label, True, color)
    surf.blit(text, text.get_rect(center=(rect.centerx, rect.centery + lift)))


def _render_tracked(font: pygame.font.Font, text: str, color,
                    tracking: int = 0) -> pygame.Surface:
    """逐字渲染并加字距，用于标题。"""
    if tracking <= 0:
        return font.render(text, True, color)
    glyphs = [font.render(ch, True, color) for ch in text]
    width = sum(g.get_width() for g in glyphs) + tracking * (len(glyphs) - 1)
    height = max(g.get_height() for g in glyphs)
    surf = pygame.Surface((max(1, width), max(1, height)), pygame.SRCALPHA)
    x = 0
    for g in glyphs:
        surf.blit(g, (x, (height - g.get_height()) // 2))
        x += g.get_width() + tracking
    return surf


# ================= 按钮按下 =================
@dataclass
class Button:
    rect: pygame.Rect
    label: str
    on_click: Callable[[], None]
    enabled: bool = True
    style: str = "normal"

    def draw(self, surf: pygame.Surface, font: pygame.font.Font) -> None:
        hover = self.enabled and self.rect.collidepoint(pygame.mouse.get_pos())
        _draw_button(surf, self.rect, self.label, font, hover=hover,
                     enabled=self.enabled, style=self.style)

    def handle(self, event: pygame.event.Event) -> bool:
        if not self.enabled:
            return False
        if event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
            if self.rect.collidepoint(event.pos):
                self.on_click()
                return True
        return False


# ================= 动画状态 =================
@dataclass
class Animation:
    piece: Piece
    fr: Coord
    to: Coord
    start_ms: int
    duration_ms: int
    flipped: bool = False

    def progress(self, now_ms: int) -> float:
        return min(1.0, max(0.0, (now_ms - self.start_ms) / self.duration_ms))

    def pos(self, now_ms: int) -> Tuple[int, int]:
        t = self.progress(now_ms)
        fx, fy = square_to_px(self.fr, self.flipped)
        tx, ty = square_to_px(self.to, self.flipped)
        # 缓出（cubic）
        ease = 1 - (1 - t) ** 3
        x = int(fx + (tx - fx) * ease)
        y = int(fy + (ty - fy) * ease)
        return x, y

    def done(self, now_ms: int) -> bool:
        return now_ms - self.start_ms >= self.duration_ms


# ================= 坐标转换 =================
def square_to_px(coord: Coord, flipped: bool = False) -> Tuple[int, int]:
    """格子坐标 → 屏幕像素中心。

    默认红方在下方（row 0 显示在最底部）；flipped=True 时棋盘转 180°，
    黑方在下方，供玩家执黑时使用。
    """
    c, r = coord
    if flipped:
        x = BOARD_ORIGIN_X + (BOARD_COLS - 1 - c) * TILE_SIZE
        y = BOARD_ORIGIN_Y + r * TILE_SIZE
    else:
        x = BOARD_ORIGIN_X + c * TILE_SIZE
        # 显示时红方在屏幕下方：渲染时把 row 翻转（row 0 在 y=9 在顶）
        display_row = (BOARD_ROWS - 1) - r
        y = BOARD_ORIGIN_Y + display_row * TILE_SIZE
    return x, y


def px_to_square(pos: Tuple[int, int], flipped: bool = False) -> Optional[Coord]:
    """屏幕像素 → 格子坐标。"""
    px, py = pos
    if not (BOARD_ORIGIN_X - TILE_SIZE // 2 <= px <= BOARD_ORIGIN_X + BOARD_PX_WIDTH + TILE_SIZE // 2):
        return None
    if not (BOARD_ORIGIN_Y - TILE_SIZE // 2 <= py <= BOARD_ORIGIN_Y + BOARD_PX_HEIGHT + TILE_SIZE // 2):
        return None
    display_col = round((px - BOARD_ORIGIN_X) / TILE_SIZE)
    display_row = round((py - BOARD_ORIGIN_Y) / TILE_SIZE)
    if flipped:
        c = (BOARD_COLS - 1) - display_col
        r = display_row
    else:
        c = display_col
        r = (BOARD_ROWS - 1) - display_row
    if 0 <= c <= 8 and 0 <= r <= 9:
        return (c, r)
    return None


# ================= 游戏状态容器 =================
@dataclass
class GameState:
    board: Board
    selected: Optional[Coord] = None
    legal_for_selected: List[Coord] = field(default_factory=list)
    legal_for_piece: List[Tuple[Coord, Coord]] = field(default_factory=list)  # 所有合法走法（提示用）
    suggested_move: Optional[Tuple[Coord, Coord]] = None  # AI 推荐的最佳走法
    last_move: Optional[Move] = None
    # 计时（秒）
    red_time: float = DEFAULT_TIME_LIMIT_SEC
    black_time: float = DEFAULT_TIME_LIMIT_SEC
    last_tick_ms: int = 0
    # 模式
    mode: str = "pvp"           # 'pvp' / 'ai'
    human_color: str = RED      # AI 模式下玩家执子色
    ai_thinking: bool = False
    ai_difficulty: str = "normal"  # AI 难度：'easy' / 'normal' / 'hard'
    # 结果
    result: str = "continue"
    # 消息
    status_message: str = ""
    status_message_until_ms: int = 0
    # 动画
    animation: Optional[Animation] = None
    # 走子历史撤销栈（用于悔棋）
    undo_stack: List[Tuple[Coord, Coord]] = field(default_factory=list)


# ================= 主 GUI 类 =================
class XiangqiGUI:
    def __init__(self, state: GameState):
        pygame.init()
        try:
            from audio import init as _ainit
            self._audio_init = _ainit
        except Exception:
            self._audio_init = None
        if self._audio_init:
            self._audio_init()

        # 尝试获取音频播放函数
        self._audio_play = None
        try:
            from audio import play as _aplay
            self._audio_play = _aplay
        except Exception:
            pass

        self.state = state
        self.screen = pygame.display.set_mode((WINDOW_WIDTH, WINDOW_HEIGHT))
        pygame.display.set_caption("中国象棋")
        self.clock = pygame.time.Clock()
        self.running = True
        # AI 后台线程相关（先初始化，避免 _poll_ai_result 在 _maybe_ai_move 之前调用时出错）
        # 每次发起思考都带一个「代际号」，局面一旦变动（新游戏/悔棋/读档/换难度）
        # 代际号 +1，旧线程算出的走法会被丢弃，避免 AI 走子落到已经变化的棋盘上。
        self._ai_generation: int = 0
        self._ai_pending: Optional[dict] = None

        # 推荐走法后台线程相关
        self._suggest_generation: int = 0
        self._suggest_pending: Optional[dict] = None
        self._suggest_thinking: bool = False

        # 字体
        self.font_tiny = _load_font(14)
        self.font_small = _load_font(17)
        self.font_ui = _load_font(19)
        self.font_medium = _load_font(23)
        self.font_large = _load_font(34)
        self.font_huge = _load_font(70)
        self.font_board = _load_font(34 * SS_BOARD)
        self._piece_fonts: Dict[int, Optional[pygame.font.Font]] = {}

        # 贴图 / 缓存
        self._piece_cache: Dict[tuple, pygame.Surface] = {}
        self._shadow_cache: Dict[tuple, Tuple[pygame.Surface, int]] = {}
        self._chip_cache: Dict[tuple, tuple] = {}
        self._toast_surface: Optional[pygame.Surface] = None
        self._toast_shadow: Optional[pygame.Surface] = None
        self._toast_shadow_pad = 0

        self._bg_surface = self._build_background()
        self._menu_bg = self._build_menu_bg()
        self._board_surface = self._build_board_surface()
        self._board_shadow, self._board_shadow_pad = _make_shadow(
            (BOARD_W, BOARD_H), 12, blur=18, alpha=170)

        self._panel_surface = self._build_panel_surface()
        self._panel_shadow, self._panel_shadow_pad = _make_shadow(
            (SIDEBAR_WIDTH, PANEL_HEIGHT), 16, blur=14, alpha=150)

        # 棋盘上的高亮贴图（预渲染，避免每帧重复绘制）
        self._last_tint = self._make_tile_surface(COLOR_HIGHLIGHT, 34, 0, inset=3, radius=9)
        self._select_tint = self._make_tile_surface(COLOR_HIGHLIGHT, 46, 200,
                                                    border_w=2, inset=3, radius=9)
        self._legal_dot = _soft_dot(24, COLOR_LEGAL_DOT, 245)
        self._capture_ring = _ring_surface(PIECE_RADIUS + 3, COLOR_LEGAL_CAPTURE, 3, 240)
        self._check_ring = _ring_surface(PIECE_RADIUS + 5, COLOR_CHECK, 3, 240)
        self._hover_ring = _ring_surface(PIECE_RADIUS + 3, (255, 198, 92), 2, 170)

        # 侧栏按钮
        self.buttons: List[Button] = []
        self._build_buttons()

        # 屏幕闪烁消息
        self._last_time_warning = ""

    @property
    def flipped(self) -> bool:
        """人机对战中玩家执黑时翻转棋盘，让己方棋子始终在下方。"""
        return self.state.mode == "ai" and self.state.human_color == BLACK

    # ---------- 按钮 ----------
    def _build_buttons(self) -> None:
        labels = [
            ("新游戏", self.new_game, "primary"),
            ("悔棋", self.undo, "normal"),
            ("提示", self.toggle_hint, "normal"),
            ("存档", self.save_game, "normal"),
            ("读档", self.load_game, "normal"),
            ("切换 AI", self.toggle_ai, "normal"),
            ("退出", self.quit, "ghost"),
        ]
        y = PANEL_TOP + BTN_Y
        for label, cb, style in labels:
            rect = pygame.Rect(PANEL_INNER_X, y, PANEL_INNER_W, BTN_H)
            self.buttons.append(Button(rect=rect, label=label, on_click=cb,
                                       style=style))
            y += BTN_GAP
        # 难度药丸（可点击）
        self._diff_rects: List[Tuple[str, pygame.Rect]] = []
        x = PANEL_INNER_X
        for key in ("easy", "normal", "hard"):
            self._diff_rects.append(
                (key, pygame.Rect(x, PANEL_TOP + DIFF_Y, DIFF_PILL_W, DIFF_PILL_H)))
            x += DIFF_PILL_W + DIFF_PILL_GAP

    # ---------- 背景 ----------
    def _build_background(self) -> pygame.Surface:
        w, h = WINDOW_WIDTH, WINDOW_HEIGHT
        surf = _vgradient((w, h), COLOR_BG_TOP, COLOR_BG_BOTTOM)
        rnd = random.Random(11)
        grain = pygame.Surface((w, h), pygame.SRCALPHA)
        for _ in range(150):
            base_y = rnd.uniform(0, h)
            freq = rnd.uniform(1.0, 2.6)
            amp = rnd.uniform(1.5, 4.0)
            pts = [(x, base_y + math.sin(x / w * freq * math.pi * 2) * amp)
                   for x in range(-40, w + 80, 40)]
            pygame.draw.lines(grain, (250, 214, 170, rnd.randint(4, 10)), False,
                              pts, rnd.randint(1, 2))
        surf.blit(grain, (0, 0))
        surf.blit(_radial_mask((w, h), COLOR_BG_GLOW, 34, 2.0, (0.5, 0.42)), (0, 0))
        surf.blit(_radial_mask((w, h), (10, 6, 3), 150, 2.4, (0.5, 0.46), edge=True),
                  (0, 0))
        return surf

    def _build_menu_bg(self) -> pygame.Surface:
        """菜单背景：桌面底 + 淡淡的棋盘格纹。"""
        surf = self._bg_surface.copy()
        overlay = pygame.Surface((WINDOW_WIDTH, WINDOW_HEIGHT), pygame.SRCALPHA)
        for x in range(8, WINDOW_WIDTH - 8, 80):
            pygame.draw.line(overlay, (230, 190, 132, 7),
                             (x, 8), (x, WINDOW_HEIGHT - 8))
        for y in range(8, WINDOW_HEIGHT - 8, 80):
            pygame.draw.line(overlay, (230, 190, 132, 7),
                             (8, y), (WINDOW_WIDTH - 8, y))
        surf.blit(overlay, (0, 0))
        surf.blit(_radial_mask((WINDOW_WIDTH, WINDOW_HEIGHT), (255, 216, 152),
                               44, 2.0, (0.5, 0.26)), (0, 0))
        return surf

    # ---------- 棋盘底图 ----------
    def _build_board_surface(self) -> pygame.Surface:
        """预渲染棋盘：木框、木纹、网格、九宫、河界文字、炮兵位标。"""
        s = SS_BOARD
        w, h = BOARD_W, BOARD_H
        hi = pygame.Surface((w * s, h * s), pygame.SRCALPHA)

        # 木框 + 框内浅色倒角
        pygame.draw.rect(hi, COLOR_FRAME, (0, 0, w * s, h * s), border_radius=11 * s)
        pygame.draw.rect(hi, COLOR_FRAME_LIGHT,
                         (3 * s, 3 * s, (w - 6) * s, (h - 6) * s),
                         1 * s, border_radius=9 * s)

        # 木面
        inset = 9
        panel = pygame.Rect(inset * s, inset * s,
                            (w - 2 * inset) * s, (h - 2 * inset) * s)
        hi.blit(_vgradient(panel.size, COLOR_WOOD_LIGHT, COLOR_WOOD_DARK),
                panel.topleft)

        # 木纹（固定随机种子，保证每次启动一致）
        rnd = random.Random(2026)
        grain = pygame.Surface(panel.size, pygame.SRCALPHA)
        for _ in range(96):
            base_y = rnd.uniform(-20 * s, panel.h + 20 * s)
            freq = rnd.uniform(0.8, 2.2)
            amp = rnd.uniform(1.0, 3.2) * s
            pts = [(x, base_y + math.sin(x / panel.w * freq * math.pi * 2) * amp)
                   for x in range(-32 * s, panel.w + 64 * s, 32 * s)]
            col = (*_mix(COLOR_GRAIN, COLOR_WOOD_LIGHT, rnd.uniform(0.0, 0.45)),
                   rnd.randint(9, 24))
            pygame.draw.lines(grain, col, False, pts, max(1, int(rnd.uniform(1, 3))))
        for _ in range(12):
            kx = rnd.uniform(0, max(1, panel.w - 40 * s))
            ky = rnd.uniform(0, max(1, panel.h - 20 * s))
            kw = rnd.uniform(6, 16) * s
            kh = rnd.uniform(3, 7) * s
            pygame.draw.ellipse(grain, (150, 102, 58, 16), (kx, ky, kw, kh))
        hi.blit(grain, panel.topleft)

        # 四周压暗（木板厚度感）+ 顶部柔光
        hi.blit(_radial_mask(panel.size, (96, 58, 30), 95, 2.8, (0.5, 0.5), edge=True),
                panel.topleft)
        hi.blit(_vgradient((panel.w, 90 * s), (255, 255, 255, 28), (255, 255, 255, 0)),
                panel.topleft)
        pygame.draw.rect(hi, (52, 31, 17), panel, 2 * s)

        # --- 网格 ---
        ox = oy = (TILE_SIZE // 2) * s
        gw, gh = BOARD_PX_WIDTH * s, BOARD_PX_HEIGHT * s
        lw = 1 * s
        for r in range(BOARD_ROWS):
            y = oy + r * TILE_SIZE * s
            pygame.draw.line(hi, COLOR_LINE, (ox, y), (ox + gw, y), lw)
        for c in range(BOARD_COLS):
            x = ox + c * TILE_SIZE * s
            if c == 0 or c == BOARD_COLS - 1:
                pygame.draw.line(hi, COLOR_LINE, (x, oy), (x, oy + gh), 2 * s)
            else:
                pygame.draw.line(hi, COLOR_LINE, (x, oy), (x, oy + 4 * TILE_SIZE * s), lw)
                pygame.draw.line(hi, COLOR_LINE, (x, oy + 5 * TILE_SIZE * s),
                                 (x, oy + gh), lw)
        # 上下边线略粗一点，像真正的木刻棋盘
        pygame.draw.line(hi, COLOR_LINE, (ox, oy), (ox + gw, oy), 2 * s)
        pygame.draw.line(hi, COLOR_LINE, (ox, oy + gh), (ox + gw, oy + gh), 2 * s)

        # 九宫斜线
        for dtop in (0, 7):
            x1, x2 = ox + 3 * TILE_SIZE * s, ox + 5 * TILE_SIZE * s
            y1, y2 = oy + dtop * TILE_SIZE * s, oy + (dtop + 2) * TILE_SIZE * s
            pygame.draw.line(hi, COLOR_LINE, (x1, y1), (x2, y2), lw)
            pygame.draw.line(hi, COLOR_LINE, (x2, y1), (x1, y2), lw)

        # 河界文字（浅色描边压在下面，做出木刻凹凸感）
        river_cy = oy + int(4.5 * TILE_SIZE * s)
        if self.font_board is not None:
            for txt, tile_col, fg in (("楚 河", 2, (162, 58, 44)),
                                      ("汉 界", 6, (84, 60, 44))):
                cx = ox + tile_col * TILE_SIZE * s
                emboss = self.font_board.render(txt, True, (252, 236, 208))
                emboss.set_alpha(120)
                hi.blit(emboss, emboss.get_rect(center=(cx + 1 * s, river_cy + 2 * s)))
                text = self.font_board.render(txt, True, fg)
                text.set_alpha(225)
                hi.blit(text, text.get_rect(center=(cx, river_cy)))

        # 炮位 / 兵位角标
        marks = [(1, 2), (7, 2), (1, 7), (7, 7),
                 (0, 3), (2, 3), (4, 3), (6, 3), (8, 3),
                 (0, 6), (2, 6), (4, 6), (6, 6), (8, 6)]
        inner = (PIECE_RADIUS - 4) * s
        arm = 6 * s
        for c, r in marks:
            x = ox + c * TILE_SIZE * s
            y = oy + ((BOARD_ROWS - 1) - r) * TILE_SIZE * s
            for dx, dy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
                sx = x + dx * inner
                sy = y + dy * inner
                ex = sx + dx * arm
                ey = sy + dy * arm
                if not (ox <= ex <= ox + gw):
                    continue
                pygame.draw.line(hi, COLOR_LINE, (sx, sy), (ex, sy), lw)
                pygame.draw.line(hi, COLOR_LINE, (sx, sy), (sx, ey), lw)

        return pygame.transform.smoothscale(hi, (w, h))

    # ---------- 棋子贴图 ----------
    def _piece_font(self, char_px: int) -> Optional[pygame.font.Font]:
        if char_px not in self._piece_fonts:
            self._piece_fonts[char_px] = _load_font(char_px * SS_PIECE)
        return self._piece_fonts[char_px]

    def _make_piece(self, color: str, name: str, radius: int = PIECE_RADIUS,
                    char_px: int = PIECE_CHAR_PX) -> pygame.Surface:
        """生成一枚棋子（象牙盘面 + 色环 + 刻字），超采样后缩小。"""
        key = (color, name, radius, char_px)
        cached = self._piece_cache.get(key)
        if cached is not None:
            return cached

        s = SS_PIECE
        pad = max(3, radius // 5)
        size = (radius + pad) * 2
        hi = pygame.Surface((size * s, size * s), pygame.SRCALPHA)
        c = hi.get_width() // 2
        R = radius * s
        rim = COLOR_RED if color == RED else COLOR_BLACK
        rim_deep = COLOR_RED_DARK if color == RED else COLOR_BLACK_DARK

        # 侧面厚度（先画，露出底部一小条）
        pygame.draw.circle(hi, (170, 130, 86), (c, c + 2 * s), R)
        pygame.draw.circle(hi, COLOR_PIECE_EDGE, (c, c + 3 * s), R - 1 * s)

        # 盘面：左上打光的径向渐变，用圆形蒙版裁切
        d = R * 2 + 2 * s
        body = pygame.Surface((d, d), pygame.SRCALPHA)
        gx, gy = R - 1 * s, R - 3 * s
        for i in range(R + 6 * s, 0, -1):
            t = min(1.0, i / R)
            col = _mix(COLOR_PIECE_FACE, COLOR_PIECE_FACE_DARK, t ** 1.15)
            pygame.draw.circle(body, col, (gx, gy), i)
        mask = pygame.Surface((d, d), pygame.SRCALPHA)
        pygame.draw.circle(mask, (255, 255, 255, 255), (R + 1 * s, R + 1 * s), R)
        body.blit(mask, (0, 0), special_flags=pygame.BLEND_RGBA_MULT)
        hi.blit(body, (c - R - 1 * s, c - R - 1 * s))

        # 外沿 / 色环 / 内细线（线宽随棋子大小缩放，小棋子才不会糊成一团）
        outline_w = max(1, round(radius * 0.07))
        ring_w = max(1, round(radius * 0.105))
        pygame.draw.circle(hi, rim_deep, (c, c), R, outline_w * s)
        pygame.draw.circle(hi, rim, (c, c), R - ring_w * s, ring_w * s)
        if radius >= 18:
            inner_r = R - max(3, round(radius * 0.32)) * s
            pygame.draw.circle(hi, _mix(rim, COLOR_PIECE_FACE, 0.55),
                               (c, c), inner_r, 1 * s)

        # 左上高光弧
        gloss = pygame.Surface(hi.get_size(), pygame.SRCALPHA)
        gr = R - max(3, round(radius * 0.25)) * s
        pygame.draw.arc(gloss, (255, 255, 255, 120),
                        pygame.Rect(c - gr, c - gr, gr * 2, gr * 2),
                        math.pi * 0.18, math.pi * 0.82, max(1, ring_w) * s)
        hi.blit(gloss, (0, 0))

        # 刻字：浅色投影在下，主字在上 → 凹刻
        font = self._piece_font(char_px)
        if font is not None:
            emboss = font.render(name, True, (255, 253, 244))
            emboss.set_alpha(170)
            hi.blit(emboss, emboss.get_rect(center=(c + 1 * s, c + 2 * s)))
            glyph = font.render(name, True, rim)
            hi.blit(glyph, glyph.get_rect(center=(c, c)))

        surf = pygame.transform.smoothscale(hi, (size, size))
        self._piece_cache[key] = surf
        return surf

    def _piece_shadow(self, radius: int = PIECE_RADIUS):
        key = ("piece_shadow", radius)
        cached = self._shadow_cache.get(key)
        if cached is not None:
            return cached
        w, h = radius * 2 + 12, radius * 2 + 8
        small = pygame.Surface((32, 32), pygame.SRCALPHA)
        pygame.draw.ellipse(small, (255, 255, 255, 255), (3, 9, 26, 15))
        mid = pygame.transform.smoothscale(small, (16, 16))
        big = pygame.transform.smoothscale(mid, (max(2, w), max(2, h)))
        big.fill((20, 10, 4, 125), special_flags=pygame.BLEND_RGBA_MULT)
        self._shadow_cache[key] = big
        return big

    def _draw_piece(self, piece: Piece, x: int, y: int) -> None:
        surf = self._make_piece(piece.color, piece.name_cn)
        shadow = self._piece_shadow()
        self.screen.blit(shadow, (x - shadow.get_width() // 2 + 1,
                                  y - shadow.get_height() // 2 + 3))
        self.screen.blit(surf, (x - surf.get_width() // 2, y - surf.get_height() // 2))

    # ---------- 高亮贴图 ----------
    def _make_tile_surface(self, color, fill_alpha: int, border_alpha: int,
                           border_w: int = 0, inset: int = 2,
                           radius: int = 9) -> pygame.Surface:
        ss = 4
        t = TILE_SIZE
        surf = pygame.Surface((t * ss, t * ss), pygame.SRCALPHA)
        rect = pygame.Rect(inset * ss, inset * ss,
                           (t - 2 * inset) * ss, (t - 2 * inset) * ss)
        if fill_alpha:
            pygame.draw.rect(surf, (*color, fill_alpha), rect, border_radius=radius * ss)
        if border_w and border_alpha:
            pygame.draw.rect(surf, (*color, border_alpha), rect,
                             border_w * ss, border_radius=radius * ss)
        return pygame.transform.smoothscale(surf, (t, t))

    # ---------- 侧栏皮肤 ----------
    def _build_panel_surface(self) -> pygame.Surface:
        w, h = SIDEBAR_WIDTH, PANEL_HEIGHT
        surf = _rounded_gradient((w, h), 16, COLOR_PANEL, COLOR_PANEL_BOTTOM)
        pygame.draw.rect(surf, COLOR_PANEL_LINE, surf.get_rect(), 1, border_radius=16)

        # 标题栏
        header = _rounded_gradient((w, HEADER_H), 16, COLOR_HEADER_TOP,
                                   COLOR_HEADER_BOTTOM, corners="top")
        surf.blit(header, (0, 0))
        gloss = pygame.Surface((w, HEADER_H), pygame.SRCALPHA)
        pygame.draw.line(gloss, (255, 255, 255, 38), (14, 1), (w - 14, 1), 2)
        pygame.draw.line(gloss, (255, 255, 255, 16), (14, HEADER_H - 2),
                         (w - 14, HEADER_H - 2), 1)
        surf.blit(gloss, (0, 0))
        pygame.draw.line(surf, COLOR_GOLD, (0, HEADER_H), (w, HEADER_H), 2)
        pygame.draw.line(surf, (58, 22, 16), (0, HEADER_H + 2),
                         (w, HEADER_H + 2), 1)

        # 计时卡片
        for oy in CLOCK_Y:
            card = pygame.Rect(PANEL_PAD, oy, w - PANEL_PAD * 2, CLOCK_H)
            pygame.draw.rect(surf, COLOR_PANEL_CARD, card, border_radius=8)
            pygame.draw.rect(surf, COLOR_PANEL_LINE, card, 1, border_radius=8)
            pygame.draw.line(surf, (255, 255, 255), (card.x + 10, card.y + 1),
                             (card.right - 10, card.y + 1), 1)

        # 分隔线 + 中央菱形
        y = DIVIDER_Y
        pygame.draw.line(surf, (222, 205, 178), (PANEL_PAD, y),
                         (w - PANEL_PAD, y), 1)
        cx = w // 2
        pygame.draw.polygon(surf, (222, 205, 178),
                            [(cx, y - 4), (cx + 4, y), (cx, y + 4), (cx - 4, y)])
        pygame.draw.polygon(surf, COLOR_GOLD,
                            [(cx, y - 2), (cx + 2, y), (cx, y + 2), (cx - 2, y)])
        return surf

    # ================= 菜单 =================
    def run_menu_then_game(self) -> None:
        """显示主菜单，然后进入游戏。"""
        while True:
            choice = self._show_menu()
            if choice == "pvp":
                self.state.mode = "pvp"
                self._loop()
                return
            elif choice == "ai":
                self.state.mode = "ai"
                self._choose_ai_side()
                self._choose_difficulty()
                self._loop()
                return
            elif choice == "load":
                if self._load_latest():
                    self._loop()
                    return
                # 加载失败则继续显示菜单

    def _draw_diamond(self, x: int, y: int, r: int, color) -> None:
        pygame.draw.polygon(self.screen, color,
                            [(x, y - r), (x + r, y), (x, y + r), (x - r, y)])

    def _draw_ornament(self, cx: int, y: int) -> None:
        """标题下方的金色装饰线。"""
        band = pygame.Surface((WINDOW_WIDTH, 14), pygame.SRCALPHA)
        pygame.draw.line(band, (*COLOR_GOLD, 130), (cx - 230, 7), (cx - 18, 7), 1)
        pygame.draw.line(band, (*COLOR_GOLD, 130), (cx + 18, 7), (cx + 230, 7), 1)
        pygame.draw.line(band, (*COLOR_GOLD_LIGHT, 70), (cx - 200, 9), (cx - 46, 9), 1)
        pygame.draw.line(band, (*COLOR_GOLD_LIGHT, 70), (cx + 46, 9), (cx + 200, 9), 1)
        self.screen.blit(band, (0, y - 7))
        self._draw_diamond(cx, y, 6, COLOR_GOLD)
        self._draw_diamond(cx, y, 3, COLOR_GOLD_LIGHT)
        self._draw_diamond(cx - 230, y, 3, COLOR_GOLD)
        self._draw_diamond(cx + 230, y, 3, COLOR_GOLD)

    def _draw_menu_heading(self, title: str, subtitle: str, cy: int) -> None:
        cx = WINDOW_WIDTH // 2
        if self.font_large is not None:
            shadow = self.font_large.render(title, True, (24, 12, 6))
            shadow.set_alpha(180)
            self.screen.blit(shadow, shadow.get_rect(center=(cx + 2, cy + 3)))
            text = self.font_large.render(title, True, (250, 231, 196))
            self.screen.blit(text, text.get_rect(center=(cx, cy)))
        self._draw_ornament(cx, cy + 34)
        if self.font_tiny is not None:
            sub = self.font_tiny.render(subtitle, True, (188, 158, 124))
            self.screen.blit(sub, sub.get_rect(center=(cx, cy + 58)))

    def _main_menu_rects(self):
        rects = []
        y = 290
        for key in ("pvp", "ai", "load", "quit"):
            rects.append((pygame.Rect(WINDOW_WIDTH // 2 - 180, y, 360, 60), key))
            y += 78
        return rects

    def _draw_main_menu(self, mouse) -> None:
        self.screen.blit(self._menu_bg, (0, 0))
        cx = WINDOW_WIDTH // 2

        # 两侧装饰棋子
        for color, name, dx in ((RED, "帅", -248), (BLACK, "将", 248)):
            decor = self._make_piece(color, name, 46, 56).copy()
            decor.set_alpha(215)
            self.screen.blit(decor, decor.get_rect(center=(cx + dx, 139)))

        if self.font_huge is not None:
            shadow = _render_tracked(self.font_huge, "中国象棋", (22, 11, 5), 12)
            shadow.set_alpha(200)
            self.screen.blit(shadow, shadow.get_rect(center=(cx + 3, 143)))
            title = _render_tracked(self.font_huge, "中国象棋", (250, 230, 194), 12)
            self.screen.blit(title, title.get_rect(center=(cx, 138)))
        self._draw_ornament(cx, 194)
        if self.font_small is not None:
            sub = self.font_small.render("C H I N E S E   C H E S S",
                                         True, (196, 164, 126))
            self.screen.blit(sub, sub.get_rect(center=(cx, 222)))

        labels = {"pvp": "双人对战", "ai": "人机对战",
                  "load": "读取存档", "quit": "退出"}
        for rect, key in self._main_menu_rects():
            _draw_button(self.screen, rect, labels[key], self.font_large,
                         hover=rect.collidepoint(mouse))
        if self.font_tiny is not None:
            hint = self.font_tiny.render(
                "1 / 2 / 3 切换 AI 难度    ·    Esc 退出", True, (150, 120, 94))
            self.screen.blit(hint, hint.get_rect(center=(cx, 622)))

    def _show_menu(self) -> str:
        """返回 'pvp' / 'ai' / 'load'。"""
        while True:
            self._draw_main_menu(pygame.mouse.get_pos())
            pygame.display.flip()
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    pygame.quit()
                    sys.exit(0)
                if event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE:
                    pygame.quit()
                    sys.exit(0)
                if event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
                    for rect, key in self._main_menu_rects():
                        if rect.collidepoint(event.pos):
                            if key == "quit":
                                pygame.quit()
                                sys.exit(0)
                            return key

    # ---------- 选边 ----------
    def _side_menu_rects(self):
        cx = WINDOW_WIDTH // 2
        return [pygame.Rect(cx - 200, 282, 400, 108),
                pygame.Rect(cx - 200, 410, 400, 108)]

    def _draw_choice_card(self, rect: pygame.Rect, color: str, piece_name: str,
                          title: str, desc: str, hover: bool) -> None:
        lift = -3 if hover else 0
        r = rect.move(0, lift)
        shadow, pad = _make_shadow((r.w, r.h), 16, blur=12,
                                   alpha=135 if hover else 90)
        self.screen.blit(shadow, (r.x - pad, r.y - pad + 7))
        card = _rounded_gradient((r.w, r.h), 16, (253, 246, 231), (234, 216, 187))
        border = COLOR_GOLD_LIGHT if hover else COLOR_FRAME
        pygame.draw.rect(card, border, card.get_rect(),
                         2 if hover else 1, border_radius=16)
        self.screen.blit(card, r.topleft)

        med = self._make_piece(color, piece_name, 32, 38)
        self.screen.blit(med, med.get_rect(center=(r.x + 58, r.centery)))

        if self.font_medium is not None:
            t = self.font_medium.render(title, True, COLOR_TEXT)
            self.screen.blit(t, (r.x + 112, r.y + 27))
        if self.font_tiny is not None:
            d = self.font_tiny.render(desc, True, COLOR_TEXT_SOFT)
            self.screen.blit(d, (r.x + 112, r.y + 64))

        # 右侧小箭头
        ax, ay = r.right - 36, r.centery
        col = COLOR_GOLD if hover else (206, 186, 154)
        pygame.draw.lines(self.screen, col, False,
                          [(ax - 5, ay - 6), (ax + 2, ay), (ax - 5, ay + 6)], 2)

    def _draw_side_menu(self, mouse) -> None:
        self.screen.blit(self._menu_bg, (0, 0))
        cx = WINDOW_WIDTH // 2
        self._draw_menu_heading("选择您的执子方", "红先黑后 · 点击卡片开始对局", 190)
        options = [
            (RED, "帅", "我执红棋", "先走 · 主动进攻 · 推荐新手"),
            (BLACK, "将", "我执黑棋", "后走 · 后发制人 · 更有挑战"),
        ]
        for rect, (color, name, title, desc) in zip(self._side_menu_rects(), options):
            self._draw_choice_card(rect, color, name, title, desc,
                                   rect.collidepoint(mouse))
        if self.font_tiny is not None:
            hint = self.font_tiny.render("Esc 返回（默认执红）", True, (150, 120, 94))
            self.screen.blit(hint, hint.get_rect(center=(cx, 596)))

    def _choose_ai_side(self) -> None:
        """让玩家选择执红还是执黑。"""
        while True:
            self._draw_side_menu(pygame.mouse.get_pos())
            pygame.display.flip()
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    pygame.quit()
                    sys.exit(0)
                if event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE:
                    # 取消选择 = 默认执红
                    self.state.human_color = RED
                    return
                if event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
                    for rect, color in zip(self._side_menu_rects(), (RED, BLACK)):
                        if rect.collidepoint(event.pos):
                            self.state.human_color = color
                            return

    # ---------- 难度 ----------
    def _diff_menu_rects(self):
        cx = WINDOW_WIDTH // 2
        return [pygame.Rect(cx - 220, 230 + i * 112, 440, 96) for i in range(3)]

    @staticmethod
    def _difficulty_options():
        return [
            ("简单", "浅层搜索 · 常有失误 · 适合入门", "easy", 1),
            ("正常", "攻守均衡 · 走法多样", "normal", 2),
            ("困难", "深度搜索 · 精准凶狠 · 棋力最强", "hard", 3),
        ]

    def _draw_difficulty_menu(self, mouse) -> None:
        self.screen.blit(self._menu_bg, (0, 0))
        cx = WINDOW_WIDTH // 2
        self._draw_menu_heading("选择 AI 难度", "鼠标点击卡片，或按 1 / 2 / 3 直接选定", 146)

        for rect, (name, desc, key, level) in zip(self._diff_menu_rects(),
                                                  self._difficulty_options()):
            current = key == self.state.ai_difficulty
            hover = rect.collidepoint(mouse)
            r = rect.move(0, -2 if hover else 0)
            shadow, pad = _make_shadow((r.w, r.h), 16, blur=11,
                                       alpha=130 if hover else 85)
            self.screen.blit(shadow, (r.x - pad, r.y - pad + 7))
            card = _rounded_gradient((r.w, r.h), 16, (253, 246, 231), (236, 220, 192))
            if current:
                border, bw = COLOR_GOLD_LIGHT, 3
            elif hover:
                border, bw = (222, 196, 152), 2
            else:
                border, bw = COLOR_FRAME, 1
            pygame.draw.rect(card, border, card.get_rect(), bw, border_radius=16)
            self.screen.blit(card, r.topleft)

            # 序号圆章
            badge_c = (r.x + 44, r.centery)
            pygame.draw.circle(self.screen, (240, 226, 200), badge_c, 21)
            pygame.draw.circle(self.screen, border, badge_c, 21, 2)
            if self.font_medium is not None:
                num = self.font_medium.render(str(level), True,
                                              COLOR_RED if current else COLOR_TEXT_SOFT)
                self.screen.blit(num, num.get_rect(center=badge_c))

            if self.font_medium is not None:
                t = self.font_medium.render(name, True, COLOR_TEXT)
                self.screen.blit(t, (r.x + 80, r.y + 20))
            if self.font_tiny is not None:
                d = self.font_tiny.render(desc, True, COLOR_TEXT_SOFT)
                self.screen.blit(d, (r.x + 80, r.y + 56))

            # 难度条
            mx = r.right - 116
            my = r.y + 38
            for k in range(3):
                filled = k < level
                color = (188, 128, 66) if filled else (221, 207, 183)
                if current and filled:
                    color = COLOR_RED
                pygame.draw.rect(self.screen, color,
                                 (mx + k * 24, my, 19, 6), border_radius=3)

            if current and self.font_tiny is not None:
                tag_w, tag_h = 46, 19
                tag = pygame.Rect(r.right - tag_w - 12, r.y + 9, tag_w, tag_h)
                tag_surf = _rounded_surface((tag_w, tag_h), tag_h // 2,
                                            (198, 146, 72), (170, 112, 48))
                self.screen.blit(tag_surf, tag.topleft)
                label = self.font_tiny.render("当前", True, (255, 247, 230))
                self.screen.blit(label, label.get_rect(center=tag.center))

        if self.font_tiny is not None:
            hint = self.font_tiny.render("Esc 沿用当前难度直接开始", True, (150, 120, 94))
            self.screen.blit(hint, hint.get_rect(center=(cx, 596)))

    def _choose_difficulty(self) -> None:
        """让人机对战选择 AI 难度：简单 / 正常 / 困难。"""
        options = self._difficulty_options()
        while True:
            self._draw_difficulty_menu(pygame.mouse.get_pos())
            pygame.display.flip()
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    pygame.quit()
                    sys.exit(0)
                if event.type == pygame.KEYDOWN:
                    if event.key == pygame.K_ESCAPE:
                        # 取消选择 = 沿用当前难度，直接开始对局
                        return
                    picked = {pygame.K_1: 0, pygame.K_KP1: 0,
                              pygame.K_2: 1, pygame.K_KP2: 1,
                              pygame.K_3: 2, pygame.K_KP3: 2}.get(event.key)
                    if picked is not None:
                        self.state.ai_difficulty = options[picked][2]
                        return
                if event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
                    for rect, (name, desc, key, level) in zip(self._diff_menu_rects(),
                                                              options):
                        if rect.collidepoint(event.pos):
                            self.state.ai_difficulty = key
                            return

    # ---------- 按钮回调 ----------
    def _invalidate_ai(self) -> None:
        """局面/难度变动后作废正在进行的后台思考（旧结果不会再被应用）。"""
        self._ai_generation += 1
        self._suggest_generation += 1
        self._ai_pending = None
        self.state.ai_thinking = False

    def set_difficulty(self, difficulty: str) -> None:
        """切换 AI 难度（简单/正常/困难），对局中立即生效。"""
        if difficulty not in DIFFICULTY_SETTINGS:
            return
        label = DIFFICULTY_SETTINGS[difficulty]["label"]
        if self.state.ai_difficulty == difficulty:
            self._set_status(f"AI 难度已经是「{label}」")
            return
        self.state.ai_difficulty = difficulty
        if self.state.mode != "ai":
            self._set_status(f"AI 难度已设为「{label}」（切换 AI 模式后生效）")
            return
        # AI 正在思考时换难度：作废旧搜索，按新难度重新算
        if self.state.ai_thinking:
            self._invalidate_ai()
        self._set_status(f"AI 难度已切换为「{label}」")

    def new_game(self) -> None:
        self._invalidate_ai()
        self.state.board = Board()
        self.state.selected = None
        self.state.legal_for_selected = []
        self.state.legal_for_piece = []
        self.state.suggested_move = None
        self.state.last_move = None
        self.state.red_time = DEFAULT_TIME_LIMIT_SEC
        self.state.black_time = DEFAULT_TIME_LIMIT_SEC
        self.state.ai_thinking = False
        self.state.result = "continue"
        self.state.animation = None
        self.state.undo_stack.clear()
        self._set_status("新对局开始")

    def undo(self) -> None:
        if self.state.result != "continue":
            self._set_status("对局已结束，无法悔棋")
            return
        self._invalidate_ai()
        # 在 AI 模式下需撤销两步（玩家一步 + AI 一步）
        steps = 2 if self.state.mode == "ai" else 1
        if len(self.state.board.history) < steps:
            self._set_status("没有可悔棋的步数")
            return
        audio_play = self._audio_play
        # 先清掉动画，避免动画与棋盘不一致
        self.state.animation = None
        for _ in range(steps):
            self.state.board.undo_move()
        # 回退时间（粗略：每步 30 秒）
        if self.state.mode == "ai":
            self.state.red_time = min(DEFAULT_TIME_LIMIT_SEC, self.state.red_time + 30)
            self.state.black_time = min(DEFAULT_TIME_LIMIT_SEC, self.state.black_time + 30)
        else:
            if self.state.board.turn == RED:
                self.state.red_time = min(DEFAULT_TIME_LIMIT_SEC, self.state.red_time + 30)
            else:
                self.state.black_time = min(DEFAULT_TIME_LIMIT_SEC, self.state.black_time + 30)
        self.state.selected = None
        self.state.legal_for_selected = []
        self.state.legal_for_piece = []
        self.state.suggested_move = None
        self.state.last_move = self.state.board.history[-1] if self.state.board.history else None
        if audio_play:
            audio_play("undo")
        self._set_status("已悔棋")

    def toggle_hint(self) -> None:
        """推荐当前局面的最佳走法：复用 AI 在后台搜索，并以箭头高亮。

        若已有推荐，再点一次会清除。AI 对战回合（电脑思考时）禁用。
        """
        if self.state.result != "continue":
            self._set_status("对局已结束")
            return
        if self._suggest_thinking:
            self._set_status("正在分析中，请稍候")
            return
        if self.state.ai_thinking:
            self._set_status("电脑思考中，请稍候")
            return
        if self.state.mode == "ai" and self.state.board.turn != self.state.human_color:
            self._set_status("当前是 AI 回合")
            return
        # 已有推荐：再次点击 → 清除
        if self.state.suggested_move is not None:
            self.state.suggested_move = None
            self._set_status("已清除推荐")
            return

        legal = self.state.board.legal_moves()
        if not legal:
            self._set_status("无合法走法")
            return

        self._suggest_thinking = True
        self._suggest_generation += 1
        # 用克隆棋盘给后台线程，避免线程读棋盘时主线程正在走子/悔棋
        snapshot = self.state.board.clone()
        pending = {"gen": self._suggest_generation, "move": None, "thread": None}
        self._suggest_pending = pending
        self._set_status("正在分析最佳走法...")

        def _think() -> None:
            try:
                # 提示不受对局难度影响：固定用正常档强度分析，保证建议质量
                pending["move"] = choose_move(snapshot, difficulty="normal")
            except Exception as e:  # pragma: no cover - 后台异常保护
                print(f"推荐错误: {e}")
                pending["move"] = None

        thread = threading.Thread(target=_think, daemon=True)
        pending["thread"] = thread
        thread.start()

    def save_game(self) -> None:
        import json
        os.makedirs(SAVE_DIR, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        path = os.path.join(SAVE_DIR, f"{SAVE_PREFIX}{ts}.json")
        data = {
            "board": self.state.board.to_dict(),
            "red_time": self.state.red_time,
            "black_time": self.state.black_time,
            "mode": self.state.mode,
            "human_color": self.state.human_color,
            "ai_difficulty": self.state.ai_difficulty,
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        self._set_status(f"已保存至 {path}")

    def _load_latest(self) -> bool:
        """加载最近的存档。失败返回 False。"""
        import json
        if not os.path.isdir(SAVE_DIR):
            self._set_status("没有存档")
            return False
        files = sorted(
            [f for f in os.listdir(SAVE_DIR) if f.startswith(SAVE_PREFIX) and f.endswith(".json")],
            reverse=True,
        )
        if not files:
            self._set_status("没有存档")
            return False
        path = os.path.join(SAVE_DIR, files[0])
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            self._set_status(f"读档失败: {e}")
            return False
        self._invalidate_ai()
        self.state.board = Board.from_dict(data["board"])
        self.state.red_time = data.get("red_time", DEFAULT_TIME_LIMIT_SEC)
        self.state.black_time = data.get("black_time", DEFAULT_TIME_LIMIT_SEC)
        self.state.mode = data.get("mode", "pvp")
        self.state.human_color = data.get("human_color", RED)
        # 旧存档没有 ai_difficulty 字段，默认回退为正常档
        self.state.ai_difficulty = data.get("ai_difficulty", "normal")
        self.state.selected = None
        self.state.legal_for_selected = []
        self.state.legal_for_piece = []
        self.state.suggested_move = None
        self.state.last_move = self.state.board.history[-1] if self.state.board.history else None
        self.state.animation = None
        self.state.result = self.state.board.game_result()
        self._set_status(f"已读取 {path}")
        return True

    def load_game(self) -> None:
        if self._load_latest():
            pass

    def toggle_ai(self) -> None:
        self._invalidate_ai()
        self.state.mode = "ai" if self.state.mode == "pvp" else "pvp"
        if self.state.mode == "ai":
            label = DIFFICULTY_SETTINGS[self.state.ai_difficulty]["label"]
            self._set_status(f"模式：人机（{label}，按 1/2/3 可切换难度）", duration_ms=5000)
        else:
            self._set_status("模式：双人对战")

    def quit(self) -> None:
        self.running = False

    # ---------- 主循环 ----------
    def _loop(self) -> None:
        while self.running:
            now_ms = pygame.time.get_ticks()
            self._handle_events()
            self._update_timers(now_ms)
            self._maybe_ai_move()
            self._draw(now_ms)
            self.clock.tick(60)
        pygame.quit()

    def _handle_events(self) -> None:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                self.running = False
                return
            # 按钮事件
            for btn in self.buttons:
                if btn.handle(event):
                    return
            if event.type == pygame.KEYDOWN:
                if self._handle_key(event.key):
                    continue
            if event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
                self._handle_click(event.pos)

    # 数字键 1/2/3（含小键盘）→ 简单/正常/困难
    _DIFFICULTY_KEYS = {
        pygame.K_1: "easy", pygame.K_KP1: "easy",
        pygame.K_2: "normal", pygame.K_KP2: "normal",
        pygame.K_3: "hard", pygame.K_KP3: "hard",
    }

    def _handle_key(self, key: int) -> bool:
        """键盘快捷键：1/2/3 切换 AI 难度。返回是否已处理。"""
        difficulty = self._DIFFICULTY_KEYS.get(key)
        if difficulty is not None:
            self.set_difficulty(difficulty)
            return True
        if key == pygame.K_ESCAPE:
            self.running = False
            return True
        return False

    def _handle_click(self, pos: Tuple[int, int]) -> None:
        # 侧栏难度药丸
        for key, rect in self._diff_rects:
            if rect.collidepoint(pos):
                self.set_difficulty(key)
                return
        if self.state.result != "continue":
            return
        if self.state.animation is not None:
            return  # 动画中忽略点击
        # AI 模式下，AI 回合禁用点击
        if self.state.mode == "ai" and self.state.board.turn != self.state.human_color:
            return
        coord = px_to_square(pos, self.flipped)
        if coord is None:
            return
        c, r = coord
        piece = self.state.board.squares[c][r]
        if self.state.selected is None:
            if piece and piece.color == self.state.board.turn:
                self._select(coord)
        else:
            if coord == self.state.selected:
                self._deselect()
                return
            fr = self.state.selected
            legal = self.state.board.legal_moves()
            if (fr, coord) in legal:
                self._do_move(fr, coord)
            elif piece and piece.color == self.state.board.turn:
                self._select(coord)
            else:
                self._deselect()

    def _select(self, coord: Coord) -> None:
        self.state.selected = coord
        self.state.legal_for_selected = [to for (fr, to)
                                         in self.state.board.legal_moves()
                                         if fr == coord]

    def _deselect(self) -> None:
        self.state.selected = None
        self.state.legal_for_selected = []

    def _do_move(self, fr: Coord, to: Coord) -> None:
        audio_play = self._audio_play
        captured = self.state.board.squares[to[0]][to[1]]
        piece = self.state.board.squares[fr[0]][fr[1]]
        self.state.board.make_move(fr, to)
        move = self.state.board.history[-1]
        self.state.last_move = move
        self.state.selected = None
        self.state.legal_for_selected = []
        self.state.legal_for_piece = []
        self.state.suggested_move = None
        # 播放音效
        if audio_play:
            if captured is not None:
                audio_play("capture")
            else:
                audio_play("move")
        # 启动动画
        self.state.animation = Animation(
            piece=piece, fr=fr, to=to,
            start_ms=pygame.time.get_ticks(),
            duration_ms=ANIMATION_DURATION_MS,
            flipped=self.flipped,
        )
        # 检查将军音效
        if audio_play and self.state.board.is_in_check(self.state.board.turn):
            audio_play("check")
        # 检查胜负
        result = self.state.board.game_result()
        if result != "continue":
            self.state.result = result
            if audio_play:
                audio_play("victory")

    def _update_timers(self, now_ms: int) -> None:
        if self.state.result != "continue":
            return
        if self.state.animation is not None or self.state.ai_thinking:
            # 动画期间或 AI 思考期间暂停计时
            self.state.last_tick_ms = now_ms
            return
        if self.state.last_tick_ms == 0:
            self.state.last_tick_ms = now_ms
            return
        elapsed = (now_ms - self.state.last_tick_ms) / 1000.0
        self.state.last_tick_ms = now_ms
        if self.state.board.turn == RED:
            self.state.red_time -= elapsed
            if self.state.red_time <= 0:
                self.state.red_time = 0
                self.state.result = "black_win"
                self._set_status("红方超时，黑方胜！")
        else:
            self.state.black_time -= elapsed
            if self.state.black_time <= 0:
                self.state.black_time = 0
                self.state.result = "red_win"
                self._set_status("黑方超时，红方胜！")

    def _maybe_ai_move(self) -> None:
        if self.state.mode != "ai":
            return
        if self.state.result != "continue":
            return
        if self.state.board.turn == self.state.human_color:
            return
        if self.state.ai_thinking:
            return
        if self.state.animation is not None:
            return
        self.state.ai_thinking = True
        # 克隆棋盘 + 代际号：线程只读快照，结果过期就丢弃
        snapshot = self.state.board.clone()
        difficulty = self.state.ai_difficulty
        pending = {"gen": self._ai_generation, "move": None, "thread": None}
        self._ai_pending = pending

        def _think():
            try:
                pending["move"] = choose_move(snapshot, difficulty=difficulty)
            except Exception as e:
                pending["move"] = None
                print(f"AI 错误: {e}")

        thread = threading.Thread(target=_think, daemon=True)
        pending["thread"] = thread
        thread.start()

    def _poll_ai_result(self) -> None:
        """每帧检查 AI 是否完成。"""
        pending = self._ai_pending
        if pending is None:
            if self.state.ai_thinking:
                self.state.ai_thinking = False
            return
        thread = pending["thread"]
        if thread is not None and thread.is_alive():
            return
        self._ai_pending = None
        self.state.ai_thinking = False
        # 期间发生过新游戏/悔棋/读档/换难度：丢弃这次的结果
        if pending["gen"] != self._ai_generation:
            return
        move = pending["move"]
        if move is not None:
            self._do_move(move[0], move[1])
        else:
            self._set_status("AI 无法走子")

    def _poll_suggest_result(self) -> None:
        """每帧检查『推荐走法』后台搜索是否完成。"""
        pending = self._suggest_pending
        if pending is None:
            if self._suggest_thinking:
                self._suggest_thinking = False
            return
        thread = pending["thread"]
        if thread is not None and thread.is_alive():
            return
        self._suggest_pending = None
        self._suggest_thinking = False
        if pending["gen"] != self._suggest_generation:
            return
        move = pending["move"]
        if move is None:
            self._set_status("无法推荐走法")
            return
        # 推荐结果基于快照，应用到当前棋盘前再校验一次
        board = self.state.board
        fr, to = move
        piece = board.squares[fr[0]][fr[1]]
        if piece is None or (fr, to) not in board.legal_moves():
            self._set_status("推荐走法已过期，请重新点击提示")
            return
        self.state.suggested_move = move
        target = board.squares[to[0]][to[1]]
        suffix = ""
        if target is not None:
            suffix = f" 吃 {target.name_cn}"
        self._set_status(
            f"推荐: {piece.name_cn} ({fr[0]},{fr[1]}) → ({to[0]},{to[1]}){suffix}",
            duration_ms=6000,
        )

    # ---------- 状态消息 ----------
    def _set_status(self, msg: str, duration_ms: int = 3000) -> None:
        self.state.status_message = msg
        self.state.status_message_until_ms = pygame.time.get_ticks() + duration_ms
        self._build_toast(msg)

    def _build_toast(self, msg: str) -> None:
        if self.font_small is None:
            self._toast_surface = None
            return
        text = self.font_small.render(msg, True, (255, 246, 228))
        w, h = text.get_width() + 40, text.get_height() + 16
        surf = _rounded_surface((w, h), h // 2, (46, 30, 21), (28, 17, 12),
                                border=(198, 152, 76), border_w=1)
        surf.blit(text, text.get_rect(center=(w // 2, h // 2)))
        self._toast_surface = surf
        self._toast_shadow, self._toast_shadow_pad = _make_shadow((w, h), h // 2, 7, 120)

    # ---------- 绘制 ----------
    def _draw(self, now_ms: int) -> None:
        self._poll_ai_result()
        self._poll_suggest_result()
        self.screen.blit(self._bg_surface, (0, 0))
        self._draw_board()
        self._draw_highlights(now_ms)
        self._draw_pieces(now_ms)
        # 提示气泡先画，结果横幅会盖在它上面
        if self.state.status_message and now_ms < self.state.status_message_until_ms:
            self._draw_status_message(now_ms)
        self._draw_sidebar(now_ms)
        pygame.display.flip()

    def _draw_board(self) -> None:
        """绘制预渲染好的棋盘底图与投影。"""
        self.screen.blit(self._board_shadow,
                         (BOARD_X - self._board_shadow_pad,
                          BOARD_Y - self._board_shadow_pad + 6))
        self.screen.blit(self._board_surface, (BOARD_X, BOARD_Y))

    def _draw_highlights(self, now_ms: int) -> None:
        # 上一步：起点与落点都留一层暖色
        if self.state.last_move:
            for coord in (self.state.last_move.fr, self.state.last_move.to):
                x, y = square_to_px(coord, self.flipped)
                self.screen.blit(self._last_tint,
                                 (x - TILE_SIZE // 2, y - TILE_SIZE // 2))

        # 推荐走法（置于棋盘提示层最底）
        self._draw_suggestion()

        # 提示：所有合法走法（点击提示后）
        if self.state.legal_for_piece:
            for fr, to in self.state.legal_for_piece:
                self._draw_legal_marker(
                    to, capture=(self.state.board.squares[to[0]][to[1]] is not None))

        # 选中棋子高亮 + 可落点
        if self.state.selected is not None:
            x, y = square_to_px(self.state.selected, self.flipped)
            self.screen.blit(self._select_tint,
                             (x - TILE_SIZE // 2, y - TILE_SIZE // 2))
            for to in self.state.legal_for_selected:
                self._draw_legal_marker(
                    to, capture=(self.state.board.squares[to[0]][to[1]] is not None))

        # 鼠标悬停在可动棋子上：一圈淡金描边
        elif (self.state.result == "continue" and self.state.animation is None
              and (self.state.mode != "ai"
                   or self.state.board.turn == self.state.human_color)):
            coord = px_to_square(pygame.mouse.get_pos(), self.flipped)
            if coord is not None:
                hovered = self.state.board.squares[coord[0]][coord[1]]
                if hovered is not None and hovered.color == self.state.board.turn:
                    x, y = square_to_px(coord, self.flipped)
                    self.screen.blit(self._hover_ring,
                                     (x - self._hover_ring.get_width() // 2,
                                      y - self._hover_ring.get_height() // 2))

        # 将军提示：呼吸红光
        if self.state.board.is_in_check(self.state.board.turn):
            gen = self.state.board.find_general(self.state.board.turn)
            if gen:
                x, y = square_to_px(gen, self.flipped)
                pulse = (math.sin(now_ms / 240.0) + 1) / 2
                self._check_ring.set_alpha(int(120 + 135 * pulse))
                self.screen.blit(self._check_ring,
                                 (x - self._check_ring.get_width() // 2,
                                  y - self._check_ring.get_height() // 2))

    def _draw_legal_marker(self, to: Coord, capture: bool = False) -> None:
        x, y = square_to_px(to, self.flipped)
        if capture:
            ring = self._capture_ring
            self.screen.blit(ring, (x - ring.get_width() // 2,
                                    y - ring.get_height() // 2))
        else:
            self.screen.blit(self._legal_dot,
                             (x - self._legal_dot.get_width() // 2,
                              y - self._legal_dot.get_height() // 2))

    def _draw_suggestion(self) -> None:
        """绘制 AI 推荐走法：起点方框 + 终点圆环 + 蓝色箭头。

        若推荐已失效（源棋子被吃/颜色不符），自动清除。
        """
        mv = self.state.suggested_move
        if mv is None:
            return
        fr, to = mv
        piece = self.state.board.squares[fr[0]][fr[1]]
        # 校验推荐是否仍有效：源棋子存在且是当前轮到的一方
        if piece is None or piece.color != self.state.board.turn:
            self.state.suggested_move = None
            return
        # 目标格被己方占据 → 推荐失效
        target = self.state.board.squares[to[0]][to[1]]
        if target is not None and target.color == piece.color:
            self.state.suggested_move = None
            return

        fx, fy = square_to_px(fr, self.flipped)
        tx, ty = square_to_px(to, self.flipped)

        # 起点方框（蓝色）
        srect = pygame.Rect(
            fx - TILE_SIZE // 2 + 3, fy - TILE_SIZE // 2 + 3,
            TILE_SIZE - 6, TILE_SIZE - 6,
        )
        pygame.draw.rect(self.screen, COLOR_SUGGEST, srect, 3, border_radius=10)

        # 终点双环（蓝色）
        pygame.draw.circle(self.screen, COLOR_SUGGEST, (tx, ty), PIECE_RADIUS + 6, 3)
        pygame.draw.circle(self.screen, COLOR_SUGGEST_GLOW,
                           (tx, ty), PIECE_RADIUS + 2, 1)

        dx, dy = tx - fx, ty - fy
        length = math.hypot(dx, dy)
        if length < 1:
            return
        # 起止点向中点收缩，避免压住棋子
        margin = PIECE_RADIUS + 5
        sx = fx + dx * margin / length
        sy = fy + dy * margin / length
        ex = tx - dx * margin / length
        ey = ty - dy * margin / length
        if length > margin * 2.1:
            # 宽线做柔光、窄线做主线
            pygame.draw.line(self.screen, COLOR_SUGGEST_GLOW, (sx, sy), (ex, ey), 9)
            pygame.draw.line(self.screen, COLOR_SUGGEST, (sx, sy), (ex, ey), 4)
            # 箭头
            angle = math.atan2(dy, dx)
            head_len = 18
            head_angle = math.pi / 6
            pts = [(ex, ey),
                   (ex - head_len * math.cos(angle - head_angle),
                    ey - head_len * math.sin(angle - head_angle)),
                   (ex - head_len * math.cos(angle + head_angle),
                    ey - head_len * math.sin(angle + head_angle))]
            pygame.draw.polygon(self.screen, COLOR_SUGGEST, pts)

    def _draw_pieces(self, now_ms: int) -> None:
        # 动画中的棋子：根据进度绘制
        anim = self.state.animation
        # 1) 画所有静止棋子
        for c in range(9):
            for r in range(10):
                p = self.state.board.squares[c][r]
                if p is None:
                    continue
                if anim and (c, r) == anim.fr:
                    continue  # 起始位置隐藏（已抬起）
                if anim and (c, r) == anim.to:
                    continue  # 目标位置由动画绘制
                x, y = square_to_px((c, r), self.flipped)
                self._draw_piece(p, x, y)
        # 2) 画动画棋子
        if anim and not anim.done(now_ms):
            x, y = anim.pos(now_ms)
            self._draw_piece(anim.piece, x, y)
        elif anim and anim.done(now_ms):
            # 动画结束：清空
            self.state.animation = None

    # ---------- 侧栏 ----------
    def _chip_assets(self, text: str, accent):
        key = (text, tuple(accent))
        cached = self._chip_cache.get(key)
        if cached is not None:
            return cached
        label = self.font_medium.render(text, True, accent)
        w, h = label.get_width() + 44, 34
        face = _rounded_surface((w, h), h // 2, (253, 248, 238), (245, 235, 217),
                                border=accent, border_w=2)
        self._chip_cache[key] = (face, label)
        return self._chip_cache[key]

    def _draw_sidebar(self, now_ms: int) -> None:
        self.screen.blit(self._panel_shadow,
                         (SIDEBAR_X - self._panel_shadow_pad,
                          PANEL_TOP - self._panel_shadow_pad + 4))
        self.screen.blit(self._panel_surface, (SIDEBAR_X, PANEL_TOP))

        cx = SIDEBAR_X + SIDEBAR_WIDTH // 2
        header_cy = PANEL_TOP + HEADER_H // 2

        # 标题（带金饰）
        for dx in (-98, 98):
            self._draw_diamond(cx + dx, header_cy, 4, COLOR_GOLD_LIGHT)
        if self.font_large is not None:
            shadow = self.font_large.render("中国象棋", True, (46, 12, 8))
            shadow.set_alpha(150)
            self.screen.blit(shadow, shadow.get_rect(center=(cx, header_cy + 2)))
            title = _render_tracked(self.font_large, "中国象棋", (255, 241, 216), 5)
            self.screen.blit(title, title.get_rect(center=(cx, header_cy)))

        # 回合胶囊
        if self.state.ai_thinking:
            chip_text, accent = "电脑思考中…", (152, 94, 34)
        else:
            is_red = self.state.board.turn == RED
            chip_text = "红方回合" if is_red else "黑方回合"
            accent = COLOR_RED if is_red else COLOR_BLACK
        face, label = self._chip_assets(chip_text, accent)
        chip = face.get_rect(center=(cx, PANEL_TOP + CHIP_CY))
        self.screen.blit(face, chip.topleft)
        pulse = 3.4 + 1.4 * math.sin(now_ms / 260.0)
        pygame.draw.circle(self.screen, accent, (chip.x + 18, chip.centery),
                           max(2, int(round(pulse))))
        self.screen.blit(label, label.get_rect(center=(chip.centerx + 8, chip.centery)))

        # 模式
        if self.font_tiny is not None:
            if self.state.mode == "ai":
                who = "您执红" if self.state.human_color == RED else "您执黑"
                mode_text = f"人机对战 · {who}"
            else:
                mode_text = "双人对战 · 轮流走子"
            m = self.font_tiny.render(mode_text, True, COLOR_TEXT_SOFT)
            self.screen.blit(m, m.get_rect(center=(cx, PANEL_TOP + MODE_Y + 8)))

        # 难度药丸
        labels = {"easy": "简单", "normal": "正常", "hard": "困难"}
        mouse = pygame.mouse.get_pos()
        for key, rect in self._diff_rects:
            current = key == self.state.ai_difficulty
            hover = rect.collidepoint(mouse)
            if current:
                fill, border, fg = (170, 116, 56), COLOR_GOLD_LIGHT, (255, 246, 230)
            else:
                fill = (250, 242, 227) if hover else (242, 232, 212)
                border = (208, 188, 158)
                fg = COLOR_TEXT_SOFT
            pygame.draw.rect(self.screen, fill, rect, border_radius=12)
            pygame.draw.rect(self.screen, border, rect, 1, border_radius=12)
            if self.font_tiny is not None:
                lt = self.font_tiny.render(labels[key], True, fg)
                self.screen.blit(lt, lt.get_rect(center=rect.center))

        # 计时
        self._draw_clock(CLOCK_Y[0], "红方", self.state.red_time,
                         COLOR_RED, self.state.board.turn == RED)
        self._draw_clock(CLOCK_Y[1], "黑方", self.state.black_time,
                         COLOR_BLACK, self.state.board.turn == BLACK)

        # 吃子记录
        self._draw_captures()

        # 按钮
        for btn in self.buttons:
            btn.draw(self.screen, self.font_ui)

        # 结果横幅
        if self.state.result != "continue":
            self._draw_result_banner()

    def _draw_clock(self, y_off: int, label: str, secs: float,
                    color, active: bool) -> None:
        card = pygame.Rect(PANEL_INNER_X, PANEL_TOP + y_off, PANEL_INNER_W, CLOCK_H)
        if active:
            accent = _mix(color, (255, 250, 240), 0.5)
            pygame.draw.rect(self.screen, accent, card, 1, border_radius=8)
            pygame.draw.rect(self.screen, color,
                             (card.x, card.y + 8, 3, card.h - 16), border_radius=2)
        if self.font_small is not None:
            lab = self.font_small.render(label, True, color)
            self.screen.blit(lab, (card.x + 12, card.y + 6))
        mins = int(max(0, secs)) // 60
        rest = int(max(0, secs)) % 60
        if self.font_medium is not None:
            low = secs < 60
            t = self.font_medium.render(f"{mins:02d}:{rest:02d}", True,
                                        COLOR_CHECK if low else COLOR_TEXT)
            self.screen.blit(t, (card.right - 12 - t.get_width(), card.y + 3))

        bar = pygame.Rect(card.x + 12, card.y + 34, card.w - 24, 5)
        pygame.draw.rect(self.screen, (230, 216, 190), bar, border_radius=3)
        ratio = max(0.0, min(1.0, secs / DEFAULT_TIME_LIMIT_SEC))
        if ratio > 0:
            fill_w = max(bar.h, int(bar.width * ratio))
            pygame.draw.rect(self.screen, color,
                             (bar.x, bar.y, fill_w, bar.height), border_radius=3)
            pygame.draw.line(self.screen, _mix(color, (255, 255, 255), 0.45),
                             (bar.x + 2, bar.y + 1),
                             (bar.x + fill_w - 2, bar.y + 1), 1)

    def _draw_captures(self) -> None:
        if self.font_small is not None:
            title = self.font_small.render("吃子记录", True, COLOR_TEXT)
            self.screen.blit(title, (PANEL_INNER_X, PANEL_TOP + CAPTION_Y))
            line_y = PANEL_TOP + CAPTION_Y + title.get_height() // 2
            pygame.draw.line(self.screen, (222, 205, 178),
                             (PANEL_INNER_X + title.get_width() + 10, line_y),
                             (SIDEBAR_X + SIDEBAR_WIDTH - PANEL_PAD, line_y), 1)

        # 已吃棋子由历史中 captured 字段还原
        red_gain: List[str] = []    # 红方吃掉的（黑子）
        black_gain: List[str] = []  # 黑方吃掉的（红子）
        for mv in self.state.board.history:
            if mv.captured is None:
                continue
            name = PIECE_NAMES_CN[(mv.captured.color, mv.captured.kind)]
            if mv.captured.color == BLACK:
                red_gain.append(name)
            else:
                black_gain.append(name)

        self._draw_capture_row(PANEL_TOP + CAPTURE_Y[0], "红方", COLOR_RED,
                               red_gain, BLACK)
        self._draw_capture_row(PANEL_TOP + CAPTURE_Y[1], "黑方", COLOR_BLACK,
                               black_gain, RED)

    def _draw_capture_row(self, y: int, label: str, accent, names: List[str],
                          piece_color: str) -> None:
        if self.font_tiny is None:
            return
        lab = self.font_tiny.render(label, True, accent)
        self.screen.blit(lab, (PANEL_INNER_X, y + 6))
        start = PANEL_INNER_X + 40
        if not names:
            dash = self.font_tiny.render("—", True, (186, 168, 142))
            self.screen.blit(dash, (start + 2, y + 6))
            return
        step = 30
        max_n = max(1, (PANEL_INNER_W - 44) // step)
        shown = names if len(names) <= max_n else names[:max_n - 1]
        for i, name in enumerate(shown):
            disc = self._make_piece(piece_color, name, 11, 14)
            self.screen.blit(disc, (start + i * step, y - 1))
        if len(shown) < len(names):
            more = self.font_tiny.render(f"+{len(names) - len(shown)}",
                                         True, COLOR_TEXT_SOFT)
            self.screen.blit(more, (start + len(shown) * step, y + 6))

    def _draw_result_banner(self) -> None:
        msg_map = {
            "red_win": ("红方胜", COLOR_RED),
            "black_win": ("黑方胜", COLOR_BLACK),
        }
        title, color = msg_map.get(self.state.result, ("", COLOR_TEXT))
        if not title:
            return
        board_rect = pygame.Rect(BOARD_X, BOARD_Y, BOARD_W, BOARD_H)
        dim = pygame.Surface(board_rect.size, pygame.SRCALPHA)
        dim.fill((20, 10, 5, 125))
        self.screen.blit(dim, board_rect.topleft)

        box = pygame.Rect(0, 0, 360, 190)
        box.center = board_rect.center
        shadow, pad = _make_shadow(box.size, 18, 14, 170)
        self.screen.blit(shadow, (box.x - pad, box.y - pad + 8))
        card = _rounded_gradient(box.size, 18, (252, 245, 228), (233, 215, 185))
        pygame.draw.rect(card, COLOR_FRAME, card.get_rect(), 2, border_radius=18)
        pygame.draw.rect(card, COLOR_GOLD, card.get_rect().inflate(-12, -12),
                         1, border_radius=14)
        self.screen.blit(card, box.topleft)

        if self.font_huge is not None:
            t = self.font_huge.render(title, True, color)
            self.screen.blit(t, t.get_rect(center=(box.centerx, box.y + 78)))
        line_y = box.y + 128
        pygame.draw.line(self.screen, COLOR_GOLD, (box.x + 96, line_y),
                         (box.right - 96, line_y), 1)
        self._draw_diamond(box.centerx, line_y, 4, COLOR_GOLD)
        if self.font_small is not None:
            sub = self.font_small.render("点击「新游戏」再来一局", True, COLOR_TEXT_SOFT)
            self.screen.blit(sub, sub.get_rect(center=(box.centerx, box.y + 154)))

    def _draw_status_message(self, now_ms: int) -> None:
        surf = self._toast_surface
        if surf is None:
            return
        remain = self.state.status_message_until_ms - now_ms
        fade = min(1.0, max(0.0, remain / 450.0))
        surf.set_alpha(int(255 * fade))
        cx = BOARD_ORIGIN_X + BOARD_PX_WIDTH // 2
        cy = BOARD_ORIGIN_Y + int(4.5 * TILE_SIZE)
        rect = surf.get_rect(center=(cx, cy))
        if self._toast_shadow is not None:
            self._toast_shadow.set_alpha(int(170 * fade))
            self.screen.blit(self._toast_shadow,
                             (rect.x - self._toast_shadow_pad,
                              rect.y - self._toast_shadow_pad + 3))
        self.screen.blit(surf, rect.topleft)
