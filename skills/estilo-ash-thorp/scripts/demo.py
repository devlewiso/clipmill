"""Demo estilo Ash Thorp: FUI/HUD de ciencia ficción, monocromo + un acento, datos vivos, título que decodifica."""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "motion-fx-core", "scripts"))
from mfx import *  # noqa: E402,F403

a = cli("Estilo Ash Thorp", seconds=8, text="PROYECTO ORBITA", sub="SISTEMA DE NAVEGACION v2.6")

BG, LINE, DIM, ACC = "#07090c", "#dfe6ee", "#4a5562", "#ff5a1f"
MONO = "JetBrainsMono NF:light"
MONO_B = "JetBrainsMono NF:bold"
GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#/<>_"


def decode(text, p, seed=0):
    """Texto que se 'descifra': caracteres aleatorios que se van fijando de izquierda a derecha."""
    n = len(text)
    fixed = int(p * n)
    out = []
    for k, ch in enumerate(text):
        if k < fixed or ch == " ":
            out.append(ch)
        elif k < fixed + 6 and p > 0:
            out.append(GLYPHS[int(_h(k, seed, p)) % len(GLYPHS)])
    return "".join(out)


def _h(k, seed, p):
    return abs(math.sin(k * 91.7 + seed * 13.1 + int(p * 60) * 7.3)) * 1000


def ring(img, c, r, t, k, u, p):
    """Anillo con ticks, segmentos y rotación propia."""
    rot = t * (12 + k * 9) * (1 if k % 2 else -1)
    arc(img, c, r, rot, rot + 360 * p, DIM, max(1, int(1.5 * u)))
    for s in range(0, int(72 * p)):
        ang = math.radians(rot + s * 5)
        l = r * (0.06 if s % 6 == 0 else 0.025)
        line(img, [(c[0] + math.cos(ang) * r, c[1] + math.sin(ang) * r),
                   (c[0] + math.cos(ang) * (r - l), c[1] + math.sin(ang) * (r - l))], LINE, max(1, int(u)))
    if k == 1:
        arc(img, c, r + 8 * u, rot * 2, rot * 2 + 40 * p, ACC, int(4 * u))


def bracket(img, box, u, p, color=LINE):
    """Esquinas de encuadre que se dibujan."""
    x0, y0, x1, y1 = box
    L = min(x1 - x0, y1 - y0) * 0.2 * p
    w = max(1, int(1.5 * u))
    for cx, cy, sx, sy in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)):
        line(img, [(cx, cy + sy * L), (cx, cy), (cx + sx * L, cy)], color, w)


def frame(t, i, ctx):
    W, H = ctx.w, ctx.h
    u = W / 1920
    img = canvas(ctx, BG)

    # Rejilla de fondo que aparece en barrido.
    g = remap(t, 0.0, 1.0, ease=ease_out_cubic)
    step = int(80 * u)
    for gx in range(0, int(W * g), step):
        line(img, [(gx, 0), (gx, H)], "#11161c", 1)
    for gy in range(0, int(H * g), step):
        line(img, [(0, gy), (W, gy)], "#11161c", 1)

    # Anillos centrales.
    c = (W * 0.5, H * 0.5)
    for k in range(4):
        p = stagger(t, k, 0.4, 0.2, 1.2, ease_in_out_expo)
        if p > 0:
            ring(img, c, H * (0.16 + k * 0.07), t, k, u, p)

    # Mira central con objetivo que se bloquea.
    lock = remap(t, 2.5, 3.2, ease=ease_out_expo)
    tgt = (lerp(W * 0.62, c[0], lock), lerp(H * 0.38, c[1], lock))
    s = H * lerp(0.08, 0.035, lock)
    bracket(img, (tgt[0] - s, tgt[1] - s, tgt[0] + s, tgt[1] + s), u, remap(t, 1.5, 2.0), ACC if lock >= 1 else LINE)
    if lock >= 1 and int(t * 6) % 2 == 0:
        draw_text(img, "OBJETIVO FIJADO", (tgt[0], tgt[1] + s + 22 * u), 14 * u, ACC, MONO_B, tracking=3 * u)

    # Paneles de datos laterales (números vivos).
    for side, x0 in ((0, W * 0.05), (1, W * 0.78)):
        p = remap(t, 1.0 + side * 0.3, 1.8 + side * 0.3, ease=ease_out_expo)
        if p <= 0:
            continue
        box = (x0, H * 0.18, x0 + W * 0.17, H * 0.82)
        bracket(img, box, u, p)
        for r in range(int(14 * p)):
            y = box[1] + 30 * u + r * 30 * u
            label = ["LAT", "LON", "ALT", "VEL", "TMP", "PWR", "SIG"][r % 7]
            val = 50 + 49 * wiggle(t * (0.5 + r * 0.1), 1, 1, r + side * 20)
            draw_text(img, f"{label}_{r:02d}", (box[0] + 14 * u, y), 13 * u, DIM, MONO, anchor="lm")
            draw_text(img, f"{val:07.3f}", (box[2] - 14 * u, y), 13 * u, ACC if r == 3 else LINE, MONO, anchor="rm")
        # Barras de nivel.
        for b in range(6):
            lv = 0.5 + 0.5 * wiggle(t, 2 + b, 1, b + side * 7)
            yb = box[3] - 20 * u - b * 14 * u
            rect(img, (box[0] + 14 * u, yb, box[0] + 14 * u + (box[2] - box[0] - 28 * u) * lv * p, yb + 6 * u), LINE, 0.7)

    # Línea de escaneo vertical.
    sy = (t * 0.35 % 1) * H
    rect(img, (0, sy, W, sy + 2 * u), ACC, 0.25)

    # Título que se decodifica + subtítulo.
    p = remap(t, 4.0, 5.6)
    if p > 0:
        rect(img, (W * 0.5 - W * 0.22 * remap(t, 3.8, 4.2, ease=ease_out_expo), H * 0.455,
                   W * 0.5 + W * 0.22 * remap(t, 3.8, 4.2, ease=ease_out_expo), H * 0.545), BG, 0.85)
        draw_text(img, decode(a.text, p, 1), (W / 2, H * 0.5), H * 0.05, LINE, MONO_B, tracking=W * 0.008)
        q = remap(t, 5.4, 6.4)
        if q > 0:
            draw_text(img, decode(a.sub, q, 2), (W / 2, H * 0.58), H * 0.018, ACC, MONO, tracking=W * 0.004)

    # Pie de pantalla: timecode.
    draw_text(img, f"T+{t:06.2f}  //  FRAME {i:05d}", (W * 0.05, H * 0.94), 12 * u, DIM, MONO, anchor="lm")

    x = glow(img, 6 * u, 0.5, 150)
    x = scanlines(x, 3, 0.12)
    x *= 1 - remap(t, 7.4, 8.0)
    return finish(x, t, grain_amt=4, vig=0.4, ca=1)


run(frame, a)
