"""mfx — motor mínimo de motion graphics / FX procedural para Claude Code.

Renderiza cuadros con Pillow + numpy y los envía por pipe a ffmpeg.
Uso típico:

    import sys; sys.path.insert(0, "<ruta>/motion-fx-core/scripts")
    from mfx import *

    def frame(t, i, ctx):          # t = segundos, i = índice de cuadro
        img = canvas(ctx, "#111")
        draw_text(img, "HOLA", (ctx.w/2, ctx.h/2), size=120, anchor="mm")
        return img

    render(frame, "out.mp4", seconds=4, w=1280, h=720, fps=24)
"""
from __future__ import annotations

import argparse
import functools
import math
import random
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

# ----------------------------------------------------------------------------
# Contexto y render
# ----------------------------------------------------------------------------


@dataclass
class Ctx:
    w: int
    h: int
    fps: int
    seconds: float
    seed: int = 7
    data: dict = field(default_factory=dict)

    @property
    def frames(self) -> int:
        return int(round(self.seconds * self.fps))


def render(frame_fn, out, seconds=5.0, w=1920, h=1080, fps=24, seed=7,
           audio=None, crf=18, preset="medium", setup=None, motion_blur=1):
    """Renderiza frame_fn(t, i, ctx) -> PIL.Image|ndarray a un .mp4 (H.264).

    motion_blur > 1 promedia N sub-cuadros por cuadro (obturador de 180°).
    setup(ctx) se llama una vez antes del primer cuadro (precalcular assets).
    """
    ctx = Ctx(w, h, fps, seconds, seed)
    random.seed(seed)
    np.random.seed(seed)
    if setup:
        setup(ctx)
    out = str(out)
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo",
           "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-"]
    if audio:
        cmd += ["-i", str(audio), "-shortest", "-c:a", "aac", "-b:a", "192k"]
    cmd += ["-c:v", "libx264", "-preset", preset, "-crf", str(crf),
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    n = ctx.frames
    try:
        for i in range(n):
            if motion_blur > 1:
                acc = np.zeros((h, w, 3), np.float32)
                for s in range(motion_blur):
                    ts = (i + 0.5 * s / motion_blur) / fps
                    acc += to_np(frame_fn(ts, i, ctx), w, h)
                arr = acc / motion_blur
            else:
                arr = to_np(frame_fn(i / fps, i, ctx), w, h)
            proc.stdin.write(np.clip(arr, 0, 255).astype(np.uint8).tobytes())
            if i % max(1, n // 10) == 0:
                print(f"  cuadro {i}/{n}", file=sys.stderr, flush=True)
    finally:
        proc.stdin.close()
        proc.wait()
    if proc.returncode:
        raise RuntimeError(f"ffmpeg falló ({proc.returncode})")
    print(f"OK -> {out}", file=sys.stderr)
    return out


def to_np(img, w=None, h=None) -> np.ndarray:
    if isinstance(img, Image.Image):
        if img.mode != "RGB":
            img = img.convert("RGB")
        if w and img.size != (w, h):
            img = img.resize((w, h), Image.LANCZOS)
        return np.asarray(img, dtype=np.float32)
    return np.asarray(img, dtype=np.float32)[..., :3]


def to_img(arr) -> Image.Image:
    if isinstance(arr, Image.Image):
        return arr.convert("RGB")
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)[..., :3], "RGB")


def cli(description="", **defaults):
    """Argumentos estándar para scripts demo: --out --w --h --fps --seconds --preview."""
    p = argparse.ArgumentParser(description=description)
    p.add_argument("--out", default=defaults.get("out", "out.mp4"))
    p.add_argument("--w", type=int, default=defaults.get("w", 1920))
    p.add_argument("--h", type=int, default=defaults.get("h", 1080))
    p.add_argument("--fps", type=int, default=defaults.get("fps", 24))
    p.add_argument("--seconds", type=float, default=defaults.get("seconds", 8))
    p.add_argument("--text", default=defaults.get("text", "TITULO"))
    p.add_argument("--sub", default=defaults.get("sub", ""))
    p.add_argument("--audio", default=None)
    p.add_argument("--image", action="append", default=[],
                   help="imagen(es) de entrada (foto, placa, logo); repetible")
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--preview", action="store_true",
                   help="960x540, crf 26, rápido para iterar")
    a = p.parse_args()
    if a.preview:
        a.w, a.h = 960, 540
    return a


