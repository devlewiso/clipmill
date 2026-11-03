---
name: estilo-kyle-cooper
description: |
  Crea secuencias de títulos inspiradas en Kyle Cooper: tipografía rayada/escrita a mano, película sucia
  y nerviosa, cortes rápidos, flash frames, macro-texturas, doble impresión desalineada, atmósfera
  obsesiva y perturbadora. Usar cuando el usuario pida: estilo Kyle Cooper, títulos de thriller/horror,
  opening psicológico, créditos "grunge", tipografía rayada, intro tipo serial killer, look de película
  vieja dañada, títulos inquietantes o industriales.
---

# Estilo Kyle Cooper

> Inspirado en los principios de Kyle Cooper (Imaginary Forces, Prologue). Obra **original**: no recrear
> los títulos de *Se7en* ni otros trabajos suyos; no copiar sus cuadernos/props.

**En Clipmill:** renderizar el clip a `ejemplo/public/motion-fx/<id>.mp4` y usarlo con `<Video>` (ver `motion-fx-core` § En Clipmill).
Para una composición React nativa con estos mismos referentes, usar `skills/motion-cine`.

**Requiere** `motion-fx-core` (leer su SKILL.md: flujo, API, revisión con hoja de contactos).

## Filosofía
- **Los títulos son el prólogo de la historia**: deben meter al espectador en la cabeza del personaje
  antes de la primera escena. Pensar "¿qué objetos obsesionan a este personaje?".
- **Lo hecho a mano**: tipografía rayada en la emulsión, escrita con aguja, impresa, fotocopiada,
  escaneada. Imperfección intencional.
- **Montaje como estado mental**: cortes nerviosos, planos de 4–20 cuadros, ritmo que acelera.
- Ruido gráfico y sonoro trabajan juntos (industrial, cuerdas desafinadas, glitches de audio).

## Lenguaje visual
| Elemento | Regla |
|---|---|
| Paleta | Casi monocroma: negros profundos, blancos sucios `#e9e4d6`, verde-amarillo enfermizo en el grade |
| Tipografía | Mecanografiada (FreeMono/Courier), serif condensada o letra rayada a mano. Tamaño pequeño para créditos, enorme y recortada para detalles |
| Textura | Macro de objetos (tinta, óxido, papel, piel, hilos), polvo, rayas, fotogramas quemados |
| Movimiento | Temblor de proyector (`jitter_offset`), doble impresión desalineada, sacudidas verticales del cuadro |
| Montaje | Lista de planos con tiempos; flash frames de 1–3 cuadros; negro entre bloques |
| Acabado | `scratches`, `flicker`, grade de baja saturación, `chromatic` 2, `vignette` fuerte, grano 15–20 |

## Recetas técnicas (mfx)
- **Lista de planos** (`SHOTS` en `scripts/demo.py`): tuplas `(inicio, fin, tipo)` y una función `shot_at(t)`.
  Así se edita el montaje como en una timeline.
- **Doble impresión**: dibujar el texto dos veces con distinto `jitter_offset`, una al 35 % de opacidad.
- **Escritura que aparece**: mostrar `texto[:n]` con `n` creciente, más parpadeo por cuadro.
- **Macro-textura**: `smoke()` a baja resolución, escalada y teñida (`tint`), con zoom lento.
- **Negativo intermitente**: `255 - x` en cuadros alternos (`i % 3 == 0`).
- **Usar material del usuario**: si hay fotos (`--image`), recortarlas en detalle extremo, pasarlas a
  alto contraste (`grade(contrast=1.6, sat=0)`) e intercalarlas como planos de 6–10 cuadros.
- Si se quiere letra rayada real: escribir/rayar sobre papel, escanear en PNG y cargarla con `load`.

## Demo
```bash
python3 skills/estilo-kyle-cooper/scripts/demo.py --preview --out cooper.mp4 \
  --text "OBSESION" --sub "dirigida por|escrita por|musica de"
```
Beats (9 s): negro → macro de tinta → flash → créditos temblorosos alternados con macros → letras
gigantes invertidas → flash → el título se escribe y se sacude → negro.

## Checklist
- ¿Ningún plano dura más de ~1 s salvo el título? ¿Hay flash frames?
- ¿Se siente físico y sucio, no digital? (si no, más rayas, grano y temblor)
- Los créditos tienen que poder leerse al menos 0.7 s, aunque tiemblen.
