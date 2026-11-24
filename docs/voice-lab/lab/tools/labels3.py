"""Hand labels for 2026-11-24-mulheres (Bel = Isabel, Eliane): each phone clip holds both women at one distance,
Bel first ("Isabel N metros"), then Eliane. No watch here: times come from the phone audio itself (energy bursts
checked against Whisper). Eliane's six per distance are clear. Bel's are less sure (4 at 3 m, 5 at 10 m)."""

CLIPS3 = {
    "3m Bel e Eliane": {"dist": 3, "Bel": [5.48, 7.44, 8.32, 9.50],
                        "Eliane": [12.76, 14.34, 15.94, 17.04, 19.34, 20.92],
                        "speech": [(1.03, 2.71), (11.10, 12.26)]},
    "5m Bel e Eliane": {"dist": 5, "Bel": [12.86, 13.80, 15.34, 19.36, 20.56, 21.46],
                        "Eliane": [25.30, 26.56, 27.70, 29.46, 30.70, 31.70],
                        "speech": [(10.25, 12.0), (23.27, 25.01)]},
    "10m Bel e Eliane": {"dist": 10, "Bel": [15.82, 16.75, 18.92, 20.00, 21.18],
                         "Eliane": [24.30, 25.48, 26.76, 28.16, 29.28, 30.38],
                         "speech": [(12.11, 13.97), (22.47, 23.99)]},
}
WORD = 0.8  # a word lasts about this long from its start

CLOSE3 = {
    "Bel perto": [(0.17, 1.10), (1.57, 2.45), (2.87, 3.77), (4.17, 5.09), (5.53, 6.53), (6.85, 7.81), (8.21, 9.21),
                  (9.53, 10.43), (10.83, 11.83), (12.03, 12.89)],
    "Eliane perto": [(0.65, 1.65), (2.09, 3.16), (3.43, 4.37), (4.59, 5.62), (5.93, 6.97), (7.15, 8.18), (8.39, 9.37),
                     (9.61, 10.61), (10.79, 11.80), (11.91, 12.95)],
}