def run(frame_fn, a, **kw):
    """Atajo: render con los argumentos de cli()."""
    return render(frame_fn, a.out, seconds=a.seconds, w=a.w, h=a.h, fps=a.fps,
                  seed=a.seed, audio=a.audio,
                  crf=26 if a.preview else 18,
                  preset="veryfast" if a.preview else "medium", **kw)


# ----------------------------------------------------------------------------
# Tiempo y easing
# ----------------------------------------------------------------------------

def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def lerp(a, b, t):
    return a + (b - a) * t


def remap(x, a, b, c=0.0, d=1.0, ease=None):
    """Mapea x de [a,b] a [c,d] con clamp y easing opcional."""
    t = clamp((x - a) / (b - a)) if b != a else float(x >= b)
    return lerp(c, d, ease(t) if ease else t)


def linear(t): return t
def ease_in_quad(t): return t * t
def ease_out_quad(t): return 1 - (1 - t) ** 2
def ease_in_out_cubic(t): return 4 * t ** 3 if t < .5 else 1 - (-2 * t + 2) ** 3 / 2
def ease_out_cubic(t): return 1 - (1 - t) ** 3
def ease_in_cubic(t): return t ** 3
def ease_out_expo(t): return 1.0 if t >= 1 else 1 - 2 ** (-10 * t)
def ease_in_expo(t): return 0.0 if t <= 0 else 2 ** (10 * t - 10)
def ease_in_out_expo(t):
    if t <= 0 or t >= 1:
        return float(t >= 1)
    return 2 ** (20 * t - 10) / 2 if t < .5 else (2 - 2 ** (-20 * t + 10)) / 2
def ease_out_back(t, s=1.70158): return 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2
def ease_out_elastic(t):
    if t <= 0 or t >= 1:
        return float(t >= 1)
    return 2 ** (-10 * t) * math.sin((t * 10 - .75) * (2 * math.pi) / 3) + 1
def smoothstep(t): return t * t * (3 - 2 * t)


def keys(t, kf, ease=ease_in_out_cubic):
    """Interpola una lista [(tiempo, valor), ...]. Valores numéricos o tuplas."""
    if t <= kf[0][0]:
        return kf[0][1]
    for (t0, v0), (t1, v1) in zip(kf, kf[1:]):
        if t <= t1:
            k = ease((t - t0) / (t1 - t0))
            if isinstance(v0, (tuple, list)):
                return tuple(lerp(a, b, k) for a, b in zip(v0, v1))
            return lerp(v0, v1, k)
    return kf[-1][1]


def stagger(t, i, start, step, dur, ease=ease_out_expo):
    """Progreso 0..1 del elemento i en una animación escalonada."""
    return remap(t, start + i * step, start + i * step + dur, ease=ease)


def wiggle(t, freq=2.0, amp=1.0, seed=0, octaves=2):
    """Ruido suave 1D (como wiggle() de After Effects)."""
    v, a, f = 0.0, 1.0, freq
    for o in range(octaves):
        x = t * f + seed * 17.13 + o * 3.7
        i0 = math.floor(x)
        fr = smoothstep(x - i0)
        r0 = _hash1(i0 + seed * 101 + o * 7)
        r1 = _hash1(i0 + 1 + seed * 101 + o * 7)
        v += lerp(r0, r1, fr) * a
        a *= .5
        f *= 2
    return v * amp


def _hash1(n):
    n = (int(n) * 374761393 + 668265263) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return (n / 0xFFFFFFFF) * 2 - 1


def beat(t, bpm=120, offset=0.0):
    """Fase 0..1 dentro del beat actual (para cortes a ritmo)."""
    return ((t - offset) * bpm / 60.0) % 1.0


# ----------------------------------------------------------------------------
# Color
# ----------------------------------------------------------------------------

def rgb(c):
    if isinstance(c, (tuple, list)):
        return tuple(int(x) for x in c[:3])
    c = c.lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def mix(c1, c2, t):
    a, b = rgb(c1), rgb(c2)
    return tuple(int(lerp(x, y, t)) for x, y in zip(a, b))


# ----------------------------------------------------------------------------
# Lienzo, formas, texto
# ----------------------------------------------------------------------------

