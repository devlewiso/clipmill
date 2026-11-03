---
name: estilo-john-knoll
description: |
  Crea VFX espaciales y secuencias de acción compuestas por capas, inspiradas en John Knoll (ILM):
  nebulosas, campos de estrellas con parallax, planetas con atmósfera, naves, láseres, explosiones con
  onda de choque, salto a velocidad luz, previs y composición multicapa. Usar cuando el usuario pida:
  estilo John Knoll/ILM, batalla espacial, escena de naves, hiperespacio, intro espacial, explosión en el
  espacio, composición por capas (matte painting + elementos), previs de una secuencia de acción.
---

# Estilo John Knoll

> Inspirado en el enfoque de John Knoll (supervisor de VFX en ILM y cocreador de Photoshop).
> Obra **original**: no usar naves, logos ni diseños de franquicias (Star Wars, Star Trek…).

**En Clipmill:** renderizar el clip a `ejemplo/public/motion-fx/<id>.mp4` y usarlo con `<Video>` (ver `motion-fx-core` § En Clipmill).

**Requiere** `motion-fx-core`.

## Filosofía
- **Composición por capas**: cada plano se construye como pila de elementos independientes (fondo
  pintado, planeta, naves, efectos, atmósfera, lente). Cada capa se puede ajustar sin re-renderizar el resto.
- **Previs primero**: bloquear la acción con formas simples y cámara antes de añadir detalle. El demo es en
  sí un previs mejorado.
- **Lenguaje de cámara real**: aunque sea espacio, la cámara se comporta como una cámara física (operador
  que sigue la acción, lentes largas, flare de una fuente fuera de cuadro).
- La herramienta al servicio de la idea: elegir la técnica más simple que venda el plano.

## Pila de capas estándar (de atrás hacia delante)
1. Nebulosa / matte painting (casi estática).
2. Estrellas en 3 profundidades (parallax ∝ profundidad).
3. Planeta / estructuras grandes con rim de atmósfera.
4. Naves (silueta + luces de motor), láseres, escombros.
5. Explosiones: núcleo, onda de choque circular, chispas, flash global.
6. Lente: glow, flare de una fuente fuera de cuadro, letterbox 2.39, grano, CA.

## Recetas técnicas (mfx)
- **Nebulosa**: dos `smoke()` con escalas distintas teñidos en púrpura/azul, sumados.
- **Estrellas con parallax**: arrays `(x, y, brillo)` por capa; `x` desplazado por `cam * velocidad_capa`.
- **Salto a velocidad luz**: estirar cada estrella con `line` hacia fuera desde el centro (k ∝ profundidad)
  + `radial_blur` + `flash` blanco.
- **Láser**: `line` corta y gruesa, que viaja entre dos puntos; el `glow` hace el resto.
- **Explosión**: `circle` brillante que se apaga con (1−k)², anillo `outline` que se expande, escombros
  con vectores normales aleatorios; flash de 1–3 cuadros.
- **Naves 3D**: modelarlas en Blender con primitivas (`prim`, `smooth`) + `emissive` en motores; renderizar
  con fondo transparente y componer sobre las capas 1–3 en mfx.
- **Diseño original**: formas de cuña/aguja/anillo; evitar siluetas reconocibles.

## Demo
```bash
python3 skills/estilo-john-knoll/scripts/demo.py --preview --out knoll.mp4 --text "FRONTERA OSCURA"
```
Beats (9 s): nebulosa y planeta → persecución con láseres → disparo del héroe y explosión → salto a
velocidad luz → título.

## Checklist
- ¿Cada capa se lee por separado? ¿Las de atrás se mueven menos que las de delante?
- ¿Hay una única fuente de luz coherente (flare y rim de la misma dirección)?
- ¿Las explosiones iluminan la escena (flash global) aunque sea un instante?
