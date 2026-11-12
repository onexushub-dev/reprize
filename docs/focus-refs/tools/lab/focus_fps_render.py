#!/usr/bin/env python3
"""Side by side: Jogadores at 10 fps (the phone's framing) | at 5 fps (focus_fps.py), in the clip's orientation.

    python3 tools/lab/focus_fps_render.py <clip> [...]   -> lab/tests/focusfps/<clip>.fps-compare.mp4
"""
import json
import os
import subprocess
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import evaluate as ev  # noqa: E402

OUT = os.path.join(ev.ROOT, "lab", "tests", "focusfps")


def render(name):
    meta = ev.clip_meta(name)
    f10 = json.load(open(os.path.join(ev.ROOT, "lab", "tests", "framing", f"{name}.current.focus.json")))
    f5 = json.load(open(os.path.join(OUT, f"{name}.p5.focus.json")))
    W, H = f10["size"]
    aspect = "landscape" if W >= H else "portrait"
    R = [np.array(f10[aspect]), np.array(f5[aspect])]
    off = int(round((meta["startMs"] - f10["startMs"]) / 100))
    n = min(len(R[0]), len(R[1])) - max(off, 0)
    PW, PH = (640, 360) if aspect == "landscape" else (300, 534)
    fps = 30
    video = os.path.join(ev.ROOT, meta["video"])
    dec = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{meta['startMs'] / 1000}", "-i", video, "-t",
                            f"{n / 10}", "-vf", f"fps={fps}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                           stdout=subprocess.PIPE)
    out = os.path.join(OUT, f"{name}.fps-compare.mp4")
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s",
                            f"{PW * 2}x{PH + 32}", "-r", str(fps), "-i", "-", "-c:v", "libx264", "-preset", "veryfast",
                            "-crf", "23", "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
    f = 0
    while True:
        buf = dec.stdout.read(W * H * 3)
        if len(buf) < W * H * 3:
            break
        fr = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
        t = f / fps
        k = min(n - 1, int(t * 10)) + off
        k2 = min(n - 1 + off, k + 1)
        u = t * 10 - int(t * 10)
        panels = []
        for title, rr in (("Jogadores 10 fps (hoje)", R[0]), ("Jogadores 5 fps", R[1])):
            x, y, w, h = (1 - u) * rr[k] + u * rr[k2]
            crop = fr[int(y * H):int((y + h) * H), int(x * W):int((x + w) * W)]
            p = cv2.resize(crop, (PW, PH), interpolation=cv2.INTER_AREA)
            head = np.zeros((32, PW, 3), np.uint8)
            cv2.putText(head, title, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
            panels.append(np.vstack([head, p]))
        enc.stdin.write(np.hstack(panels).tobytes())
        f += 1
    enc.stdin.close()
    enc.wait()
    dec.kill()
    print(out)


if __name__ == "__main__":
    for c in sys.argv[1:]:
        render(c)