def canvas(ctx_or_size, color="#000"):
    size = (ctx_or_size.w, ctx_or_size.h) if isinstance(ctx_or_size, Ctx) else ctx_or_size
    return Image.new("RGB", size, rgb(color))


def layer(size):
    """Capa RGBA transparente."""
    return Image.new("RGBA", size, (0, 0, 0, 0))


def over(base, top, xy=(0, 0), opacity=1.0):
    """Compone una capa RGBA sobre base (in-place) con opacidad."""
    if opacity <= 0:
        return base
    if opacity < 1:
        top = top.copy()
        a = top.getchannel("A").point(lambda v: int(v * opacity))
        top.putalpha(a)
    base.paste(top, (int(xy[0]), int(xy[1])), top)
    return base


@functools.lru_cache(maxsize=64)
def font(name="DejaVu Sans:bold", size=96):
    """Carga una fuente por nombre fontconfig ('Familia:bold') o ruta .ttf/.otf."""
    path = name
    if not Path(name).exists():
        try:
            path = subprocess.run(["fc-match", "-f", "%{file}", name],
                                  capture_output=True, text=True).stdout.strip()
        except FileNotFoundError:
            path = ""
    try:
        return ImageFont.truetype(path, int(size))
    except Exception:
        return ImageFont.load_default(int(size))


def text_size(text, size, fnt="DejaVu Sans:bold", tracking=0):
    f = font(fnt, int(size))
    if not tracking:
        l, t, r, b = f.getbbox(text)
        return r - l, b - t
    w = sum(f.getlength(ch) for ch in text) + tracking * (len(text) - 1)
    l, t, r, b = f.getbbox(text)
    return int(w), b - t


def draw_text(img, text, xy, size=96, fill="#fff", fnt="DejaVu Sans:bold",
              anchor="mm", tracking=0, opacity=1.0, stroke=0, stroke_fill="#000"):
    """Dibuja texto. tracking = espacio extra en px entre letras."""
    size = max(1, int(size))
    f = font(fnt, size)
    lay = layer(img.size)
    d = ImageDraw.Draw(lay)
    col = rgb(fill) + (int(255 * clamp(opacity)),)
    if not tracking:
        d.text(xy, text, font=f, fill=col, anchor=anchor,
               stroke_width=stroke, stroke_fill=rgb(stroke_fill))
    else:
        tw, _ = text_size(text, size, fnt, tracking)
        x = xy[0] - (tw / 2 if anchor[0] == "m" else tw if anchor[0] == "r" else 0)
        for ch in text:
            d.text((x, xy[1]), ch, font=f, fill=col, anchor="l" + anchor[1],
                   stroke_width=stroke, stroke_fill=rgb(stroke_fill))
            x += f.getlength(ch) + tracking
    img.paste(lay, (0, 0), lay)
    return img


def text_mask(text, size, fnt="DejaVu Sans:bold", pad=20, tracking=0):
    """Máscara L (0-255) del texto, recortada con padding. Útil para FX por letra."""
    tw, th = text_size(text, size, fnt, tracking)
    m = Image.new("L", (tw + pad * 2, int(th * 1.6) + pad * 2), 0)
    tmp = Image.new("RGBA", m.size, (0, 0, 0, 0))
    draw_text(tmp, text, (m.size[0] / 2, m.size[1] / 2), size, "#fff", fnt,
              "mm", tracking)
    return tmp.getchannel("A")


def rect(img, box, fill, opacity=1.0, angle=0, radius=0):
    """Rectángulo (x0,y0,x1,y1), opcionalmente rotado (grados) alrededor de su centro."""
    x0, y0, x1, y1 = box
    x0, x1 = min(x0, x1), max(x0, x1)
    y0, y1 = min(y0, y1), max(y0, y1)
    box = (x0, y0, x1, y1)
    if angle:
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        hw, hh = (x1 - x0) / 2, (y1 - y0) / 2
        a = math.radians(angle)
        pts = [(cx + dx * math.cos(a) - dy * math.sin(a),
                cy + dx * math.sin(a) + dy * math.cos(a))
               for dx, dy in ((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh))]
        return poly(img, pts, fill, opacity)
    lay = layer(img.size)
    d = ImageDraw.Draw(lay)
    col = rgb(fill) + (int(255 * clamp(opacity)),)
    if radius:
        d.rounded_rectangle(box, radius, fill=col)
    else:
        d.rectangle(box, fill=col)
    img.paste(lay, (0, 0), lay)
    return img


