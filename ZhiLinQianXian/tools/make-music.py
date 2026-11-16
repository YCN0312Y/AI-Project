# -*- coding: utf-8 -*-
"""生成主界面背景音乐：D 小调军事进行曲（军鼓 + 低音鼓 + 铜管号角 + 低音 oom-pah）。

只用标准库合成 PCM，再用 ffmpeg 编码成 MP3。重新生成直接运行本文件即可：
    python tools/make-music.py
输出 audio/march.mp3。BPB/配器/旋律都在下面的常量里，方便调整。
"""
import array
import math
import os
import random
import shutil
import subprocess
import wave

SR = 22050
BPM = 112
BEAT = 60.0 / BPM
BARS = 8
DUR = BARS * 4 * BEAT + 0.35
N = int(SR * DUR)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO_DIR = os.path.join(ROOT, 'audio')
WAV = os.path.join(AUDIO_DIR, 'march.wav')
MP3 = os.path.join(AUDIO_DIR, 'march.mp3')

buf = array.array('f', [0.0]) * N


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12.0)


def add(pos, value):
    if 0 <= pos < N:
        buf[pos] += value


def snare(t0, amp=1.0):
    """小军鼓：高通白噪声 + 一点鼓皮基音，快速衰减。"""
    start = int(t0 * SR)
    rnd = random.Random(int(t0 * 10000) + 7)
    prev = 0.0
    for i in range(int(0.19 * SR)):
        t = i / SR
        raw = rnd.uniform(-1, 1)
        hp = raw - prev * 0.7
        prev = raw
        skin = math.sin(2 * math.pi * 185 * t) * 0.22
        e = math.exp(-t * 21) * (1 - math.exp(-t * 700))
        add(start + i, amp * (hp * 0.55 + skin) * e * 0.42)


def kick(t0, amp=1.0):
    """低音鼓：频率从 ~118Hz 迅速滑到 48Hz，指数衰减。"""
    start = int(t0 * SR)
    phase = 0.0
    for i in range(int(0.28 * SR)):
        t = i / SR
        f = 48 + 70 * math.exp(-t * 30)
        phase += 2 * math.pi * f / SR
        add(start + i, amp * math.sin(phase) * math.exp(-t * 11) * 0.88)


def cymbal(t0, amp=1.0):
    start = int(t0 * SR)
    rnd = random.Random(int(t0 * 10000) + 31)
    for i in range(int(0.32 * SR)):
        t = i / SR
        e = math.exp(-t * 13) * (1 - math.exp(-t * 900))
        add(start + i, amp * rnd.uniform(-1, 1) * e * 0.075)


def brass(t0, note, beats, amp=1.0):
    """铜管/军号：锯齿谐波叠加 + ADSR + 轻微颤音。"""
    f = midi(note)
    dur = beats * BEAT * 0.92
    start = int(t0 * SR)
    for i in range(int(dur * SR)):
        t = i / SR
        a, r = 0.018, 0.06
        if t < a:
            e = t / a
        elif t > dur - r:
            e = max(0.0, (dur - t) / r)
        else:
            e = 1.0
        e *= 0.82 + 0.18 * math.exp(-t * 3)
        vib = 1 + 0.0025 * math.sin(2 * math.pi * 5.5 * t)
        s = 0.0
        for h in range(1, 8):
            s += math.sin(2 * math.pi * f * h * vib * t + h * 0.3) / h
        add(start + i, amp * s * e * 0.30)


def tuba(t0, note, beats, amp=1.0):
    """低音声部：三角波感的基频 + 三次谐波。"""
    f = midi(note)
    dur = beats * BEAT * 0.82
    start = int(t0 * SR)
    for i in range(int(dur * SR)):
        t = i / SR
        e = min(1.0, t / 0.012) * math.exp(-t * 2.6)
        s = math.sin(2 * math.pi * f * t) + 0.30 * math.sin(2 * math.pi * 3 * f * t)
        add(start + i, amp * s * e * 0.34)


