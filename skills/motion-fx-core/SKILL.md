---
name: motion-fx-core
description: |
  Motor base para crear videos de motion graphics, títulos animados y VFX desde código
  (Python + Pillow + numpy → ffmpeg, y Blender headless para 3D). Lo usan todas las skills
  "estilo-*" (Saul Bass, Kyle Cooper, Patrick Clair, Andrew Kramer, Ash Thorp, Erin Sarofsky, BUCK, GMUNK,
  Dennis Muren, John Knoll, Joe Letteri, Paul Franklin, Douglas Trumbull).
  Usar cuando el usuario pida: hacer un video animado, intro, títulos/créditos, lower thirds,
  kinetic typography, efectos (glow, lens flare, glitch, grano, aberración cromática, humo,
  doble exposición, god rays, slit-scan), render 3D con Blender, o revisar/acabar un video con ffmpeg.
---

# Motion FX Core

Pipeline para que Claude Code **genere videos completos desde código**, sin After Effects.

| Herramienta | Para qué | Velocidad |
|---|---|---|
| `scripts/mfx.py` (Pillow+numpy→ffmpeg) | 2D: tipografía, formas, FX de post, transiciones, ruido | ~6 fps a 960×540 |
| `scripts/blender_kit.py` (Blender 5 headless, Cycles) | 3D: texto extruido, materiales, luces, volumetría, integración CG | ~5 s/cuadro preview en CPU |
| `ffmpeg` | codificar, audio, concatenar, grade final, hojas de contacto | — |

Ruta: `skills/motion-fx-core/scripts/` (rutas relativas a la raíz del repo; copia en `~/.claude/skills/` y en Obsidian `00_System/Skills/Motion-FX/`).

## Flujo de trabajo obligatorio

1. **Brief en 1 mensaje**: duración, formato (16:9 / 9:16 / 2.39), texto, música (opcional), estilo/skill.
   Si el usuario no dice nada, elige defaults razonables y sigue.
2. **Storyboard en beats** (tabla tiempo → qué pasa → técnica). Ritmo: un beat cada 0.5–2 s.
3. **Escribir un script** en el directorio de trabajo (no dentro de la skill). Partir del `demo.py`
   de la skill de estilo correspondiente y modificarlo.
4. **Preview**: `python3 escena.py --preview --out prev.mp4` (960×540, rápido).
5. **Revisión visual** — nunca entregar sin mirar:
   ```bash
   python3 -c "import sys,os;sys.path.insert(0,'skills/motion-fx-core/scripts');import mfx;mfx.contact_sheet('prev.mp4','sheet.png',4,3)"
   ```
   Luego abrir `sheet.png` con la tool **Read** y corregir composición, legibilidad y timing.
   Para un instante exacto: `ffmpeg -ss 2.5 -i prev.mp4 -frames:v 1 f.png`.
6. **Render final** sin `--preview` (1920×1080, crf 18). Para 4K: `--w 3840 --h 2160`.
7. Entregar la ruta del .mp4 y una descripción breve de los beats.

## API de mfx (resumen)

```python
import sys, os; sys.path.insert(0, "skills/motion-fx-core/scripts")
from mfx import *

a = cli("mi escena", seconds=8, text="TITULO")      # --out --w --h --fps --seconds --text --sub --audio --preview
def frame(t, i, ctx):                               # t en segundos
    img = canvas(ctx, "#0e0e0e")                    # PIL RGB
    p = remap(t, 0.5, 1.5, ease=ease_out_expo)      # 0..1 animado
    draw_text(img, a.text, (ctx.w/2, ctx.h/2), ctx.h*.15, "#fff", tracking=ctx.w*.01*p, opacity=p)
    x = glow(img, 12, .7)                           # a partir de aquí arrays float HxWx3
    return finish(x, t)                             # CA + viñeta + grano
run(frame, a, motion_blur=1)                        # motion_blur=4 para desenfoque real (4× lento)
```

- **Tiempo**: `remap`, `keys(t,[(0,v0),(1,v1)])`, `stagger(t,i,start,step,dur)`, `wiggle`, `beat(t,bpm)`.
- **Easing**: `ease_out_expo` (golpes de título), `ease_in_out_cubic` (cámara), `ease_out_back` (rebote),
  `ease_out_elastic`, `smoothstep`, `linear`.
- **Dibujo** (sobre PIL): `canvas`, `layer`, `over`, `draw_text` (tracking, stroke, opacity), `text_mask`,
  `text_size`, `rect` (rotable), `poly`, `circle`, `arc`, `line`, `load`, `transform` (cámara 2D).
