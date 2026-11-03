#!/usr/bin/env python3
"""Reencuadra un video a otro formato (9:16, 4:5, 1:1, 16:9) siguiendo la cara, como «auto reframe» de CapCut.

  1. Detecta caras con YuNet (onnxruntime, CPU) en ~5 cuadros por segundo.
  2. Elige la cara principal (la más grande, sin saltar de una persona a otra por un cuadro) y arma una trayectoria.
  3. Suaviza el movimiento como un camarógrafo: zona muerta (no se mueve por gestos chicos), sin temblor y con
     velocidad máxima. Si la cara salta de golpe (cambio de plano), corta en vez de hacer un paneo.
  4. Recorta con ffmpeg (crop que se mueve cuadro a cuadro) y escala al tamaño final; el audio se copia.
Sin cara por más de --sin-cara-seg segundos, la cámara vuelve suave al centro.

Modelo: face_detection_yunet_2023mar.onnx (MIT, opencv_zoo) en ~/.cache/clipmill/ (o FOTOGRAMA_YUNET).

Uso:
  python3 reencuadrar.py entrada.mp4 salida.mp4 [--formato 9:16] [--muestras 5]
"""
import argparse, json, math, os, subprocess, sys
from pathlib import Path

import numpy as np

MODELO = Path(os.environ.get('FOTOGRAMA_YUNET', Path.home() / '.cache/clipmill/face_detection_yunet_2023mar.onnx'))
LADO = 640  # YuNet 2023mar tiene la entrada fija en 640×640
TAMANOS = {'9:16': (1080, 1920), '4:5': (1080, 1350), '1:1': (1080, 1080), '16:9': (1920, 1080)}


def sh(*args):
    r = subprocess.run(args, text=True, capture_output=True)
    if r.returncode: sys.exit(r.stderr[-2000:])
    return r.stdout


def info(video):
    d = json.loads(sh('ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:stream_side_data=rotation:format=duration', '-of', 'json', str(video)))
    s = d['streams'][0]
    w, h = s['width'], s['height']
    rot = next((abs(int(x.get('rotation', 0))) for x in s.get('side_data_list', []) if 'rotation' in x), 0)
    if rot in (90, 270): w, h = h, w  # ffmpeg ya entrega los cuadros girados
    num, den = map(int, s['r_frame_rate'].split('/'))
    return w, h, num / den, float(d['format']['duration'])


class YuNet:
    def __init__(self):
        import onnxruntime as ort
        if not MODELO.exists(): sys.exit(f'Falta el modelo {MODELO} (face_detection_yunet_2023mar.onnx de opencv_zoo, MIT).')
        self.s = ort.InferenceSession(str(MODELO), providers=['CPUExecutionProvider'])
        self.salidas = [o.name for o in self.s.get_outputs()]

    def detectar(self, bgr, umbral=0.6):
        """bgr: 640×640×3 uint8. Devuelve [(x, y, w, h, puntaje)] en píxeles de esa imagen (con NMS)."""
        x = bgr.transpose(2, 0, 1)[None].astype(np.float32)
        r = dict(zip(self.salidas, self.s.run(None, {'input': x})))
        cajas = []
        for paso in (8, 16, 32):
            cols = LADO // paso
            cls, obj, bb = r[f'cls_{paso}'][0, :, 0], r[f'obj_{paso}'][0, :, 0], r[f'bbox_{paso}'][0]
            pts = np.sqrt(np.clip(cls, 0, 1) * np.clip(obj, 0, 1))
            for i in np.nonzero(pts > umbral)[0]:
                fila, col = divmod(int(i), cols)
                cx, cy = (col + bb[i, 0]) * paso, (fila + bb[i, 1]) * paso
                w, h = math.exp(bb[i, 2]) * paso, math.exp(bb[i, 3]) * paso
                cajas.append((cx - w / 2, cy - h / 2, w, h, float(pts[i])))
        cajas.sort(key=lambda c: -c[4])
        quedan = []
        for c in cajas:  # NMS
            if all(iou(c, q) < 0.3 for q in quedan): quedan.append(c)
        return quedan


def iou(a, b):
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[0] + a[2], b[0] + b[2]), min(a[1] + a[3], b[1] + b[3])
    i = max(0, x2 - x1) * max(0, y2 - y1)
    return i / (a[2] * a[3] + b[2] * b[3] - i + 1e-9)


