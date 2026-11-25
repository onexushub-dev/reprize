"""voice_bench.py `results` (plan 2026-11-24 voice keyword detector, Task 5).

    cd docs/voice-lab/lab/tools && python3 -m pytest test_voice_bench.py -q
    # without pytest:
    cd docs/voice-lab/lab/tools && python3 test_voice_bench.py
"""

import json
import os
import sys
import tempfile
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voice_bench as vb  # noqa: E402


def session(kind, events=(), duration=60.0, perf=None, **extra):
    s = {
        "kind": kind, "engines": ["dictation", "keyword"], "perfEngine": None, "device": "iPhone17,2", "ios": "27.0",
        "model": "salvar-v1", "start": "2026-11-24T23:27:20Z", "durationSec": duration,
        "events": [{"engine": e, "t": float(i)} for i, e in enumerate(events)],
        "perf": perf if perf is not None else [], "audio": "x.m4a",
    }
    s.update(extra)
    return s


def test_accuracy_table_counts_per_engine():
    s = session("accuracy", ["keyword"] * 6 + ["dictation"] * 3, speaker="Victor", distance=5, expected=6)
    rows = vb.accuracy_rows([s])
    assert rows == [("Victor", 5, "3/6", "6/6")]


def test_accuracy_adds_up_repeated_sessions():
    a = session("accuracy", ["keyword"] * 5 + ["dictation"] * 4, speaker="Sara", distance=10, expected=6)
    b = session("accuracy", ["keyword"] * 6 + ["dictation"] * 2, speaker="Sara", distance=10, expected=6)
    assert vb.accuracy_rows([a, b]) == [("Sara", 10, "6/12", "11/12")]


def test_extra_events_are_reported_not_counted():
    s = session("accuracy", ["keyword"] * 8, speaker="Victor", distance=3, expected=6)
    assert vb.accuracy_rows([s]) == [("Victor", 3, "0/6", "6/6 (+2)")]


def test_missing_speaker_is_marked():
    s = session("accuracy", ["keyword"] * 6, speaker="", distance=3, expected=6)
    assert vb.accuracy_rows([s])[0][0] == "?"


def test_noise_rate_per_hour():
    s = session("noise", ["dictation", "dictation"], duration=900.0)
    assert vb.noise_rows([s]) == [(15.0, 2, 8.0, 0, 0.0)]


def test_perf_battery_per_hour_and_thermal_minutes():
    rows = []
    for i, t in enumerate(range(0, 901, 60)):
        rows.append({"t": float(t), "battery": round(0.80 - 0.002 * i, 4), "thermal": "fair" if t >= 600 else "nominal",
                     "cpuSec": 10.0 + 6.0 * i, "keywordStepMs": None if t == 0 else 3.0})
    s = session("perf", duration=900.0, perf=rows, perfEngine="keyword", engines=["keyword"])
    (r,) = vb.perf_rows([s])
    assert r["engine"] == "keyword"
    assert abs(r["batteryPerHour"] - 12.0) < 1e-6
    assert r["thermalMinutes"] == {"nominal": 10.0, "fair": 5.0}
    assert abs(r["cpuSecPerMin"] - 6.0) < 1e-6
    assert abs(r["stepMs"] - 3.0) < 1e-6


def test_perf_puts_microphone_baseline_first():
    mk = lambda e: session("perf", duration=900.0, perfEngine=e,
                           perf=[{"t": 0.0, "battery": 0.9, "thermal": "nominal", "cpuSec": 0.0},
                                 {"t": 900.0, "battery": 0.89, "thermal": "nominal", "cpuSec": 90.0}])
    assert [r["engine"] for r in vb.perf_rows([mk("keyword"), mk("none"), mk("dictation")])] == ["none", "dictation", "keyword"]


def test_perf_with_charger_has_no_battery_rate():
    rows = [{"t": 0.0, "battery": 0.65, "thermal": "nominal", "cpuSec": 0.0, "charging": True},
            {"t": 900.0, "battery": 0.65, "thermal": "nominal", "cpuSec": 90.0, "charging": True}]
    (r,) = vb.perf_rows([session("perf", duration=900.0, perf=rows, perfEngine="keyword")])
    assert r["charging"] is True and r["batteryPerHour"] is None


def test_issues_are_listed_per_session():
    s = session("perf", duration=900.0, perfEngine="dictation",
                issues=[{"t": 547.2, "what": "app foi para o fundo"}, {"t": 640.0, "what": "app voltou"}])
    assert vb.issue_lines([("20261124-210321-perf", s)]) == [
        "20261124-210321-perf (Só atual): 9:07 app foi para o fundo; 10:40 app voltou"]


def test_cpu_above_microphone():
    assert vb.above({"engine": "keyword", "cpuSecPerMin": 7.6}, 3.6) == "+4.0 s/min (+7% of a core)"
    assert vb.above({"engine": "none", "cpuSecPerMin": 3.6}, 3.6) == "—"


def test_loads_zips_and_folders_once():
    with tempfile.TemporaryDirectory() as d:
        s = session("noise", duration=60.0)
        with open(os.path.join(d, "20261124-200000-noise.json"), "w") as f:
            json.dump(s, f)
        with zipfile.ZipFile(os.path.join(d, "export.zip"), "w") as z:
            z.writestr("VoiceBench-x/20261124-200000-noise.json", json.dumps(s))
            z.writestr("VoiceBench-x/20261124-200100-accuracy.json",
                       json.dumps(session("accuracy", speaker="Victor", distance=3, expected=6)))
            z.writestr("VoiceBench-x/20261124-200100-accuracy.m4a", b"")
        os.makedirs(os.path.join(d, "_descartadas"))
        with open(os.path.join(d, "_descartadas", "20261124-190000-perf.json"), "w") as f:
            json.dump(session("perf"), f)
        names = sorted(n for n, _ in vb.load_sessions(d))
        assert names == ["20261124-200000-noise", "20261124-200100-accuracy"]


if __name__ == "__main__":
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"ok    {name}")
            except Exception as e:  # noqa: BLE001
                failed += 1
                print(f"FAIL  {name}: {e!r}")
    sys.exit(1 if failed else 0)