def poly(img, pts, fill, opacity=1.0):
    lay = layer(img.size)
    ImageDraw.Draw(lay).polygon(pts, fill=rgb(fill) + (int(255 * clamp(opacity)),))
    img.paste(lay, (0, 0), lay)
    return img


def circle(img, c, r, fill=None, outline=None, width=2, opacity=1.0):
    lay = layer(img.size)
    a = int(255 * clamp(opacity))
    ImageDraw.Draw(lay).ellipse(
        (c[0] - r, c[1] - r, c[0] + r, c[1] + r),
        fill=rgb(fill) + (a,) if fill else None,
        outline=rgb(outline) + (a,) if outline else None, width=width)
    img.paste(lay, (0, 0), lay)
    return img


def arc(img, c, r, start, end, color, width=2, opacity=1.0):
    lay = layer(img.size)
    ImageDraw.Draw(lay).arc((c[0] - r, c[1] - r, c[0] + r, c[1] + r), start, end,
                            fill=rgb(color) + (int(255 * clamp(opacity)),), width=width)
    img.paste(lay, (0, 0), lay)
    return img


def line(img, pts, color, width=2, opacity=1.0):
    lay = layer(img.size)
    ImageDraw.Draw(lay).line(pts, fill=rgb(color) + (int(255 * clamp(opacity)),),
                             width=width)
    img.paste(lay, (0, 0), lay)
    return img


def load(path, size=None, cover=True):
    """Carga imagen y la ajusta (cover/contain) a size."""
    im = Image.open(path).convert("RGB")
    if size:
        sw, sh = size
        r = max(sw / im.width, sh / im.height) if cover else min(sw / im.width, sh / im.height)
        im = im.resize((int(im.width * r), int(im.height * r)), Image.LANCZOS)
        x, y = (im.width - sw) // 2, (im.height - sh) // 2
        im = im.crop((x, y, x + sw, y + sh)) if cover else im
    return im


