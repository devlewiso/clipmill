"""Demo estilo Andrew Kramer: título de trailer metálico, rayos volumétricos, flare, partículas, impacto."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "motion-fx-core", "scripts"))
from mfx import *  # noqa: E402,F403

a = cli("Estilo Andrew Kramer", seconds=7, text="HORIZONTE", sub="PROXIMAMENTE")

FONT = "DejaVu Sans:bold"
IMPACT = 2.2   # segundo del golpe principal


def setup(ctx):
    W, H = ctx.w, ctx.h
    m = text_mask(a.text, H * 0.17, FONT, pad=40, tracking=H * 0.02)
    ctx.data["mask"] = np.asarray(m, np.float32) / 255
    rng = np.random.default_rng(3)
    ctx.data["dust"] = rng.random((180, 4)).astype(np.float32)   # x, y, profundidad, fase


def chrome_fill(mask, t, sweep):
    """Relleno metálico: gradiente vertical con horizonte + banda especular que barre."""
    h, w = mask.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    v = yy / h
    base = np.interp(v, [0, 0.45, 0.5, 0.55, 1], [210, 245, 90, 150, 60])
    band = np.exp(-((xx / w - sweep - (v - 0.5) * 0.3) / 0.06) ** 2) * 255
    col = np.clip(base + band, 0, 255)[..., None] * np.array([0.92, 0.95, 1.0], np.float32)
    edge = np.clip(mask - blur(np.repeat(mask[..., None] * 255, 3, 2), 2)[..., 0] / 255, 0, 1)
    return col * mask[..., None] + edge[..., None] * 255


def frame(t, i, ctx):
    W, H = ctx.w, ctx.h
    x = np.zeros((H, W, 3), np.float32)
    x[:] = np.array([4, 6, 10], np.float32)

    # Fondo: humo frío y tenue.
    sm = smoke(W // 4, H // 4, t * 0.3, scale=30, seed=1)
    sm = np.asarray(Image.fromarray((sm * 255).astype("uint8")).resize((W, H), Image.BICUBIC), np.float32)
    x += sm[..., None] * np.array([0.08, 0.12, 0.18], np.float32)

    # Polvo en suspensión (3 capas de profundidad, parallax).
    img = to_img(x)
    for px, py, z, ph in ctx.data["dust"]:
        xx = (px * W + t * W * 0.02 * (0.3 + z)) % W
        yy = (py * H - t * H * 0.01 * z + wiggle(t + ph * 9, 0.3, H * 0.01)) % H
        circle(img, (xx, yy), 0.6 + z * 2, "#c9d6e8", opacity=0.15 + 0.4 * z)
    x = to_np(img)

    # Título: aparece con la luz detrás en el impacto; push-in constante (trailer).
    mask = ctx.data["mask"]
    reveal = remap(t, IMPACT - 0.05, IMPACT + 0.25, ease=ease_out_expo)
    scale = lerp(1.25, 1.0, ease_out_expo(remap(t, IMPACT - 0.05, IMPACT + 0.6))) * lerp(1, 1.06, t / ctx.seconds)
    if reveal > 0:
        txt = chrome_fill(mask, t, remap(t, IMPACT + 0.3, IMPACT + 1.6, -0.2, 1.2, ease_in_out_cubic)) * reveal
        timg = to_img(txt)
        nw, nh = int(timg.width * scale), int(timg.height * scale)
        timg = timg.resize((nw, nh), Image.BICUBIC)
        layer_ = np.zeros_like(x)
        x0, y0 = (W - nw) // 2, (H - nh) // 2
        xs0, ys0 = max(0, -x0), max(0, -y0)
        xd0, yd0 = max(0, x0), max(0, y0)
        cw, ch = min(nw - xs0, W - xd0), min(nh - ys0, H - yd0)
        layer_[yd0:yd0 + ch, xd0:xd0 + cw] = to_np(timg)[ys0:ys0 + ch, xs0:xs0 + cw]
        x = np.maximum(x, layer_)
        # Rayos volumetricos que salen del texto hacia cámara.
        x = light_rays(x, (W / 2, H * 0.45), length=0.35 * reveal, strength=0.9 * reveal)

    # Impacto: flash + sacudida + onda de choque.
    k = remap(t, IMPACT, IMPACT + 0.4)
    if 0 < k < 1:
        x = flash(x, (1 - k) ** 4 * 0.9, "#cfe0ff")
        dx, dy = wiggle(t, 40, W * 0.012 * (1 - k), 1), wiggle(t, 40, H * 0.012 * (1 - k), 2)
        x = to_np(transform(to_img(x), 1.0, 0, (dx, dy)))
        x = radial_blur(x, 0.08 * (1 - k), 8)

    # Flare anamórfico que barre de izquierda a derecha.
    fx = remap(t, IMPACT + 0.2, ctx.seconds, -0.1, 1.1, ease_in_out_cubic)
    x = lens_flare(x, (fx * W, H * 0.45), 0.9 * reveal)

    # Subtítulo seco, abajo, con tracking amplio.
    o = remap(t, 4.6, 5.0) * (1 - remap(t, 6.5, 6.9))
    if o > 0:
        img = to_img(x)
        draw_text(img, a.sub, (W / 2, H * 0.72), H * 0.03, "#9fb0c8", FONT, tracking=W * 0.012, opacity=o)
        x = to_np(img)

    x = glow(x, W / 120, 0.6, 170)
    x = grade(x, gamma=(0.95, 1.0, 1.08), gain=(0.95, 1.0, 1.1), contrast=1.1)
    x *= 1 - remap(t, 6.5, 7.0)
    return finish(letterbox(x, 2.39), t, grain_amt=6, vig=0.4, ca=2)


run(frame, a, setup=setup)
