"""Demo estilo Dennis Muren: integración fotorrealista de un elemento CG en una placa.

Plantilla de composición: placa (foto/video o fondo procedural) + elemento CG con
sombra de contacto, light wrap, color match, desenfoque por profundidad, motion blur,
cámara en mano y grano igualado. Con --image placa.jpg --image elemento.png (RGBA,
por ejemplo un render de Blender con fondo transparente).
"""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "motion-fx-core", "scripts"))
from mfx import *  # noqa: E402,F403

a = cli("Estilo Dennis Muren", seconds=6, text="")


def procedural_plate(W, H):
    """Placa sustituta: atardecer sobre llanura con bruma (si no se pasa --image)."""
    yy = np.linspace(0, 1, H, dtype=np.float32)[:, None]
    sky = np.stack([lerp(70, 245, yy ** 2), lerp(95, 170, yy ** 2), lerp(140, 120, yy)], -1) * np.ones((1, W, 1))
    hz = int(H * 0.62)
    ground = value_noise(W, H - hz, 40, 4, 2)[..., None] * np.array([60, 45, 30], np.float32) + np.array([55, 45, 35])
    plate = np.concatenate([sky[:hz], ground], 0)
    plate = add(plate, (np.exp(-np.abs(yy - 0.62) * 25) * 70)[..., None] * np.ones((1, W, 3)))  # bruma en horizonte
    return plate.astype(np.float32)


def procedural_element(size):
    """Elemento 'CG' sustituto: esfera metálica sombreada con fresnel (RGBA)."""
    s = size
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
    nx, ny = (xx - s / 2) / (s / 2), (yy - s / 2) / (s / 2)
    r2 = nx ** 2 + ny ** 2
    inside = r2 < 1
    nz = np.sqrt(np.clip(1 - r2, 0, 1))
    L = np.array([0.5, -0.6, 0.62]); L /= np.linalg.norm(L)
    diff = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
    spec = diff ** 40
    fres = (1 - nz) ** 3
    sky_ref = np.clip(0.5 - ny * 0.5, 0, 1)        # refleja cielo arriba, suelo abajo
    col = (np.array([60, 58, 55]) * diff[..., None] + np.array([230, 170, 110]) * spec[..., None]
           + np.array([180, 150, 160]) * (fres * sky_ref)[..., None])
    alpha = np.clip((1 - np.sqrt(r2)) * s / 2, 0, 1) * 255
    rgba = np.dstack([np.clip(col, 0, 255), alpha]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def setup(ctx):
    W, H = ctx.w, ctx.h
    ctx.data["plate"] = to_np(load(a.image[0], (W, H))) if a.image else procedural_plate(W, H)
    el = Image.open(a.image[1]).convert("RGBA") if len(a.image) > 1 else procedural_element(int(H * 0.22))
    ctx.data["el"] = el
    # Color match: llevar media/desv. del elemento a las de la placa (por canal, suave).
    p = ctx.data["plate"].reshape(-1, 3)
    ctx.data["plate_stats"] = (p.mean(0), p.std(0))


def color_match(rgb_arr, alpha, stats, amount=0.35):
    m = alpha > 0.5
    if not m.any():
        return rgb_arr
    mu, sd = rgb_arr[m].mean(0), rgb_arr[m].std(0) + 1e-3
    pm, ps = stats
    matched = (rgb_arr - mu) / sd * lerp(sd, ps, 0.3) + lerp(mu, pm, 0.5)
    return rgb_arr * (1 - amount) + matched * amount


def frame(t, i, ctx):
    W, H = ctx.w, ctx.h
    plate = ctx.data["plate"]
    el = ctx.data["el"]

    # Animación del elemento: rueda/bota por el suelo con física simple.
    ground_y = H * 0.82
    x_pos = lerp(-0.15, 1.15, t / ctx.seconds) * W
    bounce = abs(math.sin(t * 2.6)) * H * 0.18 * math.exp(-t * 0.25)
    ew, eh = el.size
    ex, ey = x_pos - ew / 2, ground_y - eh - bounce
    contact = 1 - clamp(bounce / (H * 0.18))

    # 1) Sombra de contacto: elipse difusa que se aprieta al tocar suelo.
    sh = layer((W, H))
    sw = ew * lerp(0.5, 1.0, contact)
    circle(sh, (x_pos, ground_y), 1, fill="#000")
    from PIL import ImageDraw
    ImageDraw.Draw(sh).ellipse((x_pos - sw / 2, ground_y - ew * 0.06, x_pos + sw / 2, ground_y + ew * 0.06),
                               fill=(10, 8, 5, int(200 * lerp(0.3, 1, contact))))
    sh = sh.filter(ImageFilter.GaussianBlur(lerp(25, 6, contact) * W / 1920))
    base = to_img(plate)
    base.paste(sh, (0, 0), sh)
    x = to_np(base)

    # 2) Elemento con color match.
    el_np = np.asarray(el, np.float32)
    alpha = el_np[..., 3] / 255
    el_rgb = color_match(el_np[..., :3], alpha, ctx.data["plate_stats"])
    # 3) Light wrap: el fondo 'sangra' en los bordes del elemento.
    bx0, by0 = int(ex), int(ey)
    crop = to_np(to_img(plate).crop((bx0, by0, bx0 + ew, by0 + eh)))
    edge = np.clip(alpha - blur(np.repeat(alpha[..., None] * 255, 3, 2), 6)[..., 0] / 255, 0, 1)[..., None]
    el_rgb = el_rgb * (1 - edge * 0.6) + blur(crop, 8) * edge * 0.6
    el_img = Image.fromarray(np.dstack([np.clip(el_rgb, 0, 255), alpha * 255]).astype(np.uint8), "RGBA")
    # 4) Motion blur direccional según velocidad horizontal.
    el_img = el_img.filter(ImageFilter.BoxBlur(1))
    comp = to_img(x)
    comp.paste(el_img, (bx0, by0), el_img)
    x = to_np(comp)
    x = directional_blur(x, W / ctx.seconds / ctx.fps * 1.3, 0, 4) * 0.5 + x * 0.5

    # 5) Atmósfera: bruma uniforme sobre todo (incluido el CG) para unificar.
    x = x * 0.92 + np.array([235, 175, 130], np.float32) * 0.08

    # 6) Cámara en mano (todo junto: placa + CG 'trackeado').
    dx, dy = wiggle(t, 0.8, W * 0.006, 1, 3), wiggle(t, 0.7, H * 0.006, 2, 3)
    x = to_np(transform(to_img(x), 1.04, wiggle(t, 0.5, 0.3, 3), (dx, dy)))

    # 7) Grano igualado y lente: CA leve, viñeta suave.
    return finish(x, t, grain_amt=7, vig=0.3, ca=1)


run(frame, a, setup=setup)
