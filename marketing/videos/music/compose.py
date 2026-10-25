"""
Original background music for the videos, composed in code so the series owns
it outright: no licence to track and nothing for Content ID to claim on
TikTok or Instagram.

104 BPM, so 39 bars run exactly 90 seconds and 26 bars exactly 60. The chords
cycle C - G - Am - F and the last two bars always land G -> C, so each video's
final card ends on a resolved chord.

    python music/compose.py    ->  public/music/theme-90s.m4a, theme-60s.m4a

Needs the packages in music/requirements.txt and ffmpeg on PATH. Fixed seed:
every run writes the same files.
"""
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import pyloudnorm
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44100
BPM = 104
BEAT = 60 / BPM
BAR = 4 * BEAT
STEP = BEAT / 4  # a sixteenth
OUT = Path(__file__).resolve().parent.parent / 'public' / 'music'

# One chord a bar. Pad voicings move by step; the arp walks the chord's top.
CHORDS = [
    dict(pad=[64, 67, 72, 74], bass=48, arp=[72, 74, 76, 79]),  # Cadd9
    dict(pad=[62, 67, 71, 74], bass=43, arp=[71, 74, 79, 83]),  # G
    dict(pad=[64, 69, 72, 76], bass=45, arp=[69, 72, 76, 81]),  # Am
    dict(pad=[65, 69, 72, 76], bass=41, arp=[69, 72, 77, 81]),  # Fmaj7
]

# Four-bar hook for the chorus: (midi note, length in eighths).
HOOK = [
    [(76, 2), (79, 1), (81, 1), (79, 2), (76, 2)],
    [(74, 3), (71, 1), (74, 2), (79, 2)],
    [(72, 2), (76, 1), (81, 1), (79, 2), (76, 2)],
    [(72, 2), (69, 1), (72, 1), (74, 2), (76, 2)],
]

rng = np.random.default_rng(7)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def sos(kind, f):
    return butter(4, f, btype=kind, fs=SR, output='sos')


def times(dur):
    return np.arange(int(dur * SR)) / SR


def noise(dur):
    return rng.uniform(-1, 1, int(dur * SR))


def place(buf, sig, at, gain=1.0):
    """Mix a mono or stereo signal into a stereo buffer at `at` seconds."""
    i = int(round(at * SR))
    if i >= len(buf):
        return
    if sig.ndim == 1:
        sig = np.stack([sig, sig], axis=1)
    n = min(len(sig), len(buf) - i)
    buf[i:i + n] += sig[:n] * gain


# ─── Instruments ──────────────────────────────────────────────────────────────

def pad_note(m, dur, cutoff):
    """Three detuned saws spread left-centre-right, filtered and slowly swelled."""
    t = times(dur + 0.9)
    voices = []
    for cents in (-8, 0, 8):
        f = hz(m) * 2 ** (cents / 1200)
        ph = (f * t + rng.random()) % 1.0
        voices.append(sosfilt(sos('lowpass', cutoff), 2 * ph - 1))
    env = np.minimum(1, t / 0.35) * np.where(t > dur, np.exp(-(t - dur) / 0.3), 1)
    left = (voices[0] + 0.6 * voices[1]) * env
    right = (voices[2] + 0.6 * voices[1]) * env
    return np.stack([left, right], axis=1)


def pluck(m, bright=1.0):
    """Additive pluck: upper partials die away faster, like a plucked string."""
    t = times(0.7)
    f = hz(m)
    out = np.zeros_like(t)
    for k in range(1, 11):
        if k * f > 9000:
            break
        out += np.sin(2 * np.pi * k * f * t) / k * np.exp(-t * (5 + 4 * k / bright))
    return out * np.minimum(1, t / 0.003)


def bell(m, dur):
    """Soft bell for the hook: a few inharmonic partials with long tails."""
    t = times(dur + 0.6)
    f = hz(m)
    out = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * d) for r, a, d in ((1, 1, 2.2), (2, 0.35, 3.5), (3, 0.12, 6), (4.2, 0.06, 9)))
    return out * np.minimum(1, t / 0.006)


def bass_note(m, dur):
    """Rounded bass with enough upper harmonics to be heard on a phone speaker."""
    t = times(dur)
    f = hz(m)
    out = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(6 * np.pi * f * t)
    env = np.minimum(1, t / 0.006) * (0.75 + 0.25 * np.exp(-t / 0.08)) * np.minimum(1, (dur - t) / 0.02)
    return out * env


