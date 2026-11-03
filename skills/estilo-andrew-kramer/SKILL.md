---
name: estilo-andrew-kramer
description: |
  Crea títulos de trailer y VFX de "estudio en casa" inspirados en Andrew Kramer (Video Copilot): texto
  metálico/cromado, rayos volumétricos, lens flares anamórficos, partículas de polvo, impactos con flash
  y sacudida, energía, sci-fi. Usar cuando el usuario pida: estilo Video Copilot o Andrew Kramer, título
  de trailer épico, intro cinematográfica con flare, texto 3D cromado, logo reveal, efectos de acción
  (explosión, láser, holograma, energía), intro para YouTube "de película".
---

# Estilo Andrew Kramer

> Inspirado en el enfoque didáctico y "hazlo tú mismo" de Andrew Kramer. Obra **original**: no copiar
> presets, proyectos de tutoriales ni logos de películas.

**En Clipmill:** renderizar el clip a `ejemplo/public/motion-fx/<id>.mp4` y usarlo con `<Video>` (ver `motion-fx-core` § En Clipmill).

**Requiere** `motion-fx-core`.

## Filosofía
- **El VFX de Hollywood es una suma de trucos sencillos bien compuestos**: capas de luz, polvo,
  flare, grano, sombra. Cada capa por separado es simple; juntas venden la toma.
- **La luz manda**: todo título se "enciende" (rayos, especulares que barren, flare).
- **Impacto = audio + flash + sacudida + blur radial**, sincronizados en el mismo cuadro.
- Siempre con **profundidad**: partículas delante y detrás, desenfoque, parallax.

## Lenguaje visual
| Elemento | Regla |
|---|---|
| Paleta | Azul acero / teal en sombras, blanco cálido en altas luces (teal & orange suave) |
| Tipografía | Sans bold ancha o display con bisel; cromado (gradiente con horizonte reflejado) |
| Luz | Rayos volumétricos desde el título, flare anamórfico horizontal, glow en altas luces |
| Atmósfera | Humo tenue de fondo, polvo en 2–3 capas de profundidad |
| Movimiento | Push-in constante, golpes con `ease_out_expo`, cámara que vibra al impacto |
| Formato | Letterbox 2.39:1, grano fino, CA 2 px |

## Recetas técnicas
- **Cromado 2D**: `chrome_fill(mask, t, sweep)` del demo: gradiente vertical con "horizonte" oscuro,
  banda especular diagonal que barre y borde brillante (máscara menos su blur).
- **Rayos volumétricos**: `light_rays(x, centro, length, strength)` aplicado después de poner el texto.
- **Flare**: `lens_flare(x, (fx, fy), intensidad)`; moverlo de lado a lado con `ease_in_out_cubic`.
- **Impacto**: `flash` exponencial + `transform` con `wiggle` de alta frecuencia + `radial_blur` decreciente.
- **Polvo**: puntos con profundidad `z` (tamaño, opacidad y velocidad ∝ z).
- **Texto 3D de verdad**: Blender: `text3d()` + `mat(metallic=1, rough=.15)` + `three_point()` + `fog()`
  para volumetría real; después glow/flare/grano en mfx. Ver `motion-fx-core/SKILL.md` § Blender.
- **Efectos de acción** (sobre video del usuario): muzzle flash = `circle` brillante 2 cuadros + `glow`
  + `flash` local; láser = `line` + `glow`; holograma = `tint` cian + `scanlines` + `flicker` + `rgb_split_glitch`.

## Demo
```bash
python3 skills/estilo-andrew-kramer/scripts/demo.py --preview --out kramer.mp4 \
  --text "HORIZONTE" --sub "PROXIMAMENTE"
```
Beats (7 s): humo y polvo → impacto (flash, sacudida, blur radial) → el título cromado aparece con rayos
→ barrido especular + flare → subtítulo → fade.

## Checklist
- ¿El impacto cae en un solo cuadro con flash, sacudida y blur a la vez?
- ¿Hay al menos 3 capas de profundidad? ¿Algo brilla en cada cuadro?
- Sin abusar: un flare principal, no cinco.
