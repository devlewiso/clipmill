---
name: estilo-dennis-muren
description: |
  Integra elementos CG en imagen real de forma fotorrealista, con los principios de Dennis Muren (ILM):
  luz y color igualados, sombras de contacto, light wrap, motion blur, cámara en mano, grano igualado,
  física creíble. Usar cuando el usuario pida: estilo Dennis Muren o ILM clásico, meter un objeto/criatura
  3D en un video o foto, composición fotorrealista, VFX realista, integrar un render de Blender en una
  placa, efectos que "no se noten", creature FX, shadow catcher.
---

# Estilo Dennis Muren

> Inspirado en la filosofía de Dennis Muren (ILM): fotorrealismo al servicio de la historia.
> Obra **original**: no recrear criaturas ni planos de películas concretas.

**En Clipmill:** renderizar el clip a `ejemplo/public/motion-fx/<id>.mp4` y usarlo con `<Video>` (ver `motion-fx-core` § En Clipmill).

**Requiere** `motion-fx-core`.

## Filosofía
- **El público tiene que olvidar que es un efecto.** Si algo llama la atención como "CG", falla.
- **Observar la realidad**: referencias de cómo se comporta la luz, el peso y el movimiento. Antes de
  componer, analizar la placa: dirección y color de la luz, dureza de las sombras, nivel de grano, desenfoque.
- **Peso y física**: anticipación, inercia y contacto con el suelo. Un objeto sin peso no se cree.
- **Imperfección de cámara**: la cámara CG tiene que heredar los defectos de la cámara real.

## Checklist de integración (en este orden)
1. **Perspectiva/track**: el CG debe moverse con la placa. Con cámara fija basta con alinear el horizonte;
   con cámara en mano, aplicar el mismo `transform` a placa y CG (como en el demo) o hacer matchmove en Blender.
2. **Luz**: la dirección de la luz CG igual que la del sol/fuente de la placa. En Blender, usar una HDRI de la
   misma escena si existe (`world(hdri=...)`).
3. **Sombra de contacto**: oscura y nítida donde toca, difusa al separarse (en el demo, la elipse se aprieta).
4. **Color match**: media y desviación del CG hacia la placa (`color_match`), niveles de negro iguales.
5. **Light wrap**: el fondo sangra en los bordes del CG (máscara de borde × placa desenfocada).
6. **Desenfoque**: igual al de la placa a esa distancia; motion blur según la velocidad (`directional_blur`
   o `render(..., motion_blur=4)`; en Blender `motion_blur(True)`).
7. **Atmósfera**: la misma bruma o tinte por encima de todo (placa y CG).
8. **Lente y grano**: `finish()` aplicado a la composición final, nunca solo al CG.

## Pipeline con Blender (recomendado para objetos reales)
```python
# escena.py  →  blender -b --factory-startup -P escena.py -- --plate placa.mp4 --out comp.mp4 --preview
import sys, os; sys.path.insert(0, "skills/motion-fx-core/scripts")
from blender_kit import *
a = bk_args(); reset(a)
camera((0,-8,1.6),(0,0,1),35)
sol = light("SUN", (5,-5,8), 4, (1,.92,.8), size=2)          # misma dirección que la placa
plate_background(a.plate)                                     # film transparente + shadow catcher
obj = smooth(prim("sphere",(0,0,1),1)); assign(obj, mat("metal",(.6,.6,.6),1,.25))
key(obj,1,location=(-4,0,1)); key(obj,a.frames,location=(4,0,1)); ease_all(obj)
motion_blur(True)
render_mp4(a, plate=a.plate)
```
Después, post en mfx: leer el mp4 compuesto con ffmpeg a cuadros, o aplicar
`ffmpeg -vf "noise=alls=7:allf=t,vignette"` para igualar el grano.

## Demo 2D (plantilla de composición)
```bash
python3 skills/estilo-dennis-muren/scripts/demo.py --preview --out muren.mp4 \
  [--image placa.jpg --image elemento_rgba.png]
```
Sin imágenes usa una placa procedural (atardecer en llanura) y una esfera metálica sombreada que bota
con física, con sombra de contacto, color match, light wrap, motion blur, bruma, cámara en mano y grano.

## Revisión
- Comparar en la hoja de contactos: ¿los negros del CG coinciden con los de la placa?
- Extraer un cuadro a tamaño completo y mirar los bordes del CG (`ffmpeg -ss 2 -i x.mp4 -frames:v 1 f.png`).
