"""
Original background music, one track per video, composed in code so the series
owns it outright: no licence to track and nothing for Content ID to claim on
TikTok or Instagram.

Each track's tempo is chosen so a whole number of bars fills its video exactly
(90 s, or 60 s for the intro). The last two bars are always a cadence, so every
video's closing card lands on a resolved chord.

    python music/compose.py            ->  public/music/<video>.m4a, all six
    python music/compose.py who why    ->  just those

Needs the packages in music/requirements.txt and ffmpeg on PATH. Fixed seeds:
every run writes the same files.
"""
import subprocess
import sys
import tempfile
import warnings
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pyloudnorm
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44100
OUT = Path(__file__).resolve().parent.parent / 'public' / 'music'
BUSES = ('kick', 'snare', 'hats', 'perc', 'bass', 'chords', 'arp', 'lead', 'fx')

# Relative level of each bus during the drops, in dB against the kick. Mixing
# by measurement keeps the balance the same whatever the instruments are.
LEVELS = dict(kick=0, snare=-7, hats=-15, perc=-12, bass=-2, chords=-6, arp=-10, lead=-5)
DUCK = dict(bass=0.55, chords=0.6, arp=0.35, lead=0.15)  # sidechain depth under the kick

rng = np.random.default_rng(0)

# pyloudnorm warns when a float mix passes 1.0 between mastering passes; the
# limiter that follows takes care of it, and write() reports the final peak.
warnings.filterwarnings('ignore', message='Possible clipped samples')


@dataclass
class Track:
    bpm: float
    length: int  # seconds: the video's running time
    style: str
    chords: list  # four (pad voicing, bass note) pairs, one a bar
    cadence: tuple  # chord indexes for the last two bars
    hook: list  # four bars of (midi note or None, eighths), one per chord
    sections: list  # (name, bars): intro, dropA, break, dropB, outro, final
    seed: int


# Per-genre parts. Steps are sixteenths in a 4/4 bar; swing delays the odd ones.
STYLES = {
    'house': dict(kick=[0, 4, 8, 12], snare=[4, 12], hats='disco', bass='offbeat', chords='supersaw', arp='up16', lead='saw', perc=[], swing=0.5),
    'disco': dict(kick=[0, 4, 8, 12], snare=[4, 12], hats='disco', bass='octave', chords='stabs', arp=None, lead='strings', perc=['shaker'], swing=0.54),
    'electro': dict(kick=[0, 4, 8, 12], snare=[4, 12], hats='sixteenths', bass='rolling', chords='supersaw', arp='up16', lead='square', perc=[], swing=0.5),
    'trance': dict(kick=[0, 4, 8, 12], snare=[4, 12], hats='disco', bass='gallop', chords='supersaw', arp='gate16', lead='saw', perc=[], swing=0.5),
    'afrohouse': dict(kick=[0, 4, 8, 12], snare=[4, 12], hats='offbeat', bass='log', chords='piano', arp=None, lead='marimba', perc=['shaker', 'conga', 'clave'], swing=0.58),
    'afrobeats': dict(kick=[0, 6, 8, 14], snare=[4, 12], hats='eighths', bass='afro', chords='highlife', arp=None, lead='flute', perc=['shaker', 'conga', 'rim'], swing=0.6),
}

