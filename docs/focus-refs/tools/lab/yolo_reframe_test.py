"""Test of the proposed reframing mechanism (YOLOv8 per-frame 'sports ball' + Savitzky-Golay + 9:16 crop).

Lab only. Ultralytics/YOLOv8 is AGPL-3.0: not allowed in the app (project rule). Here only to measure the idea.

Faithful to the proposed script: model.track(persist=True, classes=[32]), first box of the frame, a missed frame
repeats the last position (frame centre before the first detection), savgol(15, 2) on x and y, crop centred on the
smoothed point and clamped to the frame. Only fix: the crop is 9:16 of the source height (the script's fixed
1080x1920 does not fit in a 1920x1080 frame), output at the source fps.

Scores on the lab's ball labels (200 ms grid, visible balls only):
  det      share of frames with a detection
  hit      share of labelled balls with a detection within 4% of the frame's long side (the right object)
  inCrop   share of labelled balls inside the 9:16 crop (the metric that matters)
  centre   same for a fixed centred 9:16 crop (baseline: no tracking at all)
"""
import json, math, os, subprocess, sys, time
import cv2
import numpy as np
from scipy.signal import savgol_filter
from ultralytics import YOLO

UP = "/mnt/user-data/uploads/Lance/docs/focus-refs"
OUT = "/home/claude/lab/out"
CLIPS = ["basket-rp-1105-h", "bt-rz-1105-a", "bt-rz-1105-b", "yt-basket-04", "yt1105-basket-a", "yt1105-basket-b",
         "yt1105-bt", "yt1105-futevolei", "yt1105-volei-a", "yt1105-volei-b", "yt1105-voleipraia"]


def run(name, weights, render):
    lab = json.load(open(f"{UP}/labels/{name}.ball.json"))
    video = f"{UP}/{lab['video']}"
    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS)
    W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    last_ms = max(int(k) for k in lab["samples"]) + 200
    model = YOLO(weights)
    pos, dets, raw = [], [], []
    t0 = time.time()
    while cap.isOpened():
        ok, frame = cap.read()
        if not ok or len(pos) * 1000 / fps > last_ms:
            break
        r = model.track(frame, persist=True, classes=[32], verbose=False)
        b = r[0].boxes
        if b is not None and b.xywh is not None and len(b.xywh):
            x, y, w, h = b.xywh[0].tolist()
            pos.append((x, y)); dets.append(1); raw.append((x, y))
        else:
            pos.append(pos[-1] if pos else (W / 2, H / 2)); dets.append(0); raw.append(None)
    cap.release()
    secs = time.time() - t0
    p = np.array(pos)
    sx = savgol_filter(p[:, 0], 15, 2)
    cw, ch = int(round(H * 9 / 16)) // 2 * 2, H
    xs = np.clip(sx - cw / 2, 0, W - cw)
    x0c = (W - cw) / 2

    n = hit = inc = cen = 0
    for k, v in lab["samples"].items():
        if not isinstance(v, list):
            continue
        i = int(round(int(k) * fps / 1000))
        if i >= len(pos):
            continue
        bx, by = v[0] * W, v[1] * H
        n += 1
        if raw[i] is not None and math.hypot(raw[i][0] - bx, raw[i][1] - by) <= 0.04 * max(W, H):
            hit += 1
        inc += xs[i] <= bx <= xs[i] + cw
        cen += x0c <= bx <= x0c + cw
    moves = np.abs(np.diff(xs)) * fps / W  # crop speed in frame widths/s
    res = {"clip": name, "frames": len(pos), "fps": round(fps, 2), "size": [W, H], "labels": n,
           "det": sum(dets) / len(dets), "hit": hit / n, "inCrop": inc / n, "centre": cen / n,
           "speedP95": float(np.percentile(moves, 95)), "msPerFrame": 1000 * secs / len(pos)}
    if render:
        tmp = f"{OUT}/{name}.raw.mp4"
        out = cv2.VideoWriter(tmp, cv2.VideoWriter_fourcc(*"mp4v"), fps, (cw, ch))
        cap = cv2.VideoCapture(video)
        for i in range(len(pos)):
            fr = cap.read()[1]
            x = int(xs[i])
            crop = fr[:, x:x + cw].copy()
            out.write(crop)
        out.release(); cap.release()
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", tmp, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                        "-pix_fmt", "yuv420p", f"{OUT}/{name}.yolov8n-9x16.mp4"], check=True)
        os.remove(tmp)
    return res


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    weights = sys.argv[1] if len(sys.argv) > 1 else "yolov8n.pt"
    render = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else set()
    rows = []
    done = set(sys.argv[3].split(',')) if len(sys.argv) > 3 else set()
    for c in [c for c in CLIPS if c not in done]:
        r = run(c, weights, c in render)
        rows.append(r)
        print(json.dumps(r), flush=True)
    json.dump(rows, open(f"{OUT}/scores-{os.path.splitext(weights)[0]}.json", "w"), indent=1)
