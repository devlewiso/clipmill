---
name: estilo-paul-franklin
description: |
  Crea VFX científicos y "en cámara" inspirados en Paul Franklin (DNEG): agujeros negros con lente
  gravitacional, fenómenos físicos plausibles, cámara sobria tipo IMAX, efectos que parecen fotografiados,
  realidades que se pliegan. Usar cuando el usuario pida: estilo Paul Franklin, DNEG o Interstellar/Inception,
  agujero negro, agujero de gusano, VFX científico realista, espacio "hard sci-fi", ciudad que se dobla,
  visualización física cinematográfica.
---

# Estilo Paul Franklin

> Inspirado en los principios de Paul Franklin (DNEG). Obra **original**: no recrear planos de
> *Interstellar* o *Inception*; la física es de todos, el diseño de cada plano es nuestro.

**En Clipmill:** renderizar el clip a `ejemplo/public/motion-fx/<id>.mp4` y usarlo con `<Video>` (ver `motion-fx-core` § En Clipmill).

**Requiere** `motion-fx-core`.

## Filosofía
- **La física como directora de arte**: partir de ecuaciones reales (lente gravitacional, Doppler,
  rotación kepleriana) y dejar que la imagen emerja de ellas. Lo inesperado de la física es más bello que lo inventado.
- **"Fotografiado, no generado"**: la cámara se comporta como una cámara IMAX montada en una nave real:
  pocos movimientos, lentes largas, exposición que no siempre favorece al efecto.
- **Contención**: sin flares gratuitos ni grades estridentes. Grano fino de película grande, viñeta mínima.
- Efectos prácticos siempre que se pueda (proyección, miniaturas); el digital completa lo imposible.

## Lenguaje visual
| Elemento | Regla |
|---|---|
| Paleta | Neutra y real: negros profundos, blancos cálidos de plasma, estrellas ligeramente azuladas |
| Cámara | Deriva lenta, zoom de 10–25 % en 10 s, micro-vibración de `wiggle` a 0.1 Hz |
| Composición | Objeto central enorme o diminuto (escala extrema), mucho espacio negro |
| Tipografía | Sans regular, pequeña, tracking amplio, sin efectos |
| Acabado | `finish(grain_amt=4, vig=0.15, ca=0)` |

## Física en el demo (2D aproximado)
- **Lente**: el fondo se muestrea en `beta = r - thE²/r` (ecuación de lente puntual): las estrellas
  forman anillos de Einstein alrededor de la sombra.
- **Sombra** de radio `Rs` y **anillo de fotones** fino en `1.02·Rs`.
- **Disco de acreción**: textura en coordenadas polares con rotación kepleriana (ω ∝ r^-1.5); parte
  frontal como elipse muy achatada (inclinación), parte trasera "levantada" sobre y bajo la sombra.
- **Doppler beaming**: el lado que se acerca es más brillante (`doppler = 1 + 0.55 * -dx/rout`).
- Para un render físico real: escribir un ray-marcher de geodésicas de Schwarzschild en numpy (lento) u
  OSL/GLSL; mantener el mismo acabado.

## Otras recetas
- **Ciudad que se pliega**: en Blender, edificios con `prim("cube")` sobre un plano con modificador
  Simple Deform (Bend) animado; cámara a ras de calle.
- **Agujero de gusano**: esfera con material de refracción (`mat(transmission=1, ior=…)`) que muestra una HDRI
  distinta del entorno.
- **Tesseract/espacio imposible**: repetición de un módulo en rejilla 3D con `emissive` en líneas + `fog`.

## Demo
```bash
python3 skills/estilo-paul-franklin/scripts/demo.py --preview --out franklin.mp4 \
  --text "MAS ALLA DEL HORIZONTE"
```
Beats (10 s): fade in → agujero negro con disco que gira y estrellas lenteadas, acercamiento lento →
título pequeño → fade.

## Checklist
- ¿Hay algún elemento gratuito que no se justifique físicamente? Quitarlo.
- ¿El movimiento de cámara es mínimo y "pesado"?
- ¿Se ven el anillo de fotones y la asimetría Doppler en la hoja de contactos?
