---
name: estilo-ash-thorp
description: |
  Crea interfaces de ciencia ficción (FUI/HUD) y títulos tecnológicos inspirados en Ash Thorp: monocromo
  con un solo acento (naranja), rejillas, anillos con ticks, datos vivos, miras que fijan objetivo,
  tipografía mono fina, texto que se decodifica. Usar cuando el usuario pida: estilo Ash Thorp, HUD,
  interfaz futurista, FUI, pantalla sci-fi, dashboard de nave, intro tech/cyberpunk, overlay de datos,
  título que se descifra, motion para producto de tecnología.
---

# Estilo Ash Thorp

> Inspirado en los principios de diseño de Ash Thorp. Obra **original**: no recrear las interfaces de
> películas concretas (*Ender's Game*, *Ghost in the Shell*…).

**En Clipmill:** renderizar el clip a `ejemplo/public/motion-fx/<id>.mp4` y usarlo con `<Video>` (ver `motion-fx-core` § En Clipmill).

**Requiere** `motion-fx-core`.

## Filosofía
- **Diseño como mundo**: cada pantalla sugiere un sistema real, con una función creíble (navegación,
  biometría, armas). Inventar la lógica antes de dibujar.
- **Restricción**: 1 color neutro + 1 acento. El acento solo marca lo importante (objetivo, alerta).
- **Precisión obsesiva**: líneas de 1 px, alineación a una rejilla, tipografía pequeña y nítida.
- Lo bello está en la **jerarquía**: un elemento protagonista enorme y muchos elementos secundarios tenues.

## Lenguaje visual
| Elemento | Regla |
|---|---|
| Paleta | Fondo `#07090c`; línea `#dfe6ee`; secundario `#4a5562`; acento `#ff5a1f` (o cian `#3ad0ff`) |
| Tipografía | Mono fina (JetBrains Mono Light/Thin), MAYÚSCULAS, tracking +2–4 px, cuerpos de 11–16 px a 1080p |
| Formas | Anillos segmentados con ticks, esquinas de encuadre, barras de nivel, rejilla de 80 px |
| Datos | Números que cambian con `wiggle`, códigos tipo `ALT_03`, timecode |
| Movimiento | Los elementos **se dibujan** (longitud de arco y línea 0→1) con `ease_in_out_expo`, escalonados |
| Acabado | Glow suave (umbral 150), `scanlines` sutiles, CA 1 px, grano bajo |

## Recetas técnicas (mfx)
- **Anillo con ticks**: `ring()` del demo: `arc` de 0 a 360·p + ticks cada 5° (largos cada 30°).
- **Esquinas**: `bracket(img, box, u, p)` dibuja las 4 esquinas que crecen con p.
- **Decodificación**: `decode(text, p)`: lo ya fijado queda; los siguientes 6 caracteres cambian al azar por cuadro.
- **Fijar objetivo**: la mira interpola posición y tamaño hacia el objetivo con `ease_out_expo`; al llegar
  cambia a color acento y parpadea una etiqueta.
- **Overlay sobre video**: componer el HUD en una `layer` RGBA y ponerla en `screen` sobre la placa del usuario.
- **Hologramas 3D**: Blender con materiales `emissive` en modo wireframe (modificador Wireframe) + glow en mfx.

## Demo
```bash
python3 skills/estilo-ash-thorp/scripts/demo.py --preview --out thorp.mp4 \
  --text "PROYECTO ORBITA" --sub "SISTEMA DE NAVEGACION v2.6"
```
Beats (8 s): la rejilla barre → se dibujan los anillos → entran los paneles de datos → la mira fija el
objetivo → el título se decodifica → subtítulo en acento → fade.

## Checklist
- ¿Solo un color de acento? ¿Las líneas son finas y nítidas (sin blur)?
- ¿Hay un protagonista claro? ¿Los datos se mueven sin distraer?
- Revisar la hoja de contactos a tamaño real: la letra pequeña debe seguir legible a 1080p.
