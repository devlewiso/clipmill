#!/usr/bin/env python3
"""Prepara una toma a cámara para la plantilla «Tutorial Viral» (un solo clip continuo, sin silencios ni bloopers).

  1. Transcribe con faster-whisper (tiempos por palabra).
  2. Quita los tramos de --quitar (bloopers, tomas repetidas, muletillas: segundos de la toma original).
  3. Jump-cut en cada pausa > --pausa s: quedan solo las frases, con un poquito de aire.
  4. Color (--look) + audio pro (-14 LUFS) y un solo clip: public/tutoriales/<slug>/clip.mp4 (1080×1920, 30 fps).
  5. tutoriales/<slug>/palabras.json con tiempos en el clip NUEVO + dónde cae cada jump-cut (para alternar zoom).
Si existe tutoriales/<slug>/texto.txt (lo que se dijo, bien escrito), corrige la ortografía de whisper con él.

Uso (desde ejemplo/):
  python3 ../skills/editor-videos/scripts/tutorial.py \
      ~/Desktop/uploads/toma.mp4 --slug 5-errores-moto --look noche --quitar 59.6-62.1 64.7-67.15 73.7-84.95
Primero corré con --solo-transcribir para ver la transcripción con tiempos y decidir qué quitar.
"""
import argparse, json, subprocess, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from preparar import LOOKS, LUFS, NIVELES_RUIDO, audio_pro, corregir, duracion, filtro_ruido, lufs, transcribir, wav16  # noqa: E402


def sh(*args):
    r = subprocess.run(args, text=True, capture_output=True)
    if r.returncode: sys.exit(r.stderr[-2000:])
    return r


