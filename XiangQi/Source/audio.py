"""音效：用 numpy 合成木质感落子声，吃子时叠加「打吃」人声。

落子声用「模态合成」模拟木棋子在木棋盘上的敲击：几个略微失谐的衰减正弦
对应棋子本身的固有振动，叠加一记极短的宽带噪声作为接触瞬间，再加一点
低频木腔共鸣与桌面反射，听起来是一声干脆的「嗒」，而不是电子蜂鸣。

吃子声是同模型的「硬碰硬」版本（音高更高、带二次撞击），后面接一句
assets/sounds/dachi.wav 里的「打吃」人声。
"""
from __future__ import annotations

import math
import os
import threading
import wave

try:
    import numpy as np
    import pygame
    _HAS_NUMPY = True
except ImportError:  # pragma: no cover
    _HAS_NUMPY = False

# --- 采样率 ---
# 必须与 mixer 实际采样率一致，否则声音会被以错误速度播放（变快、变尖）。
# gui 里 pygame.init() 会先把 mixer 初始化成系统默认值，因此 init() 里会
# 主动关掉再按 SR 重建，确保这里生成的波形按原速播放。
SR = 44100

_HERE = os.path.dirname(os.path.abspath(__file__))
VOICE_PATH = os.path.join(_HERE, "assets", "sounds", "dachi.wav")

_cache: dict = {}
_move_index = 0
_enabled = True

# --- 背景音乐状态 ---
_MUSIC_VOLUME = 0.35
_music_enabled = True
_music_thread = None
_music_pending = None      # 后台线程生成好的立体声 int16 数组
_music_sound = None
_music_start_ms = None     # 淡入起点
_music_active = False      # 是否已在播放（避免重复 enter_menu 重播）
_MUSIC_FADE_MS = 1600
# 场景：菜单/选边/难度等非对战界面播放，对战界面暂停。
# 与 _music_enabled（用户开关）分开，避免进入对战时把用户的「开」状态改掉。
_music_scene = "menu"      # 'menu' / 'battle'


def _sine(freq: float, duration: float, vol: float = 0.5,
          attack: float = 0.005, release: float = 0.05) -> "np.ndarray":
    t = np.linspace(0, duration, int(SR * duration), False)
    wave_ = np.sin(2 * math.pi * freq * t) * vol
    # 简单包络
    n = len(wave_)
    a = max(1, int(attack * SR))
    r = max(1, int(release * SR))
    env = np.ones(n)
    env[:a] = np.linspace(0, 1, a)
    env[-r:] = np.linspace(1, 0, r)
    return (wave_ * env * 32767).astype(np.int16)


def _click(freq: float, duration: float, vol: float = 0.6) -> "np.ndarray":
    t = np.linspace(0, duration, int(SR * duration), False)
    # 衰减脉冲
    decay = np.exp(-t * 30)
    wave_ = np.sin(2 * math.pi * freq * t) * decay * vol
    return (wave_ * 32767).astype(np.int16)


# ================= 木质敲击 =================
def _wood_modes(base: float = 1.0):
    """棋子敲击的固有频率：(频率, 幅度, 衰减时间, 相位)。

    频率刻意不成整数倍，避免听上去像乐音；高次模衰减更快，模拟木头
    把高频迅速吸收掉的特点。
    """
    return [
        (640 * base, 0.52, 0.060, 0.0),
        (1110 * base, 0.46, 0.046, 0.8),
        (1790 * base, 0.38, 0.033, 1.9),
        (2380 * base, 0.27, 0.024, 3.2),
        (3250 * base, 0.18, 0.016, 4.5),
        (4600 * base, 0.11, 0.010, 5.4),
    ]


def _wood_core(dur: float, base: float, seed: int):
    """单次木块敲击（未归一化）。"""
    rng = np.random.default_rng(seed)
    n = max(1, int(SR * dur))
    t = np.arange(n) / SR
    sig = np.zeros(n, dtype=np.float64)

    # 1) 接触瞬间的宽带噪声：1~2 ms 内衰减完，经一阶差分提亮
    noise = np.diff(rng.standard_normal(n), prepend=0.0)
    sig += noise * 0.55 * np.exp(-t / 0.0017)

    # 2) 木棋子本体的振动模态
    nyq = SR / 2
    for f, amp, tau, phase in _wood_modes(base):
        if f < nyq * 0.94:
            sig += amp * np.sin(2 * math.pi * f * t + phase) * np.exp(-t / tau)

    # 3) 低频「闷」声：棋子砸在木板上的体积感
    sig += 0.32 * np.sin(2 * math.pi * 176 * base * t) * np.exp(-t / 0.022)
    sig += 0.16 * np.sin(2 * math.pi * 98 * base * t) * np.exp(-t / 0.012)
    return sig


