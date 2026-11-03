"""Demo estilo GMUNK: holograma wireframe que se construye, escultura de luz en niebla, proyección mapeada
sobre paneles en movimiento (ilusión de túnel) y psicodelia infrarroja con el título. La luz se suma sobre negro."""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "motion-fx-core", "scripts"))
from mfx import *  # noqa: E402,F403
from PIL import Image, ImageDraw  # noqa: E402

a = cli("Estilo GMUNK", seconds=12, text="LA LUZ ES EL MATERIAL", sub="SISTEMA 07 // EN CAMARA")

NEGRO, CIAN, BLANCO, NARANJA = "#030509", "#7FE9FF", "#F2FBFF", "#FF8A2A"
MAGENTA, ROSA, VIOLETA = "#FF3DA8", "#FFB3DA", "#120A1E"
MONO = "DejaVu Sans Mono"
SANS = "DejaVu Sans:light"
CORTES = [3.0, 6.0, 9.0]

# icosaedro unitario
_p = (1 + 5 ** 0.5) / 2
ICO_V = [np.array(v, float) / math.sqrt(1 + _p * _p) for v in
         [(-1, _p, 0), (1, _p, 0), (-1, -_p, 0), (1, -_p, 0), (0, -1, _p), (0, 1, _p), (0, -1, -_p), (0, 1, -_p),
          (_p, 0, -1), (_p, 0, 1), (-_p, 0, -1), (-_p, 0, 1)]]
ICO_E = sorted({tuple(sorted((i, j))) for i in range(12) for j in range(12)
                if i < j and abs(np.linalg.norm(ICO_V[i] - ICO_V[j]) - np.linalg.norm(ICO_V[0] - ICO_V[11])) < 1e-6})


def rot(v, ax, ay):
    x, y, z = v
    y, z = y * math.cos(ax) - z * math.sin(ax), y * math.sin(ax) + z * math.cos(ax)
    x, z = x * math.cos(ay) + z * math.sin(ay), -x * math.sin(ay) + z * math.cos(ay)
    return x, y, z


def proyectar(v, cx, cy, escala, dist=3.2):
    x, y, z = v
    k = dist / (dist + z)
    return cx + x * escala * k, cy + y * escala * k, z


def luz(img_np, radios=((4, 0.9), (22, 0.7))):
    """Glow en capas: núcleo nítido + halo amplio."""
    x = img_np
    for r, s in radios:
        x = glow(x, r, s, 40)
    return x


