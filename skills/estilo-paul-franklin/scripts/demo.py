"""Demo estilo Paul Franklin: agujero negro con lente gravitacional, disco de acreción y cámara 'IMAX' sobria.

Aproximación 2D físicamente motivada:
- Fondo de estrellas deformado por la ecuación de lente (beta = theta - thetaE^2/theta).
- Sombra (horizonte) negra; anillo de fotones fino y brillante.
- Disco de acreción inclinado: parte frontal como elipse delgada; parte trasera 'levantada'
  por la lente formando un arco sobre y bajo la sombra; brillo Doppler asimétrico.
"""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "motion-fx-core", "scripts"))
from mfx import *  # noqa: E402,F403

a = cli("Estilo Paul Franklin", seconds=10, text="MAS ALLA DEL HORIZONTE")


def setup(ctx):
    W, H = ctx.w, ctx.h
    rng = np.random.default_rng(4)
    S = 2 * max(W, H)
    stars = np.zeros((S, S), np.float32)
    n = int(S * S / 900)
    ys, xs = rng.integers(0, S, n), rng.integers(0, S, n)
    stars[ys, xs] = rng.random(n) ** 3 * 255
    stars = np.asarray(Image.fromarray(stars.astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)), np.float32) * 2.5
    ctx.data["stars"] = stars
    # Textura turbulenta del disco en coordenadas polares (ángulo x radio).
    tex = value_noise(1024, 64, 8, 4, 9)
    streak = value_noise(1024, 64, 2, 2, 3)
    ctx.data["disk_tex"] = (tex * 0.7 + streak * 0.6) ** 1.4
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    ctx.data["grid"] = (xx, yy)


def disk_sample(tex, ang, rad, rin, rout, t):
    """Brillo del disco en (ángulo, radio). Gira con velocidad kepleriana (interior más rápido)."""
    rn = np.clip((rad - rin) / (rout - rin), 0, 1)
    omega = 0.6 / np.maximum(0.25, rn + 0.25) ** 1.5
    u = ((ang / (2 * np.pi) + omega * t * 0.15) % 1) * (tex.shape[1] - 1)
    v = rn * (tex.shape[0] - 1)
    val = tex[v.astype(int), u.astype(int)]
    fall = np.clip(1 - rn, 0, 1) ** 1.2 * (rad >= rin) * (rad <= rout)
    return val * fall


def frame(t, i, ctx):
    W, H = ctx.w, ctx.h
    T = ctx.seconds
    xx, yy = ctx.data["grid"]
    # Cámara: deriva lenta y un leve acercamiento — nada de movimientos gratuitos.
    zoom = lerp(0.85, 1.1, ease_in_out_cubic(t / T))
    cx, cy = W * 0.5 + wiggle(t, 0.1, W * 0.004, 1), H * 0.5 + wiggle(t, 0.1, H * 0.004, 2)
    Rs = H * 0.13 * zoom                       # radio de la sombra
    dx, dy = (xx - cx), (yy - cy)
    r = np.sqrt(dx ** 2 + dy ** 2) + 1e-3

    # 1) Estrellas lenteadas.
    thE = Rs * 1.6
    beta = r - thE ** 2 / r
    sx = (cx + dx / r * beta + t * W * 0.01).astype(int) % ctx.data["stars"].shape[1]
    sy = (cy + dy / r * beta).astype(int) % ctx.data["stars"].shape[0]
    bg = ctx.data["stars"][sy, sx]
    x = np.repeat(bg[..., None], 3, 2) * np.array([0.85, 0.9, 1.0])

    tex = ctx.data["disk_tex"]
    inc = 0.12                                 # inclinación (achatamiento de la elipse frontal)
    rin, rout = Rs * 1.5, Rs * 4.2
    ang = np.arctan2(dy, dx)
    doppler = 1 + 0.55 * (-dx / (rout))        # lado que se acerca (izquierda) más brillante

    # 2) Parte trasera del disco, curvada por la lente sobre y bajo la sombra.
    rl = r                                     # radio aparente ≈ radio del disco 'levantado'
    back = disk_sample(tex, ang * 2, rl * 0.9, rin * 0.75, rout * 0.55, t)
    back *= (r > Rs * 1.02)
    # 3) Parte frontal: elipse muy achatada que pasa por delante de la sombra.
    re = np.sqrt(dx ** 2 + (dy / inc) ** 2)
    front = disk_sample(tex, np.arctan2(dy / inc, dx), re, rin, rout, t)
    front_mask = (dy > -Rs * 0.05) | (r > Rs * 1.05)

    # Sombra del horizonte.
    shadow = (r < Rs).astype(np.float32)
    x *= (1 - shadow)[..., None]
    hot = np.array([255, 205, 150.])
    x += (back * doppler * 1.6)[..., None] * hot * (1 - shadow)[..., None]
    x += (front * doppler * 2.0 * front_mask)[..., None] * hot

    # 4) Anillo de fotones: línea muy fina en el borde de la sombra.
    ring = np.exp(-((r - Rs * 1.02) / (Rs * 0.012)) ** 2)
    x += (ring * doppler * 200)[..., None] * np.array([1, 0.9, 0.8])

    x = glow(x, W / 90, 0.7, 150)

    # Título contenido, tarde, sin efectos.
    o = remap(t, 7.5, 8.5) * (1 - remap(t, 9.4, 10))
    if o > 0:
        img = to_img(x)
        draw_text(img, a.text, (W / 2, H * 0.86), H * 0.028, "#e9e4da", "DejaVu Sans", tracking=W * 0.01, opacity=o)
        x = to_np(img)
    x *= remap(t, 0, 1.0)
    # Acabado de película grande: grano fino, sin CA marcada, viñeta mínima.
    return finish(x, t, grain_amt=4, vig=0.15, ca=0)


run(frame, a, setup=setup)
