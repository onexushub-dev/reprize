#!/usr/bin/env python3
"""Analysis plan 2026-11-12, Stage 2, I1 (one pass for Jogadores and Bola): does the shared pass hand the detectors the
same pictures as the two separate analyzers did? Frame times come from the clips' own sample tables (no decode); each
rule is the code's, line for line:

- Jogadores before (FocusAnalyzer, main c19cbf2): keep the first frame at or after `next`, then move `next` on by the
  interval until it passes the frame.
- Bola before (BallAnalyzer, c19cbf2) and both after (ClipScan with ScanTicks.Cursor): per tick, the first frame inside
  [tick, tick + window); Jogadores' window is its interval, Bola's 100 ms.

Per clip: Jogadores over the whole clip at 200 ms (today's default), Bola over the whole clip and over a cut that does
not start on the 100 ms grid (the middle third, + 37 ms). Writes lab/tests/focusfps/scan-parity.md.

    python3 tools/lab/scan_parity.py [dir ...]
"""
from __future__ import annotations

import glob
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
OUT = os.path.join(ROOT, "lab", "tests", "focusfps", "scan-parity.md")


def boxes(f, start, end):
    pos = start
    while pos + 8 <= end:
        f.seek(pos)
        size, kind = struct.unpack(">I4s", f.read(8))
        head = 8
        if size == 1:
            size = struct.unpack(">Q", f.read(8))[0]
            head = 16
        elif size == 0:
            size = end - pos
        if size < head:
            return
        yield kind.decode("latin-1"), pos + head, pos + size
        pos += size


def child(f, start, end, kind):
    for k, s, e in boxes(f, start, end):
        if k == kind:
            return s, e
    return None


def frame_times_ms(path):
    """Presentation times (ms, edit list applied) of the first video track's samples, sorted."""
    with open(path, "rb") as f:
        f.seek(0, 2)
        size = f.tell()
        moov = child(f, 0, size, "moov")
        if moov is None:
            return None
        for k, s, e in boxes(f, *moov):
            if k != "trak":
                continue
            mdia = child(f, s, e, "mdia")
            hdlr = child(f, *mdia, "hdlr")
            f.seek(hdlr[0] + 8)
            if f.read(4) != b"vide":
                continue
            f.seek(child(f, *mdia, "mdhd")[0])
            version = f.read(1)[0]
            f.seek(child(f, *mdia, "mdhd")[0] + (20 if version == 1 else 12))
            scale = struct.unpack(">I", f.read(4))[0]
            stbl = child(f, *child(f, *mdia, "minf"), "stbl")
            st = child(f, *stbl, "stts")
            f.seek(st[0] + 4)
            n = struct.unpack(">I", f.read(4))[0]
            dts, t = [], 0
            for _ in range(n):
                count, delta = struct.unpack(">II", f.read(8))
                for _ in range(count):
                    dts.append(t)
                    t += delta
            ct = child(f, *stbl, "ctts")
            pts = list(dts)
            if ct is not None:
                f.seek(ct[0])
                ver = f.read(1)[0]
                f.seek(ct[0] + 4)
                n = struct.unpack(">I", f.read(4))[0]
                i = 0
                for _ in range(n):
                    count, off = struct.unpack(">Ii" if ver == 1 else ">II", f.read(8))
                    for _ in range(count):
                        if i < len(pts):
                            pts[i] += off
                        i += 1
            shift = 0
            edts = child(f, s, e, "edts")
            if edts is not None:
                el = child(f, *edts, "elst")
                if el is not None:
                    f.seek(el[0])
                    ver = f.read(1)[0]
                    f.seek(el[0] + 4)
                    n = struct.unpack(">I", f.read(4))[0]
                    for _ in range(n):
                        if ver == 1:
                            _dur, media = struct.unpack(">Qq", f.read(16))
                        else:
                            _dur, media = struct.unpack(">Ii", f.read(8))
                        f.read(4)
                        if media >= 0:
                            shift = media
                            break
            return sorted((p - shift) * 1000.0 / scale for p in pts)
    return None


