# Reencuadrar: otro formato siguiendo la cara

Como «auto reframe» de CapCut: pasa un video a **9:16, 4:5, 1:1 o 16:9** recortándolo de manera que la persona quede
siempre en cuadro. Sirve para sacar Reels de un video horizontal, de un en vivo o de una toma donde no quedaste
centrado. Todo corre en tu PC (CPU), sin APIs ni costo.

Código: [`skills/editor-videos/scripts/reencuadrar.py`](../skills/editor-videos/scripts/reencuadrar.py).

## Uso en el estudio

**✂ Limpiar → 📐 Reencuadrar** (lateral): elegí un video de `uploads/`, el formato y el zoom (1× = el recorte más
grande posible; 1.15–1.5× acerca) y tocá **📐 Reencuadrar**. Va a la [cola](cola-y-retake.md) y el resultado queda en
`out/<nombre>-<formato>-<fecha>.mp4`. El original no se toca.

## Línea de comandos

```bash
PY=python3   # o el Python de un venv con faster-whisper y onnxruntime
$PY skills/editor-videos/scripts/reencuadrar.py entrada.mp4 salida.mp4 --formato 9:16 [--zoom 1.2] [--muestras 5] [--zona 0.12] [--sin-cara-seg 2]
```

Deja además `salida.reencuadre.json` con la cara elegida en cada muestra (para revisar qué siguió).

## Cómo funciona

1. **Detección:** YuNet ([opencv_zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet), MIT)
   con onnxruntime (MIT), 5 cuadros por segundo. ~10 s para 30 s de video 1080p.
2. **Cara principal:** la más grande, pero sigue a la misma persona mientras esté cerca (no salta entre dos por un
   cuadro). Solo cuentan las caras que se ven **seguidas 0.8 s en el mismo lugar**: así una llanta o un reflejo que
   «parece» cara un instante no mueve la cámara.
3. **Camarógrafo:** zona muerta (no se mueve por gestos chicos), resorte con velocidad máxima (~0.9 recortes por
   segundo) y suavizado sin desfase. Si la cara salta de golpe y se queda ahí (cambio de plano), **corta** en vez de
   hacer un paneo. La cara queda un poco arriba del centro, como en una toma normal.
4. **Sin cara** más de 2 s (pantallas, b-roll): la cámara vuelve suave al centro.
5. **Recorte:** ffmpeg con `crop` que se mueve cuadro a cuadro (`sendcmd`), escala lanczos al tamaño final
   (9:16 → 1080×1920), audio copiado. Respeta la rotación de los videos del celular.

## Modelo

`~/.cache/clipmill/face_detection_yunet_2023mar.onnx` (232 KB, MIT; sha256 `8f2383e4…52fa4`), o la ruta en
`FOTOGRAMA_YUNET`. Si falta, el script avisa de dónde bajarlo.
