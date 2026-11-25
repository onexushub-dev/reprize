#!/usr/bin/env python3
"""Voice trigger lab, Phase 1: the VoiceBench test app (lab/ios-bench), its model files and its results.

VoiceBench is a throwaway iPhone app, separate from Reprize, that runs today's dictation trigger ("Atual") and the new
"salvar" detector ("Novo", the same KeywordDetector.swift the app will use) on the same microphone, plus 10-minute
consumption runs with one engine at a time. How to run a session: docs/voice-lab/bench-protocol.md.

    # on the Mac, before building the app in Xcode: model files -> ios-bench/VoiceBench/Data/ (not in git)
    python3 docs/voice-lab/lab/tools/voice_bench.py prepare
    # after a run: the .zip exported by the app (AirDrop) goes in docs/voice-lab/bench/, then
    python3 docs/voice-lab/lab/tools/voice_bench.py results docs/voice-lab/bench [--md out.md]

`results` reads every session .json in the folder, its subfolders and its .zip files (each session once; folders whose
name starts with "_", like _descartadas/, are skipped):
  - accuracy: per speaker and distance, each engine's events counted up to the expected number, extras as "(+n)";
  - noise: each engine's false triggers per hour;
  - perf: per engine (the microphone-only run first, as the baseline), battery drop per hour, minutes in each
    thermal state, CPU seconds per minute and the new engine's mean step time.
The counts trust the app's events. To check one session by ear, its .m4a sits next to its .json; the events' `t` is
seconds since Iniciar, and the .m4a starts ~0.2 s later (the microphone's start-up).

Only the standard library is needed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
DATA = os.path.join(HERE, "..", "ios-bench", "VoiceBench", "Data")
MODEL_DIR = os.path.join(ROOT, "app", "modules", "replay-camera", "ios", "Models", "voice", "salvar-v1")
MODEL_FILES = ("detector.json", "mel_filterbank.bin", "classifier.bin")
MODELS_MD = os.path.join(ROOT, "docs", "voice-lab", "MODELS.md")
# Xcode compiles the .mlpackage into voice_embedding.mlmodelc inside the app (same model as ios/Models/*.mlmodelc).
EMBEDDING = os.path.join(HERE, "build", "voice_embedding.mlpackage")

ENGINES = ("dictation", "keyword")
ENGINE_NAMES = {"none": "Só microfone", "dictation": "Atual (ditado)", "keyword": "Novo (detector)"}
THERMAL = ("nominal", "fair", "serious", "critical")


# MARK: prepare

def expected_sha256() -> dict[str, str]:
    """The model files' sha256 from MODELS.md's table (written by export_detector.py)."""
    out = {}
    with open(MODELS_MD, encoding="utf-8") as f:
        for line in f:
            m = re.match(r"\|\s*([\w.]+)\s*\|\s*([0-9a-f]{64})\s*\|", line)
            if m:
                out[m.group(1)] = m.group(2)
    return out


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def cmd_prepare(_a) -> int:
    missing = [f for f in MODEL_FILES if not os.path.isfile(os.path.join(MODEL_DIR, f))]
    if missing:
        print(f"Faltam {', '.join(missing)} em {MODEL_DIR}: rode export_detector.py build", file=sys.stderr)
        return 1
    if not os.path.isdir(EMBEDDING):
        print(f"Falta {EMBEDDING}: rode export_detector.py build", file=sys.stderr)
        return 1
    known = expected_sha256()
    for f in MODEL_FILES:
        got = sha256(os.path.join(MODEL_DIR, f))
        if known.get(f) != got:
            print(f"{f} não bate com o sha256 de MODELS.md ({got[:12]}…): rode export_detector.py build", file=sys.stderr)
            return 1
    if os.path.isdir(DATA):
        shutil.rmtree(DATA)
    os.makedirs(DATA)
    for f in MODEL_FILES:
        shutil.copy2(os.path.join(MODEL_DIR, f), os.path.join(DATA, f))
    shutil.copytree(EMBEDDING, os.path.join(DATA, "voice_embedding.mlpackage"))
    print(f"Pronto: {os.path.normpath(DATA)}")
    for name in sorted(os.listdir(DATA)):
        print(f"  {name}")
    print("Agora abra docs/voice-lab/lab/ios-bench/VoiceBench.xcodeproj no Xcode e rode no iPhone.")
    return 0


# MARK: results

def load_sessions(folder: str) -> list[tuple[str, dict]]:
    """(name, session) for every session .json under `folder` and inside its .zip files, each name once, by name."""
    found: dict[str, dict] = {}

    def add(path_in_source: str, read):
        base = os.path.basename(path_in_source)
        if not base.endswith(".json") or base.startswith("._"):
            return
        name = base[: -len(".json")]
        if name in found:
            return
        try:
            data = json.loads(read())
        except (ValueError, UnicodeDecodeError):
            return
        if isinstance(data, dict) and data.get("kind") in ("accuracy", "noise", "perf"):
            found[name] = data

    for dirpath, dirs, files in os.walk(folder):
        dirs[:] = sorted(d for d in dirs if not d.startswith("_"))  # _descartadas/: runs set aside on purpose
        for f in sorted(files):
            path = os.path.join(dirpath, f)
            if f.endswith(".zip"):
                with zipfile.ZipFile(path) as z:
                    for member in sorted(z.namelist()):
                        add(member, lambda m=member: z.read(m))
            else:
                add(path, lambda p=path: open(p, "rb").read())
    return sorted(found.items())


def count(session: dict, engine: str) -> int:
    return sum(1 for e in session.get("events", []) if e.get("engine") == engine)


def accuracy_rows(sessions: list[dict]) -> list[tuple[str, int, str, str]]:
    """(speaker, distance, Atual, Novo) per speaker and distance; extras are counted per session."""
    groups: dict[tuple[str, int], list[int]] = {}
    for s in sessions:
        if s.get("kind") != "accuracy":
            continue
        speaker = (s.get("speaker") or "").strip() or "?"
        key = (speaker, int(s.get("distance") or 0))
        expected = int(s.get("expected") or 0)
        g = groups.setdefault(key, [0, 0, 0, 0, 0])  # expected, atual, atual extra, novo, novo extra
        g[0] += expected
        for i, engine in ((1, "dictation"), (3, "keyword")):
            heard = count(s, engine)
            g[i] += min(heard, expected)
            g[i + 1] += max(0, heard - expected)
    text = lambda hits, extra, expected: f"{hits}/{expected}" + (f" (+{extra})" if extra else "")
    return [(speaker, distance, text(atual, atual_x, expected), text(novo, novo_x, expected))
            for (speaker, distance), (expected, atual, atual_x, novo, novo_x) in sorted(groups.items())]


def noise_rows(sessions: list[dict]) -> list[tuple[float, int, float, int, float]]:
    """(minutes, Atual events, Atual per hour, Novo events, Novo per hour), all noise sessions together."""
    noise = [s for s in sessions if s.get("kind") == "noise"]
    if not noise:
        return []
    seconds = sum(float(s.get("durationSec") or 0) for s in noise)
    atual = sum(count(s, "dictation") for s in noise)
    novo = sum(count(s, "keyword") for s in noise)
    per_hour = (lambda n: round(n * 3600 / seconds, 2)) if seconds > 0 else (lambda n: 0.0)
    return [(round(seconds / 60, 2), atual, per_hour(atual), novo, per_hour(novo))]


def perf_rows(sessions: list[dict]) -> list[dict]:
    """One row per perf session, microphone-only first, then Atual, then Novo (then by start)."""
    rows = []
    for s in sessions:
        if s.get("kind") != "perf":
            continue
        perf = sorted(s.get("perf") or [], key=lambda r: r["t"])
        if len(perf) < 2:
            continue
        first, last = perf[0], perf[-1]
        hours = (last["t"] - first["t"]) / 3600
        minutes = hours * 60
        thermal: dict[str, float] = {}
        for a, b in zip(perf, perf[1:]):
            state = a.get("thermal", "unknown")
            thermal[state] = round(thermal.get(state, 0.0) + (b["t"] - a["t"]) / 60, 2)
        steps = [r["keywordStepMs"] for r in perf if r.get("keywordStepMs") is not None]
        charging = any(r.get("charging") for r in perf)
        rows.append({
            "engine": s.get("perfEngine") or "none",
            "start": s.get("start", ""),
            "minutes": round(minutes, 1),
            "batteryStart": first["battery"],
            "batteryEnd": last["battery"],
            "charging": charging,
            "batteryPerHour": None if charging or hours <= 0 else (first["battery"] - last["battery"]) * 100 / hours,
            "thermalMinutes": thermal,
            "cpuSecPerMin": (last["cpuSec"] - first["cpuSec"]) / minutes if minutes > 0 else 0.0,
            "stepMs": sum(steps) / len(steps) if steps else None,
        })
    order = {"none": 0, "dictation": 1, "keyword": 2}
    return sorted(rows, key=lambda r: (order.get(r["engine"], 3), r["start"]))


RUN_NAMES = {"none": "Só microfone", "dictation": "Só atual", "keyword": "Só novo"}


def session_label(s: dict) -> str:
    if s.get("kind") == "accuracy":
        return f"Acerto {(s.get('speaker') or '').strip() or '?'} {s.get('distance')} m"
    if s.get("kind") == "noise":
        return "Ruído"
    return RUN_NAMES.get(s.get("perfEngine") or "none", "Consumo")


def issue_lines(named: list[tuple[str, dict]]) -> list[str]:
    """One line per session that recorded issues (interruptions, background, recording errors, charger)."""
    lines = []
    for name, s in named:
        issues = s.get("issues") or []
        if issues:
            text = "; ".join(f"{int(i['t'] // 60)}:{int(i['t'] % 60):02d} {i['what']}" for i in issues)
            lines.append(f"{name} ({session_label(s)}): {text}")
    return lines


def above(row: dict, base_cpu: float | None) -> str:
    """CPU seconds per minute above the microphone-only baseline, and the share of one CPU core that is."""
    if base_cpu is None or row["engine"] == "none":
        return "—"
    extra = row["cpuSecPerMin"] - base_cpu
    return f"{extra:+.1f} s/min ({extra / 60 * 100:+.0f}% of a core)"


def markdown(sessions: list[dict], named: list[tuple[str, dict]] | None = None) -> str:
    out = []
    devices = sorted({f"{s.get('device', '?')} (iOS {s.get('ios', '?')})" for s in sessions})
    models = sorted({s.get("model", "?") for s in sessions})
    out.append(f"Sessions: {len(sessions)} · device: {', '.join(devices) or '—'} · model: {', '.join(models) or '—'}")
    out.append("")
    acc = accuracy_rows(sessions)
    out.append("### Accuracy (\"salvar\" heard / said)")
    out.append("")
    if acc:
        out.append("| Speaker | Distance | Atual (dictation) | Novo (detector) |")
        out.append("|---|---|---|---|")
        for speaker, distance, atual, novo in acc:
            out.append(f"| {speaker} | {distance} m | {atual} | {novo} |")
    else:
        out.append("No accuracy sessions.")
    out.append("")
    out.append("### False triggers (noise sessions)")
    out.append("")
    noise = noise_rows(sessions)
    if noise:
        out.append("| Minutes | Atual | Atual per hour | Novo | Novo per hour |")
        out.append("|---|---|---|---|---|")
        for minutes, a, ah, n, nh in noise:
            out.append(f"| {minutes:g} | {a} | {ah:g} | {n} | {nh:g} |")
    else:
        out.append("No noise sessions.")
    out.append("")
    out.append("### Consumption (one engine at a time)")
    out.append("")
    perf = perf_rows(sessions)
    if perf:
        base = [r["cpuSecPerMin"] for r in perf if r["engine"] == "none"]
        base_cpu = sum(base) / len(base) if base else None
        out.append("| Engine | Minutes | Battery | Battery per hour | Thermal (min) | CPU s per min | Above microphone | Novo step |")
        out.append("|---|---|---|---|---|---|---|---|")
        for r in perf:
            thermal = ", ".join(f"{k} {v:g}" for k, v in sorted(r["thermalMinutes"].items(),
                                                                key=lambda kv: THERMAL.index(kv[0]) if kv[0] in THERMAL else 9))
            step = f"{r['stepMs']:.2f} ms" if r["stepMs"] is not None else "—"
            rate = "plugged in" if r["charging"] else f"{r['batteryPerHour']:.1f} %/h"
            out.append(f"| {ENGINE_NAMES.get(r['engine'], r['engine'])} | {r['minutes']:g} | "
                       f"{r['batteryStart'] * 100:.0f}% → {r['batteryEnd'] * 100:.0f}% | {rate} | "
                       f"{thermal} | {r['cpuSecPerMin']:.1f} | {above(r, base_cpu)} | {step} |")
        out.append("")
        out.append("iOS gives apps the battery level in 5% steps, so a 10 min run rarely moves it: read the battery "
                   "column only when it changed. "
                   "CPU is the whole app (microphone, .m4a recording, screen) — compare with the microphone-only row. "
                   "Not in this column: Atual's speech recognition, which runs in an iOS process outside VoiceBench, and "
                   "Novo's Core ML work on the Neural Engine. For the full energy picture record an Xcode Power "
                   "Profiler trace per engine.")
    else:
        out.append("No consumption sessions.")
    issues = issue_lines(named or [])
    if issues:
        out.append("")
        out.append("### Issues during sessions")
        out.append("")
        out.extend(f"- {line}" for line in issues)
    return "\n".join(out) + "\n"


def cmd_results(a) -> int:
    loaded = load_sessions(a.folder)
    if not loaded:
        print(f"Nenhuma sessão em {a.folder}", file=sys.stderr)
        return 1
    text = markdown([s for _, s in loaded], loaded)
    print(text)
    if a.md:
        with open(a.md, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"Salvo em {a.md}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("prepare", help="copy the model files into ios-bench/VoiceBench/Data").set_defaults(fn=cmd_prepare)
    r = sub.add_parser("results", help="tables from the app's exported sessions")
    r.add_argument("folder", help="folder with session .json files and/or the app's exported .zip files")
    r.add_argument("--md", help="also write the tables to this Markdown file")
    r.set_defaults(fn=cmd_results)
    a = p.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
