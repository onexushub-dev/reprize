#!/usr/bin/env python3
"""Modo Foco lab, test 26 (2026-11-06): the ball TRAIL, to judge ball detection on its own, before any camera.

Idea (Victor, after looking at Ball AI): apps that draw a clean ball trail are not necessarily detecting better per
frame; they draw it AFTER the clip, with the whole clip in hand. So here the camera is left out and we only ask:
"given the detections we already have (detector, EdgeTAM, detector + EdgeTAM...), how good a ball path can we build
offline?" If the trail looks right on video, the remaining problem is the camera rules; if not, it is the detector.

Steps, per 100 ms frame (same grid as every other lab track):
1. Candidates: every ball position the track file gives for the frame (one for a tracker such as EdgeTAM, several for
   a detector with `cands`). Optional size filter (mask/box area, as hybrid.py).
2. Linking: candidates are joined frame to frame into tracklets (constant-velocity prediction, a gate that grows with
   the ball's speed and with the gap; gaps up to `link_gap` frames).
3. Robust local fit, both ways in time: at every frame of a tracklet, a weighted quadratic in time (x and y; a ball
   in the air is a parabola) over +/- `win` frames, with Tukey biweights. Points far from the fit are outliers and are
   dropped; the fit also fills the tracklet's own small gaps. The detections that pass stay exactly where they were
   seen (`keep_det`): a fit over 0.5 s rounds off dribbles and bounces (test 26 on the labels: 83% instead of 100%
   of the ground truth kept on basket-rp-1105-v-a).
4. Tracklets that are short, or that barely move (a ball held / lying around, a head, a racket: test 15 showed the
   wrong "ball" is the one that does not move), are dropped. Where tracklets overlap, the strongest one wins.
5. Bridges: a gap of up to `bridge` frames between two kept tracklets is filled with a cubic Hermite curve if the
   speed it implies is plausible.

Outputs (docs/focus-refs/lab/tests/trail/):
- `<clip>.<tag>.trail.json`: the clean track per 100 ms frame + per-frame kind (detected / filled / bridged).
- with `--as-model NAME`: the clean track also in the one-click format (`lab/tests/oneclick/<clip>.ball.NAME.json`,
  `pred_one`), so `hybrid.py --model NAME` frames the camera on it with no other change (step 3 of the plan).
- `<clip>.<tag>.trail.mp4` with `--render`: raw detections joined as they come (left / top) | clean trail (right /
  bottom); the labelled ball (ground truth) as a small red cross when the clip has labels.
- scores on the labels (same 200 ms grid and 2% radius as evaluate.py): recall, precision, false alarm, raw vs clean.

    cd docs/focus-refs
    python3 tools/lab/trail.py --track lab/tests/<run>/<clip>.ball.<tag>.json [--key pred_one] [--render] <clip>
    python3 tools/lab/trail.py --track-dir lab/tests/<run> --pattern '{clip}.ball.{tag}.json' --tag det5 --render
    python3 tools/lab/trail.py --selftest            # synthetic check of the cleaning, no video needed

Track file formats accepted (frame index as a string = ms / 100 from the clip window start):
- `{"pred_one": {"12": [cx, cy, x, y, w, h, area, ...] | null}}` (oneclick.py, single_pass.py, low_fps.py...);
  `--key` picks another dict in the file (`pred_fixed`, `track`, ...).
- `{"cands": {"12": [[cx, cy, score], ...]}}`: several candidates per frame (a per-frame detector).
- `{"frames": [[[cx, cy, w, h, score], ...] | null, ...]}`: ball_detect.py / roi_tiles.py output (lab/tests/detect/),
  one entry per 100 ms frame, null where the frame was not analysed.
- a label file (`samples` keyed by ms): to see what the cleaning does to ground truth.
All positions are 0..1 of the picture.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import evaluate as ev  # noqa: E402

TESTS = os.path.join(ev.ROOT, "lab", "tests")
OUT = os.path.join(TESTS, "trail")

# Distances are in picture LONG sides (L), times in 100 ms frames.
T = dict(
    area_max=0.003,  # a mask/box bigger than this share of the picture is not a ball (hybrid.py)
    v_max=3.0,  # L/s: fastest plausible ball (labels: p90 0.2-0.7 L/s, max 2.5 L/s on a YouTube basket clip)
    gate_min=0.06,  # L: smallest linking gate per frame
    gate_speed=0.6,  # extra gate per frame, as a share of the predicted step
    link_gap=3,  # frames a tracklet may skip and still be continued
    win=2,  # +/- frames of the local fit (0.5 s window; 3 rounds off dribbles and bounces: test 26 sweep)
    resid_max=0.08,  # L: a point further than this from the robust fit is an outlier (0.05 dropped real bounces)
    min_pts=4,  # detections a tracklet needs to be kept
    min_speed=0.05,  # L/s: median speed under this = a still object (test 15: wrong balls move 0.03-0.07 L/s)
    keep_det=1,  # 1: kept detections are drawn where they were seen; 0: the fit's position (smoother, rounds bounces)
    bridge=10,  # frames (1 s) a gap between two kept tracklets may be bridged
    trail_s=1.2,  # seconds of trail drawn behind the ball
)


# ---------------------------------------------------------------------------------------------------- input


def clip_info(name: str) -> dict | None:
    """name|video|start ms|duration ms|sport from clips.txt (the lab's clip list)."""
    with open(os.path.join(HERE, "clips.txt")) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("|")
            if parts[0] == name and len(parts) >= 5:
                return {"name": name, "video": parts[1], "startMs": int(parts[2]), "durMs": int(parts[3]),
                        "sport": parts[4]}
    return None


def load_candidates(path: str, key: str | None) -> tuple[dict[int, list], list | None]:
    """{frame index: [(cx, cy, w, h, area), ...]} and the picture size if the file has one."""
    with open(path) as f:
        d = json.load(f)
    size = d.get("size")
    out: dict[int, list] = {}
    if "samples" in d and key is None:  # a label file: ms keys, [x, y] or 'out'/'none'
        for t, v in d["samples"].items():
            if isinstance(v, list):
                out.setdefault(int(t) // 100, []).append((v[0], v[1], 0.0, 0.0, 0.0, 1.0))
        return out, size
    if key is None and isinstance(d.get("frames"), list):  # ball_detect.py: [[cx, cy, w, h, score], ...] per frame
        for i, items in enumerate(d["frames"]):
            for p in items or []:
                out.setdefault(i, []).append((p[0], p[1], p[2], p[3], math.pi / 4 * p[2] * p[3], p[4]))
        return out, size
    if key is None:
        for k in ("cands", "pred_one", "pred_fixed", "track"):
            if k in d:
                key = k
                break
    if key is None or key not in d:
        raise SystemExit(f"{path}: no track found (keys: {', '.join(d)}); pass --key")
    for i, v in d[key].items():
        if v is None:
            continue
        items = v if (len(v) > 0 and isinstance(v[0], list)) else [v]
        for p in items:
            if p is None or len(p) < 2:
                continue
            w = p[4] if len(p) > 6 else 0.0
            h = p[5] if len(p) > 6 else 0.0
            a = p[6] if len(p) > 6 else 0.0
            sc = float(p[2]) if len(p) == 3 else 1.0
            out.setdefault(int(i), []).append((float(p[0]), float(p[1]), w, h, a, sc))
    return out, size


# ---------------------------------------------------------------------------------------------------- cleaning


def to_l(p, size):
    W, H = size
    L = max(W, H)
    return np.array([p[0] * W / L, p[1] * H / L])


def from_l(q, size):
    W, H = size
    L = max(W, H)
    return (float(q[0] * L / W), float(q[1] * L / H))


def _score(c) -> float:
    return float(c[5]) if len(c) > 5 else 1.0


def link(cands: dict[int, list], n: int, size) -> list[dict]:
    """Greedy frame-to-frame linking into tracklets: {'t': [frames], 'p': [L coords], 'wh': [(w, h)]}."""
    step_max = T["v_max"] * 0.1
    active: list[dict] = []
    done: list[dict] = []
    for i in range(n):
        pts = [(to_l(c, size), c) for c in cands.get(i, []) if not (c[4] > T["area_max"])]
        pairs = []
        for ti, tr in enumerate(active):
            gap = i - tr["t"][-1]
            if gap > T["link_gap"] + 1:
                continue
            last = tr["p"][-1]
            if len(tr["t"]) >= 2:
                v = (tr["p"][-1] - tr["p"][-2]) / (tr["t"][-1] - tr["t"][-2])
                pred = last + v * gap
                gate = T["gate_min"] * gap + T["gate_speed"] * float(np.linalg.norm(v)) * gap
            else:
                pred = last
                gate = step_max * gap
            gate = min(gate, step_max * gap + T["gate_min"])
            for pi, (q, _) in enumerate(pts):
                dist = float(np.linalg.norm(q - pred))
                if dist <= gate:
                    pairs.append((dist / max(gate, 1e-6), ti, pi))
        pairs.sort()
        used_t, used_p = set(), set()
        for _, ti, pi in pairs:
            if ti in used_t or pi in used_p:
                continue
            used_t.add(ti)
            used_p.add(pi)
            tr = active[ti]
            tr["t"].append(i)
            tr["p"].append(pts[pi][0])
            tr["wh"].append((pts[pi][1][2], pts[pi][1][3]))
            tr["s"].append(_score(pts[pi][1]))
        for pi, (q, c) in enumerate(pts):
            if pi not in used_p:
                active.append({"t": [i], "p": [q], "wh": [(c[2], c[3])], "s": [_score(c)]})
        keep = []
        for tr in active:
            if i - tr["t"][-1] > T["link_gap"]:
                done.append(tr)
            else:
                keep.append(tr)
        active = keep
    return done + active


def robust_fit(ts: np.ndarray, ps: np.ndarray, at: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Local weighted quadratic (in time) of x and y, Tukey biweights; returns fitted positions at `at` and each
    input point's residual to the fit at its own time."""
    w_rob = np.ones(len(ts))
    for _ in range(4):
        res = np.zeros(len(ts))
        for k, t in enumerate(ts):
            res[k] = np.linalg.norm(_local(ts, ps, w_rob, t) - ps[k])
        s = max(0.006, 1.4826 * float(np.median(res)))
        u = res / (4.685 * s)
        w_rob = np.where(u < 1, (1 - u ** 2) ** 2, 0.0)
        w_rob = np.where(res > T["resid_max"], 0.0, w_rob)
        if w_rob.sum() < 2:
            break
    fitted = np.array([_local(ts, ps, w_rob, t) for t in at])
    res = np.array([np.linalg.norm(_local(ts, ps, w_rob, t) - ps[k]) for k, t in enumerate(ts)])
    return fitted, res


def _local(ts, ps, w_rob, t):
    d = np.abs(ts - t)
    w = np.where(d <= T["win"], (1 - (d / (T["win"] + 1)) ** 3) ** 3, 0.0) * w_rob
    m = w > 0
    if m.sum() == 0:
        k = int(np.argmin(d))
        return ps[k]
    deg = 2 if m.sum() >= 4 else (1 if m.sum() >= 2 else 0)
    if deg == 0:
        return (ps[m] * w[m, None]).sum(0) / w[m].sum()
    # a fit needs points on both sides of t, or it extrapolates: drop to linear then
    if not ((ts[m] < t).any() and (ts[m] > t).any()):
        deg = min(deg, 1)
    X = np.vander(ts[m] - t, deg + 1)
    sw = np.sqrt(w[m])
    coef, *_ = np.linalg.lstsq(X * sw[:, None], ps[m] * sw[:, None], rcond=None)
    return coef[-1]


def clean(cands: dict[int, list], n: int, size) -> dict:
    """The clean track: {'pos': [L coords | None] * n, 'kind': ['det' | 'fill' | 'bridge' | None] * n, ...}."""
    tracklets = link(cands, n, size)
    kept = []
    for tr in tracklets:
        if len(tr["t"]) < T["min_pts"]:
            continue
        ts = np.array(tr["t"], float)
        ps = np.array(tr["p"])
        sc = np.array(tr["s"])
        at = np.arange(ts[0], ts[-1] + 1, dtype=float)
        fitted, res = robust_fit(ts, ps, at)
        inl = res <= T["resid_max"]
        if inl.sum() < T["min_pts"]:
            continue
        if inl.sum() < len(ts):  # refit on the inliers only
            ts, ps, sc = ts[inl], ps[inl], sc[inl]
            at = np.arange(ts[0], ts[-1] + 1, dtype=float)
            fitted, _ = robust_fit(ts, ps, at)
        if T["keep_det"]:  # the fit only judges and fills: a kept detection stays where it was seen (corners stay)
            fitted[(ts - at[0]).astype(int)] = ps
        steps = np.linalg.norm(np.diff(fitted, axis=0), axis=1) * 10  # L/s per frame
        med_speed = float(np.median(steps)) if len(steps) else 0.0
        if med_speed < T["min_speed"]:
            continue
        wh = [x for x in tr["wh"] if x[0] > 0]
        kept.append({"t0": int(at[0]), "fit": fitted, "det": set(int(t) for t in ts), "n": float(sc.sum()),
                     "speed": med_speed, "wh": tuple(np.median(np.array(wh), 0)) if wh else (0.0, 0.0)})
    # strongest first (detections weighted by the detector's score, a little bonus for movement); weaker ones only
    # take free frames
    kept.sort(key=lambda k: k["n"] * (1 + min(k["speed"], 1.0)), reverse=True)
    pos: list = [None] * n
    kind: list = [None] * n
    owner = [-1] * n
    for ki, k in enumerate(kept):
        span = range(k["t0"], k["t0"] + len(k["fit"]))
        free = [i for i in span if pos[i] is None]
        if len(free) < T["min_pts"]:
            continue
        for i in free:
            pos[i] = k["fit"][i - k["t0"]]
            kind[i] = "det" if i in k["det"] else "fill"
            owner[i] = ki
    # bridges between consecutive runs
    i = 0
    while i < n:
        if pos[i] is not None:
            i += 1
            continue
        j = i
        while j < n and pos[j] is None:
            j += 1
        a, b = i - 1, j
        gap = j - i
        if a >= 0 and b < n and gap <= T["bridge"]:
            pa, pb = pos[a], pos[b]
            va = pa - pos[a - 1] if a >= 1 and pos[a - 1] is not None else np.zeros(2)
            vb = pos[b + 1] - pb if b + 1 < n and pos[b + 1] is not None else np.zeros(2)
            span = gap + 1
            if np.linalg.norm(pb - pa) / span * 10 <= T["v_max"]:
                for g in range(1, span):
                    s = g / span
                    h00, h10 = 2 * s ** 3 - 3 * s ** 2 + 1, s ** 3 - 2 * s ** 2 + s
                    h01, h11 = -2 * s ** 3 + 3 * s ** 2, s ** 3 - s ** 2
                    pos[a + g] = h00 * pa + h10 * va * span + h01 * pb + h11 * vb * span
                    kind[a + g] = "bridge"
                    owner[a + g] = owner[a]
        i = j
    whs = {ki: k["wh"] for ki, k in enumerate(kept)}
    return {"pos": pos, "kind": kind, "owner": owner, "wh": whs, "tracklets": len(tracklets), "kept": len(kept)}


# ---------------------------------------------------------------------------------------------------- scores


def raw_track(cands: dict[int, list]) -> dict[int, tuple]:
    """What a naive trail uses: the first (or only) candidate of each frame, ms keys."""
    return {i * 100: (c[0][0], c[0][1]) for i, c in cands.items() if c}


def scores(name: str, cands, cl, size) -> dict | None:
    if not os.path.exists(os.path.join(ev.LABELS, f"{name}.ball.json")):
        return None
    truth = ev.load_truth(name)
    clean_ms = {i * 100: from_l(p, size) for i, p in enumerate(cl["pos"]) if p is not None}
    return {"raw": ev.score_track(truth, raw_track(cands)), "clean": ev.score_track(truth, clean_ms)}


# ---------------------------------------------------------------------------------------------------- render


def render(name, info, cands, cl, size, out_path):
    import cv2

    video = os.path.join(ev.ROOT, info["video"])
    st = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_streams", "-of", "json",
                                    video], capture_output=True, text=True, check=True).stdout)["streams"][0]
    W, H = st["width"], st["height"]
    rot = int(st.get("tags", {}).get("rotate", 0))
    for side in st.get("side_data_list", []):
        if "rotation" in side:
            rot = int(side["rotation"])
    if abs(rot) % 180 == 90:
        W, H = H, W
    num, den = st["r_frame_rate"].split("/")
    fps = float(num) / float(den)
    keep = 2 if fps > 40 else 1
    ofps = fps / keep
    portrait = H > W
    s = 960 / max(W, H)
    pw, ph = int(round(W * s)) // 2 * 2, int(round(H * s)) // 2 * 2
    size_out = (pw * 2, ph) if portrait else (pw, ph * 2)
    truth = ev.load_truth(name) if os.path.exists(os.path.join(ev.LABELS, f"{name}.ball.json")) else None
    raw = raw_track(cands)
    n = len(cl["pos"])
    clean_xy = [from_l(p, size) if p is not None else None for p in cl["pos"]]
    trail_n = int(round(T["trail_s"] * 10))
    font = cv2.FONT_HERSHEY_SIMPLEX
    colours = {"det": (60, 255, 120), "fill": (0, 220, 255), "bridge": (255, 160, 0)}

    def px(p):
        return int(round(p[0] * pw)), int(round(p[1] * ph))

    def text(img, s_, org):
        (tw, th), base = cv2.getTextSize(s_, font, 0.55, 1)
        x, y = org
        cv2.rectangle(img, (x - 4, y - th - 4), (x + tw + 4, y + base + 2), (0, 0, 0), -1)
        cv2.putText(img, s_, org, font, 0.55, (255, 255, 255), 1, cv2.LINE_AA)

    def at(seq, t_frames):
        """Clean position at a fractional frame (linear between 100 ms frames), None outside the track."""
        i0 = int(math.floor(t_frames))
        i1 = i0 + 1
        if i0 < 0 or i0 >= n or seq[i0] is None:
            return None
        if i1 >= n or seq[i1] is None:
            return seq[i0]
        f = t_frames - i0
        return (seq[i0][0] * (1 - f) + seq[i1][0] * f, seq[i0][1] * (1 - f) + seq[i1][1] * f)

    dec = subprocess.Popen(["ffmpeg", "-v", "error", "-ss", f"{info['startMs'] / 1000:.3f}", "-i", video, "-t",
                            f"{info['durMs'] / 1000:.3f}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                           stdout=subprocess.PIPE)
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s",
                            f"{size_out[0]}x{size_out[1]}", "-r", f"{ofps}", "-i", "-", "-c:v", "libx264", "-preset",
                            "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", out_path], stdin=subprocess.PIPE)
    fb = W * H * 3
    k = 0
    while True:
        buf = dec.stdout.read(fb)
        if len(buf) < fb:
            break
        if k % keep:
            k += 1
            continue
        frame = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
        small = cv2.resize(frame, (pw, ph), interpolation=cv2.INTER_AREA)
        left, right = small.copy(), small.copy()
        t_ms = k * 1000 / fps
        tf = t_ms / 100
        i_now = int(math.floor(tf))
        # left: raw detections joined in time order, no cleaning
        prev, prev_i = None, -99
        for i in range(max(0, i_now - trail_n), i_now + 1):
            p = raw.get(i * 100)
            if p is None:
                continue
            q = px(p)
            cv2.circle(left, q, 3, (200, 200, 200), -1, cv2.LINE_AA)
            if prev is not None and i - prev_i <= 2:
                cv2.line(left, prev, q, (0, 0, 255), 2, cv2.LINE_AA)
            prev, prev_i = q, i
        # right: clean trail, colour by kind, fading
        for i in range(max(0, i_now - trail_n), i_now):
            a, b = clean_xy[i], clean_xy[i + 1] if i + 1 < n else None
            if a is None or b is None:
                continue
            fade = (i - (i_now - trail_n)) / max(1, trail_n)
            c = colours.get(cl["kind"][i + 1] or "det", (60, 255, 120))
            cv2.line(right, px(a), px(b), tuple(int(v * (0.35 + 0.65 * fade)) for v in c), 2 + int(3 * fade),
                     cv2.LINE_AA)
        head = at(clean_xy, tf)
        if head is not None:
            cv2.circle(right, px(head), 11, (60, 255, 120), 2, cv2.LINE_AA)
        if truth is not None:
            g = int(round(t_ms / 200)) * 200
            v = truth["samples"].get(g)
            if isinstance(v, tuple) and abs(g - t_ms) <= 100:
                for img in (left, right):
                    x, y = px(v)
                    cv2.line(img, (x - 6, y), (x + 6, y), (0, 0, 255), 1, cv2.LINE_AA)
                    cv2.line(img, (x, y - 6), (x, y + 6), (0, 0, 255), 1, cv2.LINE_AA)
        text(left, f"{name}  {t_ms / 1000:5.1f}s  raw detections", (10, 24))
        kind_now = cl["kind"][i_now] if 0 <= i_now < n else None
        text(right, f"clean trail: {kind_now or 'no ball'}", (10, 24))
        text(right, "green detected  yellow filled  blue bridged", (10, ph - 12))
        out = np.hstack([left, right]) if portrait else np.vstack([left, right])
        enc.stdin.write(out.tobytes())
        k += 1
    enc.stdin.close()
    enc.wait()
    dec.wait()