def audio_original(entrada, carpeta, ruido='no'):
    """Respeta el audio tal cual (ya mejorado): solo volumen a -14 LUFS con limitador (y RNNoise si se pide)."""
    crudo, final = carpeta / 'voz1.wav', carpeta / 'voz.wav'
    limpiar = filtro_ruido(ruido).rstrip(',') if ruido in ('normal', 'fuerte') else 'anull'
    sh('ffmpeg', '-v', 'error', '-y', '-i', str(entrada), '-vn', '-af', limpiar, '-ar', '48000', '-c:a', 'pcm_s24le', str(crudo))
    ganancia = LUFS - lufs(crudo)
    sh('ffmpeg', '-v', 'error', '-y', '-i', str(crudo), '-af', f'volume={ganancia:.2f}dB,alimiter=limit=0.84:attack=2:release=50:level=false', '-c:a', 'pcm_s24le', str(final))
    return final


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('video')
    ap.add_argument('--slug', required=True)
    ap.add_argument('--look', choices=[*LOOKS, 'ninguno'], default='natural', help='ninguno = sin color (la toma va a otro proceso, p. ej. el Noticiero)')
    ap.add_argument('--quitar', nargs='*', default=[], help='tramos a-b (segundos de la toma original)')
    ap.add_argument('--ruido', choices=NIVELES_RUIDO, default='suave', help='reducción de ruido de la voz (normal/fuerte = RNNoise)')
    ap.add_argument('--lut', help='LUT .cube de color (cámara, Premiere, DaVinci o public/luts/) que se aplica después del look')
    ap.add_argument('--salida', help='archivo de salida (por defecto public/tutoriales/<slug>/clip.mp4)')
    ap.add_argument('--propuesta', action='store_true', help='suma los cortes activos de tutoriales/<slug>/propuesta.json (limpiar.py / pestaña Limpiar)')
    ap.add_argument('--pausa', type=float, default=0.3, help='pausas más largas que esto se cortan')
    ap.add_argument('--modelo', default='small')
    ap.add_argument('--audio', choices=['pro', 'original'], default='pro',
                    help='original = el audio ya viene mejorado (p. ej. por el usuario): solo se lleva a -14 LUFS')
    ap.add_argument('--solo-transcribir', action='store_true')
    o = ap.parse_args()

    v = Path(o.video).expanduser()
    datos, clips = Path('tutoriales') / o.slug, Path('public') / 'tutoriales' / o.slug
    datos.mkdir(parents=True, exist_ok=True)
    clips.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix='tutorial-'))

    crudo = datos / 'transcripcion-original.json'
    if crudo.exists() and json.loads(crudo.read_text()).get('video') == str(v):
        palabras = json.loads(crudo.read_text())['palabras']
    else:
        print(f'· transcribiendo {v.name}…', flush=True)
        wav16(v, tmp / 'a.wav')
        palabras = transcribir(tmp / 'a.wav', o.modelo)
        crudo.write_text(json.dumps({'video': str(v), 'palabras': palabras}, ensure_ascii=False))
    if o.solo_transcribir:
        linea, ini = [], 0
        for i, p in enumerate(palabras):
            if linea and p[1] - palabras[i - 1][2] > 0.6:
                print(f'[{ini:6.2f}-{palabras[i - 1][2]:6.2f}] ' + ' '.join(linea)); linea = []
            if not linea: ini = p[1]
            linea.append(p[0])
        print(f'[{ini:6.2f}-{palabras[-1][2]:6.2f}] ' + ' '.join(linea))
        return

    quitar = [tuple(map(float, q.split('-'))) for q in o.quitar]
    movidos = []  # bloques [a, b] que van después de la palabra que empieza en `despues` (edición por texto)
    if o.propuesta:
        prop = json.loads((datos / 'propuesta.json').read_text())
        quitar += [(c['a'], c['b']) for c in prop['cortes'] if c['activo']]
        movidos = prop.get('movidos', [])
        print(f"· propuesta: {sum(c['activo'] for c in prop['cortes'])} cortes activos, {len(movidos)} bloques movidos", flush=True)
    # Se quita la palabra si el corte tapa su mitad Y su final; si solo tapa el inicio (palabra estirada), se recorta abajo.
    dentro = lambda p: any(a <= (p[1] + p[2]) / 2 <= b and p[2] <= b + 0.05 for a, b in quitar)
    quedan = [list(p) for p in palabras if not dentro(p)]
    # Un corte que toma solo una parte de la palabra (p. ej. el «eeeh» pegado al inicio) la recorta.
    for p in quedan:
        for a, b in quitar:
            if a <= p[1] < b < p[2]: p[1] = b
            if p[1] < a < p[2] <= b: p[2] = a
    texto = datos / 'texto.txt'
    if texto.exists():
        quedan, avisos = corregir(quedan, [texto.read_text()])
        for a in avisos: print('⚠ ' + a)

    # Bloque movido al que pertenece cada palabra (por su mitad) y clave de orden: su tiempo, o el de la palabra
    # después de la que se pegó el bloque (+ un poquito, respetando el orden interno del bloque).
    bloque = lambda p: next((k for k, m in enumerate(movidos) if m['a'] <= (p[1] + p[2]) / 2 <= m['b']), -1)
    clave = lambda p: (lambda k: p[1] if k < 0 else movidos[k]['despues'] + 0.001 + (p[1] - movidos[k]['a']) * 1e-5)(bloque(p))

    # Tramos: palabras seguidas (pausa corta, sin un tramo quitado en medio y del mismo bloque) van juntas.
    tramos = []
    for p in quedan:
        corta = tramos and p[1] - tramos[-1]['fin'] <= o.pausa and not any(tramos[-1]['fin'] <= a < p[1] for a, _ in quitar) and bloque(p) == bloque(tramos[-1]['p'][-1])
        if corta: tramos[-1]['fin'] = p[2]; tramos[-1]['p'].append(p)
        else: tramos.append({'ini': p[1], 'fin': p[2], 'p': [p]})
    total = duracion(v)
    for i, t in enumerate(tramos):
        antes = tramos[i - 1]['fin'] if i else 0
        despues = tramos[i + 1]['ini'] if i + 1 < len(tramos) else total
        t['a'] = max(antes + 0.02, t['ini'] - 0.1, 0)
        t['b'] = min(despues - 0.02, t['fin'] + 0.14, total)
    if movidos:  # el aire de cada tramo se calcula con sus vecinos reales; después se reordena
        tramos.sort(key=lambda t: clave(t['p'][0]))

    print(f'· {len(tramos)} tramos, audio {o.audio}…', flush=True)
    voz = audio_pro(v, tmp, o.ruido) if o.audio == 'pro' else audio_original(v, tmp, o.ruido)
    vf, n = LOOKS.get(o.look, 'null'), len(tramos)
    if o.lut:
        lut = Path(o.lut).expanduser().resolve()
        if not lut.exists(): sys.exit(f'No existe la LUT {lut}')
        vf += f",lut3d=file='{lut}':interp=tetrahedral"
    filtros = ['[0:v]split=%d%s' % (n, ''.join(f'[s{i}]' for i in range(n))), '[1:a]asplit=%d%s' % (n, ''.join(f'[r{i}]' for i in range(n)))]
    for i, t in enumerate(tramos):
        d = t['b'] - t['a']
        filtros.append(f"[s{i}]trim={t['a']:.3f}:{t['b']:.3f},setpts=PTS-STARTPTS,fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v{i}]")
        filtros.append(f"[r{i}]atrim={t['a']:.3f}:{t['b']:.3f},asetpts=PTS-STARTPTS,afade=t=in:d=0.015,afade=t=out:st={max(0, d - 0.025):.3f}:d=0.025[a{i}]")
    filtros.append(''.join(f'[v{i}][a{i}]' for i in range(n)) + f'concat=n={n}:v=1:a=1[vc][ac]')
    filtros.append(f'[vc]{vf}[vo]')
    (tmp / 'f.txt').write_text(';\n'.join(filtros))
    destino = Path(o.salida).expanduser() if o.salida else clips / 'clip.mp4'
    destino.parent.mkdir(parents=True, exist_ok=True)
    sh('ffmpeg', '-v', 'error', '-y', '-i', str(v), '-i', str(voz), '-/filter_complex', str(tmp / 'f.txt'), '-map', '[vo]', '-map', '[ac]',
       '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', str(destino))

    nuevas, cortes, t0 = [], [], 0.0
    for t in tramos:
        cortes.append(round(t0, 3))
        nuevas += [[p[0], round(p[1] - t['a'] + t0, 2), round(p[2] - t['a'] + t0, 2)] for p in t['p']]
        t0 += t['b'] - t['a']
    dur = duracion(destino)
    (datos / 'palabras.json').write_text(json.dumps({'look': o.look, 'duracion': round(dur, 3), 'cortes': cortes, 'palabras': nuevas}, ensure_ascii=False))
    print(f'✓ {destino} ({dur:.1f} s, antes {total:.1f} s) y {datos}/palabras.json. Ahora escribí {datos}/plan.json.')


if __name__ == '__main__':
    main()
