"""Hand labels for 2026-11-24 (second field test: open court, strong wind, no music).

Times are on the timeline of the watch recording "Gravação 4", which heard both speakers (Whisper + VAD segments).
The seven phone clips were saved one right after another through the remote, so with the app's no-overlap rule they
sit end to end on that timeline. The chain is anchored on "Yasmin 3m" (the only clip the envelope match finds with
confidence, r=0.25) and checked against two words Whisper also reads in the phone audio (V3 22.92 s -> 51.69 s,
Y3 13.19 s -> 77.41 s, both within 0.3 s). Expect up to ~1 s of error on the other clips.
"""

WATCH2 = "Gravação 4"

# clip -> offset on the watch timeline (clip t = 0 is watch t = offset)
CLIPS2 = {
    "Victor 3m": 28.77, "Yasmin 3m": 64.22, "Victor 5m": 90.90, "Yasmin 5m": 113.44,
    "Victor 10m": 133.48, "Yasmin 10m": 157.41, "Victor 12m": 172.24,
}

# (start, end, speaker, distance_m) on the watch timeline: 3x normal + 3x loud per speaker and distance
UTT2 = [
    (51.31, 52.34, "Victor", 3), (53.13, 54.10, "Victor", 3), (54.95, 55.83, "Victor", 3),
    (58.06, 58.97, "Victor", 3), (59.75, 60.63, "Victor", 3), (61.51, 62.42, "Victor", 3),
    (76.07, 77.11, "Yasmin", 3), (77.39, 78.39, "Yasmin", 3), (79.31, 80.30, "Yasmin", 3),
    (83.82, 85.40, "Yasmin", 3), (85.48, 86.58, "Yasmin", 3), (87.05, 87.99, "Yasmin", 3),
    (102.12, 103.06, "Victor", 5), (103.88, 104.82, "Victor", 5), (105.61, 106.45, "Victor", 5),
    (107.72, 108.69, "Victor", 5), (109.35, 110.61, "Victor", 5), (111.21, 112.05, "Victor", 5),
    (119.66, 120.85, "Yasmin", 5), (121.48, 122.55, "Yasmin", 5), (123.11, 124.02, "Yasmin", 5),
    (125.32, 126.30, "Yasmin", 5), (128.50, 129.56, "Yasmin", 5), (129.93, 130.90, "Yasmin", 5),
    (145.19, 146.23, "Victor", 10), (147.08, 148.05, "Victor", 10), (148.97, 149.88, "Victor", 10),
    (151.50, 152.53, "Victor", 10), (153.26, 154.26, "Victor", 10), (154.92, 155.96, "Victor", 10),
    (160.90, 161.94, "Yasmin", 10), (162.73, 163.83, "Yasmin", 10), (164.39, 165.36, "Yasmin", 10),
    (166.35, 167.41, "Yasmin", 10), (168.17, 169.24, "Yasmin", 10), (169.67, 170.71, "Yasmin", 10),
    (186.15, 187.13, "Victor", 12), (187.95, 188.92, "Victor", 12), (189.67, 190.55, "Victor", 12),
    (192.27, 193.21, "Victor", 12), (193.77, 194.71, "Victor", 12), (195.24, 196.18, "Victor", 12),
]

# close-mic recordings ("vozes de perto"); confusers are salva / salve / salvo / salvou
CLOSE2 = {"QD 5": "Victor", "QD 5 3": "Yasmin"}
CONFUSERS2 = ["QD 5 2", "QD 5 4"]

# the app's own trigger, voice ON (Victor, 5 tries per distance, counted on the checklist)
APP_BASELINE2 = {3: (3, 5), 5: (3, 5), 10: (3, 5), 12: (2, 5), 15: (0, 5)}
