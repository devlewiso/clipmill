# Voz en off local (gratis)

Clipmill puede narrar tus videos con **Kokoro-82M**, una voz que corre en tu propia computadora (GPU NVIDIA o CPU), sin internet, sin cuentas y sin pagar por carácter.

- **Licencias:** el modelo Kokoro-82M es Apache-2.0 y `kokoro-onnx` es MIT. Podés usar el audio en videos comerciales.
- **Velocidad:** en una GPU modesta (RTX 2060) cada frase tarda menos de medio segundo. En CPU también va rápido.
- **Idiomas:** español (`em_alex`, `em_santa`, `ef_dora`), inglés de EE. UU. y británico, y otros.

## Instalar (una vez)

```bash
python3 -m venv ~/.cache/clipmill-voz
~/.cache/clipmill-voz/bin/pip install kokoro-onnx soundfile onnxruntime   # con GPU: "onnxruntime-gpu[cuda,cudnn]"
mkdir -p ~/.cache/clipmill-voz/modelo && cd ~/.cache/clipmill-voz/modelo
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

## Usar

1. Escribí las frases en un JSON (una clave por frase):
   ```json
   { "voz": "em_alex", "lang": "es", "velocidad": 0.95,
     "frases": { "l1": "Guatemala. Una ciudad que nunca duerme.", "l2": "Y un programador que tampoco." } }
   ```
2. Generá los audios desde la carpeta de tu proyecto:
   ```bash
   ~/.cache/clipmill-voz/bin/python ../cli/voz-local.py frases.json public/voz/mi-video
   ```
3. En tu composición: `<Audio src="/voz/mi-video/l1.mp3" grupo="voz" />`. Con `bajarCon="voz"` en la música y los clips, todo baja solo cuando habla ([bajar-musica.md](bajar-musica.md)).

`duraciones.json` queda al lado, con lo que dura cada frase, para acomodar los tiempos. Para rehacer una sola frase: `--solo l2`.