TRACKS = {
    # Progressive house, A minor: Am - F - C - G, closing G -> C.
    'intro': Track(
        128, 60, 'house',
        [([57, 60, 64, 69], 45), ([57, 60, 65, 69], 41), ([55, 60, 64, 67], 48), ([55, 59, 62, 67], 43)],
        (3, 2),
        [[(76, 1), (76, 1), (79, 1), (76, 1), (74, 2), (72, 2)],
         [(72, 1), (72, 1), (74, 1), (72, 1), (69, 2), (72, 2)],
         [(76, 1), (79, 1), (84, 2), (79, 1), (76, 1), (79, 2)],
         [(74, 2), (71, 1), (74, 1), (79, 3), (None, 1)]],
        [('intro', 4), ('dropA', 12), ('break', 4), ('dropB', 8), ('outro', 3), ('final', 1)],
        11,
    ),
    # Disco house, D major: D - Bm - G - A, closing A -> D.
    'who': Track(
        120, 90, 'disco',
        [([57, 62, 66, 69], 38), ([59, 62, 66, 71], 35), ([59, 62, 67, 71], 43), ([57, 61, 64, 69], 45)],
        (3, 0),
        [[(74, 1), (76, 1), (78, 2), (81, 2), (78, 2)],
         [(78, 1), (76, 1), (74, 2), (71, 2), (74, 2)],
         [(71, 1), (74, 1), (79, 2), (78, 2), (76, 2)],
         [(76, 2), (73, 2), (76, 1), (78, 1), (76, 2)]],
        [('intro', 4), ('dropA', 16), ('break', 4), ('dropB', 16), ('outro', 4), ('final', 1)],
        22,
    ),
    # Electro-pop, E minor: Em - C - G - D, closing D -> G.
    'what': Track(
        128, 90, 'electro',
        [([59, 64, 67, 71], 40), ([60, 64, 67, 72], 36), ([59, 62, 67, 71], 43), ([57, 62, 66, 69], 38)],
        (3, 2),
        [[(71, 1), (74, 1), (76, 2), (79, 1), (76, 1), (74, 2)],
         [(72, 1), (76, 1), (79, 2), (76, 2), (72, 2)],
         [(74, 1), (79, 1), (83, 2), (81, 1), (79, 1), (74, 2)],
         [(81, 2), (78, 2), (76, 2), (74, 2)]],
        [('intro', 4), ('dropA', 16), ('break', 4), ('dropB', 20), ('outro', 3), ('final', 1)],
        33,
    ),
    # Trance, B minor: Bm - G - D - A, closing A -> D.
    'why': Track(
        136, 90, 'trance',
        [([59, 62, 66, 71], 35), ([59, 62, 67, 71], 43), ([57, 62, 66, 69], 38), ([57, 61, 64, 69], 45)],
        (3, 2),
        [[(78, 1), (78, 1), (81, 1), (78, 1), (83, 2), (81, 2)],
         [(79, 1), (78, 1), (76, 2), (74, 2), (76, 2)],
         [(74, 1), (76, 1), (78, 2), (81, 2), (86, 2)],
         [(85, 2), (81, 2), (76, 2), (81, 2)]],
        [('intro', 4), ('dropA', 20), ('break', 4), ('dropB', 20), ('outro', 2), ('final', 1)],
        44,
    ),
    # Afro-house, G minor: Gm - Eb - Bb - F, closing F -> Gm.
    'where': Track(
        120, 90, 'afrohouse',
        [([55, 58, 62, 67], 43), ([55, 58, 63, 67], 39), ([53, 58, 62, 65], 46), ([53, 57, 60, 65], 41)],
        (3, 0),
        [[(74, 1), (None, 1), (74, 1), (77, 1), (79, 2), (77, 1), (74, 1)],
         [(75, 1), (None, 1), (74, 1), (72, 1), (70, 2), (72, 2)],
         [(70, 1), (None, 1), (74, 1), (77, 1), (82, 2), (77, 2)],
         [(77, 1), (75, 1), (74, 1), (72, 1), (69, 2), (72, 2)]],
        [('intro', 4), ('dropA', 16), ('break', 4), ('dropB', 16), ('outro', 4), ('final', 1)],
        55,
    ),
    # Afrobeats, A major: Amaj7 - F#m7 - Dmaj7 - E, closing E -> A.
    'when': Track(
        112, 90, 'afrobeats',
        [([56, 61, 64, 69], 45), ([57, 61, 64, 69], 42), ([57, 61, 66, 69], 38), ([56, 59, 64, 68], 40)],
        (3, 0),
        [[(76, 2), (73, 1), (76, 1), (78, 2), (76, 2)],
         [(73, 1), (76, 1), (73, 2), (69, 2), (71, 2)],
         [(69, 1), (73, 1), (78, 2), (76, 2), (73, 2)],
         [(71, 2), (68, 2), (71, 1), (73, 1), (76, 2)]],
        [('intro', 4), ('dropA', 16), ('break', 4), ('dropB', 12), ('outro', 5), ('final', 1)],
        66,
    ),
}