def analizar(video, w, h, muestras, duracion):
    """Caras cada 1/muestras s: lista de (t, [(cx, cy, alto, puntaje)]) en píxeles del video original."""
    det = YuNet()
    k = LADO / max(w, h)
    sw, sh_ = round(w * k) // 2 * 2, round(h * k) // 2 * 2
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', str(video), '-vf', f'fps={muestras},scale={sw}:{sh_},pad={LADO}:{LADO}:0:0',
                          '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE)
    out, n, total = [], 0, int(duracion * muestras)
    while True:
        b = p.stdout.read(LADO * LADO * 3)
        if len(b) < LADO * LADO * 3: break
        img = np.frombuffer(b, np.uint8).reshape(LADO, LADO, 3)
        caras = [((x + cw / 2) / k, (y + ch / 2) / k, ch / k, s) for x, y, cw, ch, s in det.detectar(img) if x < sw and y < sh_]
        out.append((n / muestras, caras))
        n += 1
        if n % (muestras * 10) == 0: print(f'· analizando {n / muestras:.0f}/{duracion:.0f} s', flush=True)
    p.wait()
    return out


def elegir(muestras):
    """Una cara por muestra: la más grande, pero sigue a la misma persona si sigue cerca (evita saltar entre dos)."""
    elegida, previa = [], None
    for t, caras in muestras:
        c = None
        if caras:
            grande = max(caras, key=lambda c: c[2])
            if previa:
                cerca = min(caras, key=lambda c: math.hypot(c[0] - previa[0], c[1] - previa[1]))
                # cambia de persona solo si la otra es claramente más grande
                c = cerca if math.hypot(cerca[0] - previa[0], cerca[1] - previa[1]) < previa[2] * 1.5 and cerca[2] > grande[2] * 0.6 else grande
            else:
                c = grande
            previa = c
        elegida.append((t, c))
    return elegida


def persistentes(elegidas, minimo):
    """Solo cuentan las caras que se ven seguidas `minimo` muestras en el mismo lugar: quita falsos positivos
    (una llanta, un reflejo) que aparecen un instante y harían saltar la cámara."""
    out, racha = list(elegidas), []

    def cerrar():
        if len(racha) < minimo:
            for i in racha: out[i] = (out[i][0], None)
        racha.clear()

    for i, (t, c) in enumerate(elegidas):
        if c is None:
            cerrar()
            continue
        if racha:
            p = elegidas[racha[-1]][1]
            if math.hypot(c[0] - p[0], c[1] - p[1]) > max(p[2], c[2]):
                cerrar()
        racha.append(i)
    cerrar()
    return out


