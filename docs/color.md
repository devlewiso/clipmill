# Color: looks por clip y LUTs

## Looks (videos de guion y composiciones)

Nueve looks: **natural, cine, cálido, frío, blanco y negro, vintage, noche, vibrante, dramático**, cada uno con
**intensidad** (0–1). Son filtros CSS + un tinte en «soft-light», así que se ven igual en el estudio y en el render.

- **Línea de tiempo** (⏱ Editar tiempo): elegí un clip → 🎨 look + intensidad · **a todos** lo pone en todos los clips
  (`colorClips` del guion). Cada clip con color muestra un punto en su barra.
- **En código:** `import { Color } from 'fotograma/color'` → `<Color look="cine" intensidad={0.8}>…</Color>`;
  `filtroColor(look, intensidad)` devuelve solo el `filter` CSS; `LOOKS` tiene la lista.
- Datos en el guion: `clips[i].color`, `clips[i].intensidadColor`, `colorClips`.

## LUTs `.cube` (tomas de cámara)

Para las tomas a cámara (Limpiar / Tutorial Viral) se aplica una LUT real con `lut3d` de ffmpeg, después del look:

- **Clipmill → ✂ Limpiar → Generar → LUT**: lista las de `public/luts/` (`.cube` o `.3dl`). Poné ahí las tuyas
  (cámara, Premiere, DaVinci) y aparecen solas.
- **CLI:** `tutorial.py … --lut public/luts/clipmill-teal-orange.cube`.
- Incluidas (propias, libres): `clipmill-teal-orange` (sombras verdosas, piel cálida), `clipmill-calido`,
  `clipmill-pelicula` (negros levantados, poco saturado). Se regeneran con `public/luts/generar-luts.py` (17³).
