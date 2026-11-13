#!/usr/bin/env python3
"""Modo Foco lab, measurement for the 2026-11-12 analysis plan (docs/superpowers/plans/2026-11-12-focus-pipeline-analysis-and-improvement-plan.md, section 6):
would MOTION-GATED tiles make Bola cheaper without losing the ball?

Today every analysed frame sends the whole frame + all 416 px tiles to the detector (19 regions at 1920 x 1080); the
model is ~3/4 of Bola's time on the phone and its cost is linear in the regions. The camera is on a tripod, so a ball
in play always changes the picture where it is. Here: a tile is run only when the picture changed inside it between
this analysed frame and its neighbours 100 ms before / after (grey thumbnail, 3-frame difference); the whole frame is
always run. Unlike test 19's tiles around the path (roi_tiles.py), the choice does not depend on where the path
thinks the ball is, so it cannot lock on a wrong object.

Offline simulation, no new inference (as roi_tiles.py): a candidate of the full run is kept when its centre lies in
a tile that would have been run. Candidates found only by the whole-frame region are dropped too (conservative: the
phone would keep them). Output: a ball_detect-style file `<clip>.<out>.json` with "inferences" per analysed frame
(then ball_track.py / det_report.py as usual), and one summary line per clip.

    python3 tools/lab/motion_tiles.py --det btpl-4kplan-1920 --out btpl-4kplan-1920-mt20c --thr 20 --mode and --carry 1 [clip ...]

`--carry 1`: a tile that is not run keeps the candidates it held the last time it was run (nothing changed there), so
still objects stay "seen on every frame" for the path's still-object filter. Without it the filter stops recognising
them (they come and go with the tiles) and the path picks them more often (measured: precision -2 to -3 points on
beach tennis).

Needs python3 + numpy + ffmpeg only (no venv). Reads each clip's window once at 640 px wide, 10 fps, grey.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import evaluate as ev  # noqa: E402

DET = os.path.join(ev.ROOT, "lab", "tests", "detect")
THUMB_W = 640


def starts(n, T, overlap=80):
    if n <= T:
        return [0]
    k = int(np.ceil((n - overlap) / (T - overlap)))
    return [int(round(i * (n - T) / (k - 1))) for i in range(k)]


def tiles(W, H, T):
    return [(x, y) for y in starts(H, T) for x in starts(W, T)]


def phone_thumbs(video, start_ms, n, W, H, tw, th, grey):
    """Test 55: the thumbnail as the app made it on 2026-11-12. Core Image folds the 4K -> 1920 scale and the thumbnail
    scale into one affine transform and samples the native frame once, bilinear, with no averaging (one sample per
    thumbnail pixel); the grey is (R + G + B) / 3 (`grey="mean"`) or the luma (`grey="luma"`, BT.601)."""
    # the decoded (native) size, not the labels' size: Core Image samples the native frame
    probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_streams", "-of", "json",
                                       video], capture_output=True, check=True).stdout)["streams"][0]
    W, H = probe["width"], probe["height"]
    if (W >= H) != (tw >= th):
        W, H = H, W
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{start_ms / 1000:.3f}", "-t", f"{n / 10 + 0.2:.3f}", "-i", video,
           "-vf", "fps=10", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    # pixel centres of the thumbnail in source pixels (Core Image samples at centres), bilinear weights
    xs = (np.arange(tw) + 0.5) * W / tw - 0.5
    ys = (np.arange(th) + 0.5) * H / th - 0.5
    x0 = np.clip(np.floor(xs).astype(int), 0, W - 2)
    y0 = np.clip(np.floor(ys).astype(int), 0, H - 2)
    fx = np.clip(xs - x0, 0, 1)[None, :, None]
    fy = np.clip(ys - y0, 0, 1)[:, None, None]
    out, size = [], W * H * 3
    while len(out) < n:
        raw = proc.stdout.read(size)
        if len(raw) < size:
            break
        f = np.frombuffer(raw, np.uint8).reshape(H, W, 3)
        r0, r1 = f[y0], f[y0 + 1]  # only the rows and columns sampled are converted
        a = r0[:, x0].astype(np.float32)
        b = r0[:, x0 + 1].astype(np.float32)
        c = r1[:, x0].astype(np.float32)
        d = r1[:, x0 + 1].astype(np.float32)
        rgb = np.rint((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy)
        if grey == "luma":
            g = np.rint(rgb @ np.array([0.299, 0.587, 0.114], np.float32))
        else:
            g = np.floor(rgb.sum(axis=2) / 3)
        out.append(g.astype(np.int16))
    proc.stdout.close()
    proc.wait()
    a = np.stack(out)
    if len(a) < n:
        a = np.concatenate([a, np.repeat(a[-1:], n - len(a), axis=0)])
    return a[:n]


def thumbs(name, n, width=THUMB_W, kind="lab"):
    """n grey thumbnails (`width` wide) of the clip's window on the 100 ms grid, upright. `kind`: "lab" (area average,
    luma: tests 53 / 54), "phone" (the app's 2026-11-12 sampling and RGB mean), "phone-luma" (its sampling, luma)."""
    meta = ev.clip_meta(name)
    video = os.path.join(ev.ROOT, meta["video"])
    W, H = meta["size"]
    tw = width if W >= H else int(round(width * W / H / 2)) * 2
    th = int(round(tw * H / W / 2)) * 2
    if kind != "lab":
        return phone_thumbs(video, meta["startMs"], n, W, H, tw, th, "luma" if kind == "phone-luma" else "mean"), tw, th
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{meta['startMs'] / 1000:.3f}", "-t", f"{n / 10 + 0.2:.3f}", "-i", video,
           "-vf", f"fps=10,scale={tw}:{th}:flags=area,format=gray", "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    got = len(raw) // (tw * th)
    a = np.frombuffer(raw[:got * tw * th], np.uint8).reshape(got, th, tw).astype(np.int16)
    if got < n:  # a short tail: repeat the last frame (no motion there)
        a = np.concatenate([a, np.repeat(a[-1:], n - got, axis=0)])
    return a[:n], tw, th


def box3(m):
    """3 x 3 box mean (tames sensor and compression noise before the threshold)."""
    p = np.pad(m.astype(np.float32), 1, mode="edge")
    return sum(p[dy:dy + m.shape[0], dx:dx + m.shape[1]] for dy in range(3) for dx in range(3)) / 9.0


def simulate(name, det_tag, out_tag, thr, min_px, hold, mode, carry=0, thumb_w=THUMB_W, step=1, dry=0, kind="lab"):
    full = json.load(open(os.path.join(DET, f"{name}.{det_tag}.json")))
    W, H = full["size"]
    T = full.get("tile", 416)
    TL = tiles(W, H, T)
    n = len(full["frames"])
    F, tw, th = thumbs(name, n, thumb_w, kind)
    sx, sy = tw / W, th / H
    rects = [(int(x * sx), int(y * sy), int(np.ceil(min(x + T, W) * sx)), int(np.ceil(min(y + T, H) * sy))) for x, y in TL]
    truth = ev.load_truth(name) if os.path.exists(os.path.join(ev.LABELS, f"{name}.ball.json")) else None
    R = ev.radius_px(truth["size"]) if truth else 0
    frames, used, carried, ran = [], [], [], []
    prev_active = set()
    last = {}  # tile index -> the candidates it held the last time it was run (carry)
    lab = lab_in = ceil_full = ceil_kept = cand_full = cand_kept = 0
    for k in range(n):
        fr = full["frames"][k]
        if fr is None:
            frames.append(None)
            carried.append(None)
            ran.append(None)
            continue
        a = box3(np.abs(F[k] - F[max(k - step, 0)])) > thr
        b = box3(np.abs(F[k] - F[min(k + step, n - 1)])) > thr
        if k - step < 0:
            m = b
        elif k + step > n - 1:
            m = a
        else:
            m = (a & b) if mode == "and" else (a | b)
        now = {i for i, (x0, y0, x1, y1) in enumerate(rects) if int(m[y0:y1, x0:x1].sum()) >= min_px}
        active = now | prev_active if hold else now
        prev_active = now
        used.append(1 + len(active))
        ran.append(sorted(active))

        def run(cx, cy):
            px, py = cx * W, cy * H
            return any(TL[i][0] <= px < TL[i][0] + T and TL[i][1] <= py < TL[i][1] + T for i in active)

        kept = [c for c in fr if run(c[0], c[1])]
        if carry:
            # Nothing changed in a tile that is not run, so what the detector saw there last time is still there: those
            # candidates are kept as they were (a lamp, a logo, a ball lying on the floor stay "seen on every frame",
            # which is what the path's still-object filter needs to keep ignoring them).
            def inside(c, i):
                return TL[i][0] <= c[0] * W < TL[i][0] + T and TL[i][1] <= c[1] * H < TL[i][1] + T
            for i in active:
                last[i] = [c for c in fr if inside(c, i)]
            seen = {tuple(c) for c in kept}
            old = []
            for i in range(len(TL)):
                if i in active:
                    continue
                for c in last.get(i, []):
                    if tuple(c) not in seen and not run(c[0], c[1]):
                        old.append(c)
                        seen.add(tuple(c))
            if carry == 1:
                kept = kept + old  # test 53: carried candidates are candidates like the others
            else:
                carried.append(old)  # test 54: evidence for the still filter only (ball_track.py "carried")
        if len(carried) < len(frames) + 1:
            carried.append([])
        frames.append(kept)
        cand_full += len(fr)
        cand_kept += len(kept)
        if truth is not None:
            g = truth["samples"].get(k * 100)
            if isinstance(g, tuple):
                lab += 1
                lab_in += 1 if run(g[0], g[1]) else 0
                ceil_full += 1 if any(ev._dist_px(c[:2], g, truth["size"]) <= R for c in fr) else 0
                ceil_kept += 1 if any(ev._dist_px(c[:2], g, truth["size"]) <= R for c in kept) else 0
    out = dict(full, tag=out_tag, frames=frames, inferences=used, **({"carried": carried} if carry == 2 else {}),
               **({"ran": ran, "ran_tiles": TL} if carry == 3 else {}),
               motion=dict(src=det_tag, thr=thr, min_px=min_px, hold=hold, mode=mode, carry=carry, thumb=[tw, th], step=step))
    if not dry:
        json.dump(out, open(os.path.join(DET, f"{name}.{out_tag}.json"), "w"), separators=(",", ":"))
    return dict(clip=name, regions_full=1 + len(TL), regions=float(np.mean(used)) if used else 0.0, labelled=lab,
                label_in_run_tile=lab_in, ceil_full=ceil_full, ceil_kept=ceil_kept, cand_full=cand_full,
                cand_kept=cand_kept)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--det", required=True, help="the full run's tag (whole frame + all tiles)")
    ap.add_argument("--out", required=True, help="tag of the simulated run")
    ap.add_argument("--thr", type=float, default=12, help="grey-level change (0..255) that counts as motion")
    ap.add_argument("--min-px", type=int, default=2, help="changed thumbnail pixels for a tile to run")
    ap.add_argument("--hold", type=int, default=1, help="1: a tile also runs on the analysed frame after it moved")
    ap.add_argument("--mode", default="or", choices=["or", "and"], help="3-frame difference: either / both neighbours")
    ap.add_argument("--carry", type=int, default=0,
                    help="1: a tile that is not run keeps the candidates of the last time it was (still objects stay seen); "
                         "2: kept apart, as evidence for the still-object filter only (test 54)")
    ap.add_argument("--thumb-w", type=int, default=THUMB_W, help="thumbnail width (640 = test 53; 160 = the app's screen-rule thumbnail)")
    ap.add_argument("--step", type=int, default=1, help="neighbours this many 100 ms steps away (2 = the analysed frames at 5 fps)")
    ap.add_argument("--dry", type=int, default=0, help="1: numbers only, no detections file")
    ap.add_argument("--thumb", default="lab", choices=["lab", "phone", "phone-luma"],
                    help="how the thumbnail is made: the lab's (area, luma), the app's of 2026-11-12, or its with luma (test 55)")
    ap.add_argument("--summary", default=None, help="write the per-clip rows here (json)")
    ap.add_argument("clips", nargs="+")
    a = ap.parse_args()
    rows = []
    for name in a.clips:
        if not os.path.exists(os.path.join(DET, f"{name}.{a.det}.json")):
            print(name, "no detections")
            continue
        r = simulate(name, a.det, a.out, a.thr, a.min_px, a.hold, a.mode, a.carry, a.thumb_w, a.step, a.dry, a.thumb)
        rows.append(r)
        pc = lambda x, y: "-" if not y else f"{100 * x / y:.0f}%"  # noqa: E731
        print(f"{name}: regions {r['regions']:.1f} of {r['regions_full']}, labelled ball in a run tile "
              f"{pc(r['label_in_run_tile'], r['labelled'])} ({r['labelled']} pts), ceiling {pc(r['ceil_full'], r['labelled'])}"
              f" -> {pc(r['ceil_kept'], r['labelled'])}, candidates kept {pc(r['cand_kept'], r['cand_full'])}", flush=True)
    if rows:
        tot = lambda k: sum(r[k] for r in rows)  # noqa: E731
        print(f"ALL ({len(rows)} clips): regions {np.mean([r['regions'] for r in rows]):.1f} of "
              f"{np.mean([r['regions_full'] for r in rows]):.1f}, labelled ball in a run tile "
              f"{100 * tot('label_in_run_tile') / max(tot('labelled'), 1):.1f}% ({tot('labelled')} pts), ceiling "
              f"{100 * tot('ceil_full') / max(tot('labelled'), 1):.1f}% -> {100 * tot('ceil_kept') / max(tot('labelled'), 1):.1f}%")
    if a.summary:
        json.dump(dict(det=a.det, out=a.out, thr=a.thr, min_px=a.min_px, hold=a.hold, mode=a.mode, carry=a.carry, rows=rows),
                  open(a.summary, "w"), indent=1)


if __name__ == "__main__":
    main()
