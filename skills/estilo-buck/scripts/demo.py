"""Demo estilo BUCK: personaje geométrico con squash & stretch, morphs forma→forma con barridos de color,
match cut a un paisaje 2.5D con parallax y título que cae letra por letra. Textura riso + grano, personajes en dos."""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "motion-fx-core", "scripts"))
from mfx import *  # noqa: E402,F403

a = cli("Estilo BUCK", seconds=10, text="ideas que se mueven", sub="hecho con código")

CREMA, CORAL, AZUL, AMARILLO, TINTA = "#F6EEDC", "#FF6B4A", "#2D5BFF", "#FFC83D", "#1E1B2E"
FONT = "DejaVu Sans:bold"
N = 120                                   # puntos por contorno (todas las formas iguales para el morph)
# (forma, color de la forma, fondo) de cada etapa del morph
ETAPAS = [("circulo", CORAL, CREMA), ("cuadrado", AZUL, AMARILLO), ("estrella", AMARILLO, AZUL), ("corazon", CORAL, CREMA)]
T_MORPH = [3.2, 4.3, 5.4]                 # arranque de cada morph (dura 0.6 s)


def contorno(forma, cx, cy, r, rot=0.0):
    """N puntos de la forma, empezando arriba y en sentido horario (para interpolar punto a punto)."""
    pts = []
    for i in range(N):
        th = -math.pi / 2 + 2 * math.pi * i / N
        if forma == "circulo":
            rr = r
        elif forma == "cuadrado":            # superelipse: cuadrado de esquinas redondeadas
            p = 6
            rr = r * 0.92 / (abs(math.cos(th)) ** p + abs(math.sin(th)) ** p) ** (1 / p)
        elif forma == "estrella":
            rr = r * (0.5 + 0.62 * abs(math.cos(2.5 * (th + math.pi / 2))) ** 2.2)
        else:                                # corazón paramétrico, s=0 arriba al centro
            s = 2 * math.pi * i / N
            x = 16 * math.sin(s) ** 3
            y = -(13 * math.cos(s) - 5 * math.cos(2 * s) - 2 * math.cos(3 * s) - math.cos(4 * s))
            pts.append((x, y + 2))
            continue
        pts.append((math.cos(th) * rr, math.sin(th) * rr))
    if forma == "corazon":
        k = r / 17
        pts = [(x * k, y * k) for x, y in pts]
    c, s_ = math.cos(rot), math.sin(rot)
    return [(cx + x * c - y * s_, cy + x * s_ + y * c) for x, y in pts]


def boil(pts, tq, amp=2.2):
    """Line boil: el contorno ondula suave (pocas armónicas) y cambia cada 2 cuadros (12 fps), como dibujado a mano."""
    rnd = np.random.default_rng(int(tq * 12) + 7)
    fases = rnd.uniform(0, 2 * math.pi, 3)
    n = len(pts)
    cx = sum(x for x, _ in pts) / n
    cy = sum(y for _, y in pts) / n
    out = []
    for i, (x, y) in enumerate(pts):
        q = 2 * math.pi * i / n
        d = amp * (math.sin(3 * q + fases[0]) + 0.6 * math.sin(5 * q + fases[1]) + 0.4 * math.sin(7 * q + fases[2])) / 2
        r = math.hypot(x - cx, y - cy) or 1
        out.append((x + (x - cx) / r * d, y + (y - cy) / r * d))
    return out


def ojos(img, cx, cy, r, tq, mira=0.0, color=TINTA):
    """Dos ojos ovalados; parpadeo a los 2.1 s y 7.9 s."""
    parp = any(abs(tq - tb) < 0.06 for tb in (2.1, 5.0, 7.9))
    for s in (-1, 1):
        ex, ey = cx + s * r * 0.32 + mira * r * 0.12, cy - r * 0.12
        if parp:
            rect(img, (ex - r * 0.1, ey - r * 0.02, ex + r * 0.1, ey + r * 0.02), color)
        else:
            poly(img, [(ex + math.cos(q) * r * 0.085, ey + math.sin(q) * r * 0.14) for q in np.linspace(0, 2 * math.pi, 24)], color)
            circle(img, (ex - r * 0.025, ey - r * 0.05), r * 0.03, "#ffffff")