def focus_before(times, start, end, every):
    kept, nxt = [], start
    for t in times:
        if t < start - 0.5 or t > end + 0.5:
            continue
        if t + 0.5 < nxt:
            continue
        while nxt <= t + 0.5:
            nxt += every
        kept.append(t)
    return kept


def cursor(times, ticks, window):
    kept, nxt = [], 0
    for t in times:
        while nxt < len(ticks) and t >= ticks[nxt] + window - 0.5:
            nxt += 1
        if nxt < len(ticks) and t >= ticks[nxt] - 0.5:
            nxt += 1
            kept.append(t)
    return kept


def grid(start, end, every):
    out, t = [], start
    while t < end:
        out.append(t)
        t += every
    return out


def ball_ticks(start, end):
    rows = max(0, math.ceil((end - start) / 100 - 1e-9))
    return [start + k * 100 for k in range(0, rows, 2)]  # phase 0, empty cache


def main():
    dirs = sys.argv[1:] or [os.path.join(ROOT, "raw-dump"), os.path.join(ROOT, "clips")]
    files = sorted(set(p for d in dirs for p in glob.glob(os.path.join(d, "**", "*.mp4"), recursive=True)))
    rows, n_clips, frames_j, frames_b, diff_j, diff_b = [], 0, 0, 0, 0, 0
    cover = {}  # fps -> [ball ticks with a picture, ball ticks]  (I3: a clip slowed to 30 fps still fills the grid)
    for p in files:
        times = frame_times_ms(p)
        if not times or len(times) < 20:
            continue
        n_clips += 1
        dur = times[-1] + 1
        fps = (len(times) - 1) / max(1e-6, (times[-1] - times[0]) / 1000)
        j_old = focus_before(times, 0, dur, 200)
        j_new = cursor(times, grid(0, dur, 200), 200)
        cuts = [(0, dur), (dur / 3 + 37, 2 * dur / 3)]
        b_old = sum((cursor(times, ball_ticks(a, b), 100) for a, b in cuts), [])
        b_new = sum((cursor(times, ball_ticks(a, b), 100) for a, b in cuts), [])
        ticks = ball_ticks(0, dur)
        c = cover.setdefault(int(round(fps / 30) * 30), [0, 0])
        c[0] += len(cursor(times, ticks, 100))
        c[1] += len(ticks)
        dj = len(set(j_old) ^ set(j_new))
        db = len(set(b_old) ^ set(b_new))
        frames_j += len(j_new)
        frames_b += len(b_new)
        diff_j += dj
        diff_b += db
        if dj or db:
            rows.append(f"| {os.path.basename(p)} | {fps:.0f} | {len(j_old)} / {len(j_new)} ({dj} differ) | {len(b_new)} ({db} differ) |")
    lines = [
        "I1 gate (scan parity): pictures the detectors receive, separate analyzers (main c19cbf2) vs the shared pass.",
        "",
        f"{n_clips} app recordings. Jogadores (whole clip, 200 ms): {frames_j} pictures, {diff_j} differ. "
        f"Bola (whole clip + an off-grid middle-third cut, 200 ms): {frames_b} pictures, {diff_b} differ.",
        "Bola ticks (200 ms) that get a picture, by recording rate: "
        + ", ".join(f"{k} fps {v[0]}/{v[1]} ({100 * v[0] / max(1, v[1]):.1f}%)" for k, v in sorted(cover.items())) + ".",
        "",
    ]
    if rows:
        lines += ["| clip | fps | Jogadores before / after | Bola |", "|---|---|---|---|"] + rows
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "w").write("\n".join(lines) + "\n")
    print("\n".join(lines[:4]))
    if rows:
        print("\n".join(rows[:15]))


if __name__ == "__main__":
    main()
