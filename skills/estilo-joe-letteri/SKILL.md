---
name: estilo-joe-letteri
description: |
  Crea entornos épicos y criaturas digitales inspirados en Joe Letteri (Wētā FX): perspectiva atmosférica
  por capas, niebla volumétrica, escala colosal, rayos de sol, criaturas que emergen de la bruma, cámara
  de grúa lenta. Usar cuando el usuario pida: estilo Joe Letteri o Wētā, paisaje de fantasía épica,
  criatura gigante, entorno digital, establishing shot épico, montañas con niebla, escena de
  fantasía/mitología, matte painting animado (2.5D).
---

# Estilo Joe Letteri

> Inspirado en los principios de Joe Letteri (Wētā FX). Obra **original**: no recrear criaturas,
> personajes ni lugares de franquicias (Tierra Media, Pandora, Kong…).

**En Clipmill:** renderizar el clip a `ejemplo/public/motion-fx/<id>.mp4` y usarlo con `<Video>` (ver `motion-fx-core` § En Clipmill).

**Requiere** `motion-fx-core`.

## Filosofía
- **La escala se vende con el aire**: lo lejano pierde contraste y se acerca al color de la bruma.
  Sin perspectiva atmosférica no hay escala.
- **Personajes digitales con alma**: lo que importa es la actuación (mirada, respiración, peso). Un
  gesto pequeño (ojos que se encienden, un giro de cabeza) vale más que mucha acción.
- **Física de la luz**: dispersión en la niebla, subsurface en la piel, rebote del entorno.
- Revelar poco a poco: la criatura primero es silueta en la niebla, después forma, después detalle.

## Lenguaje visual
| Elemento | Regla |
|---|---|
| Paleta | Cielo frío arriba, horizonte cálido; bruma `#b9b4ac`; rocas cercanas casi negras con tinte azul |
| Composición | 5–7 capas de profundidad, horizonte bajo o alto (nunca en el centro), sujeto en el tercio |
| Luz | Sol bajo contraluz detrás de la bruma: `light_rays` y halo |
| Movimiento | Grúa lenta (subir o bajar) + paneo lateral; parallax ∝ cercanía; niebla a la deriva |
| Criatura | Silueta enorme entre capas medias, con el valor de la bruma de su profundidad |
| Formato | 2.39:1, grano fino |

## Recetas técnicas (mfx)
- **Perspectiva atmosférica**: `col = roca*(1-depth**0.6) + HAZE*depth**0.6` por capa (`depth` 1 = lejos).
- **Cordilleras**: `ridge()` con `wiggle` de 4 octavas; las cercanas más bajas y más rugosas.
- **Parallax 2.5D**: capas más anchas que el cuadro, desplazadas `ox = (LW-W)*cam*par`.
- **Bancos de niebla**: `smoke()` multiplicado por una banda gaussiana en y, entre capas concretas.
- **Criatura que emerge**: polígono de silueta entre capas, coloreado con su propia profundidad y animado
  en `y` con `ease_in_out_cubic`; detalle final = ojos emisivos.
- **Criaturas o rocas 3D reales**: Blender con `fog(density)`, luz SUN contraluz, `mat(sss=0.3)` para piel,
  y componer las capas en mfx.

## Demo
```bash
python3 skills/estilo-joe-letteri/scripts/demo.py --preview --out letteri.mp4 --text "EL GUARDIAN"
```
Beats (10 s): grúa sobre montañas en bruma → niebla a la deriva y rayos de sol → una silueta colosal se
alza entre las capas → se encienden sus ojos → título.

## Checklist
- ¿Cada capa más lejana es más clara y menos contrastada?
- ¿La criatura tiene el valor de su distancia (no negra pura si está lejos)?
- ¿Se percibe la escala (algo pequeño de referencia, si hace falta)?
