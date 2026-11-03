# Scripts de edición de tomas a cámara

Los usa la cola del estudio (pestaña ✂ Limpiar y 📐 Reencuadrar):

- `limpiar.py`: transcribe con faster-whisper y propone cortes (muletillas, tomas repetidas, arranques en falso).
- `tutorial.py`: arma el clip limpio con jump-cuts, color y audio a -14 LUFS.
- `reencuadrar.py`: pasa un video a 9:16 / 4:5 / 1:1 / 16:9 siguiendo la cara (YuNet local).

Requisitos: `pip install faster-whisper onnxruntime opencv-python numpy` y `FOTOGRAMA_PY` apuntando a ese Python.
