#!/usr/bin/env python3
"""
Encaixa os clipes nos punches da musica.
A musica entra atrasada para o clipe 11 caber inteiro: o 1o punch do grave
cai exatamente na cortada dele.
"""
import itertools, json

# punches da faixa (impactos de grave reais, travados a partir das marcacoes)
TRACK_P = [4.62, 12.84, 22.72, 28.08, 31.75, 35.14, 40.79, 49.83, 55.19, 58.86]
# nivel de cada impacto (0-1), para saber quais sao os mais fortes
LEVEL = [0.68, 0.70, 0.72, 0.78, 0.68, 0.76, 0.71, 0.57, 0.61, 0.54]

APEX = {            # (apice no clipe, duracao)
    'Campeao 11.mp4': (10.735, 14.60),
    'Campeao 6.mp4':  (12.739, 18.23),
    'Campeao 2.mp4':  (7.929, 10.83),
    'Campeao 4.mp4':  (5.066,  7.07),
    'Campeao 13.mp4': (10.062, 13.57),
    'Campeao 10.mp4': (4.398, 12.43),
    'Campeao 8.mp4':  (8.839, 12.90),
    'Campeao 5.mp4':  (10.296, 13.10),
    'Campeao 14.mp4': (4.197,  7.23),
    'Campeao 7.mp4':  (6.809, 10.17),
}
FIRST = 'Campeao 11.mp4'
DELAY = APEX[FIRST][0] - TRACK_P[0]          # atraso da musica
P = [p + DELAY for p in TRACK_P]             # punches no tempo do video
GAPS = [P[i+1] - P[i] for i in range(len(P)-1)]

H_MIN, B_MIN = 0.80, 1.20
rest = [k for k in APEX if k != FIRST]


def lead(k):
    return APEX[k][0]


def tail(k):
    return APEX[k][1] - APEX[k][0]


def want_hold(g):
    """p&b proporcional ao intervalo: punch rapido onde a musica aperta,
    segurado onde ela abre -- como na referencia."""
    return min(2.60, max(0.75, g*0.30))


best = None
for perm in itertools.permutations(rest):
    order = [FIRST] + list(perm)
    holds, builds, ok = [], [], True
    for i, g in enumerate(GAPS):
        nxt = order[i+1]
        h = want_hold(g)
        h = max(h, g - lead(nxt))      # o proximo nao tem build para tanto
        h = min(h, tail(order[i]))     # o anterior nao tem cauda para tanto
        b = g - h
        if (b < B_MIN or b > lead(nxt) + 1e-6
                or h < H_MIN - 1e-6 or h > tail(order[i]) + 1e-6):
            ok = False
            break
        holds.append(h)
        builds.append(b)
    if not ok:
        continue
    last_hold = min(3.40, tail(order[-1]))
    if last_hold < 1.60:
        continue
    # corte de cabeca de cada clipe (quanto do inicio se perde)
    trims = [0.0] + [lead(order[i+1]) - builds[i] for i in range(len(builds))]
    i14 = order.index('Campeao 14.mp4')
    score = LEVEL[i14]*10
    score -= sum(abs(h - want_hold(GAPS[i])) for i, h in enumerate(holds))*0.6
    score -= max(trims)*0.30           # evita um clipe perder muito da cabeca
    score -= sum(t for t in trims)*0.05
    score += min(builds)*0.8           # evita fragmento curto demais
    score += last_hold*0.3
    if best is None or score > best[0]:
        best = (score, order, holds, builds, last_hold, trims)

score, order, holds, builds, last_hold, trims = best
print('atraso da musica: %.3fs   (clipe 11 inteiro, 1o punch do grave na cortada)' % DELAY)
print()
rows, t = [], 0.0
for i, k in enumerate(order):
    build = APEX[k][0] if i == 0 else builds[i-1]
    cin = APEX[k][0] - build
    snap = t + build
    hold = holds[i] if i < len(holds) else last_hold
    t1 = snap + hold
    rows.append((k, round(cin, 3), round(t, 3), round(t1, 3), round(snap, 3)))
    print("    ('%s', %6.3f, %6.3f, %6.3f, %6.3f),   # build %.2f  hold %.2f  nivel %.2f"
          % (k, cin, t, t1, snap, build, hold, LEVEL[i]))
    t = t1
print('\ntotal %.2fs   |  clipe 14 no punch de nivel %.2f'
      % (t, LEVEL[order.index('Campeao 14.mp4')]))
json.dump(dict(delay=DELAY, rows=rows), open('/home/claude/work/solved.json', 'w'), indent=1)