# ---------- 1) holograma que se construye ----------
def holograma(t, W, H):
    S = min(W, H)
    img = canvas((W, H), NEGRO)
    cx, cy, R = W / 2, H / 2, S * 0.27
    ax, ay = 0.45 + t * 0.15, t * 0.55
    pts = [proyectar(rot(v, ax, ay), cx, cy, R) for v in ICO_V]
    n = int(remap(t, 0.15, 1.9, 0, len(ICO_E), ease=ease_in_out_cubic))
    for k, (i, j) in enumerate(ICO_E[:n]):
        z = (pts[i][2] + pts[j][2]) / 2
        col = mix(CIAN, "#1B4E66", (z + 1) / 2)                 # lo lejano se apaga y azula
        line(img, [pts[i][:2], pts[j][:2]], col, 2)
    for k, p in enumerate(pts[:max(0, n // 2)]):
        circle(img, p[:2], 3, BLANCO)
    # anillos con ticks y etiqueta que cuenta
    for r_, sentido, a0 in ((1.45, 1, 0), (1.62, -1, 40)):
        ext = remap(t, 0.4, 2.0, 0, 360, ease=ease_out_expo)
        arc(img, (cx, cy), R * r_, a0 + t * 20 * sentido, a0 + t * 20 * sentido + ext, "#2C8FB0", 1)
    for k in range(72):
        if k / 72 < remap(t, 0.6, 2.2):
            q = math.radians(k * 5 + t * 12)
            r0, r1 = R * 1.72, R * (1.78 if k % 6 else 1.86)
            line(img, [(cx + math.cos(q) * r0, cy + math.sin(q) * r0), (cx + math.cos(q) * r1, cy + math.sin(q) * r1)],
                 NARANJA if k % 18 == 0 else "#2C8FB0", 1)
    op = remap(t, 1.0, 1.4)
    draw_text(img, f"OBJ.07  //  VERT {min(12, n // 2):02d}  ARISTAS {n:02d}", (W * 0.06, H * 0.9), S * 0.024, CIAN, MONO, anchor="lm", opacity=op, tracking=3)
    draw_text(img, f"SYNC {remap(t, 1.0, 2.8, 0, 100):05.1f}%", (W * 0.94, H * 0.9), S * 0.024, NARANJA, MONO, anchor="rm", opacity=op, tracking=3)
    x = to_np(img)
    # escaneo que barre
    sy = int(remap(t % 1.5, 0, 1.5, -0.1, 1.1) * H)
    if 0 <= sy < H:
        x[max(0, sy - 2):sy + 2] = np.clip(x[max(0, sy - 2):sy + 2] + np.array(rgb(CIAN)) * 0.35, 0, 255)
    x = luz(x)
    x *= 0.92 + 0.08 * (0.5 + 0.5 * math.sin(t * 40)) * (t < 2.2)  # parpadeo del holograma
    return scanlines(x, 3, 0.18)


# ---------- 2) escultura de luz en niebla ----------
def escultura(t, W, H):
    S = min(W, H)
    cx, cy = W / 2, H * 0.52
    acc = np.zeros((H, W, 3), np.float32)
    for k in range(7):
        ay = t * 0.45 + k * math.pi / 7
        lay = Image.new("L", (W, H), 0)
        d = ImageDraw.Draw(lay)
        # hoja de luz: un rectángulo vertical en 3D que rota en Y, proyectado
        cs = []
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            v = rot((sx * 1.15, sy * 0.85, 0), 0.18, ay)
            cs.append(proyectar(v, cx, cy, S * 0.42)[:2])
        d.polygon(cs, fill=38)
        d.line(cs + [cs[0]], fill=200, width=2)
        m = np.asarray(lay, np.float32)[..., None] / 255
        col = np.array(rgb(mix("#0A1AFF", CIAN, k / 6)), np.float32)
        acc += m * col
    circle_l = canvas((W, H), "#000")
    circle(circle_l, (cx, cy), S * 0.035, BLANCO)
    acc = add(acc, to_np(circle_l))
    haze = smoke(W, H, t * 0.6, scale=S * 0.5, seed=3)[..., None]
    acc = acc * (0.55 + 0.6 * haze)
    acc = light_rays(acc, (cx, cy), length=0.45, strength=0.8)
    acc = luz(acc, ((6, 0.8), (40, 0.6)))
    return lens_flare(acc, (cx, cy), 0.35 + 0.1 * math.sin(t * 2), "#9fdcff")


# ---------- 3) proyección mapeada sobre paneles que se mueven ----------
def tunel(t, W, H):
    """Túnel de cuadros calculado en el espacio de la cámara (se 'proyecta' sobre lo que lo tape)."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    cx, cy = W / 2 + math.sin(t * 1.3) * W * 0.04, H / 2
    d = np.maximum(np.abs(xx - cx) / W, np.abs(yy - cy) / H)
    prof = 1 / (d + 0.04)
    bandas = (np.sin(prof * 3.2 - t * 9) > 0).astype(np.float32)
    lum = bandas * np.clip(d * 3, 0, 1)
    return lum


def proyeccion(t, W, H):
    tt = t - CORTES[1]
    lum = tunel(t, W, H)
    mask = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(mask)
    bordes = []
    for k, (x0, fase) in enumerate(((0.3, 0.0), (0.7, 1.7))):
        # panel movido "por un robot": se traslada, gira en Y (escorzo) y se inclina
        ang = math.sin(tt * 1.1 + fase) * 0.55
        cx = W * (x0 + 0.06 * math.sin(tt * 0.9 + fase))
        cy = H * (0.5 + 0.05 * math.cos(tt * 1.3 + fase))
        w, h = W * 0.2 * math.cos(ang), H * 0.62
        sk = h * 0.12 * math.sin(ang)
        q = [(cx - w, cy - h / 2 + sk), (cx + w, cy - h / 2 - sk), (cx + w, cy + h / 2 + sk), (cx - w, cy + h / 2 - sk)]
        d.polygon(q, fill=255)
        bordes.append(q)
    m = np.asarray(mask, np.float32) / 255
    base = (0.1 + 0.9 * lum) * m
    x = base[..., None] * np.array(rgb(BLANCO), np.float32)
    img = to_img(x)
    for q in bordes:
        line(img, q + [q[0]], CIAN, 2)
    x = to_np(img)
    return luz(x, ((3, 0.5), (18, 0.35)))


# ---------- 4) psicodelia infrarroja + título ----------
def psicodelia(t, W, H):
    S = min(W, H)
    tt = t - CORTES[2]
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    c1 = (W * (0.5 + 0.18 * math.sin(tt * 0.7)), H * 0.5)
    c2 = (W * (0.5 - 0.18 * math.sin(tt * 0.7)), H * (0.5 + 0.1 * math.cos(tt)))
    r1 = np.hypot(xx - c1[0], yy - c1[1])
    r2 = np.hypot(xx - c2[0], yy - c2[1])
    v = 0.5 + 0.5 * np.sin(r1 / S * 70) * np.sin(r2 / S * 70 + tt * 2)  # moiré de interferencia
    v = v ** 2.2
    oscuro, medio, claro = (np.array(rgb(c), np.float32) for c in (VIOLETA, MAGENTA, ROSA))
    x = np.where(v[..., None] < 0.5, oscuro + (medio - oscuro) * (v[..., None] * 2), medio + (claro - medio) * (v[..., None] * 2 - 1))
    x = x * (0.35 + 0.65 * remap(tt, 0, 0.6))
    x = x * 0.55                                                   # el título manda
    img = to_img(x)
    # título que se construye letra por letra con barrido de luz
    n = int(remap(tt, 0.3, 1.6, 0, len(a.text)))
    fs = S * 0.075
    draw_text(img, a.text[:n], (W / 2, H * 0.47), fs, BLANCO, SANS, tracking=S * 0.012)
    q = remap(tt, 1.6, 2.1, ease=ease_out_expo)
    line(img, [(W / 2 - W * 0.22 * q, H * 0.55), (W / 2 + W * 0.22 * q, H * 0.55)], BLANCO, 2)
    draw_text(img, a.sub, (W / 2, H * 0.6), S * 0.026, ROSA, MONO, tracking=S * 0.008, opacity=remap(tt, 1.9, 2.4))
    x = luz(to_np(img), ((3, 0.7), (26, 0.5)))
    return x


def frame(t, i, ctx):
    W, H = ctx.w, ctx.h
    if t < CORTES[0]:
        x = holograma(t, W, H)
    elif t < CORTES[1]:
        x = escultura(t - CORTES[0], W, H)
    elif t < CORTES[2]:
        x = proyeccion(t, W, H)
    else:
        x = psicodelia(t, W, H)
    # destello corto en cada corte (en el beat)
    for c in CORTES:
        if 0 <= t - c < 0.12:
            x = add(x, np.full_like(x, 255 * (1 - (t - c) / 0.12) * 0.6))
    x *= remap(t, 0, 0.25) * (1 - remap(t, ctx.seconds - 0.4, ctx.seconds))
    return finish(x, t, grain_amt=5, vig=0.45, ca=2, seed=i)


run(frame, a)
