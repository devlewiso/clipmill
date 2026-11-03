# Quitar el ruido de fondo de la voz

Como «reducir ruido» de CapCut: limpia calle, viento, tráfico o ventilador de una voz grabada, con **RNNoise** (una red
neuronal para voz que ffmpeg trae como `arnndn`). Local, sin costo.

| Nivel | Qué hace | Cuándo |
|---|---|---|
| `no` | Nada | Audio de estudio ya limpio |
| `suave` (por defecto) | `afftdn` (lo de siempre) | Ruido constante y bajo |
| `normal` | RNNoise al 85 % | Calle, ventilador: limpia sin que la voz suene procesada |
| `fuerte` | RNNoise al 100 % | Mucho ruido; puede afinar un poco la voz |

Medido en una toma de calle de noche (92 s, todo a -14 LUFS): el ruido en las 16 pausas baja de **-28.7 dB**
(`suave`) a **-38.1 dB** (`fuerte`). Sumarle `afftdn` antes o después de RNNoise no mejora (después, empeora). La
transcripción de la voz limpia es la misma que la original.

## Dónde se usa

- **Clipmill → ✂ Limpiar → Generar → Ruido de fondo.** **🎧 Comparar** genera 8 s desde donde está el video
  (antes y después) para escucharlo antes de generar el clip.
- **Scripts:** `tutorial.py … --ruido normal` y `preparar.py … --ruido fuerte` (Noticiero). Por defecto `suave`.
- **Composiciones:** `<Audio src="voz.mp3" limpiarRuido="normal" />` o `<Video src="toma.mp4" limpiarRuido="fuerte" />`:
  se aplica al mezclar en el render.

## Modelo

`~/.cache/clipmill/rnnoise-sh.rnnn` (297 KB, «somnolent-hogwash»: voz sobre ruido de grabación, de
[GregorR/rnnoise-models](https://github.com/GregorR/rnnoise-models), que declara los modelos sin copyright; sha256
`70bb6685…3fdec0`), o la ruta en `FOTOGRAMA_RNNOISE`. RNNoise trabaja en mono a 48 kHz (la cadena convierte sola).