def transform(img, scale=1.0, angle=0.0, offset=(0, 0), fill=(0, 0, 0)):
    """Escala/rota/traslada alrededor del centro (cámara 2D)."""
    w, h = img.size
    if scale != 1.0:
        nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
        im = img.resize((nw, nh), Image.BICUBIC)
        out = Image.new("RGB", (w, h), fill)
        out.paste(im, ((w - nw) // 2 + int(offset[0]), (h - nh) // 2 + int(offset[1])))
    else:
        out = ImageChops.offset(img, int(offset[0]), int(offset[1])) if any(offset) else img
    if angle:
        out = out.rotate(angle, Image.BICUBIC, fillcolor=fill)
    return out


# ----------------------------------------------------------------------------
# Ruido procedural
# ----------------------------------------------------------------------------

def value_noise(w, h, scale=64, octaves=4, seed=0, t=0.0, persistence=0.5):
    """Ruido fractal 0..1 (float32 HxW). t desplaza el ruido para animarlo."""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        s = max(1, scale / (2 ** o))
        gw, gh = int(w / s) + 3, int(h / s) + 3
        g = rng.random((gh, gw)).astype(np.float32)
        im = Image.fromarray((g * 255).astype(np.uint8), "L")
        big = im.resize((int(gw * s), int(gh * s)), Image.BICUBIC)
        ox = int((t * s * 0.6 * (o + 1)) % (big.width - w)) if big.width > w else 0
        oy = int((t * s * 0.25 * (o + 1)) % (big.height - h)) if big.height > h else 0
        out += np.asarray(big.crop((ox, oy, ox + w, oy + h)), np.float32) / 255 * amp
        tot += amp
        amp *= persistence
    return out / tot


def smoke(w, h, t, scale=180, seed=0, contrast=2.2):
    """Humo/tinta animado 0..1."""
    n = value_noise(w, h, scale, 5, seed, t * 20)
    n2 = value_noise(w, h, scale * 0.5, 3, seed + 9, -t * 35)
    v = np.clip((n * 0.7 + n2 * 0.3 - 0.5) * contrast + 0.5, 0, 1)
    return v ** 1.5


# ----------------------------------------------------------------------------
# FX de post (numpy). Todas reciben/devuelven arrays float32 HxWx3 o PIL.
# ----------------------------------------------------------------------------

def _arr(x):
    return to_np(x) if isinstance(x, Image.Image) else x.astype(np.float32)


def grain(x, amount=12, seed=None, mono=True):
    a = _arr(x)
    rng = np.random.default_rng(seed)
    shape = a.shape[:2] + ((1,) if mono else (3,))
    return a + rng.normal(0, amount, shape).astype(np.float32)


def chromatic(x, shift=3):
    """Aberración cromática radial simple (R hacia fuera, B hacia dentro)."""
    a = _arr(x)
    if not shift:
        return a
    out = a.copy()
    img = to_img(a)
    h, w = a.shape[:2]
    for ch, s in ((0, shift), (2, -shift)):
        sc = 1 + s / (w / 2)
        nw, nh = int(w * sc), int(h * sc)
        im = img.getchannel(ch).resize((nw, nh), Image.BILINEAR)
        x0, y0 = (nw - w) // 2, (nh - h) // 2
        if sc >= 1:
            out[..., ch] = np.asarray(im.crop((x0, y0, x0 + w, y0 + h)), np.float32)
        else:
            canvas_ = Image.new("L", (w, h), 0)
            canvas_.paste(im, (-x0, -y0))
            out[..., ch] = np.asarray(canvas_, np.float32)
    return out


def glow(x, radius=20, strength=0.8, threshold=180):
    """Bloom: aísla altas luces, desenfoca y suma en modo screen."""
    a = _arr(x)
    hi = np.clip((a - threshold) * (255 / max(1, 255 - threshold)), 0, 255)
    b = np.asarray(to_img(hi).filter(ImageFilter.GaussianBlur(radius)), np.float32)
    b2 = np.asarray(to_img(hi).filter(ImageFilter.GaussianBlur(radius * 3)), np.float32)
    return screen(a, (b * 0.7 + b2 * 0.5) * strength)


def blur(x, radius=4):
    return np.asarray(to_img(_arr(x)).filter(ImageFilter.GaussianBlur(radius)), np.float32)


def directional_blur(x, dx=20, dy=0, samples=8):
    a = _arr(x)
    acc = np.zeros_like(a)
    for s in range(samples):
        k = s / max(1, samples - 1) - 0.5
        acc += np.roll(a, (int(dy * k), int(dx * k)), axis=(0, 1))
    return acc / samples


def radial_blur(x, amount=0.06, samples=10, center=None):
    """Zoom blur desde el centro (hiperespacio, impactos)."""
    img = to_img(_arr(x))
    w, h = img.size
    cx, cy = center or (w / 2, h / 2)
    acc = np.zeros((h, w, 3), np.float32)
    for s in range(samples):
        sc = 1 + amount * s / samples
        nw, nh = int(w * sc), int(h * sc)
        im = img.resize((nw, nh), Image.BILINEAR)
        x0, y0 = int(cx * sc - cx), int(cy * sc - cy)
        acc += np.asarray(im.crop((x0, y0, x0 + w, y0 + h)), np.float32)
    return acc / samples


def vignette(x, strength=0.5, power=2.2):
    a = _arr(x)
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2) / 1.414
    return a * (1 - strength * d ** power)[..., None]


def scanlines(x, spacing=3, strength=0.25):
    a = _arr(x)
    m = np.ones(a.shape[0], np.float32)
    m[::spacing] = 1 - strength
    return a * m[:, None, None]


def letterbox(x, ratio=2.39):
    a = _arr(x).copy()
    h, w = a.shape[:2]
    bar = max(0, int((h - w / ratio) / 2))
    if bar:
        a[:bar] = 0
        a[h - bar:] = 0
    return a


def grade(x, lift=(0, 0, 0), gamma=(1, 1, 1), gain=(1, 1, 1), sat=1.0, contrast=1.0):
    """Corrección tipo lift/gamma/gain + saturación + contraste (pivot 0.5)."""
    a = np.clip(_arr(x) / 255, 0, 1)
    a = a * np.array(gain, np.float32) + np.array(lift, np.float32) * (1 - a)
    a = np.clip(a, 0, 1) ** (1 / np.array(gamma, np.float32))
    a = (a - 0.5) * contrast + 0.5
    lum = (a @ np.array([.2126, .7152, .0722], np.float32))[..., None]
    a = lum + (a - lum) * sat
    return np.clip(a, 0, 1) * 255


def tint(x, color, amount=1.0):
    """Duotono/monotono: mapea luminancia al color dado."""
    a = _arr(x)
    lum = (a @ np.array([.2126, .7152, .0722], np.float32))[..., None] / 255
    c = np.array(rgb(color), np.float32)
    return a * (1 - amount) + lum * c * amount


def duotone(x, dark, light):
    a = _arr(x)
    lum = (a @ np.array([.2126, .7152, .0722], np.float32))[..., None] / 255
    return np.array(rgb(dark), np.float32) * (1 - lum) + np.array(rgb(light), np.float32) * lum


def screen(a, b):
    a, b = _arr(a), _arr(b)
    return 255 - (255 - a) * (255 - b) / 255


def multiply(a, b):
    return _arr(a) * _arr(b) / 255


def add(a, b):
    return np.clip(_arr(a) + _arr(b), 0, 255)


def overlay(a, b):
    a, b = _arr(a) / 255, _arr(b) / 255
    return np.where(a < .5, 2 * a * b, 1 - 2 * (1 - a) * (1 - b)) * 255


def double_exposure(base, inner, mask_from="base", gamma=1.0):
    """Doble exposición: inner visible dentro de las luces de base (estilo True Detective)."""
    b, i = _arr(base), _arr(inner)
    lum = (b @ np.array([.2126, .7152, .0722], np.float32))[..., None] / 255
    m = lum ** gamma if mask_from == "base" else 1 - lum ** gamma
    return screen(b * (1 - m) , i * m)


def flicker(x, t, amount=0.08, seed=0):
    return _arr(x) * (1 + wiggle(t, 18, amount, seed, 1))


def jitter_offset(t, amount=3, fps=24, seed=0):
    """Desplazamiento de 'gate weave' de proyector (por cuadro)."""
    i = int(t * fps)
    return (_hash1(i * 3 + seed) * amount, _hash1(i * 7 + seed + 1) * amount * 0.6)


def scratches(x, t, fps=24, count=3, seed=0, dust=40):
    """Rayas verticales y polvo de película."""
    a = _arr(x).copy()
    h, w = a.shape[:2]
    rng = np.random.default_rng(int(t * fps) + seed * 1000)
    for _ in range(rng.integers(0, count + 1)):
        xx = int(rng.integers(0, w))
        val = rng.choice([30.0, 230.0])
        a[:, xx:xx + rng.integers(1, 3)] = a[:, xx:xx + 1] * 0.3 + val * 0.7
    for _ in range(rng.integers(0, dust)):
        cx, cy = int(rng.integers(0, w)), int(rng.integers(0, h))
        r = int(rng.integers(1, 4))
        a[max(0, cy - r):cy + r, max(0, cx - r):cx + r] = rng.choice([0.0, 255.0])
    return a


def rgb_split_glitch(x, t, fps=24, intensity=1.0, seed=0):
    """Glitch digital: desplaza bandas horizontales y separa canales."""
    a = _arr(x).copy()
    h, w = a.shape[:2]
    rng = np.random.default_rng(int(t * fps) * 13 + seed)
    for _ in range(int(rng.integers(2, 8) * intensity)):
        y = int(rng.integers(0, h))
        bh = int(rng.integers(2, max(3, h // 12)))
        dx = int(rng.integers(-w // 20, w // 20) * intensity)
        a[y:y + bh] = np.roll(a[y:y + bh], dx, axis=1)
    s = int(6 * intensity)
    a[..., 0] = np.roll(a[..., 0], s, axis=1)
    a[..., 2] = np.roll(a[..., 2], -s, axis=1)
    return a


def lens_flare(x, pos, intensity=1.0, color="#ffd9a0", streak=True):
    """Flare anamórfico: núcleo + streak horizontal + ghosts sobre el eje óptico."""
    a = _arr(x)
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    px, py = pos
    c = np.array(rgb(color), np.float32) / 255
    d = np.sqrt((xx - px) ** 2 + (yy - py) ** 2)
    core = np.exp(-(d / (w * 0.015)) ** 2) * 1.5 + np.exp(-(d / (w * 0.08))) * 0.5
    fl = core[..., None] * c
    if streak:
        s = np.exp(-np.abs(yy - py) / (h * 0.004)) * np.exp(-np.abs(xx - px) / (w * 0.35))
        fl += s[..., None] * np.array([0.55, 0.75, 1.0], np.float32) * 0.9
    cx, cy = w / 2, h / 2
    for k, rr, al in ((-0.4, 0.03, 0.15), (-0.8, 0.06, 0.08), (0.5, 0.02, 0.2), (-1.2, 0.1, 0.05)):
        gx, gy = cx + (px - cx) * k, cy + (py - cy) * k
        gd = np.sqrt((xx - gx) ** 2 + (yy - gy) ** 2)
        fl += (np.clip(1 - gd / (w * rr), 0, 1) ** 2 * al)[..., None] * c
    return screen(a, np.clip(fl * 255 * intensity, 0, 255))


def light_rays(x, pos, length=0.5, samples=24, decay=0.94, strength=0.9):
    """God rays / volumetría 2D desde un punto (blur radial de altas luces)."""
    a = _arr(x)
    hi = np.clip(a - 160, 0, 255) * 2.5
    img = to_img(hi)
    w, h = img.size
    acc = np.zeros_like(a)
    wt = 1.0
    for s in range(samples):
        sc = 1 + length * s / samples
        nw, nh = int(w * sc), int(h * sc)
        im = img.resize((nw, nh), Image.BILINEAR)
        x0, y0 = int(pos[0] * sc - pos[0]), int(pos[1] * sc - pos[1])
        acc += np.asarray(im.crop((x0, y0, x0 + w, y0 + h)), np.float32) * wt
        wt *= decay
    return screen(a, np.clip(acc / samples * strength * 3, 0, 255))


def finish(x, t=0.0, fps=24, grain_amt=8, vig=0.35, ca=1, seed=0):
    """Acabado 'cinematográfico' estándar: CA + viñeta + grano."""
    a = chromatic(x, ca) if ca else _arr(x)
    a = vignette(a, vig) if vig else a
    return grain(a, grain_amt, seed=int(t * fps) + seed) if grain_amt else a


# ----------------------------------------------------------------------------
# Transiciones (p = 0..1)
# ----------------------------------------------------------------------------

def wipe(a, b, p, angle=0, soft=40):
    A, B = _arr(a), _arr(b)
    h, w = A.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r = math.radians(angle)
    proj = xx * math.cos(r) + yy * math.sin(r)
    lo, hi = proj.min() - soft, proj.max() + soft
    edge = lerp(lo, hi, p)
    m = np.clip((edge - proj) / soft + 0.5, 0, 1)[..., None]
    return A * (1 - m) + B * m


def iris(a, b, p, center=None, soft=4):
    A, B = _arr(a), _arr(b)
    h, w = A.shape[:2]
    cx, cy = center or (w / 2, h / 2)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    r = p * math.hypot(w, h)
    m = np.clip((r - d) / soft, 0, 1)[..., None]
    return A * (1 - m) + B * m


def crossfade(a, b, p):
    return _arr(a) * (1 - p) + _arr(b) * p


def flash(x, p, color="#fff"):
    """Flash frame: p=1 cuadro completamente blanco."""
    return _arr(x) * (1 - p) + np.array(rgb(color), np.float32) * p


# ----------------------------------------------------------------------------
# Utilidades de revisión
# ----------------------------------------------------------------------------

def contact_sheet(video, out_png, cols=4, rows=3, width=1600):
    """Hoja de contactos de un video (para revisar visualmente con la tool Read)."""
    dur = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(video)], capture_output=True, text=True).stdout.strip() or 1)
    n = cols * rows
    fps = n / dur
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-vf",
                    f"fps={fps:.4f},scale={width // cols}:-1,tile={cols}x{rows}",
                    "-frames:v", "1", str(out_png)], check=True)
    return out_png


if __name__ == "__main__":
    # Auto-test: 3 s de prueba con varios FX.
    a = cli("Prueba de mfx", seconds=3, text="MFX")

    def f(t, i, ctx):
        img = canvas(ctx, "#0b0d12")
        s = remap(t, 0, 1.2, 0.6, 1, ease_out_back)
        draw_text(img, a.text, (ctx.w / 2, ctx.h / 2), ctx.h * 0.25 * s, "#f2f2f2",
                  tracking=ctx.w * 0.01)
        x = glow(img, ctx.w / 100, 0.8)
        x = lens_flare(x, (lerp(-0.1, 1.1, t / ctx.seconds) * ctx.w, ctx.h * 0.42), 0.8)
        return finish(x, t)

    run(f, a)