# ─── DSP helpers ──────────────────────────────────────────────────────────────

def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def times(dur):
    return np.arange(int(dur * SR)) / SR


def noise(dur):
    return rng.uniform(-1, 1, int(dur * SR))


def filt(x, kind, f, order=4):
    return sosfilt(butter(order, f, btype=kind, fs=SR, output='sos'), x, axis=0)


def saw(f, t, phase=0.0):
    return 2 * ((f * t + phase) % 1.0) - 1


def adsr(t, dur, a=0.005, r=0.08):
    """Linear attack, hold until `dur`, exponential release after it."""
    return np.minimum(1, t / a) * np.where(t > dur, np.exp(-(t - dur) / r), 1.0)


def vibrato_phase(f, t, cents=14, rate=5.5, delay=0.12):
    """Integrated phase for a note whose vibrato fades in after `delay`."""
    depth = np.clip((t - delay) / 0.2, 0, 1) * cents / 1200
    return np.cumsum(f * 2 ** (depth * np.sin(2 * np.pi * rate * t))) / SR


def pan(x, p):
    """Constant-power pan of a mono signal, p from -1 (left) to 1 (right)."""
    a = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], axis=1)


def place(buf, sig, at, gain=1.0):
    """Mix a mono or stereo signal into a stereo buffer at `at` seconds."""
    i = int(round(at * SR))
    if i >= len(buf) or gain == 0:
        return
    if sig.ndim == 1:
        sig = np.stack([sig, sig], axis=1)
    n = min(len(sig), len(buf) - i)
    buf[i:i + n] += sig[:n] * gain


# ─── Instruments ──────────────────────────────────────────────────────────────

def supersaw(m, dur, cutoff, a=0.01, r=0.25, voices=7, spread=22):
    """Seven detuned saws fanned across the stereo field."""
    t = times(dur + 5 * r)
    left, right = np.zeros_like(t), np.zeros_like(t)
    for v in range(voices):
        pos = v / (voices - 1)
        s = saw(hz(m) * 2 ** (spread * (2 * pos - 1) / 1200), t, rng.random())
        left += s * np.cos(pos * np.pi / 2)
        right += s * np.sin(pos * np.pi / 2)
    x = filt(np.stack([left, right], axis=1), 'lowpass', cutoff) * (2 / voices)
    return x * adsr(t, dur, a, r)[:, None]


def pluck(m, bright=1.0):
    """Additive pluck: upper partials die away faster, like a plucked string."""
    t = times(0.6)
    f = hz(m)
    out = sum(np.sin(2 * np.pi * k * f * t) / k * np.exp(-t * (6 + 4 * k / bright)) for k in range(1, 11) if k * f < 9000)
    return out * np.minimum(1, t / 0.003)


def guitar(m):
    """Bright, short pick for the highlife riff."""
    t = times(0.45)
    f = hz(m)
    out = sum(np.sin(2 * np.pi * k * f * t) / k ** 0.8 * np.exp(-t * (7 + 3 * k)) for k in range(1, 15) if k * f < 10000)
    return out * np.minimum(1, t / 0.002) * 0.5


def piano(m):
    """Slightly inharmonic partials with a hammer-quick attack."""
    t = times(1.6)
    f = hz(m)
    out = sum(np.sin(2 * np.pi * k * f * np.sqrt(1 + 0.0004 * k * k) * t) / k ** 1.2 * np.exp(-t * (1.4 + 0.9 * k)) for k in range(1, 9))
    return out * np.minimum(1, t / 0.002) * 0.6


