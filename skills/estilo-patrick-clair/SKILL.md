---
name: estilo-patrick-clair
description: |
  Crea openings y títulos inspirados en Patrick Clair (Antibody): doble exposición de retratos y paisajes,
  push-ins lentísimos, tinta y humo dentro de siluetas, paleta desaturada melancólica, tipografía serif
  fina con tracking amplio. Usar cuando el usuario pida: estilo Patrick Clair, opening de serie de prestigio
  (HBO), doble exposición, intro tipo True Detective/Westworld, títulos atmosféricos, melancólicos,
  contemplativos o de thriller sureño.
---

# Estilo Patrick Clair

> Inspirado en los principios de Patrick Clair. Obra **original**: no recrear openings concretos
> (*True Detective*, *Westworld*, *Daredevil*…).

**En Clipmill:** renderizar el clip a `ejemplo/public/motion-fx/<id>.mp4` y usarlo con `<Video>` (ver `motion-fx-core` § En Clipmill).
Para una composición React nativa con estos mismos referentes, usar `skills/motion-cine`.

**Requiere** `motion-fx-core`.

## Filosofía
- **Metáfora del personaje**: el paisaje *vive dentro* de la persona (doble exposición): el lugar como
  identidad, culpa o memoria.
- **Lentitud hipnótica**: todo se mueve siempre, pero muy despacio. Push-ins continuos, sin cortes bruscos.
- Imágenes **casi abstractas** que el espectador completa; el significado se revela poco a poco.
- Música lenta y emotiva: los fundidos y las revelaciones siguen las frases musicales, no los golpes.

## Lenguaje visual
| Elemento | Regla |
|---|---|
| Paleta | Desaturada (sat 0.4–0.6), negros levantados con tinte azul-verde, altas luces cálidas ámbar |
| Composición | Silueta (perfil, figura) grande y descentrada; paisaje/industria dentro; mucho negro |
| Texturas | Tinta en agua, humo, fuego lento, nubes, fuga de luz cálida |
| Tipografía | Serif clásica fina (C059, o Cormorant/Garamond libres), MAYÚSCULAS, tracking amplio que se cierra lentamente |
| Movimiento | Push-in 5–15 % por plano, paralaje leve entre base e interior, fundidos de 1–1.5 s |
| Transiciones | Disolvencias encadenadas, a veces a través de un fogonazo de luz |

## Recetas técnicas (mfx)
- **Doble exposición**: `double_exposure(base, inner, gamma)`: el interior aparece en las luces de la base.
  `gamma` > 1 limpia los bordes. Con retratos reales: `--image retrato.jpg` (fondo claro, sujeto oscuro o al revés).
- **Tinta que avanza**: `smoke()` a 1/3 de resolución, escalada, en `multiply` con intensidad creciente.
- **Fuga de luz**: gradiente radial cálido en `screen` que deriva con `wiggle` lento (`light_leak` del demo).
- **Push-in**: `transform(img, lerp(1.0, 1.12, ease_in_out_cubic(t/T)))`, distinto para base e interior.
- **Siluetas sin foto**: polígono de perfil normalizado (`PROFILE` en el demo) + `blur` leve.
- Para 3D (estatuas, humo volumétrico real): Blender con `blender_kit.fog()` y cámara lenta, y después
  `double_exposure` en mfx.

## Demo
```bash
python3 skills/estilo-patrick-clair/scripts/demo.py --preview --out clair.mp4 \
  --text "TIERRA BALDIA" --sub "temporada uno" [--image retrato.jpg]
```
Beats (10 s): fade desde negro → perfil con paisaje y torres dentro → la tinta invade la figura →
el título aparece con tracking que se cierra → fundido a negro.

## Checklist
- ¿Hay movimiento en cada cuadro, aunque sea mínimo? ¿Ningún corte brusco?
- ¿La silueta se lee en miniatura? ¿El interior aporta significado (lugar, oficio, trauma)?
- ¿Saturación baja y negros con tinte frío?