def kick():
    t = times(0.45)
    f = 48 + 110 * np.exp(-t / 0.03)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16)
    click = sosfilt(sos('highpass', 2000), noise(0.45)) * np.exp(-t / 0.003) * 0.35
    return body + click


def clap():
    t = times(0.4)
    n = sosfilt(butter(2, [900, 3200], btype='bandpass', fs=SR, output='sos'), noise(0.4))
    env = sum(np.where(t >= o, np.exp(-(t - o) / 0.004), 0) for o in (0, 0.011, 0.022))
    env += np.where(t >= 0.03, 0.6 * np.exp(-(t - 0.03) / 0.09), 0)
    return n * env


def hat(open_=False):
    d = 0.3 if open_ else 0.06
    t = times(d)
    return sosfilt(sos('highpass', 7000), noise(d)) * np.exp(-t / (0.2 if open_ else 0.03))


def crash():
    t = times(2.6)
    hp = sos('highpass', 4500)
    env = np.exp(-t / 0.9)
    return np.stack([sosfilt(hp, noise(2.6)) * env, sosfilt(hp, noise(2.6)) * env], axis=1)


def riser():
    """A bar of filtered noise swelling into the next section."""
    t = times(BAR)
    return sosfilt(sos('highpass', 1500), noise(BAR)) * (t / BAR) ** 3


def reverb_ir():
    t = times(2.2)
    lp = sos('lowpass', 6000)
    tail = [sosfilt(lp, noise(2.2)) * np.exp(-t / 0.45) for _ in range(2)]
    ir = np.stack(tail, axis=1)
    ir[: int(0.02 * SR)] = 0  # 20 ms pre-delay
    return ir / np.sqrt(np.sum(ir ** 2) / 2)


# ─── Arrangement ──────────────────────────────────────────────────────────────

def plan(bars):
    """What plays in each bar. Shorter cuts lose the breakdown and second chorus."""
    sections = (
        [('intro', 4), ('verse', 8), ('chorus', 8), ('break', 4), ('chorus', 8), ('lite', 4), ('outro', 3)]
        if bars == 39
        else [('intro', 4), ('verse', 8), ('chorus', 8), ('lite', 3), ('outro', 3)]
    )
    out = []
    for name, n in sections:
        out += [(name, i, n) for i in range(n)]
    assert len(out) == bars, (len(out), bars)
    return out


# Pad filter cutoff (Hz) per section; the intro sweeps its own.
CUTOFF = {'verse': 2000, 'chorus': 2600, 'break': 1400, 'lite': 1800, 'outro': 1500}


