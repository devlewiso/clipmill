---
name: estilo-erin-sarofsky
description: |
  Crea tipografía cinética y títulos enérgicos inspirados en Erin Sarofsky (Sarofsky studio): paneles
  gráficos diagonales, colores primarios saturados, semitonos tipo cómic, palabras que golpean al ritmo,
  bloques de título apilados con sombra dura. Usar cuando el usuario pida: estilo Sarofsky, títulos de
  superhéroes, kinetic typography, intro enérgica, video promocional con ritmo, títulos de comedia o
  acción, estética cómic, lyric video, títulos para redes con mucho punch.
---

# Estilo Erin Sarofsky

> Inspirado en los principios de Erin Sarofsky y su estudio. Obra **original**: no recrear los títulos de
> películas de Marvel ni usar personajes o logos con licencia.

**En Clipmill:** renderizar el clip a `ejemplo/public/motion-fx/<id>.mp4` y usarlo con `<Video>` (ver `motion-fx-core` § En Clipmill).

**Requiere** `motion-fx-core`.

## Filosofía
- **El tono primero**: los títulos traducen la personalidad de la película (divertida, heroica,
  irreverente) a ritmo y tipografía.
- **Diseño gráfico audaz**: composiciones de póster, color plano, contraste máximo.
- **Ritmo musical**: cada palabra, panel y corte cae en un beat. Calcular todo en beats, no en segundos.
- Juego y sorpresa: transiciones ingeniosas que convierten un elemento en el siguiente.

## Lenguaje visual
| Elemento | Regla |
|---|---|
| Paleta | Primarios saturados: amarillo `#ffd400`, rojo `#e4002b`, azul `#0a2ecc`, negro `#111`, papel `#f7f3ea` |
| Tipografía | Sans muy bold y compacta (tracking negativo), MAYÚSCULAS, sombra dura desplazada |
| Formas | Paneles diagonales (−12°), bloques rotados ±3° detrás de las palabras, viñetas de cómic |
| Textura | Semitono (puntos) en multiply o add, que crece en gradiente |
| Movimiento | `ease_out_back` para el pop de palabras, `ease_out_expo` para paneles; punch de escala en cada beat |
| Ritmo | BPM definido (120 por defecto); `beat(t,bpm)` da la fase; sacudidas en los downbeats |

## Recetas técnicas (mfx)
- **Tiempo en beats**: `SPB = 60/BPM`; `b = int(t/SPB)`; `ph = beat(t, BPM)`. Si hay música real, medir el
  BPM (`ffmpeg -i m.mp3 -af "ebur128" -f null -` da la sonoridad; o pedir el BPM al usuario).
- **Panel diagonal**: `panel()` del demo: paralelogramo que barre el cuadro desde un lado.
- **Pop de palabra con sombra dura**: dibujar en negro desplazado 10 px y encima en color, escala `ease_out_back`.
- **Semitono**: `halftone(W,H,t,color,cell,angle)`: puntos que crecen hacia un lado y se desplazan.
- **Punch al beat**: `transform(img, 1 + 0.025*(1-ph)**6)`.
- **Bloques apilados**: un `rect` rotado por palabra, entrando alternadamente por izquierda y derecha.
- Para 9:16 (Reels/TikTok): `--w 1080 --h 1920` y apilar palabras en vertical.

## Demo
```bash
python3 skills/estilo-erin-sarofsky/scripts/demo.py --preview --out sarofsky.mp4 \
  --text "EQUIPO IMPARABLE" --sub "CADA HEROE|TIENE UN|ORIGEN"
```
Beats (8 s a 120 BPM): una palabra cada 2 beats sobre paneles de color que barren → lockup final con
bloques apilados, semitono y punch en cada beat.

## Checklist
- ¿Cada evento cae en un beat? ¿Las palabras se leen en ≤ 1 beat?
- ¿Máximo 3 colores por cuadro + negro/papel?
- ¿Se siente divertido y con energía, no corporativo?