def _room_reflections(sig: "np.ndarray") -> "np.ndarray":
    """桌面与空气的极短反射，让声音不在真空中。"""
    out = sig.copy()
    for delay, gain in ((0.0055, 0.16), (0.0092, 0.10), (0.0143, 0.055), (0.0210, 0.03)):
        k = int(delay * SR)
        if k < len(out):
            out[k:] += sig[: len(out) - k] * gain
    return out


def _finish(sig: "np.ndarray", peak: float = 0.92) -> "np.ndarray":
    """整理成 int16 mono：去直流、短淡入淡出、归一化。"""
    sig = sig - sig.mean()
    n = len(sig)
    fade_in = max(1, int(0.0004 * SR))
    fade_out = max(1, int(0.012 * SR))
    if n > fade_in + fade_out:
        sig[:fade_in] *= np.linspace(0, 1, fade_in)
        sig[-fade_out:] *= np.linspace(1, 0, fade_out)
    m = float(np.abs(sig).max())
    if m > 0:
        sig = sig * (peak / m)
    return np.clip(sig * 32767, -32768, 32767).astype(np.int16)


def _move_hit(seed: int = 0, base: float = 1.0) -> "np.ndarray":
    """棋子落在木棋盘上：一声干净的「嗒」。"""
    sig = _wood_core(0.20, base, seed)
    sig = _room_reflections(sig)
    return _finish(sig, 0.88)


def _capture_hit(seed: int = 7) -> "np.ndarray":
    """棋子砸在另一枚棋子上：更硬、更高、带二次撞击。"""
    sig = _wood_core(0.26, 1.16, seed)
    # 第一次撞击后 22 ms，两枚棋子互相碰了一下（轻一些、更高）
    k = int(0.022 * SR)
    second = _wood_core(0.18, 1.48, seed + 1) * 0.55
    end = min(len(sig), k + len(second))
    sig[k:end] += second[: end - k]
    sig = _room_reflections(sig)
    return _finish(sig, 0.95)


def _load_voice() -> "np.ndarray | None":
    """读取预处理过的「打吃」人声，返回 -1~1 的 mono 浮点数组。"""
    try:
        with wave.open(VOICE_PATH, "rb") as w:
            sr = w.getframerate()
            ch = w.getnchannels()
            width = w.getsampwidth()
            raw = w.readframes(w.getnframes())
    except (OSError, EOFError):
        return None
    if width != 2:
        return None
    data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        data = data.reshape(-1, ch).mean(axis=1)
    if sr != SR and len(data) > 1:
        # 线性插值重采样（素材本身就是 22050，这里只是兜底）
        x = np.linspace(0, len(data) - 1, int(len(data) * SR / sr))
        data = np.interp(x, np.arange(len(data)), data).astype(np.float32)
    return data


def _make_capture() -> "np.ndarray":
    """吃子：真实的棋子互撞声 + 稍后一句「打吃」。"""
    hit = _capture_hit().astype(np.float32) / 32768.0
    voice = _load_voice()
    if voice is None:
        sig = hit
    else:
        # 撞击后约 110 ms 起人声，避免糊在一起
        gap = int(0.11 * SR)
        sig = np.zeros(max(len(hit), gap + len(voice)), dtype=np.float32)
        sig[: len(hit)] += hit
        sig[gap: gap + len(voice)] += voice * 0.72
    return _finish(sig, 0.94)


