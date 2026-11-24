#!/usr/bin/env python3
"""Voz en off LOCAL y gratis con Kokoro-82M (ONNX): corre en tu GPU NVIDIA o en la CPU, sin internet y sin cuentas.
Licencias: modelo Kokoro-82M Apache-2.0 y kokoro-onnx MIT → podés usar el audio en videos comerciales.

Entrada: un JSON {"voz": "em_alex", "lang": "es", "velocidad": 1.0, "frases": {"l1": "Texto…", "l2": "…"}}
Salida:  <carpeta>/<clave>.mp3 (-16 LUFS, listo para Clipmill) + duraciones.json {clave: segundos}

Instalar (una vez):
  python3 -m venv ~/.cache/clipmill-voz && ~/.cache/clipmill-voz/bin/pip install kokoro-onnx soundfile onnxruntime
  # con GPU NVIDIA, en vez de onnxruntime:  "onnxruntime-gpu[cuda,cudnn]"
  mkdir -p ~/.cache/clipmill-voz/modelo && cd ~/.cache/clipmill-voz/modelo
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
También hace falta ffmpeg (el mismo que usa el render).

Voces en español: em_alex, em_santa (hombres), ef_dora (mujer) → "lang": "es".
Inglés: am_michael, am_fenrir, af_heart ("en-us") · bm_george, bm_lewis, bf_emma ("en-gb").

Uso (desde la carpeta de tu proyecto):
  ~/.cache/clipmill-voz/bin/python ../cli/voz-local.py frases.json public/voz/mi-video [--solo l1,l3]
"""
import argparse, json, os, subprocess, sys, tempfile, time

a = argparse.ArgumentParser(description='Voz en off local con Kokoro-82M')
a.add_argument('frases', help='JSON con voz, lang, velocidad y frases')
a.add_argument('salida', help='carpeta donde se guardan los mp3')
a.add_argument('--modelo', default=os.path.expanduser('~/.cache/clipmill-voz/modelo/kokoro-v1.0.onnx'))
a.add_argument('--voces', default=os.path.expanduser('~/.cache/clipmill-voz/modelo/voices-v1.0.bin'))
a.add_argument('--solo', default='', help='solo estas claves, separadas por coma')
o = a.parse_args()

for ruta in (o.modelo, o.voces):
    if not os.path.exists(ruta):
        sys.exit(f'Falta {ruta}: mirá «Instalar» al principio de este archivo.')

import onnxruntime as ort
try:
    ort.preload_dlls()  # con onnxruntime-gpu carga CUDA; si no hay GPU sigue en CPU
except Exception:
    pass
import soundfile as sf
from kokoro_onnx import Kokoro

cfg = json.load(open(o.frases, encoding='utf-8'))
voz = cfg.get('voz', 'em_alex')
vel = float(cfg.get('velocidad', 1.0))
lang = cfg.get('lang') or ('es' if voz[:1] == 'e' else 'en-gb' if voz[:1] == 'b' else 'en-us')
proveedores = [p for p in ('CUDAExecutionProvider', 'CPUExecutionProvider') if p in ort.get_available_providers()]
sesion = ort.InferenceSession(o.modelo, providers=proveedores)
kokoro = Kokoro.from_session(sesion, o.voces)
print(f'Kokoro en {sesion.get_providers()[0]} · voz {voz} · idioma {lang}', file=sys.stderr)

# Limpieza: quita graves que retumban, el silencio del final y normaliza a -16 LUFS (lineal, sin «bombeo»).
FILTRO = ('highpass=f=85,equalizer=f=170:t=o:w=1.2:g=-4,'
          'areverse,silenceremove=start_periods=1:start_threshold=-50dB,afade=t=in:d=0.04,areverse,'
          'loudnorm=I=-16:TP=-1.5:linear=true')
os.makedirs(o.salida, exist_ok=True)
ruta_dur = os.path.join(o.salida, 'duraciones.json')
duraciones = json.load(open(ruta_dur)) if os.path.exists(ruta_dur) else {}
solo = set(filter(None, o.solo.split(',')))
for clave, texto in cfg['frases'].items():
    if solo and clave not in solo:
        continue
    t0 = time.time()
    try:
        muestras, sr = kokoro.create(texto, voice=voz, speed=vel, lang=lang)
    except Exception as e:
        if 'CUDA' not in sesion.get_providers()[0]:
            raise
        print('GPU sin memoria, sigo en CPU:', str(e).splitlines()[-1][:120], file=sys.stderr)
        sesion = ort.InferenceSession(o.modelo, providers=['CPUExecutionProvider'])
        kokoro = Kokoro.from_session(sesion, o.voces)
        muestras, sr = kokoro.create(texto, voice=voz, speed=vel, lang=lang)
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        sf.write(f.name, muestras, sr)
        destino = os.path.join(o.salida, clave + '.mp3')
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', f.name, '-af', FILTRO, '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '160k', destino], check=True)
        os.unlink(f.name)
    duraciones[clave] = round(len(muestras) / sr, 2)
    print(f'{clave:<12} {duraciones[clave]:5.2f} s  ({time.time() - t0:.1f} s)  {texto}')
json.dump(duraciones, open(ruta_dur, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