def riso(x, W, H, cell=7):
    """Puntos de semitono en las zonas oscuras (look risografía)."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    u = (xx + yy) % cell - cell / 2
    v = (xx - yy) % cell - cell / 2
    lum = x.mean(axis=2) / 255.0
    dot = (np.sqrt(u ** 2 + v ** 2) < cell * 0.5 * (1 - lum) ** 1.5)[..., None]
    return x * (1 - 0.12 * dot)


def pelota(t):
    """Posición vertical (0 = piso, 1 = altura del salto) y escala (sx, sy) de la pelota: caída, rebote, anticipación, salto."""
    h, sy = 0.0, 1.0
    if t < 0.6:                                   # cae desde arriba, estirada
        k = t / 0.6
        h = 1.6 * (1 - k * k)
        sy = 1 + 0.25 * k
    elif t < 1.15:                                # golpe: se aplasta y vuelve con rebote amortiguado
        k = (t - 0.6) / 0.55
        sy = 1 - 0.38 * math.exp(-5 * k) * math.cos(k * 10)
        h = 0.18 * math.sin(math.pi * min(1, k * 1.6)) if k < 0.62 else 0
    elif t < 1.45:                                # anticipación: se agacha
        sy = 1 - 0.22 * ease_in_out_cubic(remap(t, 1.15, 1.45))
    elif t < 2.25:                                # salto con estiramiento
        k = (t - 1.45) / 0.8
        h = math.sin(math.pi * k)
        sy = 1.22 - 0.22 * k * 2 if k < 0.5 else 1 + 0.12 * (k - 0.5) * 2
    elif t < 2.8:                                 # aterriza y se asienta
        k = (t - 2.25) / 0.55
        sy = 1 - 0.3 * math.exp(-5 * k) * math.cos(k * 10)
    return h, (1 / math.sqrt(max(0.3, sy)), sy)


def colinas(img, W, H, base, amp, freq, fase, color, cam):
    pts = [(x, base - amp * math.sin(x / W * freq * math.pi + fase + cam)) for x in np.linspace(-20, W + 20, 60)]
    poly(img, [(-20, H + 20)] + pts + [(W + 20, H + 20)], color)


def frame(t, i, ctx):
    W, H = ctx.w, ctx.h
    tq = math.floor(t * 12) / 12                  # personajes "en dos"
    S = min(W, H)
    piso = H * 0.68
    R = S * 0.13

    # ---- 1) pelota con squash & stretch (0–3.2 s) ----
    if t < T_MORPH[0]:
        img = canvas(ctx, CREMA)
        h, (sx, sy) = pelota(tq)
        cx = W / 2 + remap(tq, 2.8, 3.2, 0, 0, ease=ease_in_out_cubic)
        crece = remap(tq, 2.8, 3.2, 1, 1.35, ease=ease_in_out_cubic)
        cy = piso - R * sy * crece - h * H * 0.32 - remap(tq, 2.8, 3.2, 0, piso - H * 0.5 - R, ease=ease_in_out_cubic)
        sombra = max(0.2, 1 - h * 0.6)
        poly(img, [(W / 2 + math.cos(q) * R * 1.1 * sombra, piso + math.sin(q) * R * 0.18 * sombra) for q in np.linspace(0, 2 * math.pi, 40)], "#E3D6BD")
        pts = [(cx + (x - cx) * sx * crece, cy + (y - cy) * sy * crece) for x, y in contorno("circulo", cx, cy, R)]
        poly(img, boil(pts, tq), CORAL)
        ojos(img, cx, cy - R * 0.05 * crece, R * crece, tq, mira=math.sin(tq * 2))
        x = to_np(img)
    # ---- 2) morphs con barridos de color (3.2–6.5 s) ----
    elif t < 6.5:
        cx, cy, Rm = W / 2, H * 0.5, R * 1.35
        etapa = sum(1 for tm in T_MORPH if t >= tm)          # 1..3
        tm = T_MORPH[etapa - 1]
        k = remap(tq, tm, tm + 0.6, ease=ease_in_out_cubic)
        f0, c0, b0 = ETAPAS[etapa - 1]
        f1, c1, b1 = ETAPAS[etapa]
        rot = math.sin(k * math.pi) * 0.35
        esc = 1 + 0.18 * math.sin(k * math.pi) - 0.06 * math.sin(remap(tq, tm + 0.6, tm + 0.95) * math.pi)
        A = contorno(f0, cx, cy, Rm * esc, rot)
        B = contorno(f1, cx, cy, Rm * esc, rot)
        pts = [(lerp(ax, bx, k), lerp(ay, by, k)) for (ax, ay), (bx, by) in zip(A, B)]

        def escena(fondo, color):
            im = canvas(ctx, fondo)
            poly(im, boil(pts, tq), color)
            ojos(im, cx, cy, Rm * esc, tq, color=TINTA if color != AZUL else "#ffffff")
            return to_np(im)
        # el fondo nuevo invade desde la forma (color-blocking)
        p = remap(t, tm + 0.25, tm + 0.85, ease=ease_in_out_expo)
        color = c0 if k < 0.5 else c1
        x = iris(escena(b0, color), escena(b1, color), p, center=(cx, cy))
    # ---- 3) match cut: el corazón es el sol de un paisaje 2.5D; título letra por letra (6.5–10 s) ----
    else:
        img = canvas(ctx, CREMA)
        k = remap(t, 6.5, 7.4, ease=ease_in_out_cubic)
        cam = remap(t, 6.5, 10, 0, 1.2, ease=ease_out_cubic)
        sube = remap(t, 6.5, 7.6, H * 0.6, 0, ease=ease_out_cubic)
        # sol (el corazón que se achica y redondea)
        sx_, sy_ = W * lerp(0.5, 0.74, k), H * lerp(0.5, 0.26, k)
        rs = R * lerp(1.35, 0.8, k)
        A = contorno("corazon", sx_, sy_, rs)
        B = contorno("circulo", sx_, sy_, rs)
        circle(img, (sx_, sy_), rs * (1.25 + 0.05 * math.sin(t * 3)), AMARILLO, opacity=0.35 * k)
        poly(img, boil([(lerp(ax, bx, k), lerp(ay, by, k)) for (ax, ay), (bx, by) in zip(A, B)], tq), CORAL)
        # nubes (cápsulas) y capas con parallax
        for j, (yy, vel) in enumerate(((0.16, 0.05), (0.3, 0.09))):
            nx = (W * (0.15 + 0.5 * j) - cam * W * vel * 3) % (W * 1.3) - W * 0.15
            for dx, dr in ((0, 0.045), (S * 0.05, 0.06), (S * 0.11, 0.04)):
                circle(img, (nx + dx, H * yy + sube * 0.3), S * dr, "#FFFFFF")
        colinas(img, W, H, H * 0.62 + sube * 0.6, H * 0.05, 2.2, 0.5, "#9DB4FF", cam * 0.6)
        colinas(img, W, H, H * 0.7 + sube * 0.8, H * 0.06, 3.1, 1.7, AZUL, cam * 1.2)
        colinas(img, W, H, H * 0.8 + sube, H * 0.035, 4.0, 0.2, CORAL, cam * 2.2)
        # título: letras que caen escalonadas, rebotan y se asientan
        fs = S * 0.1
        letras = list(a.text)
        anchos = [text_size(c if c != " " else "n", fs, FONT)[0] * (0.55 if c == " " else 1) for c in letras]
        x0 = W / 2 - sum(anchos) / 2
        ybase = H * 0.47
        for j, c in enumerate(letras):
            p = stagger(tq, j, 7.2, 0.045, 0.55, ease_out_back)
            if p > 0 and c != " ":
                y = lerp(-H * 0.2, ybase, p)
                draw_text(img, c, (x0 + anchos[j] / 2 + 5, y + 6), fs, "#D9CBB0", FONT)   # sombra plana
                draw_text(img, c, (x0 + anchos[j] / 2, y), fs, TINTA, FONT)
            x0 += anchos[j]
        # sub con barrido
        q = remap(t, 8.6, 9.1, ease=ease_out_expo)
        if q > 0:
            tw, th = text_size(a.sub, S * 0.045, FONT)
            rect(img, (W / 2 - tw / 2 - 24, H * 0.56 - th, W / 2 - tw / 2 - 24 + (tw + 48) * q, H * 0.56 + th), CORAL)
            if q > 0.6:
                draw_text(img, a.sub, (W / 2, H * 0.56), S * 0.045, "#ffffff", FONT)
        x = to_np(img)

    x = riso(x, W, H)
    x *= 1 - remap(t, ctx.seconds - 0.3, ctx.seconds)
    return grain(x, 5, seed=i)


run(frame, a)
