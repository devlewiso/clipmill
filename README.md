# Clipmill

**La fábrica de videos con IA en piloto automático:** de una idea a un video publicado en YouTube y TikTok,
con un lienzo de flujos donde ves lo que genera cada paso.

> Clipmill es el nombre comercial. El paquete, la CLI y las rutas internas siguen llamándose `fotograma`.

Framework para hacer videos con React. Núcleo, renderer, estudio, transiciones y efectos propios
(sin código bajo la "Remotion License"; ver [src/terceros/LICENCIAS.md](src/terceros/LICENCIAS.md)).

```bash
npx fotograma estudio                       # previsualizar y renderizar en el navegador (puerto 3060)
npx fotograma render Efectos out/fx.mp4     # renderizar (h264 | vp9 | prores | gif)
npx fotograma imagen Portada out/p.png      # un frame como PNG
npx fotograma lista                         # composiciones del proyecto
npx fotograma ritmo musica.mp3              # beats, compases y acentos → musica.ritmo.json
```

## Estudio

`npx fotograma estudio` abre **http://127.0.0.1:3060**. Pestañas:

- **Composiciones**: el lateral tiene dos grupos con bloques plegables (se recuerda cuáles abriste):
  **Canales** (un bloque por canal, definidos por vos
  con tus guiones arriba en «✎ Mis videos» y debajo las carpetas por día) y **Ejemplos** (✨ Demos, 🎞️ Edits, 🔤 Título).
  La regla de qué va a cada canal está en [`app/estudio/canales.ts`](app/estudio/canales.ts) (una línea por canal).
  Visor con zoom, tablero de transparencia, pantalla completa, velocidad, bucle, rango de entrada/salida (I/O),
  línea de tiempo con una pista por `Secuencia`, `Audio` y `Video`, props como formulario o JSON, y render.
  Los renders van a la **[cola](docs/cola-y-retake.md)** (de a uno, reordenable, sobrevive a reinicios) y con un
  rango marcado se puede hacer **Retake**: rehacer solo ese tramo y pegarlo sobre el video ya renderizado.
- **✂ Limpiar**: [editar una toma a cámara por su texto](docs/limpiar.md). Clipmill propone qué cortar (muletillas,
  tomas repetidas, arranques en falso) y lo editás como texto: seleccionar y borrar, devolver, mover frases
  (Ctrl+X / Ctrl+V), deshacer (Ctrl+Z), con vista previa de cómo queda. Genera el clip para Tutorial Viral o la toma
  limpia para el Noticiero, con [ruido de fondo](docs/ruido.md) suave / normal / fuerte (RNNoise) y «🎧 Comparar». Ahí mismo, **📐 [Reencuadrar](docs/reencuadrar.md)**: pasa un video a 9:16 / 4:5 / 1:1 / 16:9
  siguiendo la cara (detección local, como «auto reframe» de CapCut).
- **Flujos**: automatización tipo n8n dentro de Clipmill (no hace falta n8n). Editor de nodos con triggers
  (manual, cron, webhook en `/webhook/<ruta>`), HTTP, Código (compatible con `$json`, `$('Nodo')`, `$input`), IF, Loop,
  Unir, tablas de datos, LLM (Ollama/OpenAI con esquema JSON, reintentos y modelo de respaldo), Kie, ElevenLabs,
  YouTube, TikTok, Telegram y los nodos de Clipmill: **Crear guion → Voz del guion → Render**.
  Ejecución en vivo, datos de entrada/salida de cada nodo, historial, credenciales (`~/.config/fotograma/`),
  plantillas ("Diálogo con personajes", "Flujo en blanco"; agregá las tuyas en `cli/flujos/plantillas.ts`) e **importación de workflows de n8n**.
  Los flujos se guardan en `flujos/`, las tablas en `datos/tablas/` y lo generado en `.fotograma/`.
- **Videos**: lo renderizado y la biblioteca, para publicar en YouTube / TikTok.
- **Recursos**: archivos de `public/` (arrastrar para subir, clic para copiar la ruta). En un audio, **🥁 Ritmo**
  detecta beats y compases para [cortar al ritmo](docs/ritmo.md).
- **Personajes**: fichas de personajes (`public/personajes/<id>/personaje.json`).

En la cabecera:

- **📱 Remoto**: [usar Clipmill desde el teléfono](docs/remoto.md) en la misma red (emparejar con QR): cola,
  encolar renders, ver los videos terminados y el asistente. No publica ni ejecuta flujos.
