"""Demo estilo Joe Letteri: entorno épico con perspectiva atmosférica, niebla volumétrica y criatura colosal."""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "motion-fx-core", "scripts"))
from mfx import *  # noqa: E402,F403

a = cli("Estilo Joe Letteri", seconds=10, text="EL GUARDIAN")

SKY_TOP, SKY_HZ, HAZE = np.array([40, 55, 75.]), np.array([200, 190, 175.]), np.array([185, 180, 172.])
LAYERS = 6          # de lejos (0) a cerca (5)


def ridge(W, H, k, seed):
    """Silueta de cordillera para la capa k (más cerca = más baja y más rugosa)."""
    base = 0.40 + k * 0.08
    amp = 0.08 + k * 0.03
    ys = np.array([H * (base - amp * (0.5 + 0.5 * wiggle(x / W * (2 + k), 1, 1, seed + k, 4)))
                   for x in range(0, W + 1, 4)])
    return np.repeat(ys, 4)[:W]


def setup(ctx):
    W, H = ctx.w * 1.3, ctx.h        # capas más anchas que el cuadro para el parallax
    W = int(W)
    ctx.data["ridges"] = [ridge(W, H, k, 3) for k in range(LAYERS)]
    ctx.data["W"] = W


def frame(t, i, ctx):
    W, H = ctx.w, ctx.h
    T = ctx.seconds
    LW = ctx.data["W"]
    cam = ease_in_out_cubic(t / T)
    crane = lerp(H * 0.12, -H * 0.04, cam)        # grúa subiendo: el horizonte baja

    yy = np.linspace(0, 1, H, dtype=np.float32)[:, None, None]
    x = SKY_TOP * (1 - yy) ** 1.5 + SKY_HZ * (1 - (1 - yy) ** 1.5)
    x = np.broadcast_to(x, (H, W, 3)).copy()

    # Sol bajo detrás de la niebla.
    sun = (W * 0.62, H * 0.33 + crane * 0.2)
    yy2, xx2 = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.sqrt((xx2 - sun[0]) ** 2 + (yy2 - sun[1]) ** 2) / W
    x += (np.exp(-d * 9) * 120)[..., None] * np.array([1, 0.85, 0.6])

    rows = np.arange(H, dtype=np.float32)[:, None]
    for k in range(LAYERS):
        depth = 1 - k / (LAYERS - 1)                 # 1 = muy lejos
        par = (0.15 + (1 - depth) * 0.85)            # parallax: lo cercano se mueve más
        ox = int((LW - W) * cam * par)
        ys = ctx.data["ridges"][k][ox:ox + W] + crane * par * 2.2
        mask = (rows >= ys[None, :]).astype(np.float32)
        # Perspectiva atmosférica: lo lejano se acerca al color de la bruma y pierde contraste.
        rock = np.array([28, 30, 34.]) * (0.6 + 0.4 * (1 - depth))
        col = rock * (1 - depth ** 0.6) + HAZE * depth ** 0.6
        x = x * (1 - mask[..., None]) + col * mask[..., None]

        # La criatura colosal vive entre las capas 2 y 3: oculta por la niebla, se alza lentamente.
        if k == 2:
            rise = remap(t, 2.5, 8.0, ease=ease_in_out_cubic)
            cx = W * 0.62 - (LW - W) * cam * par * 0.2
            cy = H * lerp(0.75, 0.30, rise) + crane * par * 2.2
            img = layer((W, H))
            sc = H * 0.32
            body = [(cx - sc * 0.55, H), (cx - sc * 0.48, cy + sc * 0.4), (cx - sc * 0.3, cy + sc * 0.05),
                    (cx - sc * 0.12, cy - sc * 0.08), (cx - sc * 0.05, cy - sc * 0.3), (cx + sc * 0.08, cy - sc * 0.32),
                    (cx + sc * 0.14, cy - sc * 0.1), (cx + sc * 0.32, cy + sc * 0.02), (cx + sc * 0.5, cy + sc * 0.4),
                    (cx + sc * 0.6, H)]
            from PIL import ImageDraw
            ImageDraw.Draw(img).polygon(body, fill=(0, 0, 0, 255))
            m = np.asarray(img.getchannel("A"), np.float32)[..., None] / 255
            cdepth = 0.55
            ccol = np.array([30, 32, 36.]) * (1 - cdepth ** 0.6) + HAZE * cdepth ** 0.6
            x = x * (1 - m) + ccol * m
            # Ojos: dos puntos emisivos que se encienden.
            eyes = remap(t, 7.0, 7.6) * (0.85 + 0.15 * math.sin(t * 7))
            if eyes > 0:
                eimg = to_img(x)
                for ex in (-0.04, 0.05):
                    circle(eimg, (cx + sc * ex, cy - sc * 0.2), H * 0.006, "#ffb347", opacity=eyes)
                x = to_np(eimg)

        # Banco de niebla volumétrica entre capas, a la deriva.
        if k in (1, 3, 4):
            fog = smoke(W // 4, H // 4, t * 0.08 + k, scale=24, seed=k + 20, contrast=1.6)
            fog = np.asarray(Image.fromarray((fog * 255).astype("uint8")).resize((W, H), Image.BICUBIC), np.float32) / 255
            band = np.exp(-((rows - (H * (0.48 + k * 0.07) + crane * par * 2)) / (H * 0.08)) ** 2)
            f = (fog * band * (0.55 + 0.1 * k))[..., None]
            x = x * (1 - f) + HAZE * f

    # Rayos de sol a través de la niebla.
    x = light_rays(x, sun, length=0.4, strength=0.6)

    # Título sobrio que aparece al final.
    o = remap(t, 8.3, 9.2) * (1 - remap(t, 9.6, 10))
    if o > 0:
        img = to_img(x)
        draw_text(img, a.text, (W / 2, H * 0.84), H * 0.05, "#f3eee4", "C059:bold", tracking=W * 0.02, opacity=o)
        x = to_np(img)

    x = grade(x, lift=(0.0, 0.01, 0.03), gamma=(1.0, 1.0, 1.02), gain=(1.05, 1.0, 0.92), sat=0.8, contrast=1.08)
    x *= remap(t, 0, 0.8)
    return finish(letterbox(x, 2.39), t, grain_amt=5, vig=0.3, ca=1)


run(frame, a, setup=setup)