def marimba(m):
    t = times(0.7)
    f = hz(m)
    out = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.32) + 0.35 * np.sin(2 * np.pi * 3.9 * f * t) * np.exp(-t / 0.05) + 0.12 * np.sin(2 * np.pi * 9.2 * f * t) * np.exp(-t / 0.012)
    return out * np.minimum(1, t / 0.001)


def saw_lead(m, dur):
    t = times(dur + 0.5)
    f = hz(m)
    left = 2 * ((vibrato_phase(f * 2 ** (-9 / 1200), t) + 0.1) % 1) - 1
    right = 2 * ((vibrato_phase(f * 2 ** (9 / 1200), t) + 0.6) % 1) - 1
    sub = np.sign(np.sin(2 * np.pi * vibrato_phase(f / 2, t))) * 0.25
    x = filt(np.stack([left + sub, right + sub], axis=1), 'lowpass', 3400)
    return x * adsr(t, dur, 0.008, 0.09)[:, None]


def square_lead(m, dur):
    t = times(dur + 0.5)
    ph = vibrato_phase(hz(m), t)
    x = np.sign(np.sin(2 * np.pi * ph)) + 0.5 * np.sign(np.sin(2 * np.pi * (ph * 2 ** (7 / 1200))))
    return filt(x, 'lowpass', 2800) * adsr(t, dur, 0.006, 0.08) * 0.7


def strings_lead(m, dur):
    """Disco strings: a detuned ensemble with its octave on top."""
    return supersaw(m, dur, 4500, a=0.05, r=0.2, voices=5, spread=12) + 0.5 * supersaw(m + 12, dur, 5000, a=0.05, r=0.2, voices=5, spread=12)


def flute(m, dur):
    t = times(dur + 0.6)
    f = hz(m)
    ph = vibrato_phase(f, t, cents=20, rate=5.0, delay=0.1)
    tone = np.sin(2 * np.pi * ph) + 0.18 * np.sin(4 * np.pi * ph)
    breath = filt(noise(dur + 0.6), 'bandpass', [f, min(f * 4, 15000)], 2) * 0.12
    return (tone + breath) * adsr(t, dur, 0.05, 0.12)


def saw_bass(m, dur, cutoff):
    t = times(dur + 0.2)
    f = hz(m)
    x = filt(saw(f, t), 'lowpass', cutoff) + 0.6 * np.sin(2 * np.pi * f * t)
    return x * adsr(t, dur, 0.004, 0.03)


def log_drum(m):
    """Amapiano log drum: a pitch-dropping sine, saturated."""
    t = times(0.5)
    f = hz(m) * 2 ** (7 / 12 * np.exp(-t / 0.02))
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.tanh(2.2 * np.sin(ph)) / np.tanh(2.2) + 0.25 * np.sin(2 * ph)
    return x * np.exp(-t / 0.28) * np.minimum(1, t / 0.002)


def round_bass(m, dur):
    t = times(dur + 0.2)
    f = hz(m)
    x = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(6 * np.pi * f * t)
    return x * adsr(t, dur, 0.005, 0.05)


def kick():
    t = times(0.4)
    f = 50 + 130 * np.exp(-t / 0.025)
    body = np.tanh(1.6 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.18)) / np.tanh(1.6)
    click = filt(noise(0.4), 'highpass', 2500) * np.exp(-t / 0.002) * 0.4
    return body + click


def snare():
    """Clap layered over a snare body."""
    t = times(0.4)
    n = filt(noise(0.4), 'bandpass', [900, 3200], 2)
    env = sum(np.where(t >= o, np.exp(-(t - o) / 0.004), 0) for o in (0, 0.011, 0.022))
    env += np.where(t >= 0.03, 0.6 * np.exp(-(t - 0.03) / 0.09), 0)
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05) * 0.5
    crack = filt(noise(0.4), 'bandpass', [2000, 8000], 2) * np.exp(-t / 0.1) * 0.5
    return n * env + body + crack