- **Ruido**: `value_noise`, `smoke` (tinta/humo animado).
- **Post FX** (array): `glow`, `blur`, `directional_blur`, `radial_blur`, `vignette`, `grain`, `chromatic`,
  `scanlines`, `letterbox`, `grade`, `tint`, `duotone`, `flicker`, `scratches`, `jitter_offset`,
  `rgb_split_glitch`, `lens_flare`, `light_rays`, `finish`.
- **Fusiones**: `screen`, `multiply`, `add`, `overlay`, `double_exposure`.
- **Transiciones** (p 0..1): `wipe`, `iris`, `crossfade`, `flash`.
- **Revisión**: `contact_sheet(video, png)`.

Fuentes: `font("Familia:bold")` usa fontconfig; acepta ruta .ttf/.otf. Instaladas: DejaVu, Free*,
C059/D050000L (serif clásica), JetBrainsMono NF. Si el estilo pide otra fuente (p. ej. Futura,
Helvetica, Bebas), descargar un equivalente libre de Google Fonts a `~/.local/share/fonts/` y `fc-cache -f`.

## Blender (3D)

```bash
blender -b --factory-startup -P escena.py -- --preview --out shot.mp4 --seconds 3
```
`blender_kit`: `bk_args`, `reset`, `world`, `fog`, `camera`, `look_at`, `track_to`, `empty`, `light`,
`three_point`, `mat`, `emissive`, `assign`, `text3d`, `system_font`, `prim`, `smooth`, `key`, `ease_all`,
`motion_blur`, `plate_background`, `render_mp4(a, plate=...)`.
- Cycles CPU es lento: planos cortos (2–5 s), `--samples 16–64`, denoise activo. Previsualizar 1 cuadro primero
  con `--seconds 0.05`.
- Pipeline híbrido recomendado: render 3D en Blender → post (glow, grano, flare, grade) con mfx leyendo
  cuadros, o con filtros ffmpeg.

## Recetas ffmpeg útiles

```bash
# Concatenar planos
printf "file '%s'\n" s1.mp4 s2.mp4 > l.txt && ffmpeg -f concat -safe 0 -i l.txt -c copy out.mp4
# Añadir música con fade out
ffmpeg -i v.mp4 -i m.mp3 -af "afade=t=out:st=7:d=1" -shortest -c:v copy -c:a aac out.mp4
# 9:16 desde 16:9 (crop central)
ffmpeg -i v.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920" out.mp4
# Grade de película rápido
ffmpeg -i v.mp4 -vf "eq=contrast=1.1:saturation=0.85,curves=preset=increase_contrast,noise=alls=8:allf=t" out.mp4
```

## En Clipmill (fotograma)

Estas skills producen **clips .mp4** con Python; Clipmill compone con React. Se unen así:

1. Renderizar el clip con la skill de estilo (desde la raíz del repo):
   `python3 skills/estilo-<artista>/scripts/demo.py --out ejemplo/public/motion-fx/<id>.mp4 --text "..."`
   (`--w 1080 --h 1920` para vertical; revisar los layouts del demo, están pensados en 16:9).
   `ejemplo/public/motion-fx/` es chica (clips de 1–10 MB); si crece, moverla al disco externo y enlazarla
   como las demás carpetas pesadas de `public/` (ver CLAUDE.md).
2. Usarlo en una composición como un plano más (el audio lo pone Clipmill):
   ```tsx
   <Secuencia desde={0} duracion={240} nombre="Titulo Trumbull">
     <Video src="/motion-fx/<id>.mp4" silenciado style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
   </Secuencia>
   ```
   Música y golpes desde `public/sonidos/` (`cine/golpe*.mp3`, `cine/whoosh*.mp3`, `dev-tutorial/musica-*.mp3`).
3. `npx fotograma revisar <id>` antes de encolar el render. Publicar: preguntar siempre.

**Cuándo usar qué:**
- Composición React nativa con estilo Cooper/Clair (texto editable desde el estudio) → `skills/motion-cine`.
- Reel de noticia con estilos glitch/neón/azul/editorial → `skills/reels-motion`.
- FX que React no hace bien (slit-scan, lente gravitacional, humo, doble exposición, glow/flare físico, integración CG,
  Blender 3D) o un estilo de la lista de artistas → estas skills, y el clip entra a Clipmill con `<Video>`.

## Ética de estilo

Las skills `estilo-*` destilan **principios y técnicas** de artistas reales para crear **obra original**.
No recrear secuencias concretas (p. ej. los títulos de *Se7en* o *Vertigo*), ni usar logos, marcas o
nombres de películas ajenas, ni presentar el resultado como obra del artista. Decir "inspirado en".
