"""
The trustees' film score: calm, original, composed in code like compose.py,
and timed to the film. It reads src/trustees/timeline.json, works out where
each chapter starts on screen (scenes overlap by T frames at each
transition), and gives each chapter its own texture: a different chord
progression and instrument mix, crossfaded at the chapter boundary. A board
reads captions over it for nine minutes, so it stays under the words: soft
pads, piano and plucks, a light pulse in the long middle chapters, no drops.

    python music/explainer.py    ->  public/music/trustees.m4a

Needs music/requirements.txt and ffmpeg. Fixed seeds: every run is identical.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pyloudnorm

sys.path.insert(0, str(Path(__file__).resolve().parent))
import compose as cm  # noqa: E402  (shared synths, filters, reverb, writer)

SR = cm.SR
HERE = Path(__file__).resolve().parent
TIMELINE = json.loads((HERE.parent / 'src' / 'trustees' / 'timeline.json').read_text())

BPM = 84
BEAT = 60 / BPM
BAR = 4 * BEAT

# Chords as (root midi for the bass, triad offsets). D major family throughout,
# so a crossfade between chapters never clashes.
D, E, Fs, G, A, B = 50, 52, 54, 55, 57, 59
MAJ, MIN = (0, 4, 7), (0, 3, 7)
PROGS = {
    'warm':   [(D, MAJ), (A, MAJ), (B, MIN), (G, MAJ)],           # I V vi IV
    'steady': [(G, MAJ), (D, MAJ), (E, MIN), (A, MAJ)],           # IV I ii V
    'bright': [(B, MIN), (G, MAJ), (D, MAJ), (A, MAJ)],           # vi IV I V
    'still':  [(G, MAJ), (A, MAJ), (Fs, MIN), (B, MIN)],          # IV V iii vi
    'home':   [(D, MAJ), (G, MAJ), (A, MAJ), (D, MAJ)],           # resolves
}

# One texture per chapter, in timeline order:
# Welcome, Why, Three pieces, Onboarding, Visit, Offline, Running, Levies, Owners, POPIA, Getting started.
PLAN = [
    dict(prog='warm', pad=1.0, piano='sparse', pluck=None, pulse=False, shaker=False),
    dict(prog='still', pad=1.0, piano='sparse', pluck=None, pulse=False, shaker=False),
    dict(prog='warm', pad=0.9, piano='arp', pluck=None, pulse=False, shaker=True),
    dict(prog='steady', pad=0.8, piano='arp', pluck='eighths', pulse=True, shaker=True),
    dict(prog='bright', pad=0.8, piano='sparse', pluck='eighths', pulse=True, shaker=True),
    dict(prog='still', pad=1.0, piano='sparse', pluck='slow', pulse=False, shaker=False),
    dict(prog='steady', pad=0.8, piano='arp', pluck='eighths', pulse=True, shaker=True),
    dict(prog='bright', pad=0.8, piano='arp', pluck='slow', pulse=True, shaker=True),
    dict(prog='still', pad=1.0, piano='sparse', pluck=None, pulse=False, shaker=False),
    dict(prog='still', pad=1.0, piano='arp', pluck=None, pulse=False, shaker=False),
    dict(prog='home', pad=1.0, piano='sparse', pluck='slow', pulse=False, shaker=False),
]

XFADE = 2.0  # seconds of overlap at each chapter boundary


def chapter_spans():
    """(start, end) seconds of each chapter on screen, transitions accounted for."""
    fps, T = TIMELINE['fps'], TIMELINE['T']
    frames = [[round(s * fps) for s in ch['scenes']] for ch in TIMELINE['chapters']]
    flat = [f for ch in frames for f in ch]
    starts, t = [], 0
    for k, f in enumerate(flat):
        starts.append(t)
        t += f - (T if k < len(flat) - 1 else 0)
    total = t
    spans, k = [], 0
    for ch in frames:
        a = starts[k]
        k += len(ch)
        b = starts[k] if k < len(flat) else total
        spans.append((a / fps, b / fps))
    return spans, total / fps


def soft_pad(notes, dur, level):
    """Warm, slow pad: detuned saws through a low filter, long attack and release."""
    xs = [cm.supersaw(m, dur, cutoff=1100, a=0.9, r=1.6, voices=5, spread=14) for m in notes]
    return sum(xs) * level * 0.32


def soft_bass(m, dur):
    t = cm.times(dur + 0.6)
    f = cm.hz(m - 12)
    x = np.sin(2 * np.pi * f * t) + 0.15 * np.sin(4 * np.pi * f * t)
    return x * cm.adsr(t, dur, a=0.08, r=0.5) * 0.5


def soft_kick():
    t = cm.times(0.5)
    f = 48 + 40 * np.exp(-t / 0.05)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.22) * 0.6


def section(spec, dur, seed):
    """One chapter's music, `dur` seconds long (crossfade tails included)."""
    cm.rng = np.random.default_rng(seed)
    n = int(dur * SR)
    dry = np.zeros((n + SR * 3, 2))
    wet_send = np.zeros_like(dry)
    prog = PROGS[spec['prog']]
    bars = int(np.ceil(dur / BAR)) + 1
    for b in range(bars):
        at = b * BAR
        root, quality = prog[(b // 2) % len(prog)]  # each chord lasts two bars
        chord = [root + 12 + o for o in quality]
        if b % 2 == 0:
            cm.place(dry, soft_pad(chord, 2 * BAR, spec['pad']), at)
            cm.place(dry, soft_bass(root, 2 * BAR - 0.2), at, 0.55)
        # piano: sparse = one chord tone per beat on beats 1 and 3; arp = eighths up the chord
        if spec['piano'] == 'sparse':
            for i, beat in enumerate((0, 2)):
                m = chord[(b + i) % 3] + 12
                p = cm.piano(m)
                cm.place(wet_send, cm.pan(p, -0.2 + 0.4 * i), at + beat * BEAT, 0.33)
        elif spec['piano'] == 'arp':
            notes = chord + [chord[0] + 12]
            for i in range(8):
                m = notes[i % 4] + 12
                p = cm.piano(m)
                cm.place(wet_send, cm.pan(p, -0.35 + 0.1 * (i % 8)), at + i * BEAT / 2, 0.16 + 0.05 * (i % 2 == 0))
        if spec['pluck'] == 'eighths':
            for i in range(8):
                m = chord[(i * 2) % 3] + 24
                cm.place(wet_send, cm.pan(cm.pluck(m, bright=0.6), 0.3 if i % 2 else -0.3), at + i * BEAT / 2 + BEAT / 4, 0.07)
        elif spec['pluck'] == 'slow':
            for i in range(4):
                m = chord[i % 3] + 24
                cm.place(wet_send, cm.pan(cm.pluck(m, bright=0.5), 0.25), at + i * BEAT, 0.08)
        if spec['pulse']:
            for beat in (0, 2):
                cm.place(dry, soft_kick(), at + beat * BEAT, 0.35)
        if spec['shaker']:
            for i in range(8):
                cm.place(dry, cm.filt(cm.shaker(), 'lowpass', 7000), at + i * BEAT / 2, 0.035 if i % 2 else 0.02)
    ir = cm.reverb_ir()
    wet = np.stack([cm.fftconvolve(wet_send[:, c], ir[:, c])[: len(dry)] for c in range(2)], axis=1)
    mix = dry + wet_send * 0.75 + wet * 0.45
    return mix[:n]


def build():
    spans, total = chapter_spans()
    if len(spans) != len(PLAN):
        raise SystemExit(f'timeline has {len(spans)} chapters, PLAN has {len(PLAN)}')
    n = int(round(total * SR))
    out = np.zeros((n, 2))
    for i, ((a, b), spec) in enumerate(zip(spans, PLAN)):
        start = max(0.0, a - XFADE / 2)
        end = min(total, b + XFADE / 2)
        x = section(spec, end - start, seed=100 + i)
        # Equal-power fades where this chapter overlaps its neighbours.
        fl = int(XFADE * SR)
        if i > 0:
            x[:fl] *= np.sin(np.linspace(0, np.pi / 2, fl))[:, None]
        if i < len(spans) - 1:
            x[-fl:] *= np.cos(np.linspace(0, np.pi / 2, fl))[:, None]
        cm.place(out, x, start)
    # A bed under captions: about -20 LUFS, peaks at -3 dBFS, gentle ends.
    meter = pyloudnorm.Meter(SR)
    out = pyloudnorm.normalize.loudness(out, meter.integrated_loudness(out), -20.0)
    peak = np.max(np.abs(out))
    if peak > 0.708:
        out *= 0.708 / peak
    fi, fo = int(1.5 * SR), int(4.0 * SR)
    out[:fi] *= np.linspace(0, 1, fi)[:, None]
    out[-fo:] *= (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, fo)))[:, None]
    for i, (a, b) in enumerate(spans):
        print(f'  chapter {i:2d} {TIMELINE["chapters"][i]["title"]:<34} {a:7.2f}s - {b:7.2f}s  ({PLAN[i]["prog"]})')
    return out


if __name__ == '__main__':
    cm.write(build(), 'trustees')