- **✦ Asistente**: [chat con herramientas](docs/asistente.md) que edita guiones, clips y flujos, genera recursos y
  maneja la cola («encolá los 3 idiomas», «hacé retake de 10 a 14 s»). Usa **Claude Code** (`claude -p`) por defecto.

Atajos: espacio, ←/→ (Shift = 1 s), Home/End, I/O, X, L, M, F, ?.

### Guías

| Guía | Qué explica |
|---|---|
| [docs/cola-y-retake.md](docs/cola-y-retake.md) | Cola de trabajos persistente, reordenar/cancelar/reintentar, Retake de un tramo, API |
| [docs/limpiar.md](docs/limpiar.md) | Pestaña Limpiar: detector (`limpiar.py`), edición por texto (cortar, mover, deshacer) y clip limpio |
| [docs/reencuadrar.md](docs/reencuadrar.md) | Reencuadrar a otro formato siguiendo la cara (YuNet local), CLI y cómo mueve la «cámara» |
| [docs/bajar-musica.md](docs/bajar-musica.md) | Ducking: la música baja sola bajo la voz (`bajarCon` / `grupo` en `<Audio>` y `<Video>`) |
| [docs/velocidad.md](docs/velocidad.md) | Velocidad por clip, cámara lenta suave (minterpolate) y congelar cuadro |
| [docs/color.md](docs/color.md) | Looks de color por clip (`fotograma/color`) y LUTs `.cube` en las tomas de cámara |
| [docs/linea-de-tiempo.md](docs/linea-de-tiempo.md) | Línea de tiempo editable de los videos de guion: clips, frases, textos y stickers |
| [docs/ruido.md](docs/ruido.md) | Quitar el ruido de fondo de la voz (RNNoise): niveles, Comparar en Limpiar, `limpiarRuido` |
| [docs/ritmo.md](docs/ritmo.md) | Ritmo: detectar beats/compases y `fotograma/ritmo` para cortar y animar al golpe |
| [docs/remoto.md](docs/remoto.md) | Remoto: emparejar el teléfono, seguridad, API del puerto 3061 |
| [docs/asistente.md](docs/asistente.md) | Asistente: proveedores (Claude Code / Ollama), herramientas, confirmaciones |

## Proyecto

El proyecto exporta sus composiciones en `src/composiciones.tsx`:

```tsx
import { Capa, definirComposicion, resorte, useFrame, useVideo } from 'fotograma'

const Hola = ({ texto }: { texto: string }) => {
  const frame = useFrame()
  const { fps } = useVideo()
  const s = resorte({ frame, fps })
  return <Capa style={{ alignItems: 'center', justifyContent: 'center', fontSize: 120, transform: `scale(${s})` }}>{texto}</Capa>
}

export default [
  definirComposicion({
    id: 'Hola',
    componente: Hola,
    props: { texto: 'Hola' },
    esquema: { texto: { tipo: 'texto', etiqueta: 'Texto' } }, // formulario en el estudio
    ancho: 1920, alto: 1080, fps: 30, duracion: 90,
  }),
]
```

`calcularMetadatos(props)` permite que la duración o el tamaño dependan de las props (así funcionan los guiones).

## Módulos

| Import | Qué trae |
|---|---|
| `fotograma` | `useFrame`, `useVideo`, `interpolar`, `interpolarColor`, `Curvas`, `resorte`, `aleatorio`, `Capa`, `Secuencia`, `Serie`, `Bucle`, `Congelar`, `Imagen`, `Video`, `Audio`, `cargarFuenteGoogle`, `useCarga` |
| `fotograma/transiciones` | `SerieTransiciones` + fundido, deslizar, empujar, barrido, iris, zoom, desenfoque, voltear, persiana, reloj, puertas, destello; `tiempoLineal`, `tiempoResorte` |
| `fotograma/fx` | `Grano`, `Vineta`, `Escaneo`, `Parpadeo`, `AberracionCromatica`, `Glitch`, `Sacudida`, `KenBurns`, `Aparecer`, `MaquinaDeEscribir`, `PalabraPorPalabra`, `NumeroAnimado`, `Subtitulos` |
| `fotograma/formas` | `Circulo`, `Elipse`, `Rectangulo`, `Triangulo`, `Estrella`, `Poligono`, `Corazon`, `Pastel`, `Flecha`, `Globo`, `Chispa`, `TrazoAnimado` |
| `fotograma/trazos` | utilidades de trazos SVG (medir, cortar, interpolar, deformar) |
| `fotograma/ruido` | `ruido2D/3D/4D` deterministas |
| `fotograma/subtitulos` | `parseSrt`, `serializeSrt`, páginas estilo TikTok |
| `fotograma/color` | `Color`, `filtroColor`, `LOOKS`: looks de color con intensidad ([guía](docs/color.md)) |
| `fotograma/ritmo` | `usePulso`, `useGolpe`, `pulso`, `faseEntreGolpes`, `cortesAlRitmo`: cortar y animar al golpe de la música ([guía](docs/ritmo.md)) |
| `fotograma/guion` | tipos de guion, `parsearGuion`, `composicionDeGuion` |
| `fotograma/render` | API de Node: `renderizar()`, `listarComposiciones()` |

