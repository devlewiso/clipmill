"""Demo estilo Douglas Trumbull: corredor slit-scan, luz pura en movimiento, cambios de color, ciudad de luces.

Slit-scan simulado: cada píxel de los dos 'muros' (arriba/abajo) proyecta a una profundidad
z = k / |y - horizonte| y muestrea una obra 2D (patrón de luces) desplazada en el tiempo.
Es lo que hacía la cámara real exponiendo una rendija mientras se movía hacia la obra.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "motion-fx-core", "scripts"))
from mfx import *  # noqa: E402,F403

a = cli("Estilo Douglas Trumbull", seconds=10, text="UMBRAL")

TEX_W, TEX_H = 1024, 2048


def setup(ctx):
    W, H = ctx.w, ctx.h
    rng = np.random.default_rng(2)
    # Obra fuente: franjas verticales de luz de distintos anchos y colores + textura (como las
    # transparencias retroiluminadas que se fotografiaban en el slit-scan).
    tex = np.zeros((TEX_H, TEX_W, 3), np.float32)
    x0 = 0
    palette = np.array([[255, 60, 40], [255, 170, 30], [40, 120, 255], [180, 60, 255], [40, 255, 180], [255, 255, 255]], np.float32)
    while x0 < TEX_W:
        w = int(rng.integers(2, 30))
        c = palette[rng.integers(0, len(palette))] * rng.uniform(0.3, 1.0)
        tex[:, x0:x0 + w] = c
        x0 += w + int(rng.integers(0, 25))
    mod = value_noise(TEX_W, TEX_H, 60, 3, 5)[..., None]
    ctx.data["tex"] = tex * (0.4 + mod)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    ctx.data["grid"] = (xx, yy)


def frame(t, i, ctx):
    W, H = ctx.w, ctx.h
    T = ctx.seconds
    xx, yy = ctx.data["grid"]
    tex = ctx.data["tex"]
    cy = H * 0.5
    dyy = yy - cy
    ady = np.abs(dyy) + 1e-3
    k = H * 0.25
    z = k / ady                                         # profundidad del muro en cada fila
    speed = lerp(0.8, 3.0, ease_in_cubic(t / T))        # acelera hacia el final
    u = ((xx - W / 2) * z / W * 0.9 + 0.5) * TEX_W      # posición lateral sobre la obra
    v = (z * 40 + t * speed * 600)                      # avance a través de la obra
    ui = np.clip(u, 0, TEX_W - 1).astype(int)
    vi = v.astype(int) % TEX_H
    x = tex[vi, ui]

    # Muro superior con otra paleta (rotación de color en el tiempo, como los filtros de Trumbull).
    hue = (t / T)
    top = (dyy < 0)[..., None]
    x = np.where(top, x[..., [2, 0, 1]] * (0.7 + 0.3 * hue) + x * (0.3 - 0.3 * hue), x)

    # Desvanecer hacia el horizonte (luz que se pierde a lo lejos) y bordes laterales.
    fade = np.clip(1 - z / 30, 0, 1) ** 1.5
    side = np.clip(1 - np.abs(u / TEX_W - 0.5) * 2, 0, 1) ** 0.5
    x *= (fade * side)[..., None]

    # Ráfagas de luz en el horizonte (estrellas que se estiran).
    x += (np.exp(-ady / (H * 0.004)) * 120 * (0.6 + 0.4 * np.sin(xx / W * 40 + t * 3)))[..., None] * np.array([1, 0.95, 0.9])

    # Final: corte a negro con una 'ciudad de luces' en miniatura y el título.
    end = remap(t, T - 2.2, T - 1.9)
    if end > 0:
        x *= 1 - end
        img = to_img(x)
        rng = np.random.default_rng(1)
        for _ in range(int(400 * end)):
            px, py = rng.random() * W, H * (0.7 + 0.25 * rng.random() ** 2)
            circle(img, (px, py), 1 + rng.random() * 2, "#ffcf8a", opacity=rng.random() * end)
        draw_text(img, a.text, (W / 2, H * 0.45), H * 0.06, "#f4f1ea", "DejaVu Sans:bold", tracking=W * 0.03,
                  opacity=remap(t, T - 1.6, T - 1.0) * (1 - remap(t, T - 0.3, T)))
        x = to_np(img)

    x = glow(x, W / 150, 0.9, 120)
    return finish(x, t, grain_amt=6, vig=0.3, ca=2)


run(frame, a, setup=setup)
