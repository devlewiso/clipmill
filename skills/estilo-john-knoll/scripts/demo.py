"""Demo estilo John Knoll: batalla espacial por capas — nebulosa, planeta, naves, láseres, explosión, salto."""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "motion-fx-core", "scripts"))
from mfx import *  # noqa: E402,F403

a = cli("Estilo John Knoll", seconds=9, text="FRONTERA OSCURA")

BOOM = 4.6          # explosión
JUMP = 6.4          # salto a velocidad luz


def setup(ctx):
    W, H = ctx.w, ctx.h
    rng = np.random.default_rng(11)
    ctx.data["stars"] = [rng.random((n, 3)).astype(np.float32) for n in (500, 160, 50)]  # 3 capas parallax
    neb = smoke(W, H, 0, scale=W / 5, seed=2, contrast=1.8)
    neb2 = smoke(W, H, 3, scale=W / 9, seed=5, contrast=2.0)
    ctx.data["neb"] = (neb[..., None] * np.array([90, 40, 120], np.float32)
                       + neb2[..., None] * np.array([20, 70, 110], np.float32))
    ctx.data["debris"] = rng.normal(0, 1, (90, 3)).astype(np.float32)


def ship(img, c, s, ang, hull="#b9bcc2", eng="#7fd4ff", t=0):
    """Nave original: casco en cuña con dos motores. Silueta simple; detalle viene de luz y glow."""
    ca, sa = math.cos(ang), math.sin(ang)
    R = lambda px, py: (c[0] + (px * ca - py * sa) * s, c[1] + (px * sa + py * ca) * s)
    poly(img, [R(1.0, 0), R(-0.6, -0.45), R(-0.4, 0), R(-0.6, 0.45)], hull)
    poly(img, [R(0.2, -0.05), R(-0.45, -0.32), R(-0.45, -0.1)], "#6b6f78")
    for e in (-0.22, 0.22):
        circle(img, R(-0.5, e), s * (0.09 + 0.02 * math.sin(t * 40 + e)), eng)


def frame(t, i, ctx):
    W, H = ctx.w, ctx.h
    u = W / 1920
    cam = t * 0.012                              # deriva lenta de cámara
    jump = remap(t, JUMP, JUMP + 0.7, ease=ease_in_expo)

    # Capa 1: nebulosa (la más lejana: casi no se mueve).
    x = np.roll(ctx.data["neb"], int(cam * W * 0.2), axis=1).copy()
    img = to_img(x)

    # Capa 2: estrellas en 3 profundidades; en el salto se estiran hacia el centro.
    cx, cy = W / 2, H / 2
    for depth, arr in enumerate(ctx.data["stars"]):
        sp = (depth + 1) * 0.3
        for sx, sy, b in arr:
            px = ((sx - cam * sp) % 1) * W
            py = sy * H
            if jump > 0:
                k = 1 + jump * 6 * (depth + 1)
                ex, ey = cx + (px - cx) * k, cy + (py - cy) * k
                line(img, [(px, py), (ex, ey)], "#cfe6ff", max(1, int((depth + 1) * u)), 0.4 + 0.6 * b)
            else:
                circle(img, (px, py), (0.5 + depth * 0.7) * u, "#ffffff", opacity=0.3 + 0.7 * b)

    # Capa 3: planeta con atmósfera (rim) que asoma por abajo.
    pr = H * 1.1
    pc = (W * 0.7, H * lerp(2.0, 1.75, t / ctx.seconds))
    circle(img, pc, pr * 1.01, "#3a7fd0", opacity=0.6)
    circle(img, pc, pr, "#0a1220")
    x = to_np(img)

    # Capa 4: naves que cruzan (persecución) + láseres.
    img = to_img(x)
    s = H * 0.1
    p1 = remap(t, 0.8, 5.0, ease=linear)
    hero = (lerp(-0.1, 0.75, p1) * W, lerp(0.75, 0.35, p1) * H + wiggle(t, 0.8, H * 0.03))
    ang = math.atan2(-0.4 * H, 0.85 * W)
    if 0.8 < t < JUMP + 0.3:
        ship(img, hero, s, ang, t=t)
    p2 = remap(t, 1.4, BOOM)
    enemy = (lerp(-0.2, 0.62, p2) * W, lerp(0.95, 0.45, p2) * H)
    if 1.4 < t < BOOM:
        ship(img, enemy, s * 0.8, ang, "#8b5a4e", "#ff7a3a", t)
        # Ráfagas cortas del enemigo, 3 por segundo.
        if (t * 3) % 1 < 0.35:
            q = (t * 3) % 1 / 0.35
            bx, by = lerp(enemy[0], hero[0], q), lerp(enemy[1], hero[1], q)
            dx, dy = (hero[0] - enemy[0]) * 0.06, (hero[1] - enemy[1]) * 0.06
            line(img, [(bx, by), (bx + dx, by + dy)], "#ff3b2e", int(4 * u))
    # Disparo del héroe hacia atrás justo antes de la explosión.
    if BOOM - 0.3 < t < BOOM:
        q = remap(t, BOOM - 0.3, BOOM)
        line(img, [(lerp(hero[0], enemy[0], q), lerp(hero[1], enemy[1], q)),
                   (lerp(hero[0], enemy[0], q + 0.1), lerp(hero[1], enemy[1], q + 0.1))], "#6cff8a", int(5 * u))
    x = to_np(img)

    # Explosión: núcleo + anillo de choque + escombros.
    k = remap(t, BOOM, BOOM + 1.6, ease=ease_out_cubic)
    if 0 < k < 1:
        ec = (lerp(-0.2, 0.62, 1) * W, lerp(0.95, 0.45, 1) * H)
        img = to_img(x)
        circle(img, ec, H * 0.12 * k, "#fff3d0", opacity=(1 - k) ** 2)
        circle(img, ec, H * 0.5 * k, outline="#9fd0ff", width=int(6 * u), opacity=(1 - k))
        for dx, dy, sp in ctx.data["debris"]:
            r = H * 0.35 * k * (0.5 + abs(sp))
            circle(img, (ec[0] + dx * r, ec[1] + dy * r), 2 * u, "#ffb060", opacity=(1 - k))
        x = to_np(img)
        x = flash(x, max(0, 1 - k * 6) * 0.6, "#ffe9c4")

    # Salto: blur radial + flash blanco + título.
    if jump > 0:
        x = radial_blur(x, 0.25 * jump, 10)
        x = flash(x, remap(t, JUMP + 0.55, JUMP + 0.75) * (1 - remap(t, JUMP + 0.8, JUMP + 1.4)), "#eaf4ff")
    o = remap(t, JUMP + 0.9, JUMP + 1.5)
    if o > 0:
        img = to_img(x)
        draw_text(img, a.text, (W / 2, H / 2), H * 0.07, "#e8eef7", "DejaVu Sans:bold", tracking=W * 0.012, opacity=o)
        x = to_np(img)

    x = glow(x, 10 * u, 0.9, 150)
    x = lens_flare(x, (W * 0.88, H * 0.12), 0.35, "#ffe6c0")   # 'sol' fuera de cuadro
    return finish(letterbox(x, 2.39), t, grain_amt=5, vig=0.35, ca=1)


run(frame, a, setup=setup)
