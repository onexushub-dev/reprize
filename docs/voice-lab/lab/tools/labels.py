"""Hand labels for 2026-11-23 (beach tennis, open court, loud music).

Times are on the WATCH recording's timeline (seconds), taken from the Whisper + VAD segments of the watch audio, where
the player's voice is close to the microphone. Each phone clip's offset on that timeline comes from align.py (the five
distance clips line up end to end, within 1 s, as the app's no-overlap rule says they should).
"""

# watch file -> list of (start, end, distance_m, style)
DIST_WATCH = "Gravação 2"
DIST_UTTERANCES = [
    # 2-3 m (the clips are named "3m"; he said "2 metros" at the start)
    (8.65, 9.62, 3, "normal"), (12.33, 13.27, 3, "normal"), (15.60, 16.76, 3, "normal"),
    (22.70, 23.99, 3, "forte"), (25.99, 26.87, 3, "forte"), (29.19, 30.40, 3, "forte"),
    (62.83, 63.86, 3, "lado"), (65.48, 66.49, 3, "lado"),
    (76.14, 77.24, 3, "pulso"), (79.08, 80.09, 3, "pulso"),
    # 5 m
    (109.80, 110.74, 5, "normal"), (112.04, 112.95, 5, "normal"), (113.99, 114.90, 5, "normal"),
    (119.27, 120.15, 5, "forte"), (121.07, 121.91, 5, "forte"), (123.15, 124.15, 5, "forte"),
    (127.27, 129.08, 5, "lado"), (129.83, 130.81, 5, "lado"),
    (133.90, 135.51, 5, "pulso"), (138.31, 139.29, 5, "pulso"),
    # 9 m (net); he said a couple more than the protocol, styles after the first six are approximate
    (154.79, 155.77, 9, "normal"), (156.23, 157.17, 9, "normal"), (158.51, 159.35, 9, "normal"),
    (161.64, 162.49, 9, "forte"), (164.23, 165.14, 9, "forte"), (165.45, 167.25, 9, "forte"),
    (168.07, 169.46, 9, "lado"), (170.15, 171.03, 9, "lado"),
    (172.39, 173.30, 9, "pulso"), (176.17, 177.14, 9, "pulso"), (179.31, 180.31, 9, "pulso"),
]
UNCERTAIN = [(21.61, 22.65), (183.11, 183.99)]  # 3rd 2-3 m "normal" re-timed: it is at the end of the 13.48-16.76 segment  # left out of both counts

# phone clip -> offset on the watch timeline (clip t = 0 is watch t = offset)
DIST_CLIPS = {
    "3m normal forte": -10.81,
    "3m de lado": 48.69,
    "3m com pulso levantado": 68.96,
    "5m normal forte lado": 82.51,
    "9m normalfortelado pul": 141.02,
}

NOISE_CLIPS = ["60s de ruido 1", "60s de ruido 2", "60s de ruido 3"]
HOME_SALVAR = "3380894D-4D5C-4EC0-8071-5FCE87072764"   # 20x "salvar", close, quiet
HOME_CONFUSERS = "4D6B9226-500A-4EA4-800E-2CF5F18D93C4"  # salva, salvou, salve, falar, saber, salada
