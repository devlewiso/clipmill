---
name: estilo-gmunk
description: |
  Crea gráficos de luz, hologramas e interfaces cinematográficas inspirados en GMUNK (Bradley G. Munkowitz):
  la tecnología como material visual, wireframes holográficos que se arman en volumen, esculturas de luz en
  niebla fotografiadas "en cámara", proyección mapeada sobre superficies en movimiento (ilusiones ópticas),
  geometría sagrada, texturas intensas, psicodelia, paletas infrarrojas y acabado de lente (flare, CA, haze).
  Usar cuando el usuario pida: estilo GMUNK, holograma, UI/pantallas de película sci-fi, look Tron/Oblivion
  sin copiarlos, escultura de luz, wallpaper de luz, projection mapping, ilusión óptica, arte generativo
  psicodélico, intro tech premium, visuales para show/instalación o NFT/arte digital.
---

# Estilo GMUNK

> Inspirado en los principios y la trayectoria de GMUNK. Obra **original**: no recrear los hologramas o UIs
> de *Tron: Legacy*, *Oblivion* o *Top Gun: Maverick*, ni el wallpaper "Hero" de Windows, ni logos de Disney,
> Universal, Microsoft o Coca-Cola.

**Requiere** `motion-fx-core` (y `blender_kit.py` para la variante 3D de luz volumétrica).

## Trayectoria (para entender de dónde sale el lenguaje)
| Obra | Qué aporta al estilo |
|---|---|
| **Flash experimental y motion design** (años 2000; MK12, Imaginary Forces y otros) | Geometría generativa, tipografía técnica, ritmo gráfico |
| ***Tron: Legacy*** (2010, Digital Domain) | Dirigió el diseño de gráficos de pantalla y **hologramas**: más de 12 min de contenido. Lo clave: líneas de luz que construyen volumen, interfaces que flotan en el espacio, glow controlado sobre negro, cian/blanco con acentos naranjas |
| ***Oblivion*** (2013) | Diseñador principal de interfaces: **UI limpia, blanca, funcional y cinematográfica**, con mucha información pero legible, tipografía fina, paneles translúcidos, datos que "respiran" |
| **BOX** (2013, con Bot & Dolly) | Corto de **proyección mapeada sobre pantallas movidas por brazos robóticos** y cámara robótica sincronizada: ilusiones ópticas (cubos imposibles, túneles, espacio que se pliega) filmadas en cámara. Grand Prix en Cannes y Best in Show en SIGGRAPH |
| **"Hero" de Windows 10** (2015) | **Escultura de luz física** (proyección a través de humo y geometría) fotografiada en cámara, no un render: la luz como material tangible, volumétrica, con haze y profundidad |
| ***Top Gun: Maverick*** (2022) | Pantallas e interfaces de cabina creíbles: realismo funcional, telemetría, HUD sobrio |
| **Fotografía infrarroja**, dirección live action, AR, instalaciones | Paletas "imposibles" (follaje blanco/rosa, cielos oscuros), textura fotográfica, luz real |
| **Arte digital / generativo** (p. ej. *Piece of Magic* con Coca-Cola, 2022, 10.000 piezas derivadas de datos de partidos) | Sistemas generativos alimentados por datos: una regla → miles de variaciones |

**Filosofía:** reinvención deliberada (cambiar de medio para no quedar atado a un estilo), proyectos personales
como laboratorio, y que una técnica contamine a la otra: fotografía ↔ diseño ↔ dirección ↔ instalación.

