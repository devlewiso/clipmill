"""Demo estilo Kyle Cooper: tipografía rayada a mano, película sucia, cortes nerviosos, flash frames."""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "motion-fx-core", "scripts"))
from mfx import *  # noqa: E402,F403

a = cli("Estilo Kyle Cooper", seconds=9, text="OBSESION",
        sub="dirigida por|escrita por|musica de")

TYPE = "FreeMono:bold"          # mecanografiada; sustituir por letra rayada/escaneada si existe
HAND = "DejaVu Serif Condensed:bold"
CREDITS = [c.strip().upper() for c in a.sub.split("|") if c.strip()] or ["UNA PELICULA"]

# Lista de planos (inicio, fin, tipo). Cortes de 0.25–1 s: ritmo nervioso.
SHOTS = [(0.0, 0.6, "black"), (0.6, 1.4, "macro"), (1.4, 1.5, "flash"),
         (1.5, 2.6, "credit0"), (2.6, 3.0, "macro"), (3.0, 3.9, "credit1"),
         (3.9, 4.0, "flash"), (4.0, 4.6, "letters"), (4.6, 5.5, "credit2"),
         (5.5, 6.0, "macro"), (6.0, 6.08, "flash"), (6.08, 8.3, "title"), (8.3, 9.0, "black")]


def shot_at(t):
    for s0, s1, kind in SHOTS:
        if s0 <= t < s1:
            return kind, (t - s0) / (s1 - s0), s0
    return "black", 1, 0


def scratched_text(img, text, xy, size, t, i, seed=0):
    """Texto 'rayado en la emulsión': doble impresión desalineada + temblor por cuadro."""
    for k, (col, op) in enumerate((("#d8d2c0", 0.35), ("#f4efe2", 1.0))):
        jx, jy = jitter_offset(t + k * 0.37, size * 0.03, 24, seed + k)
        draw_text(img, text, (xy[0] + jx + k * size * 0.02, xy[1] + jy), size, col, TYPE,
                  tracking=size * 0.05, opacity=op * (0.75 + 0.25 * _flick(i, seed)))


def _flick(i, seed):
    return 0.5 + 0.5 * math.sin(i * 12.9898 + seed * 78.233) ** 2


def frame(t, i, ctx):
    W, H = ctx.w, ctx.h
    kind, p, s0 = shot_at(t)
    img = canvas(ctx, "#060606")

    if kind == "flash":
        return flash(to_np(img), 1.0, "#f3eedd")

    if kind == "macro":
        # Textura macro: tinta/óxido enorme que se desliza, como cámara pegada a un objeto.
        n = smoke(W // 2, H // 2, t * 0.6 + s0 * 10, scale=60, seed=int(s0 * 10), contrast=3)
        tex = Image.fromarray((n * 255).astype("uint8"), "L").resize((W, H), Image.BICUBIC)
        x = to_np(tex.convert("RGB"))
        x = transform(to_img(x), 1.15 + p * 0.15, angle=p * 3)
        x = tint(x, "#b8a77a", 0.8)
    elif kind.startswith("credit"):
        k = int(kind[-1]) % len(CREDITS)
        scratched_text(img, CREDITS[k], (W * (0.32 + 0.12 * k), H * (0.42 + 0.08 * k)), H * 0.045, t, i, k)
        # Nombre falso como segundo renglón, cortado a la mitad del plano.
        if p > 0.35:
            scratched_text(img, "_ _ _ _ _ _", (W * (0.36 + 0.12 * k), H * (0.5 + 0.08 * k)), H * 0.03, t, i, k + 5)
        x = to_np(img)
    elif kind == "letters":
        # Letras sueltas del título en primerísimo plano, invertidas, a destiempo.
        ch = a.text[int(p * len(a.text)) % len(a.text)]
        draw_text(img, ch, (W / 2 + wiggle(t, 6, W * 0.02, 3), H / 2), H * 1.1, "#e9e4d6", HAND)
        x = 255 - to_np(img) if int(t * 24) % 3 == 0 else to_np(img)
    elif kind == "title":
        # Título: entra parpadeando letra a letra y se "imprime" dos veces desalineado.
        shown = a.text[: max(1, int(remap(p, 0, 0.45) * len(a.text)) + 1)]
        scratched_text(img, shown, (W / 2, H / 2), H * 0.16, t, i, 11)
        if 0.55 < p < 0.62:   # sacudida de proyector
            img = transform(img, 1.0, 0, (0, H * 0.04))
        x = to_np(img)
    else:
        x = to_np(img)

    # Acabado: película vieja, sucia y nerviosa.
    x = scratches(x, t, 24, count=4, seed=3, dust=12)
    x = flicker(x, t, 0.18, 2)
    x = grade(x, lift=(0.02, 0.025, 0.0), gamma=(1.0, 1.05, 0.9), gain=(1.0, 0.98, 0.82), sat=0.6, contrast=1.25)
    x = chromatic(x, 2)
    x = vignette(x, 0.55)
    return grain(x, 18, seed=i)


run(frame, a)
