#!/usr/bin/env python3
"""
Monta um reel de beach tennis replicando a gramatica de edicao da referencia:
  - cortes duros quantizados na grade de 1/8 de tempo (107.67 BPM)
  - "punch": snap para grade dessaturado no apice de cada jogada
  - flashes de 1 frame estourados nos acentos
"""
import json, os, subprocess, sys, math

ROOT = '/home/claude'
CLIPS = os.path.join(ROOT, 'clips_raw')
WORK = os.path.join(ROOT, 'build')
os.makedirs(WORK, exist_ok=True)

FPS = 30
W, H = 1080, 1920

# ---- grade medido na referencia: out = in^1.40 * 0.90, depois saturacao 0.30
GAMMA, GAIN, SAT = 1.40, 0.90, 0.30
k = 1 - SAT
MIX = ('colorchannelmixer='
       'rr={:.4f}:rg={:.4f}:rb={:.4f}:'
       'gr={:.4f}:gg={:.4f}:gb={:.4f}:'
       'br={:.4f}:bg={:.4f}:bb={:.4f}').format(
    SAT + k*0.299, k*0.587, k*0.114,
    k*0.299, SAT + k*0.587, k*0.114,
    k*0.299, k*0.587, SAT + k*0.114)
TONE = ("lutrgb="
        "r='255*pow(clip(val/255\\,0\\,1)\\,{g})*{a}':"
        "g='255*pow(clip(val/255\\,0\\,1)\\,{g})*{a}':"
        "b='255*pow(clip(val/255\\,0\\,1)\\,{g})*{a}'").format(g=GAMMA, a=GAIN)

# ---- timeline (tempos globais em segundos) ----------------------------------
# cada slot: (clipe, entrada_no_clipe, inicio_na_timeline, fim_na_timeline, snap_global ou None)
#
# A musica roda desde 0:00. Os 10 punches foram travados no impacto de grave
# mais proximo das marcacoes do Victor (0:05, 0:13, 0:23, 0:28, 0:32, 0:35,
# 0:41, 0:50, 0:55, 0:59). O grave entra em 4.62 -- ai cai o punch do CLIPE 11.
#
# A musica comeca junto com o video e toca ate 0:04 dela. Ai PAUSA por
# 6.115s -- entra o som natural da partida -- e volta no ponto exato em que
# parou, de modo que o grave (4.62s da faixa) caia na cortada do clipe 11.
AUDIO_DELAY = 6.115      # tamanho da pausa
PAUSE_AT = 4.00          # minutagem da faixa onde a musica para
RESUME_AT = PAUSE_AT + AUDIO_DELAY   # quando ela volta, no tempo do video

# apices marcados pelo Victor, convertidos do GLOBAL do video de revisao
TIMELINE = [
    ('Campeao 11.mp4', 0.000,  0.000, 13.201, 10.735),  # A CORTADA -- grave entra aqui
    ('Campeao 13.mp4', 4.308, 13.201, 21.555, 18.955),
    ('Campeao 6.mp4',  5.459, 21.555, 30.443, 28.835),
    ('Campeao 14.mp4', 0.445, 30.443, 35.296, 34.195),  # 2o melhor punch, impacto mais forte
    ('Campeao 2.mp4',  5.360, 35.296, 38.882, 37.865),
    ('Campeao 4.mp4',  2.693, 38.882, 42.950, 41.255),
    ('Campeao 8.mp4',  4.884, 42.950, 49.505, 46.905),
    ('Campeao 5.mp4',  3.856, 49.505, 57.553, 55.945),
    ('Campeao 7.mp4',  3.057, 57.553, 62.406, 61.305),
    ('Campeao 10.mp4', 1.829, 62.406, 68.375, 64.975),  # final
]

# textos centralizados, no estilo da referencia (bold branco com contorno
# preto). A troca e instantanea no frame do 1o punch; o segundo texto fica
# 5.00s exatos (150 frames) e some.
FONT = '/usr/share/fonts/opentype/inter/Inter-Bold.otf'
TEXT_SIZE = 76
TEXTS = [
    ('The art of...', 0.000, 10.735),   # ate o frame anterior ao punch
    ('App Reprize!', 10.735, 15.735),   # entra no punch, 5.00s
]

# flashes de 1 frame, em impactos reais de grave (ja no tempo do video)
FLASHES = [36.36, 39.56, 44.08, 48.60, 52.26, 58.77, 63.29, 67.82]

