"""常量配置：颜色、尺寸、中文标签、游戏参数。

配色整体围绕「紫檀木桌面 + 象牙棋子 + 朱砂/墨色字」的古典棋具质感设计。
"""
from __future__ import annotations

# --- 棋盘几何 ---
BOARD_COLS = 9
BOARD_ROWS = 10
RIVER_ROW = 4  # 河界在 row 4 与 row 5 之间；红方在 row 0-4

# --- 屏幕尺寸 ---
TILE_SIZE = 64
BOARD_PX_WIDTH = (BOARD_COLS - 1) * TILE_SIZE  # 512
BOARD_PX_HEIGHT = (BOARD_ROWS - 1) * TILE_SIZE  # 576
BOARD_MARGIN_X = 40
BOARD_MARGIN_Y = 40
SIDEBAR_WIDTH = 300
# 侧栏左缘 = 棋盘木框右缘 + 间距，保证侧栏永远不会压到棋盘
SIDEBAR_X = BOARD_MARGIN_X - TILE_SIZE // 2 + BOARD_PX_WIDTH + TILE_SIZE + 16

WINDOW_WIDTH = SIDEBAR_X + SIDEBAR_WIDTH + 20          # 920
WINDOW_HEIGHT = BOARD_MARGIN_Y * 2 + BOARD_PX_HEIGHT   # 656

# --- 颜色 (R, G, B) ---
# 桌面 / 背景
COLOR_BG = (46, 33, 26)            # 背景基色（回退用）
COLOR_BG_TOP = (92, 66, 49)        # 桌面渐变（上）
COLOR_BG_BOTTOM = (33, 23, 18)     # 桌面渐变（下）
COLOR_BG_GLOW = (255, 218, 164)    # 桌面中央暖光

# 棋盘木面
COLOR_WOOD = (228, 192, 140)       # 棋盘木纹底色
COLOR_WOOD_LIGHT = (244, 214, 168)
COLOR_WOOD_DARK = (206, 164, 112)
COLOR_GRAIN = (166, 118, 70)       # 木纹
COLOR_LINE = (92, 56, 34)          # 网格线
COLOR_LINE_SOFT = (122, 84, 54)    # 装饰线
COLOR_CHECK = (226, 58, 48)        # 将军提示

# 文字 / 边框
COLOR_TEXT = (62, 42, 28)          # 深棕文字
COLOR_TEXT_SOFT = (132, 102, 74)   # 次要文字
COLOR_TEXT_LIGHT = (252, 243, 226)
COLOR_RED = (176, 42, 34)          # 红方
COLOR_RED_DARK = (118, 26, 22)
COLOR_BLACK = (42, 38, 35)         # 黑方
COLOR_BLACK_DARK = (24, 21, 19)
COLOR_WHITE = (255, 255, 255)
COLOR_BLACK_SHADOW = (0, 0, 0)

# 木框 / 面板
COLOR_FRAME = (78, 46, 28)         # 棋盘木框 / 面板描边
COLOR_FRAME_LIGHT = (146, 96, 54)  # 框内倒角高光
COLOR_GOLD = (198, 152, 76)        # 金色装饰
COLOR_GOLD_LIGHT = (236, 198, 122)
COLOR_PANEL = (247, 238, 219)      # 侧边栏背景
COLOR_PANEL_BOTTOM = (235, 220, 193)
COLOR_PANEL_LINE = (214, 194, 162)
COLOR_PANEL_CARD = (253, 248, 236)
COLOR_HEADER_TOP = (150, 64, 47)   # 侧栏标题栏（漆器红）
COLOR_HEADER_BOTTOM = (102, 34, 26)

# 棋子
COLOR_PIECE_FACE = (250, 242, 222)
COLOR_PIECE_FACE_DARK = (220, 199, 166)
COLOR_PIECE_EDGE = (150, 116, 78)

# 交互
COLOR_HIGHLIGHT = (255, 190, 74)   # 选中高亮
COLOR_LEGAL_DOT = (46, 118, 68)    # 合法落点（绿点）
COLOR_LEGAL_CAPTURE = (192, 58, 44)  # 可吃子落点（红圈）
COLOR_SUGGEST = (48, 100, 186)     # 推荐走法（蓝色箭头）
COLOR_SUGGEST_GLOW = (146, 178, 232)

# 按钮
COLOR_BUTTON = (176, 118, 62)
COLOR_BUTTON_HOVER = (208, 152, 88)
COLOR_BUTTON_DISABLED = (196, 181, 158)

# --- 阵营 ---
RED = "red"
BLACK = "black"

# --- 棋子类型 ---
GENERAL = "G"   # 将/帅
ADVISOR = "A"   # 士/仕
ELEPHANT = "E"  # 象/相
HORSE = "H"     # 马
ROOK = "R"      # 车
CANNON = "C"    # 炮
PAWN = "P"      # 卒/兵

# 中文显示名称（红方/黑方）
PIECE_NAMES_CN = {
    (RED, GENERAL): "帅",
    (RED, ADVISOR): "仕",
    (RED, ELEPHANT): "相",
    (RED, HORSE): "马",
    (RED, ROOK): "车",
    (RED, CANNON): "炮",
    (RED, PAWN): "兵",
    (BLACK, GENERAL): "将",
    (BLACK, ADVISOR): "士",
    (BLACK, ELEPHANT): "象",
    (BLACK, HORSE): "马",
    (BLACK, ROOK): "车",
    (BLACK, CANNON): "炮",
    (BLACK, PAWN): "卒",
}

# --- 评估价值（AI 用）---
PIECE_VALUES = {
    GENERAL: 10000,
    ROOK: 900,
    CANNON: 450,
    HORSE: 400,
    ADVISOR: 200,
    ELEPHANT: 200,
    PAWN: 100,
}

# --- 游戏参数 ---
DEFAULT_TIME_LIMIT_SEC = 15 * 60     # 每方 15 分钟
AI_THINK_TIME_LIMIT_SEC = 1.5        # AI 单步最大思考时间
ANIMATION_DURATION_MS = 180          # 棋子移动动画时长

# --- 文件 ---
SAVE_DIR = "saves"
SAVE_PREFIX = "save_"