def trayectoria(elegidas, w, h, cw, ch, fps, duracion, zona, sin_cara_seg):
    """Centro del recorte para cada cuadro del video final, suavizado como un camarógrafo."""
    t = np.array([e[0] for e in elegidas])
    centro = np.array([w / 2, h / 2])
    # Objetivo por muestra: la cara (un poco arriba del centro del recorte, como en una toma de cámara); sin cara, se
    # mantiene la última y después de `sin_cara_seg` vuelve al centro.
    obj, ultimo, desde = [], centro, -1e9
    for ti, c in elegidas:
        if c: ultimo, desde = np.array([c[0], c[1] + ch * 0.08]), ti
        obj.append(ultimo if ti - desde <= sin_cara_seg else centro)
    obj = np.array(obj) if obj else np.array([centro])
    # Mediana (quita detecciones sueltas) y cuadros del video final.
    k = 2
    med = np.array([np.median(obj[max(0, i - k):i + k + 1], axis=0) for i in range(len(obj))])
    n = max(1, int(round(duracion * fps)))
    tf = np.arange(n) / fps
    objf = np.stack([np.interp(tf, t if len(t) else [0], med[:, j]) for j in range(2)], 1)
    # Camarógrafo: no se mueve dentro de la zona muerta; afuera, se acerca con resorte y velocidad máxima.
    # Un salto grande que se mantiene (cambio de plano) es corte directo.
    pos = np.zeros_like(objf)
    p = objf[0].copy()
    vmax = np.array([cw, ch]) * 0.9 / fps  # como mucho ~0.9 recortes por segundo
    for i in range(n):
        d = objf[i] - p
        lejos = np.abs(d) > np.array([cw, ch]) * 0.75
        adelante = objf[min(n - 1, i + int(fps * 0.5))]
        if lejos.any() and np.all(np.abs(adelante - objf[i]) < np.array([cw, ch]) * 0.2):
            p = objf[i].copy()  # corte de plano
        else:
            fuera = np.sign(d) * np.maximum(0, np.abs(d) - np.array([cw, ch]) * zona)
            p = p + np.clip(fuera * 0.12, -vmax, vmax)
        pos[i] = p
    # Suavizado sin desfase (ida y vuelta) para quitar los quiebres del resorte.
    a = 0.15
    for _ in range(2):
        for i in range(1, n): pos[i] = pos[i - 1] + a * (pos[i] - pos[i - 1])
        for i in range(n - 2, -1, -1): pos[i] = pos[i + 1] + a * (pos[i] - pos[i + 1])
    x = np.clip(pos[:, 0] - cw / 2, 0, w - cw)
    y = np.clip(pos[:, 1] - ch / 2, 0, h - ch)
    return x, y


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('video')
    ap.add_argument('salida')
    ap.add_argument('--formato', choices=list(TAMANOS), default='9:16')
    ap.add_argument('--muestras', type=int, default=5, help='cuadros analizados por segundo')
    ap.add_argument('--zona', type=float, default=0.12, help='zona muerta (fracción del recorte) donde la cámara no se mueve')
    ap.add_argument('--sin-cara-seg', type=float, default=2.0)
    ap.add_argument('--zoom', type=float, default=1.0, help='>1 acerca (recorte más chico que el máximo)')
    o = ap.parse_args()

    v = Path(o.video).expanduser()
    w, h, fps, dur = info(v)
    W, H = TAMANOS[o.formato]
    # El recorte más grande con el formato pedido que entra en el video (dividido por el zoom), en pares.
    cw = min(w, h * W / H) / o.zoom
    ch = cw * H / W
    cw, ch = int(cw) // 2 * 2, int(ch) // 2 * 2
    print(f'· {v.name}: {w}×{h} @ {fps:.2f} → recorte {cw}×{ch} → {W}×{H}', flush=True)

    elegidas = persistentes(elegir(analizar(v, w, h, o.muestras, dur)), max(2, round(o.muestras * 0.8)))
    con = sum(1 for _, c in elegidas if c)
    print(f'· cara en {con}/{len(elegidas)} muestras ({100 * con / max(1, len(elegidas)):.0f} %)', flush=True)
    x, y = trayectoria(elegidas, w, h, cw, ch, fps, dur, o.zona, o.sin_cara_seg)

    # Cada cuadro mueve el crop con sendcmd (solo cuando cambia ≥ 1 px).
    salida = Path(o.salida).expanduser()
    salida.parent.mkdir(parents=True, exist_ok=True)
    cmds, previo = [], None
    for i, (xi, yi) in enumerate(zip(x, y)):
        xy = (int(round(xi)), int(round(yi)))
        if xy != previo:
            cmds.append(f'{i / fps:.4f} crop x {xy[0]}, crop y {xy[1]};')
            previo = xy
    cmdf = salida.with_suffix('.cmd.txt')
    cmdf.write_text('\n'.join(cmds))
    vf = f"sendcmd=f='{cmdf}',crop={cw}:{ch}:{int(x[0])}:{int(y[0])},scale={W}:{H}:flags=lanczos,setsar=1"
    print('· recortando…', flush=True)
    sh('ffmpeg', '-v', 'error', '-y', '-i', str(v), '-vf', vf, '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
       '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', str(salida))
    cmdf.unlink()
    pista = salida.with_suffix('.reencuadre.json')
    pista.write_text(json.dumps({'video': str(v), 'formato': o.formato, 'recorte': [cw, ch], 'fps': fps,
                                 'caras': [[round(t, 2), [round(c[0]), round(c[1]), round(c[2])] if c else None] for t, c in elegidas]}))
    print(f'✓ {salida} ({W}×{H}, cara en {100 * con / max(1, len(elegidas)):.0f} % del video) · pista en {pista.name}')


if __name__ == '__main__':
    main()
