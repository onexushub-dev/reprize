#!/usr/bin/env python3
"""Modo Foco lab (tests 32-38): unweighted means over the clips of det_report.py reports
(lab/tests/detect/report.<name>.md): ceiling, precision and cover, plus cover per clip. The lab's tables quote these.

    python3 tools/lab/report_mean.py t37-bhn-full-s50 t38-gym
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

for name in sys.argv[1:]:
    rows = [ln for ln in open(os.path.join(ROOT, "lab", "tests", "detect", f"report.{name}.md"))
            if ln.startswith("| b") or ln.startswith("| y")]  # one row per clip (basket-*, yt*)
    ceil, prec, cover, per = [], [], [], []
    for r in rows:
        f = [x.strip() for x in r.strip().strip("|").split("|")]
        ceil.append(int(f[2].rstrip("%")))
        _, p, c, _ = [x.strip() for x in f[3].split("/")]
        prec.append(int(p.rstrip("%")))
        cover.append(int(c.rstrip("%")))
        per.append(f"{f[0]}:{c}")
    n = len(rows)
    print(f"{name}: n={n} ceiling {sum(ceil) / n:.1f} precision {sum(prec) / n:.1f} cover {sum(cover) / n:.1f} | "
          + " ".join(per))