# ---------------------------------------------------------------------------------------------------- main


def run(name: str, track: str, key: str | None, tag: str, do_render: bool, as_model: str | None) -> str:
    info = clip_info(name)
    cands, size = load_candidates(track, key)
    if os.path.exists(os.path.join(ev.LABELS, f"{name}.ball.json")):
        with open(os.path.join(ev.LABELS, f"{name}.ball.json")) as f:
            size = size or json.load(f)["size"]
    if size is None:
        raise SystemExit(f"{name}: picture size unknown (no 'size' in the track, no label file)")
    n = (max(cands) + 1) if cands else 0
    if info is not None:
        n = max(n, int(info["durMs"] // 100))
    cl = clean(cands, n, size)
    sc = scores(name, cands, cl, size)
    os.makedirs(OUT, exist_ok=True)
    W, H = size
    pred = {}
    for i, p in enumerate(cl["pos"]):
        if p is None:
            continue
        x, y = from_l(p, size)
        w, h = cl["wh"].get(cl["owner"][i], (0.0, 0.0))
        w, h = (w, h) if w > 0 else (12 / W, 12 / H)
        pred[str(i)] = [round(x, 4), round(y, 4), round(x - w / 2, 4), round(y - h / 2, 4), round(w, 4),
                        round(h, 4), round(math.pi / 4 * w * h, 6), 1.0]
    res = {"v": 1, "clip": name, "source": os.path.relpath(track, ev.ROOT), "stepMs": 100, "size": size,
           "tuning": T, "tracklets": cl["tracklets"], "kept": cl["kept"],
           "kind": {str(i): k for i, k in enumerate(cl["kind"]) if k}, "pred_one": pred, "scores": sc}
    with open(os.path.join(OUT, f"{name}.{tag}.trail.json"), "w") as f:
        json.dump(res, f, separators=(",", ":"))
    if as_model:
        os.makedirs(os.path.join(TESTS, "oneclick"), exist_ok=True)
        with open(os.path.join(TESTS, "oneclick", f"{name}.ball.{as_model}.json"), "w") as f:
            json.dump({"clip": name, "mode": "ball", "fps": 10, "pred_one": pred}, f, separators=(",", ":"))
    kinds = [k for k in cl["kind"] if k]
    share = (lambda k: 100 * kinds.count(k) / max(1, n))  # noqa: E731
    line = (f"| {name} | {cl['tracklets']} → {cl['kept']} | {100 * len(kinds) / max(1, n):.0f}% "
            f"({share('det'):.0f} / {share('fill'):.0f} / {share('bridge'):.0f}) ")
    if sc:
        r, c = sc["raw"], sc["clean"]
        line += (f"| {ev.fmt(r['recall'])} → {ev.fmt(c['recall'])} | {ev.fmt(r['precision'])} → "
                 f"{ev.fmt(c['precision'])} | {ev.fmt(r['false_alarm'])} → {ev.fmt(c['false_alarm'])} |")
    else:
        line += "| — | — | — |"
    if do_render:
        if info is None:
            print(f"  {name}: not in clips.txt, no video to render", flush=True)
        else:
            path = os.path.join(OUT, f"{name}.{tag}.trail.mp4")
            render(name, info, cands, cl, size, path)
            print("  video:", os.path.relpath(path, ev.ROOT), flush=True)
    return line


HEADER = ["| Clip | Tracklets → kept | Ball on screen (det / fill / bridge %) | Recall raw → clean "
          "| Precision raw → clean | False alarm raw → clean |", "|---|---|---|---|---|---|"]


def selftest() -> None:
    """Synthetic clip: a ball on parabolas with bounces, 25% missed frames, 1-frame jitter, 10% wild false
    detections and a still 'ball' (a held ball / a head) present the whole time. The clean track must keep the
    real ball and drop the rest."""
    rng = np.random.default_rng(7)
    size = [720, 1280]
    n = 300
    truth = []
    x, y, vx, vy = 0.2, 0.7, 0.025, -0.06
    for _ in range(n):
        truth.append((x, y))
        vy += 0.006
        x += vx
        y += vy
        if y > 0.8:
            y, vy = 0.8, -abs(vy) * 0.8 - 0.03
        if x < 0.05 or x > 0.95:
            vx = -vx
    cands: dict[int, list] = {}
    for i, (x, y) in enumerate(truth):
        c = []
        if rng.random() > 0.25:
            c.append((x + rng.normal(0, 0.004), y + rng.normal(0, 0.004), 0, 0, 0, 1.0))
        if rng.random() < 0.10:
            c.append((rng.random(), rng.random(), 0, 0, 0, 1.0))
        c.append((0.5 + rng.normal(0, 0.002), 0.3 + rng.normal(0, 0.002), 0, 0, 0, 1.0))  # still decoy
        rng.shuffle(c)
        cands[i] = c
    cl = clean(cands, n, size)
    err, hit, said = [], 0, 0
    L = max(size)
    for i, p in enumerate(cl["pos"]):
        if p is None:
            continue
        said += 1
        q = from_l(p, size)
        e = math.hypot((q[0] - truth[i][0]) * size[0], (q[1] - truth[i][1]) * size[1])
        err.append(e)
        hit += e <= 0.02 * L
    raw = raw_track(cands)
    raw_hit = sum(1 for t, p in raw.items()
                  if math.hypot((p[0] - truth[t // 100][0]) * size[0], (p[1] - truth[t // 100][1]) * size[1])
                  <= 0.02 * L)
    print(f"selftest: raw first-candidate hits {100 * raw_hit / n:.0f}% of frames")
    print(f"selftest: clean covers {100 * said / n:.0f}% of frames, {100 * hit / max(1, said):.0f}% of them on the "
          f"ball, median error {np.median(err):.1f} px, tracklets {cl['tracklets']} -> kept {cl['kept']}")
    assert said / n > 0.85 and hit / max(1, said) > 0.9, "cleaning below expectations"
    print("selftest: ok")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("clips", nargs="*")
    ap.add_argument("--track", help="one track file (one clip)")
    ap.add_argument("--track-dir", help="folder with one track file per clip (with --pattern)")
    ap.add_argument("--pattern", default="{clip}.ball.{tag}.json")
    ap.add_argument("--key", help="dict in the track file to read (default: cands, pred_one, pred_fixed, track)")
    ap.add_argument("--tag", default="trail", help="name for the outputs (and {tag} in --pattern)")
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--as-model", help="also write lab/tests/oneclick/<clip>.ball.NAME.json for hybrid.py --model NAME")
    ap.add_argument("--set", action="append", default=[], help="override a tuning value, e.g. --set win=4")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    for item in a.set:
        k, _, v = item.partition("=")
        if k not in T:
            raise SystemExit(f"unknown value {k}; known: {', '.join(T)}")
        T[k] = type(T[k])(float(v)) if isinstance(T[k], float) else int(float(v))
    if a.selftest:
        selftest()
        return
    jobs = []
    if a.track:
        if len(a.clips) != 1:
            raise SystemExit("--track needs exactly one clip name")
        jobs.append((a.clips[0], a.track))
    elif a.track_dir:
        names = a.clips or ev.labelled_clips("ball")
        for name in names:
            p = os.path.join(a.track_dir, a.pattern.format(clip=name, tag=a.tag))
            if os.path.exists(p):
                jobs.append((name, p))
        if not jobs:
            raise SystemExit(f"no track files matching {a.pattern} in {a.track_dir}")
    else:
        raise SystemExit("pass --track FILE CLIP, --track-dir DIR, or --selftest")
    lines = list(HEADER)
    print("\n".join(HEADER), flush=True)
    for name, path in jobs:
        line = run(name, path, a.key, a.tag, a.render, a.as_model)
        lines.append(line)
        print(line, flush=True)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f"summary-{a.tag}.md"), "w") as f:
        f.write("# Ball trail: raw detections vs clean offline track (test 26)\n\n"
                "Recall / precision / false alarm on the labelled ball (200 ms grid, 2% radius, evaluate.py).\n"
                "Raw = the first candidate of each frame as it comes; clean = linked, robust fit, still objects "
                "dropped, gaps filled and bridged.\n\n" + "\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