## Cómo renderiza

1. Vite sirve el proyecto; la página `/__fotograma/render` monta la composición a tamaño real.
2. Varias instancias de Chrome headless (una por núcleo de trabajo) van frame a frame:
   `irA(frame)` pinta con React y espera imágenes, videos y fuentes (`esperarCarga`).
3. ffmpeg une los frames y mezcla las pistas de `<Audio>` y `<Video>` en su posición (bajando la música bajo la
   voz donde se pidió con `bajarCon`, ver [docs/bajar-musica.md](docs/bajar-musica.md)).

Requisitos: Node 20+, Chrome/Chromium (`FOTOGRAMA_CHROME` para otra ruta) y ffmpeg (`FOTOGRAMA_FFMPEG`).
Opcionales: Python con faster-whisper para Limpiar (`FOTOGRAMA_PY`), Claude Code (`claude`) u Ollama para el asistente.

### Variables de entorno

| Variable | Para qué | Por defecto |
|---|---|---|
| `FOTOGRAMA_HOST` | Dónde escucha el estudio. `0.0.0.0` lo abre a la red **sin contraseña**: para el teléfono usá Remoto | `127.0.0.1` |
| `FOTOGRAMA_REMOTO_PUERTO` | Puerto de Remoto | `3061` |
| `FOTOGRAMA_AGENTE_PROVEEDOR` | Modelo del asistente: `claude` (Claude Code) u `ollama` | `claude` |
| `FOTOGRAMA_AGENTE_MODELO` | Modelo (`sonnet`, `opus`, `haiku` con Claude; p. ej. `deepseek-v4.1-flash:cloud` con Ollama) | `sonnet` |
| `FOTOGRAMA_RNNOISE` | Modelo RNNoise para quitar ruido de la voz | `~/.cache/clipmill/rnnoise-sh.rnnn` |
| `FOTOGRAMA_YUNET` | Modelo de caras para Reencuadrar | `~/.cache/clipmill/face_detection_yunet_2023mar.onnx` |
| `FOTOGRAMA_PY` | Python con faster-whisper y onnxruntime (Limpiar, Reencuadrar) | `python3` |
| `FOTOGRAMA_CHROME`, `FOTOGRAMA_FFMPEG` | Rutas de Chrome y ffmpeg | autodetectadas |

### Configuración opcional (`~/.config/fotograma/config.json`)

```json
{
  "biblioteca": "/ruta/a/tus/videos",
  "canales": { "mi-canal": { "cuenta": "YouTube - Mi canal", "categoria": "22" } }
}
```

- `biblioteca`: carpeta donde se archivan los videos terminados (también `FOTOGRAMA_BIBLIOTECA`).
- `canales`: cuenta de YouTube (nombre de la credencial) y categoría para publicar desde la biblioteca.
- Otras variables: `FOTOGRAMA_HERRAMIENTAS` (scripts/tokens de TikTok y Telegram), `FOTOGRAMA_PROTEGIDOS`
  (rutas extra que los flujos nunca tocan, separadas por `:`), `FOTOGRAMA_VIDEOS_DATOS` (carpetas de JSON de videos editables).

## Empezar

```bash
npm install
cd ejemplo && npm install
npx fotograma estudio        # http://127.0.0.1:3060
```

El [`ejemplo/`](ejemplo/) trae demos neutras (título en 3 formatos, transiciones, efectos y formas).
Las skills de motion graphics por estilo (`skills/estilo-*`, motor en `skills/motion-fx-core`) generan clips con Python + ffmpeg/Blender.
