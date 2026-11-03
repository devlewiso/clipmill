"""Demo estilo Saul Bass: papel recortado, barras geométricas, paleta plana, título en el hueco."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "motion-fx-core", "scripts"))
from mfx import *  # noqa: E402,F403

a = cli("Estilo Saul Bass", seconds=8, text="EL ULTIMO VERANO", sub="una pelicula de nadie")

PAPER, INK, ACCENT = "#efe4cc", "#141210", "#e2491d"


def rough_poly(img, box, fill, seed, rough=3.0, steps=10):
    """Rectángulo con bordes 'cortados a tijera'."""
    x0, y0, x1, y1 = box
    pts = []
    edges = [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]
    for e, ((ax, ay), (bx, by)) in enumerate(edges):
        for s in range(steps):
            k = s / steps
            j = wiggle(k * 3, 1, rough, seed * 10 + e, 1)
            nx, ny = (0, 1) if ay == by else (1, 0)
            pts.append((lerp(ax, bx, k) + nx * j, lerp(ay, by, k) + ny * j))
    return poly(img, pts, fill)


def frame(t, i, ctx):
    W, H = ctx.w, ctx.h
    u = W / 1920
    img = canvas(ctx, PAPER)

    # Beat 1 (0–2 s): barras negras caen escalonadas, anchos irregulares.
    widths = [0.05, 0.11, 0.03, 0.08, 0.14, 0.04, 0.09]
    x = 0.49 - (sum(widths[:3]) + 0.02 * 2)   # el corte entre barras 3 y 4 cae en el centro
    gap = remap(t, 2.0, 3.0, 0, 0.30, ease_in_out_expo)   # Beat 2: se abren
    gap += remap(t, 5.2, 6.0, 0, 1.3, ease_in_expo)        # Beat 5: salen de cuadro
    for k, bw in enumerate(widths):
        p = stagger(t, k, 0.1, 0.12, 0.6, ease_out_expo)
        side = -1 if k < 3 else 1
        bx = (x + side * gap / 2) * W
        y1 = lerp(-H, 0, p) + H * 0.92
        rough_poly(img, (bx, y1 - H * 0.84, bx + bw * W, y1), INK, k, 2.5 * u)
        x += bw + 0.02

    # Beat 5 (5.5–7 s): figura simbólica — anillos concéntricos detrás del bloque.
    p = remap(t, 5.6, 6.4, ease=ease_out_expo)
    if p > 0:
        c = (W * 0.5, H * 0.5)
        for r_i in range(4):
            r = H * (0.40 + r_i * 0.035) * p
            rot = t * (40 if r_i % 2 else -55) + r_i * 70
            arc(img, c, r, rot, rot + 250, INK if r_i % 2 else ACCENT, int(12 * u))

    # Beat 3 (2.6–3.4 s): bloque naranja llena el hueco.
    p = remap(t, 2.6, 3.3, ease=ease_out_expo)
    if p > 0:
        cx = 0.5 * W
        rough_poly(img, (cx - 0.13 * W * p, H * 0.22, cx + 0.13 * W * p, H * 0.78), ACCENT, 99, 3 * u)

    # Beat 4 (3.4–5.5 s): título letra a letra, cada letra levemente rotada (recorte a mano).
    words = a.text.split()
    fs = H * 0.075
    for w_i, word in enumerate(words):
        yy = H * 0.5 + (w_i - (len(words) - 1) / 2) * fs * 1.15
        tw, _ = text_size(word, fs, "DejaVu Sans Condensed:bold", fs * 0.08)
        xx = W / 2 - tw / 2
        f = font("DejaVu Sans Condensed:bold", int(fs))
        for c_i, ch in enumerate(word):
            q = stagger(t, c_i + w_i * 4, 3.4, 0.06, 0.25, ease_out_back)
            if q > 0:
                lay = layer(img.size)
                draw_text(lay, ch, (xx + f.getlength(ch) / 2, yy - (1 - q) * fs * 0.6), fs,
                          PAPER, "DejaVu Sans Condensed:bold", opacity=min(1, q * 2))
                lay = lay.rotate(wiggle(c_i, 1, 4, c_i + w_i, 1), center=(xx, yy))
                img.paste(lay, (0, 0), lay)
            xx += f.getlength(ch) + fs * 0.08

    # Beat 6 (6.5–8 s): créditos pequeños, luego todo se va a negro con un wipe duro.
    if a.sub:
        o = remap(t, 6.2, 6.8)
        draw_text(img, a.sub.upper(), (W / 2, H * 0.95), H * 0.028, INK,
                  "DejaVu Sans Condensed:bold", tracking=W * 0.006, opacity=o)
    x = to_np(img)
    x = multiply(x, 255 - value_noise(W, H, 6, 2, 3) [..., None] * 40)   # textura de papel
    pw = remap(t, 7.3, 7.8, ease=ease_in_expo)
    if pw > 0:
        x = wipe(x, canvas(ctx, INK), pw, angle=0, soft=2)
    return grain(x, 5, seed=i)


run(frame, a)
