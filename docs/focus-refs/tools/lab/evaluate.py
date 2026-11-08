"""Modo Foco lab: scoring against the ground truth in docs/focus-refs/labels/ (no third-party deps beyond numpy).

Ground truth per clip: one sample every 200 ms (the labelling grid), each a ball point, "out" or "none".
- A prediction HITS a ball point when it is within `radius` of it; radius = 2% of the frame's long side (≈26 px at
  1280 px, about one to two ball diameters on our clips).
- recall      = hits / ball points                       (how often the method has the ball)
- precision   = hits / predictions on ball-point samples  (when it says "ball here", how often it is right)
- false alarm = predictions on "out"/"none" samples / those samples (ball claimed where there is none to see)
- for candidate detectors (several guesses per frame): ceiling = share of ball points with ANY candidate within radius.

"none" runs longer than 2 s are read as "out": a long stretch with the ball in play but never visible means the play
is outside the picture (e.g. basket-v-01, empty court for 24 s), which is "out" in the labelling rules.
"""

from __future__ import annotations

import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))  # docs/focus-refs
LABELS = os.path.join(ROOT, "labels")
FRAMES = os.path.join(ROOT, "lab", "frames")
GRID_MS = 200


def labelled_clips(mode: str = "ball") -> list[str]:
    order = []
    with open(os.path.join(HERE, "clips.txt")) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                order.append(line.split("|")[0])
    return [n for n in order if os.path.exists(os.path.join(LABELS, f"{n}.{mode}.json"))]


def clip_meta(name: str) -> dict:
    """The clip's frames.json (extract.sh); when the frames were deleted (2026-11-05 cleanup), the same fields from
    clips.txt and the video (no frames needed for the scores and reports)."""
    path = os.path.join(FRAMES, name, "frames.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    import subprocess
    with open(os.path.join(HERE, "clips.txt")) as f:
        rows = [l.strip().split("|") for l in f if l.strip() and not l.startswith("#")]
    row = next((r for r in rows if r[0] == name), None)
    if row is None:
        raise FileNotFoundError(f"{name}: not in clips.txt and no frames.json")
    _, video, start, dur, sport = row[:5]
    st = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_streams", "-of", "json",
                                    os.path.join(ROOT, video)], capture_output=True, text=True, check=True).stdout)["streams"][0]
    w, h = st["width"], st["height"]
    rot = int(st.get("tags", {}).get("rotate", 0))
    for side in st.get("side_data_list", []):
        if "rotation" in side:
            rot = int(side["rotation"])
    if abs(rot) % 180 == 90:
        w, h = h, w
    size = [1280, round(h * 1280 / w / 2) * 2] if w >= h else [round(w * 1280 / h / 2) * 2, 1280]
    return {"name": name, "video": video, "startMs": int(start), "durMs": int(dur), "sport": sport, "stepMs": 100,
            "fps": 10, "count": int(dur) // 100, "size": size}


def load_truth(name: str, mode: str = "ball", long_none_ms: int = 2000) -> dict:
    """{ms: (x, y) | 'out' | 'none'} on the 200 ms grid, ms from the window start; plus 'meta'."""
    with open(os.path.join(LABELS, f"{name}.{mode}.json")) as f:
        raw = json.load(f)
    s = {}
    for t, v in raw["samples"].items():
        t = int(t)
        if t % GRID_MS:
            continue
        s[t] = tuple(v[:2]) if isinstance(v, list) and mode == "ball" else (tuple(v) if isinstance(v, list) else v)
    # long "none" runs -> "out"
    ts = sorted(s)
    i = 0
    while i < len(ts):
        if s[ts[i]] == "none":
            j = i
            while j + 1 < len(ts) and s[ts[j + 1]] == "none" and ts[j + 1] - ts[j] == GRID_MS:
                j += 1
            if ts[j] - ts[i] + GRID_MS > long_none_ms:
                for k in range(i, j + 1):
                    s[ts[k]] = "out"
            i = j + 1
        else:
            i += 1
    return {"samples": s, "size": raw["size"], "startMs": raw["startMs"], "video": raw["video"], "prompts": raw["prompts"]}


def _dist_px(a, b, size) -> float:
    return math.hypot((a[0] - b[0]) * size[0], (a[1] - b[1]) * size[1])


def radius_px(size) -> float:
    return 0.02 * max(size)


def score_track(truth: dict, pred: dict) -> dict:
    """pred: {ms: (x, y) | None} (missing ms = no prediction)."""
    size, R = truth["size"], radius_px(truth["size"])
    pts = hits = said = fa = empty = 0
    for t, v in truth["samples"].items():
        p = pred.get(t)
        if isinstance(v, tuple):
            pts += 1
            if p is not None:
                said += 1
                if _dist_px(p, v, size) <= R:
                    hits += 1
        else:
            empty += 1
            if p is not None:
                fa += 1
    return {"points": pts, "recall": hits / pts if pts else None, "precision": hits / said if said else None,
            "false_alarm": fa / empty if empty else None, "empty": empty}


def score_candidates(truth: dict, cands: dict) -> dict:
    """cands: {ms: [(x, y), ...]}. Ceiling recall and clutter."""
    size, R = truth["size"], radius_px(truth["size"])
    pts = hit = 0
    n = []
    for t, v in truth["samples"].items():
        c = cands.get(t, [])
        n.append(len(c))
        if isinstance(v, tuple):
            pts += 1
            if any(_dist_px(p, v, size) <= R for p in c):
                hit += 1
    return {"ceiling": hit / pts if pts else None, "cands_per_frame": sum(n) / len(n) if n else 0}


def first_loss_ms(truth: dict, pred: dict, from_ms: int) -> int | None:
    """Time (ms after from_ms) of the first ball point the prediction misses; None if it never misses."""
    size, R = truth["size"], radius_px(truth["size"])
    for t in sorted(truth["samples"]):
        v = truth["samples"][t]
        if t < from_ms or not isinstance(v, tuple):
            continue
        p = pred.get(t)
        if p is None or _dist_px(p, v, size) > R:
            return t - from_ms
    return None


def fmt(x, pct=True) -> str:
    if x is None:
        return "—"
    return f"{100 * x:.0f}%" if pct else f"{x:.1f}"
