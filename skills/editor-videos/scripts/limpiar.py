#!/usr/bin/env python3
"""Propone qué cortar de una toma a cámara (como «quitar muletillas» de CapCut), para revisarlo en Clipmill.

Detecta, sobre la transcripción con tiempos por palabra:
  · toma repetida    una frase que se vuelve a decir más adelante (queda la ÚLTIMA, la buena)
  · arranque en falso 1–4 palabras sueltas que son el inicio de la frase que sigue
  · repetición       tartamudeo: «el el», «vamos a vamos a» (se quita la primera)
  · muletilla        eh, em, mmm, ah… (y «este», «o sea», «bueno» solo si van aislados entre pausas)
  · palabra estirada whisper le pegó a la palabra un «eeeh» o un error de antes: se recorta el sobrante
Las pausas largas no se proponen: tutorial.py ya las corta solo (--pausa).

Escribe tutoriales/<slug>/propuesta.json; el estudio (pestaña Limpiar) la muestra para activar/desactivar cortes,
y `tutorial.py … --propuesta` aplica los activos. Reutiliza transcripcion-original.json si ya existe.

Uso (desde ejemplo/):
  python3 ../skills/editor-videos/scripts/limpiar.py \
      ~/Desktop/uploads/toma.mp4 --slug 5-errores-moto
"""
import argparse, difflib, json, re, sys, tempfile, unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

MULETILLAS = {'eh', 'ehh', 'ehhh', 'em', 'emm', 'ehm', 'mm', 'mmm', 'mmmm', 'ah', 'ahh', 'aah', 'uh', 'um', 'hmm'}
AISLADAS = {'este', 'bueno', 'osea', 'o sea', 'digamos', 'pues'}  # solo cuentan entre pausas
# Pista para que whisper SÍ escriba las muletillas (por defecto las limpia).
PISTA = 'Eh, este... mmm, o sea, bueno, eh, ¿verdad? Ehm, ah, entonces, eh.'


def norm(w):
    w = unicodedata.normalize('NFD', w.lower())
    return re.sub(r'[^a-zñ0-9]', '', ''.join(c for c in w if unicodedata.category(c) != 'Mn'))


def transcribir_con_muletillas(wav, modelo):
    import wave
    import numpy as np
    from faster_whisper import WhisperModel
    w = wave.open(str(wav))
    a = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    m = WhisperModel(modelo, device='cpu', compute_type='int8')
    palabras, desde = [], 0.0
    while True:  # igual que preparar.transcribir: si se come el final, sigue desde donde quedó
        segs, _ = m.transcribe(a[int(desde * 16000):], language='es', word_timestamps=True, initial_prompt=PISTA)
        nuevas = [[x.word.strip(), round(desde + x.start, 2), round(desde + x.end, 2)] for s in segs for x in s.words]
        palabras += [p for p in nuevas if not palabras or p[1] >= palabras[-1][2] - 0.05]
        fin = palabras[-1][2] if palabras else 0
        if not nuevas or len(a) / 16000 - fin < 2.5:
            return palabras
        desde = fin


def parecidas(x, y):
    """Misma palabra o casi («cambiando» / «cambiarlo»): los arranques en falso rara vez se repiten exacto."""
    return x == y or (min(len(x), len(y)) >= 4 and difflib.SequenceMatcher(None, x, y).ratio() >= 0.75)


def frases(palabras, pausa=0.45):
    """Agrupa palabras en frases separadas por pausas o por punto final (índices de inicio y fin, inclusivos)."""
    out, ini = [], 0
    for i in range(1, len(palabras) + 1):
        if i == len(palabras) or palabras[i][1] - palabras[i - 1][2] > pausa or re.search(r'[.?!…]$', palabras[i - 1][0]):
            out.append((ini, i - 1))
            ini = i
    return out