def compose(bars):
    total = bars * BAR
    n = int(round(total * SR))
    bus = {k: np.zeros((n, 2)) for k in ('pad', 'arp', 'lead', 'bass', 'drums', 'fx')}
    kicks = []
    steps = plan(bars)
    for b, (sec, i, length) in enumerate(steps):
        at = b * BAR
        chord_i = b % 4
        if b == bars - 2:
            chord_i = 1  # G ...
        if b == bars - 1:
            chord_i = 0  # ... -> C to finish
        ch = CHORDS[chord_i]
        last = b == bars - 1

        # Pad: the intro opens its filter bar by bar.
        cutoff = 500 + 450 * i if sec == 'intro' else CUTOFF[sec]
        for m in ch['pad']:
            place(bus['pad'], pad_note(m, BAR * (1.6 if last else 1.0), cutoff), at, 0.065)

        # Arp, eighths, every section but the final held chord.
        if not last:
            for e, idx in enumerate([0, 2, 1, 3, 2, 1, 3, 2]):
                vel = (0.6 + 0.12 * i) if sec == 'intro' else (0.75 if e % 2 == 0 else 0.55)
                place(bus['arp'], pluck(ch['arp'][idx], 1.4 if sec == 'chorus' else 1.0), at + e * 2 * STEP, 0.19 * vel)

        drums = sec in ('verse', 'chorus', 'lite') or (sec == 'outro' and i == 0)
        if drums:
            for s in (0, 4, 8, 12):
                place(bus['drums'], kick(), at + s * STEP, 0.55)
                kicks.append(at + s * STEP)
        if sec == 'chorus':
            for s in (4, 12):
                place(bus['drums'], clap(), at + s * STEP, 0.32)
        if drums or sec == 'break':
            for s in range(16):
                offbeat = s % 4 == 2
                if sec == 'chorus' and offbeat:
                    place(bus['drums'], hat(True), at + s * STEP, 0.07)
                else:
                    place(bus['drums'], hat(), at + s * STEP, 0.09 if offbeat else 0.04)

        # Bass: root eighths, an octave jump on the last eighth of each half bar.
        if sec in ('verse', 'chorus', 'lite'):
            for e in range(8):
                m = ch['bass'] + (12 if e in (3, 7) else 0)
                place(bus['bass'], bass_note(m, 2 * STEP * 0.8), at + e * 2 * STEP, 0.27)

        # The hook carries the chorus and, softer, the breakdown.
        if sec in ('chorus', 'break'):
            pos = 0
            for m, length8 in HOOK[i % 4]:
                place(bus['lead'], bell(m, length8 * 2 * STEP), at + pos * 2 * STEP, 0.13 if sec == 'chorus' else 0.09)
                pos += length8

        if i == 0 and sec in ('verse', 'chorus'):
            place(bus['fx'], crash(), at, 0.1)
        nxt = steps[b + 1][0] if b + 1 < bars else None
        if nxt in ('verse', 'chorus') and nxt != sec:
            place(bus['fx'], riser(), at, 0.1)

    # Sidechain: pad, bass and arp duck under each kick, the classic pump.
    t = np.arange(n) / SR
    duck = np.ones(n)
    for k in kicks:
        i0 = int(k * SR)
        seg = t[i0:i0 + int(0.4 * SR)] - k
        dip = 0.5 * np.minimum(1, seg / 0.005) * np.exp(-seg / 0.11)  # 5 ms in, so it never clicks
        duck[i0:i0 + len(seg)] = np.minimum(duck[i0:i0 + len(seg)], 1 - dip)
    for name, depth in (('pad', 1.0), ('bass', 1.0), ('arp', 0.4)):
        bus[name] *= (1 - depth * (1 - duck))[:, None]

    # Ping-pong dotted-eighth delay on the arp.
    d = int(0.75 * BEAT * SR)
    arp = bus['arp'].copy()
    for r in range(1, 4):
        src = bus['arp'][:, 0] + bus['arp'][:, 1]
        echo = np.zeros(n)
        echo[r * d:] = src[: n - r * d] * 0.5 * 0.42 ** r
        arp[:, (r + 1) % 2] += echo
    bus['arp'] = arp

    dry = bus['pad'] + bus['arp'] + bus['lead'] + bus['bass'] + bus['drums'] + bus['fx']
    send = 0.3 * bus['pad'] + 0.3 * bus['arp'] + 0.4 * bus['lead'] + 0.15 * bus['drums']
    ir = reverb_ir()
    wet = np.stack([fftconvolve(send[:, c], ir[:, c])[:n] for c in range(2)], axis=1)
    mix = dry + 0.22 * wet

    mix = sosfilt(butter(2, 30, btype='highpass', fs=SR, output='sos'), mix, axis=0)
    return master(mix)


def master(x, lufs=-16.0, ceiling=0.89):
    x = x / np.max(np.abs(x)) * 0.7
    meter = pyloudnorm.Meter(SR)
    x = pyloudnorm.normalize.loudness(x, meter.integrated_loudness(x), lufs)
    # Peak limiter: instant attack, 80 ms release.
    peak = np.max(np.abs(x), axis=1)
    want = np.minimum(1.0, ceiling / np.maximum(peak, 1e-9))
    g = np.empty_like(want)
    cur, rel = 1.0, np.exp(-1 / (0.08 * SR))
    for i in range(len(want)):
        cur = want[i] if want[i] < cur else rel * cur + (1 - rel) * want[i]
        g[i] = cur
    x = x * g[:, None]
    # Fades: a breath in, and the final chord rings away over the last 3 s.
    n = len(x)
    fi, fo = int(0.03 * SR), int(3.0 * SR)
    x[:fi] *= np.linspace(0, 1, fi)[:, None]
    x[-fo:] *= (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, fo)))[:, None]
    return x


def write(x, name):
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / 'mix.wav'
        wavfile.write(wav, SR, (np.clip(x, -1, 1) * 32767).astype(np.int16))
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(wav), '-c:a', 'aac', '-b:a', '192k', str(OUT / name)], check=True)
    meter = pyloudnorm.Meter(SR)
    print(f'{name}: {len(x) / SR:.3f}s, {meter.integrated_loudness(x):.1f} LUFS, peak {20 * np.log10(np.max(np.abs(x))):.1f} dBFS')


if __name__ == '__main__':
    write(compose(39), 'theme-90s.m4a')
    write(compose(26), 'theme-60s.m4a')