def pad(t0, notes, beats, amp=1.0):
    """和弦垫：低音量正弦长音，给军乐加厚度。"""
    dur = beats * BEAT
    start = int(t0 * SR)
    for i in range(int(dur * SR)):
        t = i / SR
        e = min(1.0, t / 0.08) * min(1.0, (dur - t) / 0.12)
        s = sum(math.sin(2 * math.pi * midi(n) * t) for n in notes)
        add(start + i, amp * s * e * 0.07)


# 每小节的和弦根音 / 五度（Dm Dm Bb C | Dm Bb C Dm）
ROOTS = [38, 38, 46, 48, 38, 46, 48, 38]
FIFTHS = [45, 45, 53, 55, 45, 53, 55, 45]
CHORDS = [
    [50, 53, 57], [50, 53, 57], [46, 50, 53], [48, 52, 55],
    [50, 53, 57], [46, 50, 53], [48, 52, 55], [50, 53, 57],
]
# (小节内第几拍, 时值/拍, MIDI 音高)
MELODY = [
    [(0, 1, 62), (1, .5, 65), (1.5, .5, 69), (2, 1, 74), (3, 1, 69)],
    [(0, 1, 70), (1, .5, 69), (1.5, .5, 67), (2, 1, 65), (3, 1, 62)],
    [(0, 1, 65), (1, 1, 69), (2, 1, 74), (3, 1, 72)],
    [(0, .5, 70), (.5, .5, 69), (1, 1, 67), (2, 1, 69), (3, 1, 72)],
    [(0, 1, 74), (1, .5, 77), (1.5, .5, 76), (2, 1, 74), (3, 1, 69)],
    [(0, 1, 70), (1, 1, 74), (2, 1, 72), (3, 1, 69)],
    [(0, 1, 67), (1, .5, 70), (1.5, .5, 69), (2, 1, 67), (3, 1, 65)],
    [(0, 1, 64), (1, 1, 67), (2, 1, 69), (3, 1, 62)],
]

for bar in range(BARS):
    base = bar * 4 * BEAT
    pad(base, CHORDS[bar], 4)
    cymbal(base, 1.0 if bar % 2 == 0 else 0.6)
    for beat in range(4):
        t = base + beat * BEAT
        snare(t, 0.62 if beat % 2 == 0 else 0.46)
        snare(t + BEAT * 0.5, 0.17)
        tuba(t, ROOTS[bar] if beat % 2 == 0 else FIFTHS[bar], 0.9)
    for beat in (0, 2):
        kick(base + beat * BEAT, 0.95 if beat == 0 else 0.72)
    kick(base + 3.5 * BEAT, 0.34)
    if bar % 2 == 1:  # 偶数小节末尾的军鼓滚奏，推进到下一句
        for k in range(6):
            snare(base + 3.5 * BEAT + k * (BEAT / 12), 0.11)
    for offset, beats, note in MELODY[bar]:
        brass(base + offset * BEAT, note, beats)

# 归一化 + 极短淡入防爆音；结尾靠铜管自身的 release 自然收束，便于循环
peak = max(abs(v) for v in buf) or 1.0
gain = 0.82 / peak
fade = int(0.02 * SR)
pcm = array.array('h')
for i, v in enumerate(buf):
    g = gain * (i / fade if i < fade else 1.0)
    x = max(-1.0, min(1.0, v * g))
    pcm.append(int(x * 32767))

os.makedirs(AUDIO_DIR, exist_ok=True)
with wave.open(WAV, 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())

ff = shutil.which('ffmpeg')
if not ff:
    try:
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        ff = None
if ff:
    subprocess.run([ff, '-y', '-loglevel', 'error', '-i', WAV,
                    '-codec:a', 'libmp3lame', '-b:a', '96k', MP3], check=True)
    os.remove(WAV)
    print('Wrote', MP3, os.path.getsize(MP3), 'bytes')
else:
    print('ffmpeg not found; kept WAV at', WAV)
print('Duration: %.2fs, %d bars @ %d BPM' % (BARS * 4 * BEAT, BARS, BPM))