# ================= 背景音乐 =================
# 一首 32 秒、可无缝循环的五声音阶小品：拨弦旋律 + 低音持续音 + 短混响。
# 生成一次约 2 秒，放在后台线程里做，避免拖慢启动。
_MUSIC_BPM = 90.0
_MUSIC_BEAT = 60.0 / _MUSIC_BPM
_MUSIC_BARS = 8
_MUSIC_LOOP = int(_MUSIC_BARS * 4 * _MUSIC_BEAT * SR)   # 21.33 s
_MUSIC_TAIL = int(5.0 * SR)
_MUSIC_TOTAL = _MUSIC_LOOP + _MUSIC_TAIL
_MUSIC_LOOP_SEC = _MUSIC_LOOP / SR


def _loop_freq(target: float) -> float:
    """把频率吸附到「循环长度内整数个周期」，保证低音首尾相位连续。"""
    return max(1, round(target * _MUSIC_LOOP_SEC)) / _MUSIC_LOOP_SEC

# (起始拍, MIDI 音高, 时值/拍, 力度, 声像 -1~1)
_MUSIC_NOTES = [
    # 第 1 小节
    (0.0, 62, 4.0, 0.85, -0.15), (2.5, 57, 3.2, 0.55, 0.20),
    # 第 2 小节
    (4.0, 66, 3.4, 0.75, 0.10), (5.75, 64, 2.2, 0.50, -0.25),
    (6.75, 62, 3.2, 0.60, 0.15),
    # 第 3 小节
    (8.0, 69, 3.6, 0.80, -0.10), (10.5, 66, 2.6, 0.55, 0.25),
    # 第 4 小节
    (12.0, 64, 3.0, 0.60, -0.20), (13.75, 62, 3.6, 0.75, 0.10),
    # 第 5 小节
    (16.0, 59, 2.4, 0.50, 0.25), (17.25, 62, 2.2, 0.55, -0.15),
    (18.75, 64, 2.6, 0.60, 0.10),
    # 第 6 小节
    (20.0, 66, 3.0, 0.70, -0.10), (21.75, 69, 3.4, 0.75, 0.20),
    # 第 7 小节
    (24.0, 71, 3.6, 0.80, -0.05), (26.0, 69, 3.0, 0.65, 0.20),
    # 第 8 小节
    (28.0, 66, 2.6, 0.60, -0.20), (29.25, 64, 2.2, 0.50, 0.15),
    (30.5, 57, 4.0, 0.55, 0.00),
    # 装饰音
    (3.5, 64, 0.9, 0.30, 0.35), (7.5, 69, 0.9, 0.28, -0.35),
    (11.5, 71, 0.9, 0.30, 0.35), (19.5, 66, 1.0, 0.30, -0.35),
    (23.5, 74, 1.0, 0.30, 0.35), (27.5, 74, 1.2, 0.28, -0.35),
    # 低音呼应
    (0.0, 50, 4.5, 0.35, 0.0), (8.0, 50, 4.5, 0.32, 0.0),
    (16.0, 45, 4.5, 0.30, 0.0), (24.0, 50, 4.5, 0.34, 0.0),
]