def hat(open_):
    d = 0.3 if open_ else 0.06
    return filt(noise(d), 'highpass', 7000) * np.exp(-times(d) / (0.18 if open_ else 0.03)) * (0.6 if open_ else 1.0)


def shaker():
    t = times(0.08)
    return filt(noise(0.08), 'bandpass', [5000, 11000], 2) * np.minimum(1, t / 0.006) * np.exp(-t / 0.035)


def conga(f):
    t = times(0.3)
    tone = np.sin(2 * np.pi * np.cumsum(f * (1 + 0.3 * np.exp(-t / 0.02))) / SR) * np.exp(-t / 0.16)
    slap = filt(noise(0.3), 'bandpass', [1500, 5000], 2) * np.exp(-t / 0.01) * 0.3
    return tone + slap


def clave():
    t = times(0.12)
    return np.sin(2 * np.pi * 2500 * t) * np.exp(-t / 0.025)


def rim():
    t = times(0.1)
    return np.sin(2 * np.pi * 820 * t) * np.exp(-t / 0.02) + filt(noise(0.1), 'bandpass', [1500, 4000], 2) * np.exp(-t / 0.008) * 0.6


def crash():
    t = times(2.6)
    env = np.exp(-t / 0.9)
    return np.stack([filt(noise(2.6), 'highpass', 4500) * env for _ in range(2)], axis=1)


def boom():
    """Sub drop that marks each drop."""
    t = times(1.5)
    return np.sin(2 * np.pi * np.cumsum(35 + 30 * np.exp(-t / 0.3)) / SR) * np.exp(-t / 0.6)


def riser(dur):
    """Noise and a climbing tone swelling into the next section."""
    t = times(dur)
    f = 200 * 2 ** (3 * t / dur)
    tone = filt(2 * ((np.cumsum(f) / SR) % 1) - 1, 'lowpass', 5000) * 0.4
    return (filt(noise(dur), 'highpass', 1500) + tone) * (t / dur) ** 3


def reverb_ir():
    t = times(2.0)
    ir = np.stack([filt(noise(2.0), 'lowpass', 6000) * np.exp(-t / 0.4) for _ in range(2)], axis=1)
    ir[: int(0.02 * SR)] = 0  # 20 ms pre-delay
    return ir / np.sqrt(np.sum(ir ** 2) / 2)


# ─── Patterns ─────────────────────────────────────────────────────────────────

def hat_pattern(mode):
    """(step, open?, velocity) for one bar."""
    if mode == 'disco':
        return [(s, s % 4 == 2, 1.0 if s % 4 == 2 else 0.35) for s in range(16)]
    if mode == 'sixteenths':
        return [(s, False, 1.0 if s % 4 == 2 else 0.5 if s % 2 == 0 else 0.3) for s in range(16)]
    if mode == 'offbeat':
        return [(s, True, 1.0) for s in (2, 6, 10, 14)] + [(s, False, 0.3) for s in range(1, 16, 2)]
    if mode == 'eighths':
        return [(s, False, 1.0 if s % 4 == 2 else 0.55) for s in range(0, 16, 2)]
    return [(s, False, 0.8 if s % 4 == 2 else 0.45) for s in range(0, 16, 2)]  # intro and break