def detectar(palabras, duracion):
    n = [norm(p[0]) for p in palabras]
    cortes = []

    def cortar(i, j, tipo, motivo, hasta=None, activo=True):
        """Corta las palabras i..j (desde el inicio de i hasta `hasta` o el final de j)."""
        a = palabras[i][1]
        b = hasta if hasta is not None else palabras[j][2]
        cortes.append({'a': round(a, 2), 'b': round(b, 2), 'tipo': tipo, 'motivo': motivo, 'texto': ' '.join(p[0] for p in palabras[i:j + 1]), 'activo': activo})

    fs = frases(palabras)
    usado = set()
    # Tomas repetidas y arranques en falso: una frase que se parece al comienzo de otra que viene poco después.
    for k, (i, j) in enumerate(fs):
        a = [x for x in n[i:j + 1] if x]
        if not a or i in usado:
            continue
        for k2 in range(k + 1, min(k + 6, len(fs))):
            i2, j2 = fs[k2]
            if palabras[i2][1] - palabras[j][2] > 25:
                break
            b = [x for x in n[i2:j2 + 1] if x][: len(a) + 2]
            if len(a) <= 4:
                # Arranque en falso: las pocas palabras sueltas son el inicio de la frase siguiente.
                if k2 == k + 1 and len(b) > len(a) and all(parecidas(x, y) for x, y in zip(a, b)):
                    cortar(i, j, 'arranque en falso', f'vuelve a empezar: «{" ".join(p[0] for p in palabras[i2:i2 + len(a) + 2])}…»', hasta=palabras[i2][1] - 0.05)
                    usado.update(range(i, j + 1))
                break
            r = difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()
            if r >= 0.6:
                cortar(i, j, 'toma repetida', f'se repite a los {palabras[i2][1]:.1f} s ({round(r * 100)} % igual); queda la última', hasta=palabras[i2][1] - 0.05)
                usado.update(range(i, j + 1))
                break

    # Tartamudeo y reinicios dentro de una frase: el mismo grupo de palabras dos veces seguidas («el el»,
    # «vamos a vamos a») o casi igual tras 1–2 palabras («Cambiando cuando dice, cambiarlo cuando dice…»).
    i = 0
    while i < len(n):
        hallado = False
        for m in (4, 3, 2, 1):
            for salto in ((0, 1, 2) if m >= 3 else (0,)):
                k = i + m + salto
                if k + m > len(n) or not all(n[i:k + m]) or usado & set(range(i, k + m)):
                    continue
                exacto = n[i:i + m] == n[k:k + m]
                if not (exacto or (m >= 2 and all(parecidas(x, y) for x, y in zip(n[i:i + m], n[k:k + m])))):
                    continue
                if m == 1 and len(n[i]) > 3:  # «muy muy», «nunca nunca»: suele ser énfasis
                    continue
                tipo = 'repetición' if exacto and not salto else 'arranque en falso'
                cortar(i, k - 1, tipo, f'vuelve a decir «{" ".join(p[0] for p in palabras[k:k + m])}»', hasta=palabras[k][1] - 0.02)
                usado.update(range(i, k))
                i, hallado = k, True
                break
            if hallado:
                break
        if not hallado:
            i += 1

    # Muletillas.
    for i, p in enumerate(palabras):
        if i in usado:
            continue
        antes = p[1] - palabras[i - 1][2] if i else 9
        despues = palabras[i + 1][1] - p[2] if i + 1 < len(palabras) else 9
        dos = n[i] + n[i + 1] if i + 1 < len(n) else ''
        if n[i] in MULETILLAS:
            cortar(i, i, 'muletilla', 'muletilla')
        elif dos == 'osea' and antes > 0.15 and (palabras[i + 1][2] if i + 1 < len(palabras) else 0) and (palabras[i + 2][1] - palabras[i + 1][2] if i + 2 < len(palabras) else 9) > 0.15:
            cortar(i, i + 1, 'muletilla', '«o sea» suelto', activo=False)
        elif n[i] in AISLADAS and antes > 0.2 and despues > 0.2:
            cortar(i, i, 'muletilla', f'«{p[0]}» suelto entre pausas', activo=False)

    # Palabras estiradas: duran mucho más de lo que se tarda en decirlas → hay algo pegado al inicio.
    for i, p in enumerate(palabras):
        if i in usado or not n[i]:
            continue
        esperado = 0.12 + 0.075 * len(n[i])
        dur = p[2] - p[1]
        if dur > esperado + 0.7 and dur > 1.6 * esperado:
            b = round(p[2] - esperado - 0.08, 2)
            cortes.append({'a': p[1], 'b': b, 'tipo': 'palabra estirada', 'motivo': f'«{p[0]}» dura {dur:.1f} s: se recorta el sonido de antes', 'texto': p[0], 'activo': True})

    cortes.sort(key=lambda c: c['a'])
    # Tomas repetidas pegadas (la 1.ª y la 2.ª de tres) quedan como un solo corte.
    juntos = []
    for c in cortes:
        u = juntos[-1] if juntos else None
        if u and u['tipo'] == c['tipo'] == 'toma repetida' and c['a'] - u['b'] < 0.2:
            u['b'], u['texto'], u['motivo'] = c['b'], u['texto'] + ' ' + c['texto'], c['motivo']
        else:
            juntos.append(c)
    cortes = juntos
    for k, c in enumerate(cortes):
        c['id'] = k + 1
        c['b'] = min(c['b'], duracion)
    return cortes


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('video')
    ap.add_argument('--slug', required=True)
    ap.add_argument('--modelo', default='small')
    ap.add_argument('--retranscribir', action='store_true', help='transcribe de nuevo pidiéndole a whisper que escriba las muletillas')
    o = ap.parse_args()
    from preparar import duracion, wav16

    v = Path(o.video).expanduser().resolve()
    datos = Path('tutoriales') / o.slug
    datos.mkdir(parents=True, exist_ok=True)
    crudo = datos / 'transcripcion-original.json'
    previa = json.loads(crudo.read_text()) if crudo.exists() else None
    if previa and Path(previa['video']).expanduser().resolve() == v and not o.retranscribir:
        palabras = previa['palabras']
        print('· uso la transcripción que ya estaba', flush=True)
    else:
        print(f'· transcribiendo {v.name} (con muletillas)…', flush=True)
        tmp = Path(tempfile.mkdtemp(prefix='limpiar-'))
        wav16(v, tmp / 'a.wav')
        palabras = transcribir_con_muletillas(tmp / 'a.wav', o.modelo)
        crudo.write_text(json.dumps({'video': str(v), 'palabras': palabras, 'muletillas': True}, ensure_ascii=False))

    total = duracion(v)
    cortes = detectar(palabras, total)
    activos = [c for c in cortes if c['activo']]
    quita = sum(c['b'] - c['a'] for c in activos)
    (datos / 'propuesta.json').write_text(json.dumps({'video': str(v), 'slug': o.slug, 'duracion': round(total, 2), 'cortes': cortes}, ensure_ascii=False, indent=1))
    for c in cortes:
        print(f"{'✓' if c['activo'] else '·'} [{c['a']:7.2f}-{c['b']:7.2f}] {c['tipo']:17} «{c['texto'][:60]}» — {c['motivo']}")
    print(f'✓ {len(cortes)} cortes propuestos ({len(activos)} activos, quitan {quita:.1f} s de {total:.1f} s) → {datos}/propuesta.json')


if __name__ == '__main__':
    main()