def _midi_freq(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def _pluck(freq: float, dur: float, amp: float = 1.0) -> "np.ndarray":
    """拨弦音色：衰减谐波 + 轻微揉弦 + 触弦噪声。"""
    n = max(1, int(dur * SR))
    t = np.arange(n) / SR
    vib = 0.0022 * np.sin(2 * math.pi * 4.6 * t) * (1 - np.exp(-t / 0.35))
    sig = np.zeros(n)
    tau0 = 1.35 * (294.0 / freq) ** 0.35
    for k in range(1, 7):
        fk = freq * k * (1 + 0.00045 * k * k)
        a = amp / (k ** 1.4)
        tau = tau0 / (1 + 0.32 * (k - 1))
        phase = 2 * math.pi * fk * t * (1 + vib) + 0.4 * k
        sig += a * np.sin(phase) * np.exp(-t / tau)
    # 指甲触弦的细碎噪声
    rng = np.random.default_rng(int(freq * 7) & 0xFFFF)
    noise = rng.standard_normal(n)
    noise = np.diff(noise, prepend=0.0) * np.exp(-t / 0.004) * 0.03
    sig += noise
    attack = max(1, int(0.003 * SR))
    sig[:attack] *= np.linspace(0, 1, attack)
    return sig


def _make_music_ir(dur: float = 1.9) -> "np.ndarray":
    """合成一段柔和的房间脉冲响应。"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(99)
    ir = rng.standard_normal(n) * np.exp(-t / 0.55)
    ir = np.convolve(ir, np.ones(5) / 5, mode="same")
    ir[: int(0.015 * SR)] = 0
    ir /= math.sqrt(float((ir * ir).sum()))
    return ir


def _reverb_fft(x: "np.ndarray", ir: "np.ndarray") -> "np.ndarray":
    n = len(x) + len(ir) - 1
    nfft = 1 << (n - 1).bit_length()
    spec = np.fft.rfft(x, nfft) * np.fft.rfft(ir, nfft)
    return np.fft.irfft(spec, nfft)[: len(x)]


def _compose_music() -> "np.ndarray":
    """生成 32 秒循环背景音乐，返回 (n, 2) 的 int16 立体声数组。"""
    left = np.zeros(_MUSIC_TOTAL)
    right = np.zeros(_MUSIC_TOTAL)
    for beat, midi, beats, vel, pan in _MUSIC_NOTES:
        start = int(beat * _MUSIC_BEAT * SR)
        sig = _pluck(_midi_freq(midi), beats * _MUSIC_BEAT + 2.8, amp=vel) * 0.42
        n = min(len(sig), _MUSIC_TOTAL - start)
        gl = math.sqrt((1 - pan) / 2)
        gr = math.sqrt((1 + pan) / 2)
        left[start:start + n] += sig[:n] * gl
        right[start:start + n] += sig[:n] * gr

    # 低音持续音：频率吸附到循环长度的整数倍，保证首尾相位连续
    t = np.arange(_MUSIC_TOTAL) / SR
    lfo = 0.6 + 0.4 * np.sin(2 * math.pi * t / (_MUSIC_LOOP_SEC / 2.0))
    drone = (np.sin(2 * math.pi * _loop_freq(73.42) * t) * 0.075 +
             np.sin(2 * math.pi * _loop_freq(110.0) * t) * 0.045 +
             np.sin(2 * math.pi * _loop_freq(146.83) * t) * 0.025) * lfo
    left += drone
    right += drone * 0.96

    ir = _make_music_ir()
    left = left + _reverb_fft(left, ir) * 0.42
    right = right + _reverb_fft(right, ir) * 0.42

    # 把越过循环点的尾音折回开头，循环处即可无缝衔接
    for ch in (left, right):
        tail = ch[_MUSIC_LOOP:]
        ch[: len(tail)] += tail
    left = left[:_MUSIC_LOOP].copy()
    right = right[:_MUSIC_LOOP].copy()

    peak = max(float(np.abs(left).max()), float(np.abs(right).max())) or 1.0
    scale = 0.72 / peak
    stereo = np.column_stack([left * scale, right * scale])
    return np.clip(stereo * 32767, -32768, 32767).astype(np.int16)


def _music_worker() -> None:
    global _music_pending
    try:
        _music_pending = _compose_music()
    except Exception:  # pragma: no cover - 生成失败时静默
        _music_pending = None


def start_music() -> None:
    """开始生成/播放背景音乐（幂等）。对战场景不会启动。"""
    global _music_thread
    if not _HAS_NUMPY or not _enabled or not _music_enabled:
        return
    if _music_scene != "menu":
        return
    if _music_sound is not None:
        if not _music_active:
            _begin_music()
        return
    if _music_pending is not None:
        return  # 已生成，等主循环 update() 接手
    if _music_thread is None or not _music_thread.is_alive():
        _music_thread = threading.Thread(target=_music_worker, name="bgm",
                                         daemon=True)
        _music_thread.start()


def _begin_music() -> None:
    global _music_start_ms, _music_active
    if _music_sound is None:
        return
    _music_sound.stop()
    _music_sound.set_volume(0.0)
    _music_sound.play(loops=-1)
    _music_active = True
    _music_start_ms = pygame.time.get_ticks()


def _stop_music(fade_ms: int = 260) -> None:
    """淡出并停止当前背景音乐（保留已生成的数据，便于再次进入菜单）。"""
    global _music_start_ms, _music_active
    _music_start_ms = None
    _music_active = False
    if _music_sound is not None:
        _music_sound.fadeout(fade_ms)


def set_scene(scene: str) -> None:
    """切换音乐场景：'menu' 播放背景音乐，'battle' 停止。

    幂等；重复调用不会重播或打断淡入。
    """
    global _music_scene
    scene = "battle" if scene == "battle" else "menu"
    if scene == _music_scene:
        if scene == "menu":
            start_music()
        return
    _music_scene = scene
    if scene == "battle":
        _stop_music()
    else:
        start_music()


def enter_menu() -> None:
    """进入菜单等非对战界面：播放背景音乐。"""
    set_scene("menu")


def enter_battle() -> None:
    """进入对战界面：暂停背景音乐（不改变用户的开关偏好）。"""
    set_scene("battle")


def current_scene() -> str:
    return _music_scene


def update() -> None:
    """主循环每帧调用：接住后台生成好的音乐，并处理淡入。"""
    global _music_pending, _music_sound, _music_start_ms
    if _music_pending is not None:
        data, _music_pending = _music_pending, None
        try:
            _music_sound = pygame.sndarray.make_sound(np.ascontiguousarray(data))
            _music_sound.set_volume(0.0)
        except pygame.error:  # pragma: no cover
            _music_sound = None
        if (_music_sound is not None and _music_enabled
                and _music_scene == "menu"):
            _begin_music()
    # 只有菜单场景且用户开着音乐时才需要维护淡入
    if (_music_sound is not None and _music_start_ms is not None
            and _music_scene == "menu"):
        progress = (pygame.time.get_ticks() - _music_start_ms) / _MUSIC_FADE_MS
        if progress >= 1.0:
            _music_sound.set_volume(_MUSIC_VOLUME)
            _music_start_ms = None
        else:
            _music_sound.set_volume(_MUSIC_VOLUME * max(0.0, progress))


def set_music_enabled(flag: bool) -> None:
    global _music_enabled, _music_start_ms
    _music_enabled = bool(flag)
    if not _music_enabled:
        _stop_music(350)
    else:
        start_music()


def toggle_music() -> bool:
    set_music_enabled(not _music_enabled)
    return _music_enabled


def music_enabled() -> bool:
    return _music_enabled


def _make(name: str):
    if not _HAS_NUMPY:
        return None
    if name == "move":
        # 三次略有差异的落子声，轮流使用，避免机械重复
        variants = [_move_hit(seed=11, base=0.98),
                    _move_hit(seed=23, base=1.04),
                    _move_hit(seed=37, base=1.00)]
        sounds = []
        for mono in variants:
            stereo = np.ascontiguousarray(np.column_stack([mono, mono]))
            sounds.append(pygame.sndarray.make_sound(stereo))
        return sounds
    elif name == "capture":
        mono = _make_capture()
    elif name == "check":
        snd = _sine(660, 0.22, 0.6)
        snd2 = _sine(440, 0.22, 0.55)
        mono = np.concatenate([snd, snd2])
    elif name == "undo":
        snd = _click(220, 0.06, 0.4)
        snd2 = _click(180, 0.08, 0.35)
        mono = np.concatenate([snd, snd2])
    elif name == "victory":
        snd = _sine(523, 0.15, 0.5)
        snd2 = _sine(659, 0.15, 0.5)
        snd3 = _sine(784, 0.25, 0.5)
        mono = np.concatenate([snd, snd2, snd3])
    else:
        return None
    # 立体声
    stereo = np.column_stack([mono, mono])
    stereo = np.ascontiguousarray(stereo)
    return pygame.sndarray.make_sound(stereo)


def play(name: str) -> None:
    """播放指定音效（如不可用则静默）。"""
    global _move_index
    if not _enabled or not _HAS_NUMPY:
        return
    if name in _cache:
        cached = _cache[name]
    else:
        cached = _make(name)
        _cache[name] = cached
    if cached is None:
        return
    if isinstance(cached, (list, tuple)):
        # 落子声有多个变体，轮流播放
        if not cached:
            return
        sound = cached[_move_index % len(cached)]
        _move_index += 1
    else:
        sound = cached
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
        # pygame.init() 可能已用系统默认采样率初始化过 mixer；
        # 这里强制按 SR 重建，避免音频被加速播放。
        if pygame.mixer.get_init() is not None:
            pygame.mixer.quit()
        pygame.mixer.init(frequency=SR, size=-16, channels=2, buffer=512)
    except pygame.error:  # pragma: no cover
        _enabled = False
