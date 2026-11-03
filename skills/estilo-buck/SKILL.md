---
name: estilo-buck
description: |
  Crea animación de diseño "con alma" inspirada en el estudio BUCK: personajes geométricos con squash &
  stretch y anticipación, morphs de forma a forma, match cuts gráficos, color-blocking con barridos
  circulares, mundos 2.5D por capas con parallax, animación "en dos" (12 fps) con line boil, tipografía
  que actúa como personaje, textura riso/grano y paletas planas reducidas. Mezcla 2D y 3D (toon). Usar
  cuando el usuario pida: estilo BUCK, explainer animado, animación de personajes simple y encantadora,
  motion design de marca, transiciones por morph, video de producto/app ilustrado, intro amable para
  YouTube o redes, "algo tipo estudio de animación", loop perfecto, o presentar un personaje de Clipmill.
---

# Estilo BUCK

> Inspirado en los principios del estudio creativo BUCK (diseño, animación 2D/3D, ilustración, narrativa).
> Obra **original**: no recrear piezas, campañas, personajes ni marcas de sus clientes.

**Requiere** `motion-fx-core` (y `blender_kit.py` para la variante 3D toon).

## Filosofía
- **La idea manda, el estilo se adapta**: cada proyecto inventa su propio universo visual. Primero el
  concepto en una frase ("la app ordena tu caos"), después la metáfora visual, recién al final la técnica.
- **Diseño que se mueve**: cada cuadro tiene que funcionar como ilustración (composición, color, aire).
- **Personalidad en el timing**: anticipación → acción → follow-through. Nada se mueve lineal.
- **Todo se transforma**: no hay cortes "muertos"; una forma se convierte en la siguiente (morph, match cut,
  color que invade la pantalla). La transición también cuenta la historia.
- **Simple y encantador**: formas geométricas, pocas líneas, ojos y gestos mínimos que transmiten emoción.
- **Artesanía + tecnología**: textura hecha a mano (grano, riso, boil) sobre animación precisa por código.

## Lenguaje visual
| Elemento | Regla |
|---|---|
| Paleta | 4–5 colores planos y saturados con un fondo cálido. Default: crema `#F6EEDC`, coral `#FF6B4A`, azul `#2D5BFF`, amarillo `#FFC83D`, tinta `#1E1B2E`. Cambiar el fondo entero en cada beat de la historia (color-blocking) |
| Formas | Geometría primaria (círculo, cápsula, rect redondeado, estrella) con esquinas suaves; personajes = forma + 2 ojos + 1 gesto |
| Línea | Sin contorno o contorno grueso uniforme en tinta; nada de degradados realistas, sombras planas en un solo tono |
| Tipografía | Sans geométrica bold y redonda (Baloo 2, Nunito, DejaVu Sans Bold) en minúsculas o mixta; las letras rebotan, se apilan, interactúan con los objetos |
| Movimiento | Squash & stretch con volumen constante, `ease_out_back` para llegar, `ease_in_cubic` para salir, overshoot y asentamiento; arcos, nunca líneas rectas |
| Ritmo | 3–4 s por idea. Cada transición es un morph o un barrido de color desde el objeto protagonista |
| Cadencia | Personajes "en dos" (12 fps dentro de 24/30) para sensación hecha a mano; cámara y fondos a 24/30 suaves |
| Textura | Grano fino + puntos riso/semitono en las sombras + leve line boil (contorno que tiembla cada 2 cuadros) |
| Espacio | 2.5D: capas planas con parallax (fondo lento, medio, primer plano rápido); o isométrico limpio |

## Las capacidades clave (y cómo hacerlas con mfx)
1. **Squash & stretch con anticipación**: `y = rebote(t)`; al tocar el piso `sy = 1 - k`, `sx = 1/sy`
   (volumen constante); antes de saltar se agacha (anticipación 4–6 cuadros); en el aire se estira en la
   dirección del movimiento. Sombra elíptica que se achica con la altura.
2. **Morph forma→forma**: remuestrear ambos contornos al mismo número de puntos (`contorno(forma, n)` del
   demo, empezando en el mismo ángulo) e interpolar punto a punto con `ease_in_out_cubic`; sumar una
   pequeña rotación y un overshoot de escala al final.
3. **Match cut gráfico**: el círculo del plano A pasa a ser el sol/ojo/botón del plano B (misma posición y
   tamaño en el corte).
4. **Color-blocking con barrido circular**: `iris(a, b, p, center=objeto)` desde el protagonista, con
   `ease_in_out_expo`; el color nuevo invade toda la pantalla y se convierte en el fondo de la escena siguiente.
5. **Mundo 2.5D con parallax**: 3–5 capas planas (cerros, nubes, piso, objetos) desplazadas a velocidades
   distintas `x_capa = -cam * profundidad`.
6. **Animación en dos + line boil**: `tq = floor(t*12)/12` para personajes; jitter de vértices con semilla
   `int(t*12)` de ±1.5 px.
7. **Tipografía personaje**: letras que caen con rebote escalonado (`stagger`), se aplastan al aterrizar,
   y una palabra clave cambia de color o se transforma en icono.
8. **Loop perfecto**: el último cuadro = el primero (útil para redes y GIFs): usar funciones periódicas de
   `t / duracion`.
9. **Variante 3D toon (Blender)**: materiales emisivos planos + Toon BSDF / Shader to RGB con rampa de 2–3
   pasos, contorno con Solidify invertido, cámara ortográfica o lente larga, misma paleta.

## Demo
```bash
python3 skills/estilo-buck/scripts/demo.py --preview --out buck.mp4 \
  --text "ideas que se mueven" --sub "hecho con código"
```
Beats (10 s): 1) un personaje-pelota cae, se aplasta y salta con anticipación · 2) se transforma en
cuadrado → estrella → corazón mientras el fondo cambia de color con barridos circulares desde la forma ·
3) el corazón es el sol de un paisaje 2.5D con parallax · 4) el título cae letra por letra, rebota y se
asienta; sub con barrido. Todo con textura riso y grano. Vertical: `--w 1080 --h 1920`.

## En Clipmill
Renderizar el clip con este demo (o una variante) a `ejemplo/public/motion-fx/<id>.mp4` y
montarlo con `<Secuencia><Video src="/motion-fx/<id>.mp4" silenciado /></Secuencia>`; textos, voz
(Kokoro local: `cli/voz-kokoro.py`) y sonidos (`public/sonidos/sfx/pop*`, `cine/whoosh*`) en la
composición. Para presentar un personaje 3D de Clipmill : usar sus GLB con la variante toon
o un render de Blender, y que las píldoras/títulos entren con squash & stretch. Ver `motion-fx-core`.

## Checklist
- ¿La idea se entiende en una frase y cada escena la empuja?
- ¿Cada cuadro funciona como ilustración? ¿Máximo 5 colores planos?
- ¿Todo llega con anticipación, overshoot y asentamiento (nada lineal)?
- ¿Las transiciones son morphs, match cuts o barridos de color, no cortes secos?
- ¿Hay textura (grano/riso/boil) para que no se sienta "plantilla"?
- ¿Es original, sin copiar piezas ni personajes de nadie?