# faixa original em 320kbps, desde o inicio
AUDIO_SRC = ('/mnt/user-data/uploads/'
             '4649ab84-Whos_Lovin_You_Hoodtrap_Extended_neverbadagain.mp3')
# som ambiente da partida enquanto a musica ainda nao entrou
AMBIENT_SRC = os.path.join(CLIPS, 'Campeao 11.mp4')
AMBIENT_UNTIL = 10.735

# encerramento gerado por build_outro.py (logo + chamada + handle digitando)
OUTRO = os.path.join(WORK, 'outro.mp4')
OUTRO_DUR = 4.20

TOTAL = TIMELINE[-1][3] + (OUTRO_DUR if os.path.exists(OUTRO) else 0.0)


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        print(' '.join(cmd[:12]), '...')
        print(p.stderr[-2500:])
        sys.exit(1)
    return p


def snap_grid(t, bpm=107.67, anchor=0.186, div=8):
    """quantiza na grade de 1/8 de tempo"""
    step = (60.0/bpm) * 4 / div
    return anchor + round((t - anchor)/step) * step


def main():
    reuse = '--reuse' in sys.argv
    raw = os.path.join(WORK, 'master_raw.mp4')

    # 1) corta e normaliza cada slot
    parts = []
    for i, (clip, cin, t0, t1, snap) in enumerate(TIMELINE):
        dur = t1 - t0
        src = os.path.join(CLIPS, clip)
        out = os.path.join(WORK, 'seg%02d.mp4' % i)
        if not (reuse and os.path.exists(out)):
            vf = ('scale=%d:%d:force_original_aspect_ratio=increase,'
                  'crop=%d:%d,fps=%d,setsar=1' % (W, H, W, H, FPS))
            run(['ffmpeg', '-nostdin', '-v', 'error', '-ss', '%.3f' % cin,
                 '-i', src, '-t', '%.3f' % dur, '-an', '-vf', vf,
                 '-c:v', 'libx264', '-crf', '16', '-preset', 'medium',
                 '-pix_fmt', 'yuv420p', '-y', out])
        parts.append(out)
        print('seg%02d  %-16s %6.2f->%6.2f  (%.2fs)  snap=%s'
              % (i, clip, t0, t1, dur, '%.2f' % snap if snap else '-'))

    # 2) concatena
    if not (reuse and os.path.exists(raw)):
        lst = os.path.join(WORK, 'list.txt')
        with open(lst, 'w') as f:
            for p in parts:
                f.write("file '%s'\n" % p)
        run(['ffmpeg', '-nostdin', '-v', 'error', '-f', 'concat', '-safe', '0',
             '-i', lst, '-c', 'copy', '-y', raw])

    # 3) janelas do grade dessaturado (do snap ate o ULTIMO frame do slot)
    #
    # As fronteiras dos slots nao caem em multiplos exatos de 1/30s, entao os
    # segmentos sao arredondados em frames na hora do corte. Usar o tempo
    # nominal aqui faz o grade vazar 1 frame para dentro do clipe seguinte --
    # por isso as janelas sao ancoradas na contagem real de frames.
    fr = 1.0/FPS

    def nframes(path):
        p = run(['ffprobe', '-v', 'error', '-count_frames', '-select_streams',
                 'v:0', '-show_entries', 'stream=nb_read_frames',
                 '-of', 'csv=p=0', path])
        return int(p.stdout.strip())

    bounds, acc = [], 0
    for p in parts:
        acc += nframes(p)
        bounds.append(acc)          # 1o frame do slot seguinte

    wins = []
    for i, (clip, cin, t0, t1, snap) in enumerate(TIMELINE):
        if snap is None:
            continue
        f0 = int(round(snap*FPS))   # frame do apice
        f1 = bounds[i] - 1          # ultimo frame deste slot
        wins.append((f0*fr, f1*fr))
    grade_en = '+'.join("between(t,%.4f,%.4f)" % (a - fr*0.5, b + fr*0.5)
                        for a, b in wins)

    # 4) flashes: 1 frame cada, centrado no frame mais proximo
    flash_en = '+'.join("between(t,%.4f,%.4f)"
                        % (round(t*FPS)*fr - fr*0.4, round(t*FPS)*fr + fr*0.4)
                        for t in FLASHES)

    vf = (TONE + ":enable='" + grade_en + "',"
          + MIX + ":enable='" + grade_en + "',"
          + "eq=brightness=0.34:contrast=1.25:saturation=0.35:enable='" + flash_en + "'")

    graded = os.path.join(WORK, 'master_graded.mp4')
    run(['ffmpeg', '-nostdin', '-v', 'error', '-i', raw, '-vf', vf,
         '-c:v', 'libx264', '-crf', '16', '-preset', 'medium',
         '-pix_fmt', 'yuv420p', '-y', graded])

    # 5) audio da referencia + mux
    final = os.path.join(ROOT, 'out', 'beach-tennis-reel.mp4')
    os.makedirs(os.path.dirname(final), exist_ok=True)
    # 4b) textos por cima de tudo (nao recebem o grade nem o flash)
    tf = []
    for txt, a, b in TEXTS:
        fa = round(a*FPS)*fr - fr*0.5
        fb = round(b*FPS)*fr - fr*0.5
        tf.append(
            "drawtext=fontfile=%s:text='%s':fontsize=%d:fontcolor=white:"
            "bordercolor=black:borderw=5:x=(w-text_w)/2:y=(h-text_h)/2:"
            "enable='between(t,%.4f,%.4f)'" % (FONT, txt, TEXT_SIZE, fa, fb - fr))
    titled = os.path.join(WORK, 'master_titled.mp4')
    run(['ffmpeg', '-nostdin', '-v', 'error', '-i', graded, '-vf', ','.join(tf),
         '-c:v', 'libx264', '-crf', '16', '-preset', 'medium',
         '-pix_fmt', 'yuv420p', '-y', titled])
    graded = titled

    # 4c) encerramento colado no fim (mesmo encode, entao concat sem recodificar)
    if os.path.exists(OUTRO):
        fl = os.path.join(WORK, 'final_list.txt')
        with open(fl, 'w') as f:
            f.write("file '%s'\nfile '%s'\n" % (titled, OUTRO))
        withoutro = os.path.join(WORK, 'master_final.mp4')
        run(['ffmpeg', '-nostdin', '-v', 'error', '-f', 'concat', '-safe', '0',
             '-i', fl, '-c', 'copy', '-y', withoutro])
        graded = withoutro

    # musica -> pausa com som natural -> musica volta na cortada
    amb_in, amb_out = 3.70, AMBIENT_UNTIL + 0.22
    fc = (
        # trecho antes da pausa, do inicio da faixa
        "[1:a]atrim=0:%.3f,asetpts=PTS-STARTPTS,"
        "afade=t=out:st=%.3f:d=0.35[m1];"
        # retomada: segue exatamente de onde parou
        "[1:a]atrim=%.3f:%.3f,asetpts=PTS-STARTPTS,adelay=%d|%d[m2];"
        # som natural da partida cobrindo a pausa
        # o som cru do clipe tem picos perto de 0dB e corpo baixo: ganho para
        # a ambiencia ficar no nivel do intro (-19 dBFS) e limitador para as
        # batidas de bola nao estourarem
        "[2:a]atrim=%.3f:%.3f,asetpts=PTS-STARTPTS,"
        "volume=0.725,alimiter=limit=0.92:level=disabled,"
        "afade=t=in:st=0:d=0.40,afade=t=out:st=%.3f:d=0.45,"
        "adelay=%d|%d[amb];"
        "[m1][m2][amb]amix=inputs=3:duration=longest:normalize=0,"
        "afade=t=out:st=%.3f:d=0.90[a]"
        % (PAUSE_AT, PAUSE_AT - 0.35,
           PAUSE_AT, TOTAL - AUDIO_DELAY,
           int(RESUME_AT*1000), int(RESUME_AT*1000),
           amb_in, amb_out,
           (amb_out - amb_in) - 0.45,
           int(amb_in*1000), int(amb_in*1000),
           TOTAL - 0.90)
    )
    run(['ffmpeg', '-nostdin', '-v', 'error',
         '-i', graded, '-i', AUDIO_SRC, '-i', AMBIENT_SRC,
         '-filter_complex', fc,
         '-map', '0:v:0', '-map', '[a]', '-shortest',
         '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k',
         '-movflags', '+faststart', '-y', final])
    print('\nOK ->', final)
    print('grade windows:', [(round(a, 2), round(b, 2)) for a, b in wins])


if __name__ == '__main__':
    main()
