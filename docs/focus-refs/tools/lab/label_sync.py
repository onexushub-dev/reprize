#!/usr/bin/env python3
"""Modo Foco lab, test 36 (2026-11-08): are the ball labels in time with the frames the detector sees? Many "blind"
points of test 35 show the ball clearly, a little away from its label, in fast moments (passes, shots). Here: decode
the clip window at 30 fps with the same chain as ball_detect.py (ffmpeg -ss before -i, fps filter), run the detector
(whole frame + 416 tiles) on the frames around each labelled point at shifts of -133..+133 ms, and count, per shift,
the labelled points with a candidate on the ball.
CAUTION (test 36): the shifts are on the fps=30 grid, whose frame 3k is NOT ball_detect.py's fps=10 frame k (that one is
3k+1 on 30 fps clips, "+33 ms" here; check a clip with frame_sync.py). Read the table against that frame, not 0 ms.

    python3 tools/lab/label_sync.py --model lab/models/ball_tiny_hn.onnx [--max-pts 40] clip ...
"""
import argparse
import os
import random
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ball_detect as bd  # noqa: E402
import evaluate as ev  # noqa: E402

SHIFTS = [-4, -3, -2, -1, 0, 1, 2, 3, 4]  # frames at 30 fps (33.3 ms)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--max-pts", type=int, default=40)
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("clips", nargs="+")
    a = ap.parse_args()
    det = bd.Yolox(a.model, a.threads)
    for name in a.clips:
        meta = ev.clip_meta(name)
        truth = ev.load_truth(name)
        R = ev.radius_px(truth["size"])
        pts = sorted((t, v) for t, v in truth["samples"].items() if isinstance(v, tuple))
        random.Random(0).shuffle(pts)
        pts = sorted(pts[:a.max_pts])
        want = {}
        for t, v in pts:
            for s in SHIFTS:
                j = 3 * (t // 100) + s  # the 10 fps tick k is the 30 fps frame 3k
                if j >= 0:
                    want.setdefault(j, []).append((t, v, s))
        video = os.path.join(ev.ROOT, meta["video"])
        W, H = bd.upright(video)
        dec = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{meta['startMs'] / 1000}", "-i", video,
                                "-t", f"{meta['durMs'] / 1000}", "-vf", "fps=30:start_time=0", "-f", "rawvideo",
                                "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
        fb = W * H * 3
        T = bd.tiles(W, H, 416)
        hit = {s: 0 for s in SHIFTS}
        cnt = {s: 0 for s in SHIFTS}
        j = 0
        last = max(want) if want else -1
        while j <= last:
            buf = dec.stdout.read(fb)
            if len(buf) < fb:
                break
            if j in want:
                fr = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
                res = det.run([fr] + [fr[y:y + 416, x:x + 416] for x, y in T], 0.05)
                cand = list(res[0])
                for (x, y), rr in zip(T, res[1:]):
                    cand += [(cx + x, cy + y, w, h, s) for cx, cy, w, h, s in rr]
                for t, v, s in want[j]:
                    cnt[s] += 1
                    if any(np.hypot(cx / W * truth["size"][0] - v[0] * truth["size"][0],
                                    cy / H * truth["size"][1] - v[1] * truth["size"][1]) <= R for cx, cy, w, h, sc in cand):
                        hit[s] += 1
            j += 1
        dec.kill()
        row = "  ".join(f"{s * 33.3:+.0f}ms {100 * hit[s] / max(1, cnt[s]):.0f}%" for s in SHIFTS)
        best = max(SHIFTS, key=lambda s: hit[s] / max(1, cnt[s]))
        print(f"{name} ({cnt[0]} pts): {row}  -> best {best * 33.3:+.0f} ms", flush=True)


if __name__ == "__main__":
    main()
