# Velocidad, cámara lenta suave y congelar cuadro

Para los **clips de video** de un guion, en ⏱ Editar tiempo (elegí el clip):

- **⏩ Velocidad**: 0.25× · 0.5× · 0.75× · 1× · 1.5× · 2× · 3× (`clips[i].velocidad`). La duración del clip en el video
  no cambia; cambia cuánto del video original muestra.
- **✨ Suave** (solo cámara lenta): genera los cuadros intermedios del tramo con `minterpolate` de ffmpeg (incluido, sin
  descargas), a los fps que hacen falta para que cada cuadro del video final sea nuevo (`max(fps fuente, fps
  composición) / velocidad`). Va a la cola (≈ 1–2 min por 4 s de 1080p), se guarda en `public/lento/` (enlace al disco
  externo) y al terminar **el servidor marca el clip** (`clips[i].lento`) aunque cierres el estudio. Si cambiás la
  velocidad o el inicio del clip, se vuelve a usar el original hasta que lo suavices de nuevo.
  Medido: 0.5× de una toma de 24 fps en un video de 30 fps → **37 de 90 cuadros repetidos** sin suave, **0** con suave.
- **❄ Congelar** (tecla **C**): en el cabezal parte el clip y mete **1.5 s** de ese cuadro quieto (`congelar: true`,
  duración ajustable arrastrando su borde). Entra y sale con corte seco, sin transición.

En código, cualquier `<Video velocidad={0.5}>` reproduce más lento, y `<Congelar frame={n}>` (de `fotograma`) fija
el cuadro de lo que tiene adentro.
