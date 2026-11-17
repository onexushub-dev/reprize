#!/usr/bin/env python3
"""
Encerramento no estilo da referencia: logo da Reprize, chamada e o handle
digitando com cursor e sublinhado ambar.
Tipografia Outfit Bold (geometrica, proxima da do Instagram), branco com
borda fina escura e palavras-chave em ambar.
"""
import os, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1080, 1920, 30
DUR = 4.2
N = int(round(DUR*FPS))

BG = (10, 10, 10)
AMBER = (255, 176, 0)
WHITE = (255, 255, 255)
STROKE = (0, 0, 0)
STROKE_W = 3

OUT = '/home/claude/outro'
os.makedirs(OUT, exist_ok=True)

AVATAR = ('/mnt/user-data/uploads/Lance/docs/brand/reprize/social/'
          'reprize-avatar-1080-escuro.png')
FONT = '/mnt/skills/examples/canvas-design/canvas-fonts/Outfit-Bold.ttf'

# cada linha e uma lista de (texto, cor): ambar = destaque
CTA = [
    [('Baixe agora', AMBER), (' o ', WHITE), ('Reprize', AMBER)],
    [('e nunca perca os seus ', WHITE), ('melhores lances', AMBER)],
]
HANDLE = '@reprize.app'

CTA_SIZE, HANDLE_SIZE = 54, 46
LOGO_W = 440
LOGO_TOP = 600
CTA_TOP = 1010
LINE_H = 76
HANDLE_Y = 1270

# --- logo recortado do avatar: mascara tudo que difere da cor do canto ------
av = Image.open(AVATAR).convert('RGB')
a = np.array(av).astype(int)
mask = (np.abs(a - np.array(BG)).sum(axis=2) > 30)
ys, xs = np.where(mask)
logo = av.crop((xs.min(), ys.min(), xs.max()+1, ys.max()+1))
logo = logo.resize((LOGO_W, int(logo.height*LOGO_W/logo.width)), Image.LANCZOS)

f_cta = ImageFont.truetype(FONT, CTA_SIZE)
f_handle = ImageFont.truetype(FONT, HANDLE_SIZE)


def ease(x):
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x)**3


def line_w(d, segs, font):
    return sum(d.textlength(t, font=font) for t, _ in segs)


def mix(c, e):
    """esmaece a cor contra o fundo, para a entrada"""
    return tuple(int(BG[i] + (c[i] - BG[i])*e) for i in range(3))


for i in range(N):
    t = i/FPS
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)

    # logo: aparece crescendo levemente
    e = ease(t/0.45)
    if e > 0:
        s = 0.88 + 0.12*e
        lw, lh = int(logo.width*s), int(logo.height*s)
        lg = logo.resize((lw, lh), Image.LANCZOS)
        if e < 1:
            lg = Image.blend(Image.new('RGB', (lw, lh), BG), lg, e)
        im.paste(lg, ((W - lw)//2, LOGO_TOP + (logo.height - lh)//2))

    # chamada: duas linhas entram escalonadas, subindo
    for k, segs in enumerate(CTA):
        e = ease((t - (0.45 + k*0.15))/0.40)
        if e <= 0:
            continue
        x = (W - line_w(d, segs, f_cta))/2
        y = CTA_TOP + k*LINE_H + int(22*(1 - e))
        for txt, col in segs:
            d.text((x, y), txt, font=f_cta, fill=mix(col, e),
                   stroke_width=STROKE_W, stroke_fill=mix(STROKE, e))
            x += d.textlength(txt, font=f_cta)

    # handle digitando, com sublinhado ambar e cursores nas pontas
    TYPE_START, PER = 1.25, 0.05
    if t >= TYPE_START:
        nch = min(int((t - TYPE_START)/PER), len(HANDLE))
        txt = HANDLE[:nch]
        wt = d.textlength(txt, font=f_handle) if txt else 0
        x0 = (W - wt)/2
        if txt:
            d.text((x0, HANDLE_Y), txt, font=f_handle, fill=WHITE,
                   stroke_width=2, stroke_fill=STROKE)
            d.rectangle([x0, HANDLE_Y + 62, x0 + wt, HANDLE_Y + 67], fill=AMBER)
        # cursores: nascem juntos no centro e se afastam com o texto
        done = nch >= len(HANDLE)
        blink = (int((t - TYPE_START)/0.42) % 2 == 0)
        if (not done) or (t < 3.30 and blink):
            for bx in (x0 - 16, x0 + wt + 11):
                d.rectangle([bx, HANDLE_Y + 4, bx + 5, HANDLE_Y + 56], fill=WHITE)

    im.save('%s/f%04d.png' % (OUT, i))

print('frames:', N)
subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-framerate', str(FPS),
                '-i', '%s/f%%04d.png' % OUT, '-c:v', 'libx264', '-crf', '16',
                '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', str(FPS),
                '-y', '/home/claude/build/outro.mp4'], check=True)
print('ok -> build/outro.mp4')
