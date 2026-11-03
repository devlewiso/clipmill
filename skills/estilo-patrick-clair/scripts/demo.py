"""Demo estilo Patrick Clair: doble exposición, push-in lento, tinta/humo, paleta melancólica."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "motion-fx-core", "scripts"))
from mfx import *  # noqa: E402,F403

a = cli("Estilo Patrick Clair", seconds=10, text="TIERRA BALDIA", sub="temporada uno")

# Perfil humano normalizado (mirando a la derecha). Sustituible por --image con un retrato.
PROFILE = [(0.30, 1.00), (0.30, 0.78), (0.26, 0.70), (0.24, 0.55), (0.25, 0.38), (0.31, 0.22),
           (0.42, 0.12), (0.55, 0.10), (0.64, 0.16), (0.69, 0.27), (0.70, 0.36), (0.74, 0.44),
           (0.72, 0.47), (0.71, 0.53), (0.73, 0.57), (0.70, 0.60), (0.71, 0.66), (0.66, 0.71),
           (0.58, 0.72), (0.56, 0.80), (0.60, 1.00)]


def setup(ctx):
    W, H = ctx.w, ctx.h
    if a.image:
        base = load(a.image[0], (W, H))
        ctx.data["base"] = to_np(base)
    else:
        sil = canvas(ctx, "#0a0c0d")
        pts = [(W * (0.08 + x * 0.55), H * y) for x, y in PROFILE]
        poly(sil, pts, "#e6e1d6")
        ctx.data["base"] = blur(sil, W / 400)
    # Paisaje interior: horizonte con capas de montes y torres de alta tensión.
    land = canvas(ctx, "#cfd3cf")
    for k, (yb, col) in enumerate(((0.62, "#9aa3a2"), (0.70, "#6f7a7b"), (0.80, "#3d4648"))):
        pts = [(0, H)]
        for s in range(41):
            xx = s / 40
            pts.append((xx * W, H * (yb - 0.06 * abs(wiggle(xx * 3, 1, 1, k * 9, 3)))))
        pts.append((W, H))
        poly(land, pts, col)
    for k in range(5):
        x0 = W * (0.15 + k * 0.17)
        line(land, [(x0, H * 0.78), (x0 + W * 0.01, H * 0.48), (x0 + W * 0.02, H * 0.78)], "#2a2f31", int(W / 600) + 1)
        line(land, [(x0 - W * 0.01, H * 0.52), (x0 + W * 0.03, H * 0.52)], "#2a2f31", int(W / 600) + 1)
    ctx.data["land"] = to_np(land)


def frame(t, i, ctx):
    W, H = ctx.w, ctx.h
    T = ctx.seconds
    # Push-in muy lento y continuo: nada se detiene del todo.
    zoom = lerp(1.0, 1.12, ease_in_out_cubic(t / T))
    base = to_np(transform(to_img(ctx.data["base"]), zoom, offset=(-W * 0.02 * t / T, 0)))
    inner = to_np(transform(to_img(ctx.data["land"]), lerp(1.25, 1.05, t / T), offset=(W * 0.03 * t / T, 0)))

    # Tinta que se expande dentro de la figura.
    ink = smoke(W // 3, H // 3, t * 0.15, scale=40, seed=4, contrast=2.6)
    ink = np.asarray(Image.fromarray((ink * 255).astype("uint8")).resize((W, H), Image.BICUBIC), np.float32)[..., None]
    inner = multiply(inner, 255 - ink * remap(t, 2, 7) * 0.9)

    x = double_exposure(base, inner, gamma=1.3)
    x = screen(x, light_leak(W, H, t))

    # Título: serif fina, tracking amplio que se cierra lentamente; fade suave.
    o = remap(t, 6.0, 7.2, ease=ease_in_out_cubic) * (1 - remap(t, 9.2, 9.9))
    if o > 0:
        img = to_img(x)
        tr = lerp(W * 0.02, W * 0.011, remap(t, 6, 10))
        draw_text(img, a.text, (W * 0.72, H * 0.47), H * 0.06, "#f1ede4", "C059", tracking=tr, opacity=o)
        if a.sub:
            draw_text(img, a.sub.upper(), (W * 0.72, H * 0.55), H * 0.022, "#c9c3b5", "C059",
                      tracking=W * 0.008, opacity=o * 0.9)
        x = to_np(img)

    x = grade(x, lift=(0.02, 0.03, 0.04), gamma=(0.95, 1.0, 1.05), gain=(1.0, 0.97, 0.9), sat=0.55, contrast=1.1)
    x = x * remap(t, 0, 1.2) * (1 - remap(t, 9.4, 10))           # fade de/a negro
    return finish(x, t, grain_amt=7, vig=0.45, ca=1)


def light_leak(W, H, t):
    """Fuga de luz cálida que deriva despacio por un borde."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    cx = W * (0.9 + 0.1 * wiggle(t, 0.15, 1, 2))
    cy = H * (0.2 + 0.2 * wiggle(t, 0.1, 1, 5))
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / W
    return (np.exp(-d * 4)[..., None] * np.array([90, 55, 25], np.float32))


run(frame, a, setup=setup)