## Lenguaje visual
| Elemento | Regla |
|---|---|
| Material | **La luz es el material**: líneas, planos y haces de luz sobre negro profundo; sumar en modo `add`/`screen`, nunca pintar luz opaca |
| Paletas | *Holograma*: negro `#030509`, cian `#7FE9FF`, blanco `#F2FBFF`, acento naranja `#FF8A2A` · *Escultura*: azul profundo `#0A1AFF` → cian, con núcleo blanco · *Infrarrojo*: magenta `#FF3DA8`, rosa `#FFB3DA`, blanco, cielo `#120A1E` |
| Geometría | Sagrada y técnica: icosaedros, toros, anillos concéntricos, rejillas en perspectiva, cuadrículas polares, moiré |
| Línea | Fina (1–2 px), con glow suave en capas (núcleo nítido + halo amplio); el detalle aparece de cerca, el volumen de lejos |
| Profundidad | Las líneas lejanas se apagan y azulan; partículas/polvo en el haz; haze volumétrico |
| Movimiento | Lento, preciso, "de máquina": rotaciones continuas, construcción línea por línea (*build-on*), barridos de escaneo, pulsos de datos; cortes en el beat |
| Texto/UI | Mono o sans técnica fina en MAYÚSCULAS con tracking amplio, etiquetas pequeñas con números vivos, corchetes y ticks |
| Acabado | Lente real: flare anamórfico tenue, aberración cromática, grano fino, viñeta; textura intensa (ruido, moiré) |

## Capacidades clave (y cómo hacerlas con mfx)
1. **Holograma wireframe que se construye**: proyectar en perspectiva los vértices de un sólido 3D
   (`proyectar()` del demo), dibujar aristas con `line`, revelarlas en orden (`build-on` por índice), apagar por
   profundidad y sumar `glow()` en dos radios. Agregar scanline que barre y parpadeo leve (`flicker`).
2. **Interfaz flotante (estilo Oblivion, original)**: anillos con ticks (`arc`), etiquetas mono, números que
   cuentan, paneles translúcidos (`rect` con opacidad), todo con un solo acento.
3. **Escultura de luz en niebla**: planos/hojas de luz que rotan, se suman en `add`, más `light_rays()` desde
   el núcleo y `smoke()` multiplicado como haze → se ve "fotografiado". Variante 3D: Blender con volumen
   (Principled Volume) y luces de área/spot con gobos, cámara fija con lente larga.
4. **Proyección mapeada / ilusión óptica (BOX)**: dos o tres paneles en perspectiva que se mueven como si los
   llevara un robot; dentro de cada uno, un patrón (túnel de cuadros, cubo imposible, rejilla) calculado desde el
   punto de vista de la cámara para que "rompa" la superficie. Sincronizar los cortes con el movimiento.
5. **Psicodelia generativa**: interferencia de anillos concéntricos (moiré), rotación de matiz, simetría radial
   (caleidoscopio), alimentado por datos o por el audio (`beat`).
6. **Paleta infrarroja**: `duotone`/`grade` que mapea verdes → blanco/rosa y cielo → violeta oscuro.
7. **Sistema → variaciones**: una función con semilla produce N piezas distintas (series para redes o arte digital).

## Demo
```bash
python3 skills/estilo-gmunk/scripts/demo.py --preview --out gmunk.mp4 \
  --text "LA LUZ ES EL MATERIAL" --sub "SISTEMA 07 // EN CAMARA"
```
Beats (12 s): 1) holograma: un icosaedro y anillos se construyen línea por línea con escaneo y datos ·
2) escultura de luz: hojas de luz azul que rotan en niebla con rayos volumétricos · 3) proyección mapeada:
dos paneles que se mueven con un túnel imposible adentro · 4) psicodelia infrarroja: moiré en magenta y rosa
con el título que se construye y la bajada técnica. Vertical: `--w 1080 --h 1920`.

## En Clipmill
Renderizar a `ejemplo/public/motion-fx/<id>.mp4` y montarlo con
`<Secuencia><Video src="/motion-fx/<id>.mp4" silenciado /></Secuencia>`. Funciona muy bien como fondo de
intros tech, ganchos de reels de IA/programación (estilo `glitch`/`azul` de `reels-motion`) y como
holograma alrededor de un personaje 3D de Clipmill (render de Blender con fondo negro sumado en `screen`).
Sonidos: `public/sonidos/sfx/glitch*`, `zap`, `subida*`, `cine/whoosh*`. Ver `motion-fx-core`.

## Checklist
- ¿La luz se suma sobre negro (no hay "luz" pintada opaca)?
- ¿Hay profundidad: lo lejano se apaga, hay haze y partículas?
- ¿El movimiento es preciso y lento, con construcción línea por línea en vez de fundidos?
- ¿Un solo acento de color por escena? ¿Textura y acabado de lente?
- ¿Se siente original (sin UIs, logos ni plano de películas reales)?
