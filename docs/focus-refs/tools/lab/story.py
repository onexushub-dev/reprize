#!/usr/bin/env python3
"""Modo Foco lab, test 30 (2026-11-07): a "story" export (9:16) with Foco na Bola. Victor: an export OPTION (not the
default), offered only for clips recorded at 1080p60 or more; the watermark must be on the story too.

Crop: 9:16 of the source. "Zoom" is relative to the largest 9:16 crop: horizontal source = full height, 31.6% of the
width (z1.0); vertical source = the whole frame (z1.0, which cannot move). Cameras, all on test 24's band path:
  today  today's Modo Foco 9:16 rows (the "portrait" rows of current.focus.json: players only)
  A      calm: dead zone 0.20 of the crop, smoothing s10 (a 10, b 1000) — test 22 / 24
  C      Victor's pick in test 29: dead zone 0.10, smoothing s3 (a 3, b 300)
Ball: test 28's basketball detector, no tap (det-bpub-n-a3k2) for basketball; today's mix (YOLOX COCO + EdgeTAM from
a tap, mix-tiny-n-a3k2) for the other sports.

Scores on the labelled samples: ball inside the crop and direction changes per 10 s (sg_lazy2.score); movement on
SCREEN = sum of |dx| of the crop centre in crop widths per 10 s (what the viewer sees pan); source pixels of the crop
(the output is 1080x1920, so a crop under 1080 px wide is scaled up), also for a 4K recording of the same framing.

    python3 tools/lab/story.py sweep [clip ...]                      # -> lab/tests/story/story-sweep-t30.md / .json
    python3 tools/lab/story.py compare --clip X --cam today --cam C@1.0 --cam C@1.25 ...   # side by side, 540x960 panels
    python3 tools/lab/story.py export --clip X --cam C@1.25 [--no-mark]  # 1080x1920 file as the app would export it
    python3 tools/lab/story.py auto [--factor 1 --max-upscale 2.2 --miss 0.03]  # test 31: zoom per clip by rule
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
import hybrid  # noqa: E402
import sg_framing as sg  # noqa: E402
import sg_lazy2 as l2  # noqa: E402
import sg_lazy3 as l3  # noqa: E402

OUT = os.path.join(ev.ROOT, "lab", "tests", "story")
ASSETS = os.environ.get("REPRIZE_ASSETS", os.path.join(ev.ROOT, "..", "..", "app", "assets", "images", "brand"))
FONT = os.environ.get("REPRIZE_FONT", os.path.join(ev.ROOT, "..", "..", "app", "node_modules", "@expo-google-fonts",
                                                    "manrope", "600SemiBold", "Manrope_600SemiBold.ttf"))
CAMS = {"A": (0.20, 10.0, 1000.0), "C": (0.10, 3.0, 300.0)}
HORIZONTAL = ["yt-basket-04", "yt1105-basket-a", "yt1105-basket-b", "basket-rp-1105-h", "bt-rz-1105-a", "bt-rz-1105-b",
              "yt-bt-06", "yt1105-bt", "yt1105-voleipraia", "yt1105-futevolei", "yt1105-volei-a", "yt1105-volei-b",
              "basket-app-1107-a", "basket-app-1107-b", "basket-app-1107-c", "basket-app-1107-d"]
VERTICAL = ["basket-rp-1105-v-a", "basket-rp-1105-v-b", "basket-v-01", "bt-rz-1105-v"]
ZOOMS = {"landscape": [1.0, 1.25, 1.5], "portrait": [1.65, 2.0, 2.5]}


def engine_for(meta):
    return "det-bpub-n-a3k2" if meta["sport"] == "basquete" else "mix-tiny-n-a3k2"


def source_size(meta):
    v = os.path.join(ev.ROOT, meta["video"])
    st = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_streams", "-of", "json",
                                    v], capture_output=True, text=True, check=True).stdout)["streams"][0]
    W, H = st["width"], st["height"]
    rot = 0
    for sd in st.get("side_data_list", []):
        rot = int(sd.get("rotation", rot))
    if abs(rot) % 180 == 90:
        W, H = H, W
    return W, H


def load(name):
    meta = ev.clip_meta(name)
    truth = ev.load_truth(name)
    with open(os.path.join(sg.TESTS, "framing", f"{name}.current.focus.json")) as f:
        fc = json.load(f)
    n = meta["count"]
    off = int(round((meta["startMs"] - fc["startMs"]) / 100))
    today = np.array(fc["portrait"][off:off + n], dtype=float)
    n = min(n, len(today))
    W, H = source_size(meta)
    orient = "portrait" if H > W else "landscape"
    return meta, truth, today[:n], n, W, H, orient


def camera(name, cam, zoom, engine=None):
    """cam 'today' or 'A'/'C'; zoom relative to the largest 9:16 crop; engine: another ball track (test 32) instead of
    engine_for(meta). -> rects (n, 4) normalized, meta..."""
    meta, truth, today, n, W, H, orient = load(name)
    if cam == "today":
        return meta, truth, n, today, W, H, orient
    wmax = min(1.0, (9 / 16) * H / W)
    hmax = min(1.0, (16 / 9) * W / H)
    w, h = wmax / zoom, hmax / zoom
    dz, a, b = CAMS[cam]
    with open(os.path.join(sg.TESTS, "oneclick", f"{name}.ball.{engine or engine_for(meta)}.json")) as f:
        oc = json.load(f)
    tr = hybrid.trusted(oc["pred_one"], n, truth["size"], meta["sport"])
    isball = np.array([p is not None for p in tr])
    cx0 = today[:, 0] + today[:, 2] / 2  # where today's 9:16 crop is centred: the fallback when there is no ball
    cy0 = today[:, 1] + today[:, 3] / 2
    rects = np.zeros((n, 4))
    rects[:, 2], rects[:, 3] = w, h
    tx = sg.target_x([None if p is None else p[0] for p in tr], cx0, 10, "hold")
    if w < 0.999:
        cx = l3.band_path(tx - dz * w, tx + dz * w, np.where(isball, 1.0, l3.WFB), cx0, 0.0, a, b)
    else:
        cx = np.full(n, 0.5)
    rects[:, 0] = np.clip(cx, w / 2, 1 - w / 2) - w / 2
    if h < 0.999:
        by = l3.bridged([None if p is None else p[1] for p in tr])
        lo = np.array([-np.inf if v is None else v - (0.5 - l3.BOTTOM) * h for v in by])
        hi = np.array([np.inf if v is None else v + (0.5 - l3.TOP) * h for v in by])
        cy = l3.band_path(lo, hi, np.ones(n), cy0, l3.WA, a, b)
    else:
        cy = np.full(n, 0.5)
    rects[:, 1] = np.clip(cy, h / 2, 1 - h / 2) - h / 2
    return meta, truth, n, rects, W, H, orient


def scores(truth, n, rects, W, H):
    s = l2.score(rects, truth, n)
    cx = rects[:, 0] + rects[:, 2] / 2
    screen = float(np.sum(np.abs(np.diff(cx)) / rects[1:, 2])) / (n / 100.0)  # crop widths per 10 s
    cw, ch = float(np.mean(rects[:, 2])) * W, float(np.mean(rects[:, 3])) * H
    return {"in": s["in"], "pts": s["pts"], "flips": s["flips"], "screen": screen, "src_w": int(round(cw)),
            "src_h": int(round(ch)), "upscale": 1080.0 / cw}


def parse_cam(spec):
    """'today', 'C@1.2' or 'C@1.2#det-bhn-n5' (test 32: the ball track to follow, default engine_for)."""
    spec = spec.partition("#")[0]
    if spec == "today":
        return "today", None
    cam, _, z = spec.partition("@")
    return cam, float(z)


def engine_of(spec):
    return spec.partition("#")[2] or None


def label_of(spec, s):
    cam, z = parse_cam(spec)
    head = "Hoje (Modo Foco 9:16)" if cam == "today" else f"{cam} {'calma' if cam == 'A' else 'zona 10%'} {z:g}x"
    ball = "" if s["in"] is None else f" - bola {s['in']:.0%}"
    return f"{head}{ball} - {s['src_w']}px"


def cmd_sweep(a):
    clips = a.clips or (HORIZONTAL + VERTICAL)
    rows = []
    for name in clips:
        meta, truth, today, n, W, H, orient = load(name)
        specs = ["today"] + [f"{c}@{z:g}" for c in ("A", "C") for z in ZOOMS[orient]]
        for spec in specs:
            cam, z = parse_cam(spec)
            _, tr, n_, r, W_, H_, _ = camera(name, cam, z)
            s = scores(tr, n_, r, W_, H_)
            rows.append({"clip": name, "sport": meta["sport"], "orient": orient, "src": f"{W}x{H}",
                         "fps": round(float(ev.clip_meta(name).get("fps", 0))), "cam": spec, **s})
        print(name, orient, flush=True)
    os.makedirs(OUT, exist_ok=True)
    json.dump(rows, open(os.path.join(OUT, "story-sweep-t30.json"), "w"), indent=1)
    lines = ["# Test 30 — story (9:16) export: today's Modo Foco 9:16 vs camera A (calm) / C (dead zone 0.10)", "",
             "in = ball inside the crop (labelled samples); flips = direction changes /10 s; screen = pan on screen, "
             "crop widths /10 s; src = crop width in source px (output 1080 wide); 4K = same for a 4K recording.", ""]
    for orient in ("landscape", "portrait"):
        sub = [r for r in rows if r["orient"] == orient]
        if not sub:
            continue
        specs = list(dict.fromkeys(r["cam"] for r in sub))
        lines += [f"## {'Horizontal' if orient == 'landscape' else 'Vertical'} recordings", "",
                  "| Clip | " + " | ".join(specs) + " |", "|---|" + "---|" * len(specs)]
        for name in dict.fromkeys(r["clip"] for r in sub):
            cells = []
            for sp in specs:
                r = next(x for x in sub if x["clip"] == name and x["cam"] == sp)
                inn = "—" if r["in"] is None else f"{r['in']:.0%}"
                cells.append(f"{inn} / {r['flips']:.1f} / {r['screen']:.1f}")
            lines.append(f"| {name} | " + " | ".join(cells) + " |")
        mean = []
        for sp in specs:
            rs = [x for x in sub if x["cam"] == sp]
            ins = [x["in"] for x in rs if x["in"] is not None]
            mean.append(f"**{np.mean(ins):.0%} / {np.mean([x['flips'] for x in rs]):.1f} / "
                        f"{np.mean([x['screen'] for x in rs]):.1f}**")
        lines.append("| **mean** | " + " | ".join(mean) + " |")
        px = []
        for sp in specs:
            rs = [x for x in sub if x["cam"] == sp and x["src"] in ("1920x1080", "1080x1920")]
            if rs:
                w = np.mean([x["src_w"] for x in rs])
                px.append(f"{w:.0f} px (x{1080 / w:.1f}); 4K {2 * w:.0f} px")
            else:
                px.append("—")
        lines += ["| source px from 1080p (upscale); 4K | " + " | ".join(px) + " |", ""]
    open(os.path.join(OUT, "story-sweep-t30.md"), "w").write("\n".join(lines) + "\n")
    print("\n".join(lines))


def today_zoom(name, orient):
    """Today's Modo Foco zoom in the recording's own framing (median over the clip): the distance signal (far players =
    more zoom)."""
    with open(os.path.join(sg.TESTS, "framing", f"{name}.current.focus.json")) as f:
        fc = json.load(f)
    nat = np.array(fc["landscape" if orient == "landscape" else "portrait"], dtype=float)
    return float(np.median(1 / np.maximum(nat[:, 2], nat[:, 3])))


def self_miss(name, rects):
    """Share of the trusted ball points (the detector's own, no labels) that fall outside the crop: what a zoom would
    lose by the camera's own account."""
    meta = ev.clip_meta(name)
    truth = ev.load_truth(name)
    n = len(rects)
    with open(os.path.join(sg.TESTS, "oneclick", f"{name}.ball.{engine_for(meta)}.json")) as f:
        oc = json.load(f)
    tr = hybrid.trusted(oc["pred_one"], n, truth["size"], meta["sport"])
    pts = [(i, p) for i, p in enumerate(tr) if p is not None]
    if not pts:
        return 0.0
    out = sum(1 for i, p in pts if not (rects[i, 0] <= p[0] <= rects[i, 0] + rects[i, 2] and
                                         rects[i, 1] <= p[1] <= rects[i, 1] + rects[i, 3]))
    return out / len(pts)


def ball_share(name, n):
    meta = ev.clip_meta(name)
    truth = ev.load_truth(name)
    with open(os.path.join(sg.TESTS, "oneclick", f"{name}.ball.{engine_for(meta)}.json")) as f:
        oc = json.load(f)
    tr = hybrid.trusted(oc["pred_one"], n, truth["size"], meta["sport"])
    return float(np.mean([p is not None for p in tr]))


def auto_zoom(name, max_upscale=2.2, factor=1.0, miss=0.03, src_scale=1.0, cam="C", min_share=0.35):
    """Test 31 rule: zoom = min(content, quality, ball safety), one value per clip.
    content  today's Modo Foco zoom x factor (factor 1 = the players as big as in today's Modo Foco, now in 9:16)
    quality  the zoom at which the crop is scaled up max_upscale to 1080 wide (src_scale 2 = the same clip in 4K)
    ball     the largest zoom (0.05 steps) whose camera keeps the detector's own ball points inside the crop but `miss`
    guard    when the detector finds the ball in under `min_share` of the clip its own points cannot be trusted to judge
             the zoom: stay at the safe zoom (horizontal: full height; vertical: today's Modo Foco zoom)
    Returns (zoom, parts)."""
    meta, truth, today, n, W, H, orient = load(name)
    wmax_px = min(W, (9 / 16) * H) * src_scale  # source px across the largest 9:16 crop
    z_quality = max(1.0, wmax_px * max_upscale / 1080.0)
    z_content = max(1.0, today_zoom(name, orient) * factor)
    top = min(z_quality, z_content)
    share = ball_share(name, n)
    if share < min_share:
        safe = 1.0 if orient == "landscape" else max(1.0, today_zoom(name, orient))
        top = min(top, safe)
    z_ball = 1.0
    for z in np.arange(1.0, top + 1e-6, 0.05):
        r = camera(name, cam, float(z))[3]
        if self_miss(name, r) <= miss:
            z_ball = float(z)
        else:
            break
    z = min(top, z_ball) if z_ball < top else top
    return round(z, 2), {"content": round(z_content, 2), "quality": round(z_quality, 2), "ball": round(z_ball, 2),
                         "share": round(share, 2)}


def cmd_auto(a):
    """Rule vs fixed zooms on every clip: ball in crop (labels), pan on screen, upscale from 1080p (and the rule's zoom
    for the same clip recorded in 4K)."""
    clips = a.clips or (HORIZONTAL + VERTICAL)
    rows = []
    for name in clips:
        meta, truth, today, n, W, H, orient = load(name)
        fac = a.factor if orient == "landscape" else a.factor_v
        z, parts = auto_zoom(name, a.max_upscale, fac, a.miss, min_share=a.min_share)
        z4k, parts4k = auto_zoom(name, a.max_upscale, fac, a.miss, src_scale=2.0, min_share=a.min_share)
        fixed = {"fix-lo": 1.0 if orient == "landscape" else 1.65, "fix-hi": 1.25 if orient == "landscape" else 1.65}
        res = {}
        for key, zz in [("auto", z), ("auto-4k", z4k)] + list(fixed.items()):
            _, t, n_, r, W_, H_, _ = camera(name, "C", zz)
            s = scores(t, n_, r, W_, H_)
            res[key] = {"zoom": zz, "in": s["in"], "screen": s["screen"], "flips": s["flips"],
                        "upscale": s["upscale"] / (2.0 if key == "auto-4k" else 1.0), "self_miss": self_miss(name, r)}
        rows.append({"clip": name, "orient": orient, "src": f"{W}x{H}", "sport": meta["sport"],
                     "today_zoom": today_zoom(name, orient), "parts": parts, "parts4k": parts4k, "res": res})
        print(name, orient, z, parts, "4K", z4k, flush=True)
    os.makedirs(OUT, exist_ok=True)
    json.dump(rows, open(os.path.join(OUT, f"story-auto-t31{a.suffix}.json"), "w"), indent=1)
    f = lambda v: "—" if v is None else f"{v:.0%}"  # noqa: E731
    lines = [f"# Test 31 — story zoom per clip: min(content = today's zoom x{a.factor:g} H / x{a.factor_v:g} V, "
             f"quality <= x{a.max_upscale:g} upscale, ball self-miss <= {a.miss:.0%}; safe zoom when the detector finds "
             f"the ball in < {a.min_share:.0%} of the clip)", "",
             "Cells: zoom / ball in crop (labels) / pan on screen (crop widths /10 s) / upscale to 1080 wide.", "",
             "| Clip | rec | today's zoom | limits content / quality / ball | rule (1080p) | rule if 4K | "
             "fixed 1x H / 1.65x V | fixed 1.25x H / 1.65x V |", "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        cell = lambda k: (f"{r['res'][k]['zoom']:g}x / {f(r['res'][k]['in'])} / {r['res'][k]['screen']:.1f} / "  # noqa
                          f"x{r['res'][k]['upscale']:.1f}")
        p = r["parts"]
        lines.append(f"| {r['clip']} | {r['orient'][0].upper()} {r['src']} | {r['today_zoom']:.2f} | "
                     f"{p['content']:g} / {p['quality']:g} / {p['ball']:g} (ball {p['share']:.0%}) | {cell('auto')} | "
                     f"{cell('auto-4k')} | "
                     f"{cell('fix-lo')} | {cell('fix-hi')} |")
    for orient in ("landscape", "portrait"):
        sub = [r for r in rows if r["orient"] == orient]
        if not sub:
            continue
        cells = []
        for k in ("auto", "auto-4k", "fix-lo", "fix-hi"):
            ins = [r["res"][k]["in"] for r in sub if r["res"][k]["in"] is not None and r["clip"] != "yt-bt-06"]
            cells.append(f"**{np.mean([r['res'][k]['zoom'] for r in sub]):.2f}x / {np.mean(ins):.0%} / "
                         f"{np.mean([r['res'][k]['screen'] for r in sub]):.1f} / "
                         f"x{np.mean([r['res'][k]['upscale'] for r in sub]):.1f}**")
        lines.append(f"| **mean {orient}** | | | | " + " | ".join(cells) + " |")
    open(os.path.join(OUT, f"story-auto-t31{a.suffix}.md"), "w").write("\n".join(lines) + "\n")
    print("\n".join(lines))


def frames(meta, n):
    """Yield (t seconds, BGR frame) over the analysis window, upright."""
    import cv2
    cap = cv2.VideoCapture(os.path.join(ev.ROOT, meta["video"]))
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.set(cv2.CAP_PROP_POS_MSEC, meta["startMs"])
    k = 0
    while k / fps <= (n - 1) * 0.1:
        ok, fr = cap.read()
        if not ok:
            break
        yield k / fps, fr, fps
        k += 1
    cap.release()


def crop_at(fr, r, t, grid, size, interp):
    import cv2
    H, W = fr.shape[:2]
    x, y, w, h = (float(np.interp(t, grid, r[:, j])) for j in range(4))
    x0, y0 = int(round(x * W)), int(round(y * H))
    cw, ch = max(2, int(round(w * W))), max(2, int(round(h * H)))
    return cv2.resize(fr[y0:y0 + ch, x0:x0 + cw], size, interpolation=interp)


def mark_overlay(Wf=1080, Hf=1920):
    """RGBA overlay of the app's export mark (ShareOverlay.tsx: bottom gradient, dark pill with the R and the handle),
    at frame pixels; sizes from the frame's short side as in the app."""
    from PIL import Image, ImageDraw, ImageFont
    unit = min(Wf, Hf)
    ov = Image.new("RGBA", (Wf, Hf), (0, 0, 0, 0))
    gh = int(min(340 + 520, Hf * 0.6))
    grad = np.zeros((gh, Wf, 4), np.uint8)
    grad[..., 3] = (np.linspace(0, 0.75, gh) * 255).astype(np.uint8)[:, None]
    ov.alpha_composite(Image.fromarray(grad, "RGBA"), (0, Hf - gh))
    logo = Image.open(os.path.join(ASSETS, "reprize-mark.png")).convert("RGBA")
    lh = round(unit * 0.042)
    logo = logo.resize((round(lh * logo.width / logo.height), lh), Image.LANCZOS)
    font = ImageFont.truetype(FONT, round(unit * 0.03))
    text = "@reprize.app"
    tb = font.getbbox(text)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    px, py, gap, margin = unit * 0.021, unit * 0.011, unit * 0.014, unit * 0.045
    pw = round(2 * px + logo.width + gap + tw)
    ph = round(2 * py + max(lh, th))
    mark = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
    d = ImageDraw.Draw(mark)
    d.rounded_rectangle([0, 0, pw - 1, ph - 1], radius=ph // 2, fill=(12, 12, 12, round(0.55 * 255)))
    mark.alpha_composite(logo, (round(px), (ph - lh) // 2))
    d.text((round(px + logo.width + gap), (ph - th) // 2 - tb[1]), text, font=font, fill=(255, 255, 255, 255))
    alpha = np.array(mark)[..., 3].astype(float) * 0.85
    m = np.array(mark)
    m[..., 3] = alpha.astype(np.uint8)
    mark = Image.fromarray(m, "RGBA")
    ov.alpha_composite(mark, (round(Wf - margin - pw), round(Hf - margin - ph)))
    return np.array(ov)


def blend(frame_bgr, ov):
    a = ov[..., 3:4].astype(np.float32) / 255.0
    rgb = ov[..., :3][..., ::-1].astype(np.float32)
    return (frame_bgr.astype(np.float32) * (1 - a) + rgb * a).astype(np.uint8)


def encode(tmp, dst, crf):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", tmp, "-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf),
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart", dst], check=True)
    os.remove(tmp)


def cmd_compare(a):
    import cv2
    cams = []
    for i, spec in enumerate(a.cam):
        cam, z = parse_cam(spec)
        meta, truth, n, r, W, H, orient = camera(a.clip, cam, z, engine_of(spec))
        label = label_of(spec, scores(truth, n, r, W, H))
        if a.labels and i < len(a.labels) and a.labels[i]:
            label = f"{a.labels[i]} {label}"
        cams.append((label, r))
    grid = np.arange(n) * 0.1
    os.makedirs(OUT, exist_ok=True)
    tmp = os.path.join(OUT, f".{a.clip}.cmp.mp4")
    out = None
    for t, fr, fps in frames(meta, n):
        panels = []
        for label, r in cams:
            p = crop_at(fr, r, t, grid, (540, 960), cv2.INTER_AREA)
            for col, th in (((0, 0, 0), 4), ((255, 255, 255), 2)):
                cv2.putText(p, label, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.55, col, th, cv2.LINE_AA)
            panels.append(p)
        img = np.hstack(panels)
        if out is None:
            out = cv2.VideoWriter(tmp, cv2.VideoWriter_fourcc(*"mp4v"), fps, (img.shape[1], img.shape[0]))
        out.write(img)
    out.release()
    dst = os.path.join(OUT, f"{a.clip}.story-compare{a.suffix}.mp4")
    encode(tmp, dst, 26)
    print(dst)


def cmd_export(a):
    import cv2
    cam, z = parse_cam(a.cam[0])
    meta, truth, n, r, W, H, orient = camera(a.clip, cam, z, engine_of(a.cam[0]))
    grid = np.arange(n) * 0.1
    ov = None if a.no_mark else mark_overlay()
    os.makedirs(OUT, exist_ok=True)
    tag = a.cam[0].replace("@", "-z").replace("#", "-")
    tmp = os.path.join(OUT, f".{a.clip}.{tag}.mp4")
    out = None
    for t, fr, fps in frames(meta, n):
        img = crop_at(fr, r, t, grid, (1080, 1920), cv2.INTER_LANCZOS4)  # what an export would do: scale to 1080x1920
        if ov is not None:
            img = blend(img, ov)
        if out is None:
            out = cv2.VideoWriter(tmp, cv2.VideoWriter_fourcc(*"mp4v"), fps, (1080, 1920))
        out.write(img)
    out.release()
    dst = os.path.join(OUT, f"{a.clip}.story-{tag}.mp4")
    encode(tmp, dst, 20)
    s = scores(truth, n, r, W, H)
    print(dst, f"crop {s['src_w']}x{s['src_h']} source px -> 1080x1920 (x{s['upscale']:.2f})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["sweep", "compare", "export", "auto"])
    ap.add_argument("clips", nargs="*")
    ap.add_argument("--clip")
    ap.add_argument("--cam", action="append", default=[])
    ap.add_argument("--suffix", default="")
    ap.add_argument("--no-mark", action="store_true")
    ap.add_argument("--labels", nargs="*", default=None, help="compare: a prefix per panel (\"\" for none)")
    ap.add_argument("--max-upscale", type=float, default=2.2, help="auto: quality limit (x scale-up to 1080 wide)")
    ap.add_argument("--factor", type=float, default=1.0, help="auto: content zoom = today's Modo Foco zoom x factor")
    ap.add_argument("--factor-v", type=float, default=1.2, help="auto: the same for vertical recordings")
    ap.add_argument("--miss", type=float, default=0.03, help="auto: max share of the detector's ball outside the crop")
    ap.add_argument("--min-share", type=float, default=0.35, help="auto: below this ball share, stay at the safe zoom")
    a = ap.parse_args()
    {"sweep": cmd_sweep, "compare": cmd_compare, "export": cmd_export, "auto": cmd_auto}[a.cmd](a)


if __name__ == "__main__":
    main()
