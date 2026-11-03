---
name: motion-cine
description: Shorts/Reels dev y tech «de título de cine» en Clipmill — Kyle Cooper (tipografía que actúa, película rayada, stop motion a dos, cajas rojas a mano, flashes de un cuadro) con cámara de Patrick Clair (empujes lentos, foco que viaja por una captura real). Usar cuando el usuario pida un video para redes sobre una herramienta/repo/IA «bien top», «motion graphics + stop motion», «estilo Kyle Cooper / Se7en / títulos de cine».
---

# Motion «de cine» (Cooper + Clair) en Clipmill

Referentes elegidos: **Kyle Cooper** (lenguaje) + **Patrick Clair** (cámara). Se toman sus *principios*, nunca copias de
secuencias concretas.

## Principios (Cooper)
- **La tipografía es el personaje**: palabras grandes en Anton (mayúsculas), entran de golpe (escala 1.7→1 con resorte) y quedan
  temblando apenas, como recortes fotografiados. Texto secundario en máquina de escribir (Special Elite) que se tipea.
- **Stop motion a dos**: todo lo «hecho a mano» cambia de pose cada 2 cuadros (`dos(f)`, `tiembla(k, f)` con `aleatorio`).
- **Remarcar = marcador rojo**: cajas y subrayados que se trazan con dos pasadas y «hierven» (`Caja`), etiquetas de papel hueso
  con barra roja (`Etiqueta`), sellos de goma (`Sello`).
- **Película**: grano (feTurbulence con semilla cada 2 cuadros), rayas verticales, polvo, parpadeo, viñeta y gate weave.
- **Cortes con flash**: un cuadro blanco + un cuadro en negativo en cada golpe (lista `flashes` del JSON).
- Paleta corta: negro cálido `#0b0a09`, hueso `#ece4d2`, rojo `#ff3b2f` (+ un color funcional: verde Android para «ok»).

## Cámara (Clair)
- Cada escena empuja lento hacia adelante (`Empuje`, 1→1.04–1.08), nunca quieta.
- Capturas reales (repo, web) como un plano: keyframes `[cuadro, escala, cx, cy]` en px de la imagen, foco que viaja de dato en
  dato; la caja roja vive *dentro* de la imagen (sigue la cámara) y la etiqueta *fuera* (fija abajo).
- Captura real con Chrome headless (`puppeteer-core` + `/usr/bin/google-chrome`, modo oscuro, `deviceScaleFactor: 2`).

## Sonido
- Una pista sintetizada por video que lee **el mismo JSON** de tiempos (`public/audio/<id>/generar.py`): tecla por letra,
  whoosh por swipe, obturador por flash, base que se llena por escena. Golpes de corte = `sonidos/cine/` (limpios, nunca `sfx/impacto*`).

## Entregar
- Datos con fuente (`"fuente"` en el JSON). Cuadros con `fotograma imagen` → hoja de contactos → `npx tsc --noEmit` → commit.
  **Sin render hasta que el usuario lo vea en Clipmill**; publicar solo con su OK.
