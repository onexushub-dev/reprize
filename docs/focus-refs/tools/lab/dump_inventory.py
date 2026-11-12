#!/usr/bin/env python3
"""4K test plan (docs/superpowers/plans/2026-11-12-4k-analysis-speed-test-plan.md): what a phone dump holds.

A dump = the app's Documents copied with devicectl into docs/focus-refs/raw-dump/<dump>/ (clips/ + mmkv/). This reads
the app's MMKV store (sessions and clips: cut, sport, Jogadores / Bola results) and ffprobes every clip, then:
  - writes lab/tests/4k/<dump>/inventory.md and inventory.json (one row per clip: time, resolution, fps, orientation,
    sport, cut, Jogadores and Bola on the phone);
  - with --register, adds the clips of the sports that have a ball model (basquete, beachTennis) to clips.txt as
    <sport><res>-<MMDD>-<id8> (e.g. bt4k-1112-35a58bfc, basket1080-1112-0a1b2c3d), window = the app's cut, and copies
    the phone's Jogadores file to lab/tests/framing/<name>.current.focus.json (the lab path and verdict read it).
Only clips recorded on --day (YYYY-MM-DD, local time) are taken, unless --day is left out. --sport sets the sport of
recordings the app never classified (none of their clips opened): pass it only when the whole day was one sport.

    python3 tools/lab/dump_inventory.py raw-dump/2026-11-11-4k --day 2026-11-11 --after 18:00 --sport beachTennis --register
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import evaluate as ev  # noqa: E402

TZ = datetime.timezone(datetime.timedelta(hours=-3))  # São Paulo
PREFIX = {"beachTennis": "bt", "basquete": "basket"}


def mmkv_objects(raw: str, prefix: str) -> dict:
    """The last JSON value stored under each `<prefix><uuid>` key (MMKV appends; the latest write wins)."""
    out = {}
    for m in re.finditer(re.escape(prefix) + r"([0-9a-f-]{36})", raw):
        i = raw.find("{", m.end(), m.end() + 8)
        if i < 0:
            continue
        depth, j = 0, i
        for j in range(i, min(len(raw), i + 200000)):
            if raw[j] == "{":
                depth += 1
            elif raw[j] == "}":
                depth -= 1
                if depth == 0:
                    break
        try:
            out[m.group(1)] = json.loads(raw[i:j + 1].encode("latin-1").decode("utf-8"))
        except ValueError:
            pass
    return out


def probe(path: str) -> dict:
    st = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                    "stream=width,height,avg_frame_rate", "-of", "json", path],
                                   capture_output=True, text=True, check=True).stdout)["streams"][0]
    rot = 0
    o = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_streams", path],
                       capture_output=True, text=True).stdout
    for line in o.splitlines():
        if line.startswith("rotation=") or line.startswith("TAG:rotate="):
            rot = int(float(line.split("=")[1]))
    w, h = st["width"], st["height"]
    if abs(rot) % 180 == 90:
        w, h = h, w
    num, den = (st["avg_frame_rate"].split("/") + ["1"])[:2]
    return {"w": w, "h": h, "fps": round(float(num) / max(float(den), 1)), "orient": "H" if w >= h else "V"}


def sport_of(session: dict) -> str | None:
    b = session.get("ballSport") or {}
    s = b.get("sport") or b.get("auto")
    return s if s in PREFIX else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dump", help="raw-dump/<dump> (relative to docs/focus-refs)")
    ap.add_argument("--day", default=None, help="only clips recorded this local day (YYYY-MM-DD)")
    ap.add_argument("--after", default=None, help="only clips recorded at or after this local time (HH:MM)")
    ap.add_argument("--before", default=None, help="only clips recorded before this local time (HH:MM)")
    ap.add_argument("--sport", choices=sorted(PREFIX), default=None,
                    help="the sport of recordings the app never classified (no clip opened yet); Victor says which")
    ap.add_argument("--register", action="store_true", help="add the clips to clips.txt and copy the Jogadores files")
    a = ap.parse_args()
    dump = a.dump.rstrip("/")
    root = os.path.join(ev.ROOT, dump)
    raw = open(os.path.join(root, "mmkv", "reprize"), "rb").read().decode("latin-1")
    clips = mmkv_objects(raw, "reprize:v1:clip:")
    sessions = mmkv_objects(raw, "reprize:v1:session:")
    rows = []
    for c in sorted(clips.values(), key=lambda c: c["createdAt"]):
        f = os.path.basename(c["path"])
        p = os.path.join(root, "clips", f)
        if not os.path.exists(p):
            continue
        at = datetime.datetime.fromtimestamp(c["createdAt"] / 1000, TZ)
        if a.day and at.strftime("%Y-%m-%d") != a.day:
            continue
        hm = at.strftime("%H:%M")
        if (a.after and hm < a.after) or (a.before and hm >= a.before):
            continue
        s = sessions.get(c["sessionId"], {})
        pr = probe(p)
        b, fo = c.get("ball") or {}, c.get("focus") or {}
        sport = sport_of(s) or a.sport
        res = "4k" if min(pr["w"], pr["h"]) >= 2160 else str(min(pr["w"], pr["h"]))
        name = f"{PREFIX[sport]}{res}-{at.strftime('%m%d')}-{f[:8].lower()}" if sport else None
        rows.append({"name": name, "file": f, "session": c["sessionId"][:8], "at": at.strftime("%Y-%m-%d %H:%M:%S"),
                     "size": f"{pr['w']}x{pr['h']}", "fps": pr["fps"], "orient": pr["orient"], "sport": sport,
                     "trim": c["trim"], "cut_changed": c["trim"] != c.get("bounds"),
                     "jogadores": fo.get("status"), "bola": b.get("status"), "bola_reason": b.get("reason"),
                     "bola_share": b.get("share"), "video": f"{dump}/clips/{f}"})
    out = os.path.join(ev.ROOT, "lab", "tests", "4k", os.path.basename(dump))
    os.makedirs(out, exist_ok=True)
    json.dump(rows, open(os.path.join(out, "inventory.json"), "w"), indent=1)
    with open(os.path.join(out, "inventory.md"), "w") as md:
        md.write(f"# {dump}: {len(rows)} clips\n\n| lab name | file | recorded | size | fps | o | sport | cut | "
                 "Jogadores | Bola on the phone |\n|---|---|---|---|---|---|---|---|---|---|\n")
        for r in rows:
            cut = (r["trim"]["endMs"] - r["trim"]["startMs"]) / 1000
            bola = r["bola"] or "-"
            if r["bola_reason"]:
                bola += f" ({r['bola_reason']})"
            if r["bola_share"] is not None:
                bola += f" share {r['bola_share']:.2f}"
            md.write(f"| {r['name'] or '-'} | {r['file'][:8]} | {r['at'][5:]} | {r['size']} | {r['fps']} | {r['orient']} | "
                     f"{r['sport'] or '-'} | {cut:.1f} s{' (changed)' if r['cut_changed'] else ''} | "
                     f"{r['jogadores'] or '-'} | {bola} |\n")
    print(f"{len(rows)} clips -> {out}/inventory.md")
    if not a.register:
        return
    listed = set()
    with open(os.path.join(HERE, "clips.txt")) as f:
        for line in f:
            if line.strip() and not line.startswith("#"):
                listed.add(line.split("|")[0])
    new = [r for r in rows if r["name"] and r["name"] not in listed]
    if new:
        with open(os.path.join(HERE, "clips.txt"), "a") as f:
            f.write(f"# {datetime.date.today()} dump_inventory.py {dump}: the app's cut of each clip (4K test plan)\n")
            for r in new:
                t = r["trim"]
                f.write(f"{r['name']}|{r['video']}|{t['startMs']}|{t['endMs'] - t['startMs']}|{r['sport']}\n")
    for r in rows:
        if not r["name"]:
            continue
        src = os.path.join(root, "clips", r["file"][:-4] + ".focus.json")
        dst = os.path.join(ev.ROOT, "lab", "tests", "framing", f"{r['name']}.current.focus.json")
        if os.path.exists(src) and not os.path.exists(dst):
            shutil.copyfile(src, dst)
        # the players' boxes as the lab reads them (renders/<clip>.people.json): the path's head rule and the beach
        # tennis camera (court lock, hitter) need them, as the app does
        people = os.path.join(ev.ROOT, "renders", f"{r['name']}.people.json")
        if os.path.exists(src) and not os.path.exists(people):
            fo = json.load(open(src))
            if fo.get("people"):
                samples = [{"t": fo["startMs"] + k * fo["stepMs"], "tiled": [b[:4] + [1.0] for b in (row or [])]}
                           for k, row in enumerate(fo["people"])]
                json.dump({"samples": samples, "trajectories": [],
                           "summary": {"tilesFixed": True, "medianHeightTiled": fo.get("playersHeight"),
                                       "note": "from the phone's Modo Foco file (people rows)"}}, open(people, "w"))
        # the phone's own Bola camera (its .ball.json), as bt_render.py's "app" panel reads it
        ball = os.path.join(root, "clips", r["file"][:-4] + ".ball.json")
        appcam = os.path.join(ev.ROOT, "lab", "tests", "story", f"{r['name']}.appcam.json")
        if os.path.exists(ball) and not os.path.exists(appcam):
            b = json.load(open(ball))
            rects = b.get("portrait") or b.get("landscape") or []
            if rects:
                os.makedirs(os.path.dirname(appcam), exist_ok=True)
                json.dump({"zoom": b.get("zoom"), "rects": rects, "source": f"phone .ball.json {b.get('rules', '')}",
                           "verdict": b.get("verdict")}, open(appcam, "w"))
    print(f"registered {len(new)} new clips in clips.txt")
    with open(os.path.join(out, "clips.list"), "w") as f:
        f.write("\n".join(r["name"] for r in rows if r["name"]) + "\n")


if __name__ == "__main__":
    main()
