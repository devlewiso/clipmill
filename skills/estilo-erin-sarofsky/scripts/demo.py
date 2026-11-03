"""Demo estilo Erin Sarofsky: tipografía cinética audaz, paneles gráficos diagonales, semitono, ritmo al beat."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "motion-fx-core", "scripts"))
from mfx import *  # noqa: E402,F403

a = cli("Estilo Erin Sarofsky", seconds=8, text="EQUIPO IMPARABLE",
        sub="CADA HEROE|TIENE UN|ORIGEN")

BPM = 120
SPB = 60 / BPM                      # segundos por beat
FONT = "DejaVu Sans:bold"
PAL = ["#ffd400", "#e4002b", "#0a2ecc", "#111111", "#f7f3ea"]
WORDS = [w.strip() for w in a.sub.split("|") if w.strip()]


def halftone(W, H, t, color, cell=14, angle=20):
    """Patrón de semitono (puntos) que se desplaza en diagonal."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.radians(angle)
    u = (xx * np.cos(r) + yy * np.sin(r) + t * 60) % cell - cell / 2
    v = (-xx * np.sin(r) + yy * np.cos(r)) % cell - cell / 2
    grad = xx / W                                  # puntos crecen hacia la derecha
    m = (np.sqrt(u ** 2 + v ** 2) < cell * 0.45 * grad)[..., None]
    return m * np.array(rgb(color), np.float32)


def panel(img, W, H, p, col, angle=-12, side=1):
    """Panel diagonal que barre el cuadro."""
    sk = H * np.tan(np.radians(angle))
    e, s = abs(sk), sk / 2
    off = lerp(side * (W + 2 * e), 0, p)
    poly(img, [(off - e + s, 0), (off + W + e + s, 0), (off + W + e - s, H), (off - e - s, H)], col)


def frame(t, i, ctx):
    W, H = ctx.w, ctx.h
    b = int(t / SPB)                # beat actual
    ph = beat(t, BPM)               # fase dentro del beat
    img = canvas(ctx, PAL[4])

    if b < 2 * len(WORDS):          # Sección A: una palabra por cada 2 beats sobre paneles alternos
        k = b // 2
        col = PAL[k % 3]
        prev = PAL[(k - 1) % 3] if k else PAL[4]
        img = canvas(ctx, prev)
        panel(img, W, H, remap((t - k * 2 * SPB) / SPB, 0, 0.5, ease=ease_out_expo), col, -12, 1 if k % 2 else -1)
        word = WORDS[k]
        pop = remap((t - k * 2 * SPB) / SPB, 0.2, 0.7, ease=ease_out_back)
        if pop > 0:
            txt_col = PAL[4] if col != PAL[0] else PAL[3]
            draw_text(img, word, (W / 2 + 10, H / 2 + 10), H * 0.17 * pop, PAL[3], FONT, tracking=-H * 0.004)  # sombra dura
            draw_text(img, word, (W / 2, H / 2), H * 0.17 * pop, txt_col, FONT, tracking=-H * 0.004)
        x = to_np(img)
        x = np.where(halftone(W, H, t, "#000", int(W / 120)) > 0, x * 0.82, x)
    else:                           # Sección B: título en bloques apilados, tipo viñeta de cómic
        tb = t - 2 * len(WORDS) * SPB
        img = canvas(ctx, PAL[3])
        lines = a.text.split()
        for k, word in enumerate(lines):
            p = stagger(tb, k, 0.0, SPB / 2, SPB * 0.6, ease_out_expo)
            fs = H * (0.2 if k == len(lines) - 1 else 0.13)
            y = H * 0.5 + (k - (len(lines) - 1) / 2) * H * 0.2
            tw, th = text_size(word, fs, FONT)
            dx = lerp(W * (1 if k % 2 else -1), 0, p)
            rect(img, (W / 2 - tw / 2 - 30 + dx, y - th * 0.75, W / 2 + tw / 2 + 30 + dx, y + th * 0.75),
                 PAL[k % 3], angle=-3 if k % 2 else 2)
            draw_text(img, word, (W / 2 + dx, y), fs, PAL[4] if k % 3 else PAL[3], FONT)
        x = to_np(img)
        # Punch al beat: escala + flash suave.
        punch = (1 - ph) ** 6
        x = to_np(transform(to_img(x), 1 + 0.025 * punch, -0.4 * punch, fill=rgb(PAL[3])))
        x = add(x, halftone(W, H, t, PAL[0], int(W / 90)) * 0.25)

    # Sacudida en cada downbeat de la sección A.
    if b < 2 * len(WORDS) and b % 2 == 0 and ph < 0.15:
        x = to_np(transform(to_img(x), 1.02, 0, (wiggle(t, 30, 12, 1), wiggle(t, 30, 12, 2))))
    x *= 1 - remap(t, ctx.seconds - 0.25, ctx.seconds)
    return grain(x, 4, seed=i)


run(frame, a)