def bass_pattern(mode):
    """(step, semitones above the root, length in steps, velocity) for one bar."""
    if mode == 'offbeat':
        return [(s, 0, 1.6, 1.0) for s in (2, 6, 10, 14)]
    if mode == 'octave':
        return [(s, 12 if (s // 2) % 2 else 0, 1.6, 1.0) for s in range(0, 16, 2)]
    if mode == 'rolling':
        return [(s, 12 if s == 14 else 0, 0.85, 1.0 if s % 4 == 0 else 0.75) for s in range(16)]
    if mode == 'gallop':
        return [(s, 0, 0.8, 1.0 if s % 4 == 2 else 0.8) for s in range(16) if s % 4]
    if mode == 'log':
        return [(0, 0, 2, 1.0), (3, 0, 2, 0.85), (6, 7, 2, 0.9), (10, 12, 2, 0.9), (12, 0, 2, 1.0), (14, 7, 2, 0.8)]
    return [(0, 0, 2.5, 1.0), (3, 7, 1.5, 0.8), (6, 12, 1.5, 0.85), (8, 0, 2.5, 1.0), (11, 7, 1.5, 0.8), (14, 12, 1.5, 0.8)]  # afro


# ─── Arrangement ──────────────────────────────────────────────────────────────

def compose(tr):
    global rng
    rng = np.random.default_rng(tr.seed)
    st = STYLES[tr.style]
    beat = 60 / tr.bpm
    bar, step = 4 * beat, beat / 4
    plan = [(sec, i, cnt) for sec, cnt in tr.sections for i in range(cnt)]
    bars = len(plan)
    assert abs(bars * bar - tr.length) < 1e-6, f'{bars} bars at {tr.bpm} BPM is {bars * bar:.3f}s, not {tr.length}s'
    n = int(round(tr.length * SR))
    bus = {k: np.zeros((n, 2)) for k in BUSES}
    kicks = []

    # One-shot samples, made once per track.
    K, S, SH, CL, RM = kick(), snare(), shaker(), clave(), rim()
    HC, HO = hat(False), hat(True)
    CH, CLO = conga(330), conga(220)
    cache = {}

    def once(key, make):
        if key not in cache:
            cache[key] = make()
        return cache[key]

    def at(b, s):
        return b * bar + s * step + (s % 2) * (st['swing'] - 0.5) * 2 * step

    for b, (sec, i, cnt) in enumerate(plan):
        ci = tr.cadence[0] if b == bars - 2 else tr.cadence[1] if b == bars - 1 else b % 4
        pad, root = tr.chords[ci]
        t0 = b * bar
        drop = sec in ('dropA', 'dropB')
        groove = drop or sec == 'outro'
        nxt = plan[b + 1][0] if b + 1 < bars else None

        if sec == 'final':  # one last hit, left to ring under the closing card
            place(bus['kick'], K, t0)
            kicks.append(t0)
            for m in pad:
                place(bus['chords'], supersaw(m, bar, 3800, a=0.004, r=0.9), t0, 0.7)
            place(bus['bass'], round_bass(root, bar), t0, 0.9)
            place(bus['fx'], crash(), t0, 0.3)
            place(bus['fx'], boom(), t0, 0.5)
            continue

        if sec in ('intro', 'dropA', 'dropB', 'outro'):
            for s in st['kick']:
                place(bus['kick'], K, at(b, s), 1.0 if s % 4 == 0 else 0.8)
                kicks.append(at(b, s))
        if groove:
            for s in st['snare']:
                place(bus['snare'], S, at(b, s))
        if sec == 'break' and i == cnt - 1:  # snare roll into the drop
            hits = [t0 + k * step for k in range(12)] + [t0 + 12 * step + k * step / 2 for k in range(8)]
            for k, h in enumerate(hits):
                place(bus['snare'], S, h, 0.15 + 0.85 * k / len(hits))

        for s, open_, vel in hat_pattern(st['hats'] if groove else 'light'):
            place(bus['hats'], HO if open_ else HC, at(b, s), vel * (0.6 if sec == 'break' else 1.0))

        if groove or (sec == 'intro' and i >= cnt // 2):
            for p in st['perc']:
                if p == 'shaker':
                    for s in range(16):
                        place(bus['perc'], pan(SH, 0.35), at(b, s), 1.0 if s % 4 == 2 else 0.5)
                elif p == 'conga':
                    for s, hi in ((3, True), (7, False), (10, True), (11, True), (14, False)):
                        place(bus['perc'], pan(CH if hi else CLO, -0.3), at(b, s), 0.8)
                elif p == 'clave':  # son clave, 3-2 across two bars
                    for s in ((0, 6, 12) if b % 2 == 0 else (4, 8)):
                        place(bus['perc'], pan(CL, 0.2), at(b, s), 0.5)
                elif p == 'rim':
                    for s in (3, 10):
                        place(bus['perc'], pan(RM, -0.15), at(b, s), 0.7)

        if groove:
            for s, off, length, vel in bass_pattern(st['bass']):
                m = root + off
                if st['bass'] == 'log':
                    sig = once(('log', m), lambda: log_drum(m))
                elif st['bass'] == 'afro':
                    sig = once(('afro', m, length), lambda: round_bass(m, length * step))
                else:
                    cut = dict(offbeat=900, octave=1400, rolling=700, gallop=800)[st['bass']]
                    sig = once(('saw', m, length), lambda: saw_bass(m, length * step, cut))
                place(bus['bass'], sig, at(b, s), vel)

        # Chords. The intro opens its filter bar by bar.
        cutoff = 500 + 2700 * (i + 1) / cnt if sec == 'intro' else dict(dropA=4200, dropB=4800, outro=3200).get(sec, 2400)
        mode = st['chords']
        if mode == 'supersaw' or not groove:
            soft = 1.0 if mode == 'supersaw' else 0.6
            for m in pad:
                place(bus['chords'], supersaw(m, bar, cutoff, a=0.25 if sec == 'break' else 0.01), t0, soft)
        if groove and mode != 'supersaw':
            for m in pad:  # a quiet bed under the rhythm part
                place(bus['chords'], supersaw(m, bar, 1800), t0, 0.3)
            if mode == 'stabs':
                for s in (2, 6, 10, 14):
                    for m in pad:
                        place(bus['chords'], once(('stab', m), lambda: supersaw(m, 0.12, 3500, a=0.003, r=0.08)), at(b, s), 0.8)
            elif mode == 'piano':
                for s in (0, 3, 6, 10, 12):
                    for m in pad:
                        place(bus['chords'], once(('piano', m), lambda: piano(m + 12)), at(b, s), 0.7)
            elif mode == 'highlife':
                tones = sorted(pad)
                for k, s in enumerate((0, 2, 3, 5, 7, 8, 10, 11, 13, 15)):
                    m = tones[(0, 2, 1, 3, 2, 1, 3, 2, 0, 2)[k]] + 12
                    place(bus['chords'], pan(once(('gtr', m), lambda: guitar(m)), 0.25), at(b, s), 0.9)

        if st['arp'] and (drop or sec == 'break'):
            seq = sorted(m + 12 for m in pad) + [max(pad) + 24]
            for s in range(16):
                m = seq[(0, 1, 2, 3, 4, 3, 2, 1)[s % 8]]
                if st['arp'] == 'gate16':
                    sig = once(('gate', m), lambda: supersaw(m, 0.7 * step, 5000, a=0.002, r=0.03))
                else:
                    sig = once(('pluck', m), lambda: pluck(m, 1.4))
                place(bus['arp'], sig, at(b, s), (1.0 if s % 2 == 0 else 0.7) * (0.6 if sec == 'break' else 1.0))

        if sec == 'dropB' or sec == 'break' or (sec == 'dropA' and (i // 4) % 2 == 1):
            pos = 0
            for m, eighths in tr.hook[b % 4]:
                if m is not None:
                    dur = eighths * 2 * step * 0.92
                    sig = dict(
                        saw=lambda: saw_lead(m, dur), square=lambda: square_lead(m, dur), strings=lambda: strings_lead(m, dur),
                        flute=lambda: flute(m, dur), marimba=lambda: marimba(m),
                    )[st['lead']]()
                    place(bus['lead'], sig, at(b, pos * 2), 0.55 if sec == 'break' else 1.0)
                pos += eighths

        if i == 0 and drop:
            place(bus['fx'], crash(), t0, 0.3)
            place(bus['fx'], boom(), t0, 0.5)
        if nxt in ('dropA', 'dropB') and nxt != sec:
            place(bus['fx'], riser(bar), t0, 0.25)

    return mixdown(bus, plan, bar, beat, kicks)


def mixdown(bus, plan, bar, beat, kicks):
    n = len(bus['kick'])
    # Measure each bus during the drops and set it to its level against the kick.
    mask = np.zeros(n, bool)
    for b, (sec, _, _) in enumerate(plan):
        if sec in ('dropA', 'dropB'):
            mask[int(b * bar * SR):int((b + 1) * bar * SR)] = True

    def rms(x):
        return np.sqrt(np.mean(x[mask] ** 2))

    ref = rms(bus['kick'])
    for name, db in LEVELS.items():
        level = rms(bus[name])
        if level > 0 and name != 'kick':
            bus[name] *= ref * 10 ** (db / 20) / level

    # Sidechain: duck the melodic buses under every kick, the classic pump.
    t = np.arange(n) / SR
    duck = np.ones(n)
    for k in kicks:
        i0 = int(k * SR)
        seg = t[i0:i0 + int(0.35 * SR)] - k
        dip = np.minimum(1, seg / 0.005) * np.exp(-seg / 0.1)  # 5 ms in, so it never clicks
        duck[i0:i0 + len(seg)] = np.minimum(duck[i0:i0 + len(seg)], 1 - dip)
    for name, depth in DUCK.items():
        bus[name] *= (1 - depth * (1 - duck))[:, None]

    # Ping-pong dotted-eighth delay on the lead and the arp.
    d = int(0.75 * beat * SR)
    src = (bus['lead'] + bus['arp']).sum(axis=1)
    echo = np.zeros((n, 2))
    for r in range(1, 4):
        echo[r * d:, r % 2] += src[: n - r * d] * 0.3 * 0.45 ** (r - 1)
    echo = filt(echo, 'lowpass', 5000)

    dry = sum(bus[k] for k in BUSES) + echo
    send = 0.25 * bus['chords'] + 0.3 * bus['arp'] + 0.3 * bus['lead'] + 0.2 * bus['snare'] + 0.15 * bus['perc']
    ir = reverb_ir()
    wet = np.stack([fftconvolve(send[:, c], ir[:, c])[:n] for c in range(2)], axis=1)
    return master(filt(dry + 0.2 * wet, 'highpass', 30, 2))


def master(x, lufs=-14.0, ceiling=0.89):
    """Loud enough to sit with other Reels and TikToks, peaks held under -1 dBFS."""
    x = x / np.max(np.abs(x)) * 0.7
    meter = pyloudnorm.Meter(SR)
    for _ in range(3):  # the limiter costs loudness, so measure, limit, repeat
        x = pyloudnorm.normalize.loudness(x, meter.integrated_loudness(x), lufs)
        x = limit(x, ceiling)
    fi, fo = int(0.02 * SR), int(2.5 * SR)
    x[:fi] *= np.linspace(0, 1, fi)[:, None]
    x[-fo:] *= (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, fo)))[:, None]
    return x


def limit(x, ceiling):
    """Peak limiter: instant attack, 60 ms release."""
    peak = np.max(np.abs(x), axis=1)
    want = np.minimum(1.0, ceiling / np.maximum(peak, 1e-9))
    g = np.empty_like(want)
    cur, rel = 1.0, np.exp(-1 / (0.06 * SR))
    for i in range(len(want)):
        w = want[i]
        cur = w if w < cur else rel * cur + (1 - rel) * w
        g[i] = cur
    return x * g[:, None]


def write(x, name):
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / 'mix.wav'
        wavfile.write(wav, SR, (np.clip(x, -1, 1) * 32767).astype(np.int16))
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(wav), '-c:a', 'aac', '-b:a', '192k', str(OUT / f'{name}.m4a')], check=True)
    meter = pyloudnorm.Meter(SR)
    print(f'{name}.m4a: {len(x) / SR:.3f}s, {meter.integrated_loudness(x):.1f} LUFS, peak {20 * np.log10(np.max(np.abs(x))):.1f} dBFS')


if __name__ == '__main__':
    for name in sys.argv[1:] or TRACKS:
        write(compose(TRACKS[name]), name)
