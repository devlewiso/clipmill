---
name: estilo-saul-bass
description: |
  Crea títulos y motion graphics inspirados en Saul Bass: papel recortado, formas geométricas planas,
  paleta limitada (rojo/naranja, negro, crema), barras y bloques que se mueven con intención, tipografía
  "cortada a mano" y simbolismo gráfico. Usar cuando el usuario pida: estilo Saul Bass, títulos retro de
  cine de los 50/60, intro minimalista geométrica, créditos tipo Hitchcock, animación "cut-out" o
  "paper cut", póster animado, opening de película vintage o mid-century.
---

# Estilo Saul Bass

> Inspirado en los principios de Saul Bass (1920–1996). Crear obra **original**: no recrear
> secuencias reales (*Vertigo*, *Psycho*, *Anatomy of a Murder*…) ni sus pósters.

**En Clipmill:** renderizar el clip a `ejemplo/public/motion-fx/<id>.mp4` y usarlo con `<Video>` (ver `motion-fx-core` § En Clipmill).

**Requiere** la skill `motion-fx-core`: primero leer su SKILL.md para el flujo de trabajo y la API.

## Filosofía
- **Un símbolo resume la película.** Antes de animar, encontrar UNA metáfora visual (una mano, un ojo,
  un laberinto, una espiral, barras) y construir todo alrededor de ella.
- **Reducción**: lo mínimo que comunica. Si sobra un elemento, se quita.
- El título **no se escribe encima**, sino que **forma parte** de la composición: aparece en huecos,
  se parte o lo revelan las formas.
- Movimiento **gráfico y con propósito**: las formas entran, se dividen y se reorganizan como un mecanismo.

## Lenguaje visual
| Elemento | Regla |
|---|---|
| Paleta | 2–3 tintas planas: `#e2491d` (rojo/naranja), `#141210` (tinta), `#efe4cc` (papel). Variantes: azul `#2b4c7e`, amarillo `#f2c12e`, verde `#4b7f52` |
| Formas | Rectángulos, barras, círculos y siluetas con **bordes irregulares** (tijera), nada de vectores perfectos |
| Tipografía | Sans condensada bold o letras dibujadas a mano, **ligeramente rotadas o desalineadas**. Mayúsculas |
| Textura | Papel (ruido de baja frecuencia en multiply) y grano leve |
| Composición | Asimétrica, mucho espacio negativo, alto contraste figura/fondo |
| Movimiento | Entradas escalonadas con `ease_out_expo`, cortes secos, stop-motion en "2s" (12 fps de animación sobre 24) |
| Sonido | Jazz con percusión, orquesta tensa: cortar a los golpes (`beat(t, bpm)`) |

## Recetas técnicas (mfx)
- **Bordes de tijera**: `rough_poly()` en `scripts/demo.py` subdivide los lados y los perturba con `wiggle`.
- **Animar en 2s** (sensación artesanal): usar `t2 = math.floor(t*12)/12` en lugar de `t`.
- **Letras recortadas**: dibujar cada letra en su `layer`, rotarla ±4° con `wiggle(i,...)` y pegarla.
- **Revelado por formas**: dibujar el título y luego barras de color fondo que se retiran con `stagger`.
- **Silueta simbólica**: `poly()` con puntos de una forma sencilla (mano, ojo, llave) y bordes rough.
- **Barras de Bass**: barras verticales u horizontales de distintos anchos que caen, se separan,
  se cruzan (`rect` y `stagger`); el título aparece en el hueco.
- **Textura de papel**: `multiply(x, 255 - value_noise(W,H,6,2,seed)[...,None]*40)`.
- Final: `grain(x, 5)`. Nada de glow, flare ni CA: es tinta plana.

## Demo
```bash
python3 skills/estilo-saul-bass/scripts/demo.py --preview --out bass.mp4 \
  --text "EL ULTIMO VERANO" --sub "una pelicula de nadie"
```
Beats (8 s): barras caen escalonadas → se abren → bloque naranja llena el hueco → el título entra letra
por letra → las barras salen y quedan anillos girando detrás del bloque → créditos → wipe a negro.

## Checklist de revisión (hoja de contactos)
- ¿Cada cuadro funciona como póster por sí solo?
- ¿Hay como máximo 3 colores? ¿El símbolo es legible en miniatura?
- ¿El título se lee con al menos 1.5 s en pantalla?
