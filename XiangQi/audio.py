"""音效：使用 numpy 生成短促合成音效；numpy 不可用时自动静音。"""
from __future__ import annotations

import math

try:
    import numpy as np
    import pygame
    _HAS_NUMPY = True
except ImportError:  # pragma: no cover
    _HAS_NUMPY = False

# --- 采样率 ---
SR = 22050

_cache: dict = {}
_enabled = True


def _sine(freq: float, duration: float, vol: float = 0.5,
          attack: float = 0.005, release: float = 0.05) -> "np.ndarray":
    t = np.linspace(0, duration, int(SR * duration), False)
    wave = np.sin(2 * math.pi * freq * t) * vol
    # 简单包络
    n = len(wave)
    a = max(1, int(attack * SR))
    r = max(1, int(release * SR))
    env = np.ones(n)
    env[:a] = np.linspace(0, 1, a)
    env[-r:] = np.linspace(1, 0, r)
    return (wave * env * 32767).astype(np.int16)


def _click(freq: float, duration: float, vol: float = 0.6) -> "np.ndarray":
    t = np.linspace(0, duration, int(SR * duration), False)
    # 衰减脉冲
    decay = np.exp(-t * 30)
    wave = np.sin(2 * math.pi * freq * t) * decay * vol
    return (wave * 32767).astype(np.int16)


def _make(name: str):
    if not _HAS_NUMPY:
        return None
    if name == "move":
        snd = _click(280, 0.08, 0.55)
    elif name == "capture":
        snd = _sine(880, 0.18, 0.55, attack=0.005, release=0.15)
        snd2 = _click(180, 0.12, 0.4)
        snd = np.concatenate([snd, snd2])
    elif name == "check":
        snd = _sine(660, 0.22, 0.6)
        snd2 = _sine(440, 0.22, 0.55)
        snd = np.concatenate([snd, snd2])
    elif name == "undo":
        snd = _click(220, 0.06, 0.4)
        snd2 = _click(180, 0.08, 0.35)
        snd = np.concatenate([snd, snd2])
    elif name == "victory":
        snd = _sine(523, 0.15, 0.5)
        snd2 = _sine(659, 0.15, 0.5)
        snd3 = _sine(784, 0.25, 0.5)
        snd = np.concatenate([snd, snd2, snd3])
    else:
        return None
    # 立体声
    stereo = np.column_stack([snd, snd])
    stereo = np.ascontiguousarray(stereo)
    return pygame.sndarray.make_sound(stereo)


def play(name: str) -> None:
    """播放指定音效（如不可用则静默）。"""
    if not _enabled or not _HAS_NUMPY:
        return
    if name in _cache:
        sound = _cache[name]
    else:
        sound = _make(name)
        _cache[name] = sound
    if sound is not None:
        try:
            sound.play()
        except pygame.error:  # pragma: no cover
            pass


def set_enabled(flag: bool) -> None:
    global _enabled
    _enabled = flag


def init() -> None:
    """尝试初始化 mixer。失败则禁用音效。"""
    global _enabled
    if not _HAS_NUMPY:
        _enabled = False
        return
    try:
        pygame.mixer.pre_init(SR, -16, 2, 512)
        pygame.mixer.init()
    except pygame.error:  # pragma: no cover
        _enabled = False